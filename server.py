"""Servidor opcional de Chat Morse para red local.

Sin servidor, el chat funciona entre pestañas del mismo navegador
(BroadcastChannel). Con este servidor en la red local, los dispositivos
lo encuentran automáticamente y los mensajes se retransmiten entre ellos.

El servidor solo reenvía paquetes: los mensajes de salas privadas llegan
cifrados de extremo a extremo y no puede leerlos.

Uso:  python server.py [--port 5050] [--open] [--set-admin-password]
"""
import argparse
import concurrent.futures
import ctypes
import getpass
import hashlib
import hmac
import ipaddress
import json
import platform
import queue
import re
import secrets
import socket
import subprocess
import sys
import threading
import time
import webbrowser
from collections import defaultdict, deque
from pathlib import Path

from flask import Flask, Response, abort, jsonify, redirect, request, send_from_directory, session

APP_ID = "morse-chat"
VERSION = 2
ROOT = Path(__file__).resolve().parent
STATIC_FILES = {"morse-chat.js", "morse-chat.css", "morse-moderation.js", "nacl-fast.min.js"}
MODERATION_FILE = ROOT / "moderation.json"
WORDS_FILE = ROOT / "stop-words.json"
ADMIN_FILE = ROOT / "admin.json"
LANGS = ("ES", "EN", "RU")
MAX_PACKET = 64 * 1024
PACKET_TYPES = {"presence", "public-message", "private-message", "invite"}
RATE_LIMIT = (40, 10.0)  # paquetes por ventana de segundos y por IP
LOGIN_LIMIT = (5, 60.0)  # intentos de acceso de administrador por IP
LOCAL_HOSTS = {"localhost", "127.0.0.1", "::1", "[::1]"}
DEFAULT_ADMIN_USER = "admin"
DEFAULT_ADMIN_PASSWORD = "686510"
MIN_PASSWORD = 6

app = Flask(__name__)
clients: dict[queue.Queue, str] = {}  # cola SSE -> IP del cliente
clients_lock = threading.Lock()
data_lock = threading.Lock()
recent = defaultdict(deque)
login_attempts = defaultdict(deque)
users: dict[str, dict] = {}  # senderId -> {nickname, language, ip, seen}
PRIMARY_IP = None
PORT = 5050
network_scan_lock = threading.Lock()
network_scan = {"network": None, "interface": None, "devices": [], "updated": 0, "scanning": False, "error": None}


# ---------- Persistencia ----------

def read_json(path, default):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return default


def write_json(path, value):
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(value, indent=2, ensure_ascii=False), encoding="utf-8")
    tmp.replace(path)


def default_words():
    """Lista inicial: la misma que trae morse-moderation.js."""
    source = (ROOT / "morse-moderation.js").read_text(encoding="utf-8")
    words = {}
    for lang in LANGS:
        block = re.search(rf"{lang}:\s*\[(.*?)\]", source, re.S)
        words[lang] = re.findall(r'"([^"]+)"', block.group(1)) if block else []
    return words


moderation = read_json(MODERATION_FILE, {})
stop_words = read_json(WORDS_FILE, None) or default_words()
stop_words_version = int(time.time())


def hash_password(password, salt):
    return hashlib.pbkdf2_hmac("sha256", password.encode(), bytes.fromhex(salt), 200_000).hex()


def set_admin_password(password, user=None):
    salt = secrets.token_hex(16)
    admin = read_json(ADMIN_FILE, {})
    admin.update(salt=salt, password_hash=hash_password(password, salt))
    admin["user"] = user or admin.get("user") or DEFAULT_ADMIN_USER
    admin["session_gen"] = admin.get("session_gen", 0) + 1  # invalida sesiones anteriores
    admin.setdefault("secret_key", secrets.token_hex(32))
    write_json(ADMIN_FILE, admin)
    return admin


def load_admin():
    admin = read_json(ADMIN_FILE, {})
    if not admin.get("password_hash"):
        admin = set_admin_password(DEFAULT_ADMIN_PASSWORD, DEFAULT_ADMIN_USER)
    return admin


admin_config = load_admin()
app.secret_key = admin_config["secret_key"]
app.config.update(SESSION_COOKIE_HTTPONLY=True, SESSION_COOKIE_SAMESITE="Strict")


# ---------- Utilidades ----------

