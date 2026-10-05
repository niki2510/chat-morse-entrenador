# Chat Morse en red local

El chat tiene dos modos y cambia solo entre ellos:

| Modo | Cuándo | Alcance |
|------|--------|---------|
| **LOCAL** | Sin servidor (por defecto) | Pestañas del mismo navegador |
| **RED LOCAL** | Hay un servidor Flask en la red | Todos los dispositivos de la red |

## Arrancar el servidor

Doble clic en **`iniciar-chat-morse.bat`**: comprueba Python, instala Flask
si falta, arranca el servidor y abre el navegador con la IP real del equipo
(por ejemplo `http://192.168.1.20:5050`). Si Windows pregunta por el
firewall, permite "Redes privadas".

A mano: `pip install -r requirements.txt` y `python server.py --open`.

La aplicación nunca se queda en `localhost` ni `127.0.0.1`: esas direcciones
redirigen a la IP real, para que la dirección que ves sea la misma que deben
usar los demás dispositivos.

## Administración

Panel en `http://IP:5050/admin` (también hay un botón ADMIN en el chat
cuando está conectado al servidor).

- **Acceso:** usuario `admin`, contraseña `686510`. La contraseña se
  cambia en el panel o con `python server.py --set-admin-password`.
  Se guarda cifrada (PBKDF2) en `admin.json`; borrar ese archivo vuelve
  a la contraseña inicial.
- **Usuarios:** lista de IPs con apodos, conexión y avisos STOP.
  BLOQUEAR desconecta al momento y rechaza esa IP; DESBLOQUEAR la libera
  y pone sus avisos a 0.
- **Lista negra STOP:** palabras por idioma (ES/EN/RU), una por línea,
  `palabra*` para prefijos. Al guardar se envía al momento a todos los
  chats conectados. Se guarda en `stop-words.json`.

## Descubrimiento automático

Al iniciar el chat (y cada 60 s mientras no hay servidor), el cliente busca
un servidor en este orden:

1. `?server=IP:PUERTO` en la URL.
2. El propio origen, si la página se sirve por http.
3. El último servidor que funcionó (guardado en el navegador).
4. Escaneo del puerto 5050 en la subred: la de la dirección de la página o
   las IP locales detectadas por WebRTC; si no se detecta ninguna, prueba
   192.168.0/1/2/100.x y 10.0.0/1.x.

El indicador de la cabecera muestra el estado (LOCAL, BUSCANDO, RED LOCAL);
pulsarlo lanza un escaneo nuevo. Si el servidor cae, el chat vuelve al modo
local y vuelve a buscar.

Limitación: una página abierta por `https://` desde Internet no puede hablar
con un servidor `http://` de la red (contenido mixto). Abre el chat desde el
servidor, como archivo local o desde la app Android.

## Qué hace el servidor

- `GET /api/ping` — identificación para el escaneo.
- `GET /api/events` — flujo SSE con los paquetes de todos.
- `POST /api/send` — retransmite un paquete (máx. 64 KB, 40 por 10 s e IP).
- `GET /api/moderation/status`, `POST /api/moderation/strike` — avisos STOP
  por IP según [MODERATION-SERVER.md](MODERATION-SERVER.md); al tercero la IP
  queda bloqueada (se guarda en `moderation.json`).
- `GET /api/moderation/words` — lista negra STOP vigente.
- `/api/admin/*` — panel de administración (sesión con contraseña, solo
  mismo origen). La excepción del creador
  por OAuth de GitHub no está implementada.

Los mensajes de salas privadas viajan cifrados de extremo a extremo; el
servidor solo los reenvía y no puede leerlos.

El cifrado usa TweetNaCl (`nacl-fast.min.js`, incluido en el proyecto)
y no Web Crypto, porque los navegadores desactivan Web Crypto en páginas
`http://IP` de la red local. Ese archivo debe copiarse siempre junto a
`Morse-Android.html` (también en la app Android).