def client_ip():
    # La IP sale de la conexión, nunca de cabeceras que envía el navegador.
    return request.remote_addr or "?"


def is_blocked(ip):
    return moderation.get(ip, {}).get("blocked", False)


def broadcast(packet, only_ip=None):
    data = json.dumps(packet, separators=(",", ":"), ensure_ascii=False)
    with clients_lock:
        targets = [q for q, ip in clients.items() if only_ip is None or ip == only_ip]
    for q in targets:
        try:
            q.put_nowait(data)
        except queue.Full:
            pass  # cliente demasiado lento; se pierde este paquete
    return len(targets)


def disconnect_ip(ip):
    with clients_lock:
        targets = [q for q, client in clients.items() if client == ip]
    for q in targets:
        try:
            q.put_nowait(None)  # cierra el flujo SSE de ese cliente
        except queue.Full:
            pass


def rate_limited(store, ip, limit):
    window, now = store[ip], time.monotonic()
    while window and now - window[0] > limit[1]:
        window.popleft()
    if len(window) >= limit[0]:
        return True
    window.append(now)
    return False


def require_admin():
    if not session.get("admin") or session.get("gen") != admin_config.get("session_gen"):
        session.clear()
        abort(401)
    # Exigir JSON obliga a un preflight CORS que no se concede a otros orígenes.
    if request.method == "POST" and not request.is_json:
        abort(415)


# ---------- Peticiones ----------

@app.before_request
def use_real_ip():
    """La aplicación se abre siempre con la IP real de la red, no con localhost."""
    host = request.host.rsplit(":", 1)[0] if not request.host.startswith("[") else request.host.split("]")[0] + "]"
    if PRIMARY_IP and host in LOCAL_HOSTS and request.method == "GET" and not request.path.startswith("/api/"):
        query = f"?{request.query_string.decode()}" if request.query_string else ""
        return redirect(f"http://{PRIMARY_IP}:{PORT}{request.path}{query}", 302)


@app.after_request
def cors(response):
    # La app Android abre el HTML como archivo local (origen "null"),
    # así que la API pública acepta cualquier origen. No usa cookies.
    if request.path.startswith("/api/") and not request.path.startswith("/api/admin/"):
        response.headers["Access-Control-Allow-Origin"] = "*"
        response.headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS"
        response.headers["Access-Control-Allow-Headers"] = "Content-Type, Accept"
        response.headers["Access-Control-Allow-Private-Network"] = "true"
    return response


@app.route("/api/<path:_any>", methods=["OPTIONS"])
def preflight(_any):
    return Response(status=204)


@app.get("/")
def index():
    return send_from_directory(ROOT, "Morse-Android.html")


@app.get("/admin")
def admin_page():
    return send_from_directory(ROOT, "admin.html")


@app.get("/<name>")
def static_file(name):
    if name not in STATIC_FILES:
        abort(404)
    return send_from_directory(ROOT, name)


@app.get("/api/ping")
def ping():
    return jsonify(app=APP_ID, version=VERSION, name=socket.gethostname(), clients=len(clients),
                   client_ip=client_ip())


@app.get("/api/network/devices")
def network_devices():
    """Inventario de la subred IPv4 donde escucha este servidor.

    El trabajo se ejecuta en segundo plano para no bloquear Flask. La ruta solo
    permite examinar la interfaz local elegida por el propio servidor.
    """
    start_network_scan(force=request.args.get("refresh") == "1")
    with network_scan_lock:
        payload = dict(network_scan)
        payload["devices"] = [dict(device) for device in network_scan["devices"]]
    return jsonify(payload)


@app.get("/api/events")
def events():
    ip = client_ip()
    if is_blocked(ip):
        abort(403)
    q: queue.Queue = queue.Queue(maxsize=500)
    with clients_lock:
        clients[q] = ip

    def stream():
        try:
            yield "retry: 3000\n\n"
            while True:
                try:
                    data = q.get(timeout=15)
                except queue.Empty:
                    yield ": ping\n\n"
                    continue
                if data is None:
                    return
                yield f"data: {data}\n\n"
        finally:
            with clients_lock:
                clients.pop(q, None)

    return Response(stream(), mimetype="text/event-stream",
                    headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@app.post("/api/send")
def send():
    ip = client_ip()
    if is_blocked(ip):
        abort(403)
    if rate_limited(recent, ip, RATE_LIMIT):
        abort(429)

    raw = request.get_data(cache=False, as_text=True)
    if len(raw) > MAX_PACKET:
        abort(413)
    try:
        packet = json.loads(raw)
    except ValueError:
        abort(400)
    if not isinstance(packet, dict) or packet.get("type") not in PACKET_TYPES:
        abort(400)

    # La IP mostrada en el chat siempre procede de la conexión TCP con Flask;
    # nunca se acepta una dirección declarada por el navegador.
    packet["sourceIp"] = ip

    if packet["type"] == "presence" and isinstance(packet.get("senderId"), str):
        users[packet["senderId"][:64]] = {
            "nickname": str(packet.get("nickname", ""))[:20],
            "language": str(packet.get("language", ""))[:2],
            "ip": ip,
            "seen": int(time.time()),
        }
    return jsonify(ok=True, delivered=broadcast(packet))


@app.get("/api/moderation/status")
def moderation_status():
    entry = moderation.get(client_ip(), {})
    return jsonify(strikes=entry.get("strikes", 0), blocked=entry.get("blocked", False), owner=False)


@app.post("/api/moderation/strike")
def moderation_strike():
    ip = client_ip()
    body = request.get_json(silent=True) or {}
    with data_lock:
        entry = moderation.setdefault(ip, {"strikes": 0, "blocked": False, "log": []})
        entry["strikes"] = min(3, entry["strikes"] + 1)
        entry["blocked"] = entry["strikes"] >= 3
        entry.setdefault("log", []).append({"time": int(time.time()), "category": str(body.get("category", ""))[:40]})
        write_json(MODERATION_FILE, moderation)
    if entry["blocked"]:
        disconnect_ip(ip)
    return jsonify(strikes=entry["strikes"], blocked=entry["blocked"], owner=False)


@app.get("/api/moderation/words")
def moderation_words():
    return jsonify(version=stop_words_version, rules=stop_words)


# ---------- Administración ----------

@app.post("/api/admin/login")
def admin_login():
    ip = client_ip()
    if rate_limited(login_attempts, ip, LOGIN_LIMIT):
        abort(429)
    body = request.get_json(silent=True) or {}
    user, password = str(body.get("user", "")), str(body.get("password", ""))
    valid_user = hmac.compare_digest(user.strip().lower(), admin_config.get("user", DEFAULT_ADMIN_USER))
    valid_password = hmac.compare_digest(hash_password(password, admin_config["salt"]), admin_config["password_hash"])
    if not (valid_user and valid_password):
        time.sleep(0.5)
        abort(403)
    session.clear()
    session["admin"] = True
    session["gen"] = admin_config.get("session_gen")
    return jsonify(ok=True)


@app.post("/api/admin/logout")
def admin_logout():
    session.clear()
    return jsonify(ok=True)


@app.get("/api/admin/state")
def admin_state():
    require_admin()
    now = int(time.time())
    with clients_lock:
        connected_ips = set(clients.values())
    rows = {}
    for sender, user in users.items():
        if now - user["seen"] > 3600:
            continue
        rows.setdefault(user["ip"], {"ip": user["ip"], "nicknames": [], "seen": 0})
        row = rows[user["ip"]]
        if user["nickname"] and user["nickname"] not in row["nicknames"]:
            row["nicknames"].append(user["nickname"])
        row["seen"] = max(row["seen"], user["seen"])
    for ip in list(moderation) + list(connected_ips):
        rows.setdefault(ip, {"ip": ip, "nicknames": [], "seen": 0})
    for ip, row in rows.items():
        entry = moderation.get(ip, {})
        row.update(strikes=entry.get("strikes", 0), blocked=entry.get("blocked", False),
                   online=ip in connected_ips, log=entry.get("log", [])[-5:])
    return jsonify(users=sorted(rows.values(), key=lambda r: (-r["online"], -r["seen"], r["ip"])),
                   words=stop_words, langs=LANGS)


@app.post("/api/admin/words")
def admin_words():
    global stop_words, stop_words_version
    require_admin()
    body = request.get_json(silent=True) or {}
    new_words = {}
    for lang in LANGS:
        items = body.get("rules", {}).get(lang, stop_words.get(lang, []))
        if not isinstance(items, list):
            abort(400)
        clean = []
        for item in items:
            word = " ".join(str(item).split())[:60]
            if word and word not in clean:
                clean.append(word)
        new_words[lang] = clean[:2000]
    with data_lock:
        stop_words = new_words
        stop_words_version = int(time.time() * 1000)
        write_json(WORDS_FILE, stop_words)
    broadcast({"type": "rules", "senderId": "server", "version": stop_words_version})
    return jsonify(ok=True, version=stop_words_version, words=stop_words)


@app.post("/api/admin/block")
def admin_block():
    require_admin()
    body = request.get_json(silent=True) or {}
    ip, blocked = str(body.get("ip", "")), bool(body.get("blocked"))
    if not ip or ip == client_ip():
        abort(400)  # el administrador no puede bloquearse a sí mismo
    with data_lock:
        entry = moderation.setdefault(ip, {"strikes": 0, "blocked": False, "log": []})
        entry["blocked"] = blocked
        entry["strikes"] = 3 if blocked else 0
        entry.setdefault("log", []).append({"time": int(time.time()), "category": "admin-block" if blocked else "admin-unblock"})
        write_json(MODERATION_FILE, moderation)
    if blocked:
        broadcast({"type": "blocked", "senderId": "server"}, only_ip=ip)
        threading.Timer(0.5, disconnect_ip, args=(ip,)).start()
    return jsonify(ok=True)


@app.post("/api/admin/password")
def admin_password():
    global admin_config
    require_admin()
    body = request.get_json(silent=True) or {}
    current, new = str(body.get("current", "")), str(body.get("new", ""))
    if not hmac.compare_digest(hash_password(current, admin_config["salt"]), admin_config["password_hash"]):
        abort(403)
    if len(new) < MIN_PASSWORD:
        abort(400)
    admin_config = set_admin_password(new)
    session["gen"] = admin_config["session_gen"]  # esta sesión sigue abierta; las demás se cierran
    return jsonify(ok=True)


# ---------- Inventario de la red local ----------

def local_network(ip):
    """Devuelve la subred de la interfaz de Flask (máximo 1024 direcciones)."""
    prefix = 24
    if platform.system() == "Windows":
        try:
            command = [
                "powershell", "-NoProfile", "-Command",
                f"(Get-NetIPAddress -AddressFamily IPv4 -IPAddress '{ip}' -ErrorAction Stop).PrefixLength",
            ]
            result = subprocess.run(command, capture_output=True, text=True, timeout=3,
                                    creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
            value = int(result.stdout.strip().splitlines()[0])
            if 22 <= value <= 30:
                prefix = value
        except (OSError, ValueError, IndexError, subprocess.SubprocessError):
            pass
    network = ipaddress.ip_network(f"{ip}/{prefix}", strict=False)
    # Evita que una configuración /8 lance millones de pruebas por accidente.
    return network if network.num_addresses <= 1024 else ipaddress.ip_network(f"{ip}/24", strict=False)


def ping_host(ip):
    system = platform.system()
    if system == "Windows":
        # Un intento TCP fuerza la resolución ARP sin crear un proceso ping por IP.
        # Aunque el puerto esté cerrado, el vecino quedará en la tabla ARP.
        try:
            with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
                probe.settimeout(0.4)
                return probe.connect_ex((ip, 9)) in (0, 10061)
        except OSError:
            return False
    command = ["ping", "-c", "1", "-W", "1", ip]
    try:
        result = subprocess.run(command, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                                timeout=1.0, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
        return result.returncode == 0
    except (OSError, subprocess.SubprocessError):
        return False


def arp_neighbors(network):
    """Lee vecinos ARP; también descubre equipos que bloquean respuestas ICMP."""
    try:
        result = subprocess.run(["arp", "-a"], capture_output=True, text=True, timeout=4,
                                creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
    except (OSError, subprocess.SubprocessError):
        return {}
    neighbors = {}
    pattern = re.compile(r"\b(\d{1,3}(?:\.\d{1,3}){3})\b\s+([0-9a-f]{2}(?:[:-][0-9a-f]{2}){5})\b", re.I)
    for ip, mac in pattern.findall(result.stdout):
        try:
            address = ipaddress.ip_address(ip)
        except ValueError:
            continue
        if address in network and address not in (network.network_address, network.broadcast_address) and not address.is_multicast:
            neighbors[ip] = mac.replace("-", ":").upper()
    return neighbors


def host_name(ip):
    try:
        return socket.gethostbyaddr(ip)[0].rstrip(".")[:80]
    except (OSError, UnicodeError):
        return ""


def device_kind(name, ip):
    value = name.lower()
    if ip == PRIMARY_IP:
        return "server"
    if any(word in value for word in ("iphone", "ipad", "ipod", "apple", "macbook", "imac")):
        return "apple"
    if any(word in value for word in ("android", "galaxy", "pixel", "redmi", "xiaomi", "huawei", "oneplus", "oppo")):
        return "android"
    if any(word in value for word in ("tv", "chromecast", "firestick", "roku")):
        return "media"
    if any(word in value for word in ("printer", "epson", "canon", "brother", "hp-")):
        return "printer"
    return "device"


def scan_local_network():
    ip = PRIMARY_IP or next(iter(lan_addresses()), None)
    if not ip:
        with network_scan_lock:
            network_scan.update(scanning=False, error="No hay una interfaz IPv4 local disponible")
        return
    network = local_network(ip)
    hosts = [str(address) for address in network.hosts()]
    alive = set()
    try:
        # El ping provoca resolución ARP incluso cuando el dispositivo no contesta
        # ICMP; por eso se combina el resultado con la tabla de vecinos.
        with concurrent.futures.ThreadPoolExecutor(max_workers=min(96, len(hosts) or 1)) as pool:
            for address, responds in zip(hosts, pool.map(ping_host, hosts)):
                if responds:
                    alive.add(address)
        neighbors = arp_neighbors(network)
        candidates = sorted(alive | set(neighbors) | {ip}, key=ipaddress.ip_address)
        # La resolución DNS inversa de equipos domésticos suele tardar decenas
        # de segundos. El inventario se mantiene ágil y usa el nombre del host
        # únicamente para el propio servidor, que sí conocemos con certeza.
        names = {ip: socket.gethostname()}
        now = int(time.time())
        devices = [{
            "ip": address,
            "name": names.get(address) or (socket.gethostname() if address == ip else "Dispositivo sin nombre"),
            "mac": neighbors.get(address, ""),
            "kind": device_kind(names.get(address, ""), address),
            "server": address == ip,
            "responds": address in alive or address in neighbors or address == ip,
            "seen": now,
        } for address in candidates]
        with network_scan_lock:
            network_scan.update(network=str(network), interface=ip, devices=devices,
                                updated=now, scanning=False, error=None)
    except Exception as exc:
        with network_scan_lock:
            network_scan.update(scanning=False, error=f"No se pudo completar el escaneo: {type(exc).__name__}")


def start_network_scan(force=False):
    with network_scan_lock:
        fresh = time.time() - network_scan["updated"] < 25
        if network_scan["scanning"] or (fresh and not force):
            return False
        network_scan["scanning"] = True
        network_scan["error"] = None
    threading.Thread(target=scan_local_network, name="morse-lan-scan", daemon=True).start()
    return True


def network_scan_loop():
    while True:
        start_network_scan()
        time.sleep(45)


# ---------- Acceso desde otros dispositivos (Firewall de Windows) ----------

def firewall_rule_name(port):
    return f"Chat Morse LAN TCP {port}"


def firewall_rule_exists(port):
    if platform.system() != "Windows":
        return True
    name = firewall_rule_name(port)
    try:
        result = subprocess.run(
            ["netsh", "advfirewall", "firewall", "show", "rule", f"name={name}"],
            capture_output=True, text=True, timeout=8,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        )
        return name.lower() in result.stdout.lower()
    except (OSError, subprocess.SubprocessError):
        return False


def install_firewall_rule(port):
    """Crea una regla TCP limitada al ejecutable, puerto y subred local."""
    if platform.system() != "Windows" or firewall_rule_exists(port):
        return True
    name = firewall_rule_name(port)
    command = [
        "netsh", "advfirewall", "firewall", "add", "rule",
        f"name={name}", "dir=in", "action=allow", "protocol=TCP",
        f"localport={port}", "remoteip=LocalSubnet", "profile=any",
        f"program={Path(sys.executable).resolve()}", "enable=yes",
    ]
    try:
        result = subprocess.run(command, capture_output=True, text=True, timeout=12,
                                creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
        return result.returncode == 0 and firewall_rule_exists(port)
    except (OSError, subprocess.SubprocessError):
        return False


def ensure_firewall_rule(port):
    """Solicita UAC una sola vez si falta la regla del puerto elegido."""
    if platform.system() != "Windows" or firewall_rule_exists(port):
        return True
    try:
        is_admin = bool(ctypes.windll.shell32.IsUserAnAdmin())
    except (AttributeError, OSError):
        is_admin = False
    if is_admin:
        return install_firewall_rule(port)

    params = subprocess.list2cmdline([
        str(Path(__file__).resolve()), "--install-firewall", "--port", str(port)
    ])
    try:
        launched = ctypes.windll.shell32.ShellExecuteW(
            None, "runas", sys.executable, params, str(ROOT), 0
        )
        return launched > 32
    except (AttributeError, OSError):
        return False


# ---------- Arranque ----------

def lan_addresses():
    addresses = []
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.connect(("10.255.255.255", 1))  # no envía nada; solo elige la interfaz de salida
            addresses.append(s.getsockname()[0])
    except OSError:
        pass
    try:
        for info in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET):
            if info[4][0] not in addresses:
                addresses.append(info[4][0])
    except OSError:
        pass
    return [a for a in addresses if not a.startswith(("127.", "169.254.", "0."))]


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Servidor LAN de Chat Morse")
    parser.add_argument("--port", type=int, default=5050)
    parser.add_argument("--open", action="store_true", help="abrir el navegador con la IP real")
    parser.add_argument("--set-admin-password", action="store_true")
    parser.add_argument("--install-firewall", action="store_true", help=argparse.SUPPRESS)
    args = parser.parse_args()
    if not 1 <= args.port <= 65535:
        raise SystemExit("El puerto debe estar entre 1 y 65535.")
    if args.install_firewall:
        if not install_firewall_rule(args.port):
            raise SystemExit(f"No se pudo crear la regla de firewall para el puerto {args.port}.")
        raise SystemExit(0)
    if args.set_admin_password:
        password = getpass.getpass(f"Nueva contraseña para '{admin_config['user']}' (mín. {MIN_PASSWORD}): ")
        if len(password) < MIN_PASSWORD:
            raise SystemExit("Demasiado corta.")
        set_admin_password(password)
        raise SystemExit("Contraseña guardada.")

    PORT = args.port
    addresses = lan_addresses()
    PRIMARY_IP = addresses[0] if addresses else None
    firewall_ready = ensure_firewall_rule(PORT)
    print("Chat Morse - servidor de red local")
    if PRIMARY_IP:
        for address in addresses:
            print(f"  Chat:  http://{address}:{PORT}")
        print(f"  Admin: http://{PRIMARY_IP}:{PORT}/admin")
    else:
        print("  AVISO: no hay red local; solo accesible en este equipo.")
        print(f"  Chat:  http://127.0.0.1:{PORT}")
    if platform.system() == "Windows":
        if firewall_rule_exists(PORT):
            print(f"  Firewall: acceso TCP {PORT} permitido solo desde la red local.")
        elif firewall_ready:
            print("  Firewall: confirma la ventana de administrador para permitir otros dispositivos.")
        else:
            print("  AVISO: no se pudo solicitar la regla del firewall; otros dispositivos podrían no entrar.")
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
        port_busy = probe.connect_ex(("127.0.0.1", PORT)) == 0
    if port_busy:
        # Ya hay un servidor (por ejemplo, otra ventana del .bat): se reutiliza.
        print(f"  El puerto {PORT} ya está en uso: el servidor ya estaba arrancado.")
        print("  Para reiniciarlo con cambios nuevos, cierra la otra ventana y vuelve a abrir el .bat.")
        if args.open:
            webbrowser.open(f"http://{PRIMARY_IP or '127.0.0.1'}:{PORT}/#chat")
        raise SystemExit(0)

    import logging
    import flask.cli
    # Los avisos de Flask/Werkzeug muestran "127.0.0.1" y confunden: se usa la IP real.
    flask.cli.show_server_banner = lambda *a, **k: None
    logging.getLogger("werkzeug").setLevel(logging.ERROR)
    threading.Thread(target=network_scan_loop, name="morse-lan-monitor", daemon=True).start()
    if args.open:
        url = f"http://{PRIMARY_IP or '127.0.0.1'}:{PORT}/#chat"
        threading.Timer(1.5, webbrowser.open, args=(url,)).start()
    app.run(host="0.0.0.0", port=PORT, threaded=True)
