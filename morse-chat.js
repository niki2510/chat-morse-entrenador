(function () {
  "use strict";

  /* Cifrado con TweetNaCl (nacl-fast.min.js): funciona también por http en la red local,
     donde los navegadores desactivan crypto.subtle y crypto.randomUUID. */
  const uuid = () => {
    if (crypto.randomUUID) try { return crypto.randomUUID(); } catch (_) {}
    const b = crypto.getRandomValues(new Uint8Array(16)); b[6] = b[6] & 15 | 64; b[8] = b[8] & 63 | 128;
    const h = [...b].map(x => x.toString(16).padStart(2, "0")).join("");
    return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;
  };

  const LATIN = {A:".-",B:"-...",C:"-.-.",D:"-..",E:".",F:"..-.",G:"--.",H:"....",I:"..",J:".---",K:"-.-",L:".-..",M:"--",N:"-.",O:"---",P:".--.",Q:"--.-",R:".-.",S:"...",T:"-",U:"..-",V:"...-",W:".--",X:"-..-",Y:"-.--",Z:"--..",0:"-----",1:".----",2:"..---",3:"...--",4:"....-",5:".....",6:"-....",7:"--...",8:"---..",9:"----."};
  const SPANISH = {...LATIN, Ñ:"--.--"};
  const RUSSIAN = {А:".-",Б:"-...",В:".--",Г:"--.",Д:"-..",Е:".",Ё:".",Ж:"...-",З:"--..",И:"..",Й:".---",К:"-.-",Л:".-..",М:"--",Н:"-.",О:"---",П:".--.",Р:".-.",С:"...",Т:"-",У:"..-",Ф:"..-.",Х:"....",Ц:"-.-.",Ч:"---.",Ш:"----",Щ:"--.-",Ъ:"--.--",Ы:"-.--",Ь:"-..-",Э:"..-..",Ю:"..--",Я:".-.-",0:"-----",1:".----",2:"..---",3:"...--",4:"....-",5:".....",6:"-....",7:"--...",8:"---..",9:"----."};
  const MAPS = {ES: SPANISH, EN: LATIN, RU: RUSSIAN};
  const REVERSE = Object.fromEntries(Object.entries(MAPS).map(([lang, map]) => [lang, Object.fromEntries(Object.entries(map).map(([letter, code]) => [code, letter]))]));
  REVERSE.RU["."] = "Е";

  const state = {
    id: sessionStorage.getItem("mc-id") || uuid(), nickname:"", language:(()=>{try{return ["ES","EN","RU"].includes(localStorage.getItem("mc-lang"))?localStorage.getItem("mc-lang"):"ES"}catch(_){return "ES"}})(),
    mode:"public", ready:false, beginner:false, revealAll:false, people:new Map(), messages:[],
    autoClean:false, lineLimit:100, latestMessageId:null,
    strikes:Number(localStorage.getItem("mc-stop-strikes")||0), blocked:localStorage.getItem("mc-stop-blocked")==="1", ownerVerified:false,
    remoteViolations:new Map(), blockedSenders:new Set(),
    roomId:null, roomKey:null, roomRaw:null, pendingInvite:null, keys:null,
    tokens:[], current:"", downAt:0, pressed:false, mouseMorse:false, letterTimer:null,
    server:null, events:null, scanning:false, seen:new Set(), networkData:null, localIp:""
  };
  sessionStorage.setItem("mc-id", state.id);

  const I18N = {
    ES: {
      title:"CHAT MORSE", you:"Tú: {nick} · {ip}", youTitle:"Tu apodo e IP local: los demás los ven en tus mensajes", sections:"Secciones", tabChat:"CHAT", tabPractice:"PRÁCTICA",
      netTitle:"Buscar servidor en la red local", netLocal:"LOCAL · sin servidor", netNone:"LOCAL · sin servidor en la red", netScan:"BUSCANDO SERVIDOR EN LA RED…",
      netLan:"RED LOCAL · {host}", netReconnect:"RECONECTANDO · {host}", netConnecting:"CONECTANDO · {host}", netBlocked:"BLOQUEADO EN EL SERVIDOR", netLost:"LOCAL · servidor perdido",
      serverDown:"Servidor de red local no disponible: modo local", connectedTo:"Conectado a {server}",
      devicesTitle:"DISPOSITIVOS EN LA RED", devicesScan:"Escaneando la red local…", devicesEmpty:"Aún no se detectaron dispositivos.", devicesUnavailable:"Disponible al conectar con el servidor Flask.", devicesFound:"{count} dispositivos · {network}", devicesRefresh:"VOLVER A ESCANEAR", thisServer:"SERVIDOR", noMac:"MAC no disponible",
      regTitle:"Entrar con un apodo", regIntro:"No se necesita cuenta. El apodo identifica esta sesión; la identidad criptográfica permanece en este navegador.",
      nick:"APODO", lang:"IDIOMA", enter:"ENTRAR AL CHAT", firstTime:"¿PRIMERA VEZ? ENTRENA EN PRÁCTICA",
      regNote:"Sin servidor, el chat comunica pestañas del mismo navegador. Si hay un servidor Chat Morse en la red local se conecta solo y habla con todos los dispositivos.",
      nickInvalid:"Usa entre 2 y 20 letras, números, _ o -.", nickChecking:"Comprobando disponibilidad del apodo…", nickTaken:"Ese apodo ya está siendo usado. Elige otro para entrar.", nickCheckFail:"No se pudo comprobar el apodo con el servidor.", noCrypto:"No se pudo cargar el cifrado (falta nacl-fast.min.js).", creatingId:"Creando identidad criptográfica…",
      regBlocked:"Acceso bloqueado después de 3 infracciones STOP.", idFailed:"No se pudo crear la identidad segura.",
      modeFree:"MODO LIBRE", modePrivate:"PRIVADO", help:"AYUDA: {state}", revealShown:"TRADUCCIÓN: VISIBLE", revealHidden:"TRADUCCIÓN: OCULTA", exit:"SALIR",
      clearChat:"LIMPIAR", autoClean:"Limpieza automática", lineLimit:"{count} líneas", chatCleared:"Chat limpiado", autoCleaned:"Limpieza automática realizada",
      newRoom:"NUEVA SALA", roomKeyPh:"Llave MC1…", open:"ABRIR", roomEmpty:"Crea una sala o introduce una llave privada.", copyKey:"COPIAR LLAVE",
      peopleTitle:"Personas disponibles para invitación personal:", nobody:"Nadie más conectado.", invite:"INVITAR",
      emptyChat:"Aún no hay transmisiones. Usa la llave Morse para iniciar.", emptyRoom:"Crea o abre una sala privada.",
      showTr:"VER TRADUCCIÓN", hideTr:"OCULTAR TRADUCCIÓN",
      normalPh:"Texto normal (se enviará únicamente como Morse)", copyPh:"Copia la frase con la llave Morse ↓", convert:"CONVERTIR",
      beginnerNote:"Ayuda para principiantes: el texto nunca se transmite; se convierte localmente antes de enviarlo.",
      waiting:"Esperando señal", keyAria:"Llave Morse (ratón izquierdo / Espacio / Enter)", keyHint:"RATÓN IZQ. / ESPACIO / ENTER",
      endLetter:"FIN LETRA", space:"ESPACIO", undo:"BORRAR", send:"ENVIAR MORSE",
      keyHelp:"Ratón izquierdo, Espacio o Enter · Corto < 280 ms = punto · Largo ≥ 280 ms = raya",
      inviteTitle:"Invitación privada", accept:"ACEPTAR", decline:"RECHAZAR",
      inviteText:"{nick} te invita a la sala privada {room}. Solo esta identidad ha podido abrir la invitación.",
      copyDone:"¡Frase copiada! Ya puedes ENVIAR MORSE", copyHintDone:"Frase completa · pulsa ENVIAR MORSE", copyHint:"Copia con la llave · siguiente: {letter} {code}", cancel:"CANCELAR",
      copyIncomplete:"Letra incompleta: termina la letra marcada", copyFull:"Frase completa: pulsa ENVIAR MORSE",
      copyWrongDash:"Señal incorrecta: tocaba — raya (pulsación larga)", copyWrongDot:"Señal incorrecta: tocaba · punto (pulsación corta)",
      copyAutoSpace:"Los espacios entre palabras se añaden solos al copiar", copyRequired:"Copia toda la frase con la llave para poder enviarla",
      badSequence:"Secuencia no válida para el idioma elegido", writeWithKey:"Escribe el mensaje con la llave Morse", noLetters:"No hay letras compatibles para convertir",
      needRoom:"Crea o abre primero una sala privada", roomCreated:"Sala privada creada", roomOpened:"Sala privada abierta", roomBadKey:"La llave privada no tiene un formato válido", roomOpenFail:"No se pudo abrir la llave privada",
      roomLabel:"Sala {room} · Llave: {key}", inviteSent:"Invitación cifrada enviada a {nick}", inviteFail:"No se pudo cifrar la invitación", inviteAccepted:"Invitación privada aceptada",
      keyCopied:"Llave privada copiada", keyCopyFail:"No se pudo copiar la llave", sendFail:"No se pudo enviar",
      pasteBlocked:"Pegar está bloqueado: transmite con la llave Morse", copyMsg:"COPIAR", msgCopied:"Mensaje copiado (solo para leerlo: no se puede pegar)", msgCopyFail:"No se pudo copiar el mensaje",
      ownerBadge:"CREADOR VERIFICADO", stopBlocked:"Acceso al chat bloqueado después de 3 infracciones STOP.", ownerStop:"Contenido STOP rechazado. El creador verificado no acumula bloqueos.",
      stopThird:"Tercer aviso: acceso bloqueado.", stopWarn:"Aviso STOP {n}/3. Mensaje rechazado. Quedan {left}.", adminBlocked:"Un administrador ha bloqueado tu acceso al chat.",
      muted:"Usuario silenciado tras 3 mensajes STOP", held:"Mensaje STOP retenido por moderación"
    },
    EN: {
      title:"MORSE CHAT", you:"You: {nick} · {ip}", youTitle:"Your nickname and local IP: others see them in your messages", sections:"Sections", tabChat:"CHAT", tabPractice:"PRACTICE",
      netTitle:"Search for a server on the local network", netLocal:"LOCAL · no server", netNone:"LOCAL · no server on the network", netScan:"SEARCHING FOR SERVER ON THE NETWORK…",
      netLan:"LOCAL NETWORK · {host}", netReconnect:"RECONNECTING · {host}", netConnecting:"CONNECTING · {host}", netBlocked:"BLOCKED ON THE SERVER", netLost:"LOCAL · server lost",
      serverDown:"Local network server unavailable: local mode", connectedTo:"Connected to {server}",
      devicesTitle:"NETWORK DEVICES", devicesScan:"Scanning the local network…", devicesEmpty:"No devices detected yet.", devicesUnavailable:"Available when connected to the Flask server.", devicesFound:"{count} devices · {network}", devicesRefresh:"SCAN AGAIN", thisServer:"SERVER", noMac:"MAC unavailable",
      regTitle:"Join with a nickname", regIntro:"No account needed. The nickname identifies this session; the cryptographic identity stays in this browser.",
      nick:"NICKNAME", lang:"LANGUAGE", enter:"JOIN THE CHAT", firstTime:"FIRST TIME? TRAIN IN PRACTICE",
      regNote:"Without a server, the chat connects tabs of the same browser. If there is a Morse Chat server on the local network, it connects automatically and talks to every device.",
      nickInvalid:"Use 2 to 20 letters, numbers, _ or -.", nickChecking:"Checking nickname availability…", nickTaken:"That nickname is already active. Choose another one to join.", nickCheckFail:"The nickname could not be checked with the server.", noCrypto:"Encryption could not be loaded (nacl-fast.min.js is missing).", creatingId:"Creating cryptographic identity…",
      regBlocked:"Access blocked after 3 STOP violations.", idFailed:"Could not create the secure identity.",
      modeFree:"OPEN MODE", modePrivate:"PRIVATE", help:"HELP: {state}", revealShown:"TRANSLATION: SHOWN", revealHidden:"TRANSLATION: HIDDEN", exit:"EXIT",
      clearChat:"CLEAR", autoClean:"Automatic cleanup", lineLimit:"{count} lines", chatCleared:"Chat cleared", autoCleaned:"Automatic cleanup completed",
      newRoom:"NEW ROOM", roomKeyPh:"MC1 key…", open:"OPEN", roomEmpty:"Create a room or enter a private key.", copyKey:"COPY KEY",
      peopleTitle:"People available for a personal invitation:", nobody:"Nobody else connected.", invite:"INVITE",
      emptyChat:"No transmissions yet. Use the Morse key to start.", emptyRoom:"Create or open a private room.",
      showTr:"SHOW TRANSLATION", hideTr:"HIDE TRANSLATION",
      normalPh:"Plain text (will be sent only as Morse)", copyPh:"Copy the phrase with the Morse key ↓", convert:"CONVERT",
      beginnerNote:"Beginner help: the text is never transmitted; it is converted locally before sending.",
      waiting:"Waiting for signal", keyAria:"Morse key (left mouse / Space / Enter)", keyHint:"LEFT MOUSE / SPACE / ENTER",
      endLetter:"END LETTER", space:"SPACE", undo:"DELETE", send:"SEND MORSE",
      keyHelp:"Left mouse, Space or Enter · Short < 280 ms = dot · Long ≥ 280 ms = dash",
      inviteTitle:"Private invitation", accept:"ACCEPT", decline:"DECLINE",
      inviteText:"{nick} invites you to private room {room}. Only this identity could open the invitation.",
      copyDone:"Phrase copied! You can now SEND MORSE", copyHintDone:"Phrase complete · press SEND MORSE", copyHint:"Copy with the key · next: {letter} {code}", cancel:"CANCEL",
      copyIncomplete:"Incomplete letter: finish the highlighted letter", copyFull:"Phrase complete: press SEND MORSE",
      copyWrongDash:"Wrong signal: a — dash was expected (long press)", copyWrongDot:"Wrong signal: a · dot was expected (short press)",
      copyAutoSpace:"Spaces between words are added automatically while copying", copyRequired:"Copy the whole phrase with the key to send it",
      badSequence:"Invalid sequence for the selected language", writeWithKey:"Write the message with the Morse key", noLetters:"No compatible letters to convert",
      needRoom:"Create or open a private room first", roomCreated:"Private room created", roomOpened:"Private room opened", roomBadKey:"The private key format is not valid", roomOpenFail:"Could not open the private key",
      roomLabel:"Room {room} · Key: {key}", inviteSent:"Encrypted invitation sent to {nick}", inviteFail:"Could not encrypt the invitation", inviteAccepted:"Private invitation accepted",
      keyCopied:"Private key copied", keyCopyFail:"Could not copy the key", sendFail:"Could not send",
      pasteBlocked:"Pasting is blocked: transmit with the Morse key", copyMsg:"COPY", msgCopied:"Message copied (read only: pasting is not allowed)", msgCopyFail:"Could not copy the message",
      ownerBadge:"VERIFIED CREATOR", stopBlocked:"Chat access blocked after 3 STOP violations.", ownerStop:"STOP content rejected. The verified creator does not accumulate blocks.",
      stopThird:"Third warning: access blocked.", stopWarn:"STOP warning {n}/3. Message rejected. {left} left.", adminBlocked:"An administrator has blocked your chat access.",
      muted:"User muted after 3 STOP messages", held:"STOP message held by moderation"
    },
    RU: {
      title:"ЧАТ МОРЗЕ", you:"Ты: {nick}", youTitle:"Твой ник: другие видят его в твоих сообщениях", sections:"Разделы", tabChat:"ЧАТ", tabPractice:"ПРАКТИКА",
      netTitle:"Искать сервер в локальной сети", netLocal:"ЛОКАЛЬНО · без сервера", netNone:"ЛОКАЛЬНО · в сети нет сервера", netScan:"ПОИСК СЕРВЕРА В СЕТИ…",
      netLan:"ЛОКАЛЬНАЯ СЕТЬ · {host}", netReconnect:"ПЕРЕПОДКЛЮЧЕНИЕ · {host}", netConnecting:"ПОДКЛЮЧЕНИЕ · {host}", netBlocked:"ЗАБЛОКИРОВАНО НА СЕРВЕРЕ", netLost:"ЛОКАЛЬНО · сервер потерян",
      serverDown:"Сервер локальной сети недоступен: локальный режим", connectedTo:"Подключено к {server}",
      regTitle:"Войти под ником", regIntro:"Аккаунт не нужен. Ник обозначает эту сессию; криптографическая личность хранится в этом браузере.",
      nick:"НИК", lang:"ЯЗЫК", enter:"ВОЙТИ В ЧАТ", firstTime:"ВПЕРВЫЕ? ПОТРЕНИРУЙСЯ В ПРАКТИКЕ",
      regNote:"Без сервера чат связывает вкладки одного браузера. Если в локальной сети есть сервер Morse Chat, чат подключится сам и будет общаться со всеми устройствами.",
      nickInvalid:"Используй от 2 до 20 букв, цифр, _ или -.", noCrypto:"Не удалось загрузить шифрование (нет nacl-fast.min.js).", creatingId:"Создаётся криптографическая личность…",
      regBlocked:"Доступ заблокирован после 3 нарушений STOP.", idFailed:"Не удалось создать защищённую личность.",
      modeFree:"СВОБОДНЫЙ", modePrivate:"ПРИВАТНЫЙ", help:"ПОМОЩЬ: {state}", revealShown:"ПЕРЕВОД: ВИДЕН", revealHidden:"ПЕРЕВОД: СКРЫТ", exit:"ВЫЙТИ",
      newRoom:"НОВАЯ КОМНАТА", roomKeyPh:"Ключ MC1…", open:"ОТКРЫТЬ", roomEmpty:"Создай комнату или введи приватный ключ.", copyKey:"КОПИРОВАТЬ КЛЮЧ",
      peopleTitle:"Кого можно пригласить лично:", nobody:"Больше никого нет.", invite:"ПРИГЛАСИТЬ",
      emptyChat:"Передач пока нет. Начни с ключа Морзе.", emptyRoom:"Создай или открой приватную комнату.",
      showTr:"ПОКАЗАТЬ ПЕРЕВОД", hideTr:"СКРЫТЬ ПЕРЕВОД",
      normalPh:"Обычный текст (будет отправлен только азбукой Морзе)", copyPh:"Перепиши фразу ключом Морзе ↓", convert:"ПРЕОБРАЗОВАТЬ",
      beginnerNote:"Помощь новичкам: текст никогда не передаётся, он преобразуется на устройстве перед отправкой.",
      waiting:"Ожидание сигнала", keyAria:"Ключ Морзе (Пробел / Enter)", keyHint:"ПРОБЕЛ / ENTER",
      endLetter:"КОНЕЦ БУКВЫ", space:"ПРОБЕЛ", undo:"СТЕРЕТЬ", send:"ОТПРАВИТЬ",
      keyHelp:"Коротко < 280 мс = · точка · Долго ≥ 280 мс = — тире · Вставка/копирование сообщений запрещены",
      inviteTitle:"Приватное приглашение", accept:"ПРИНЯТЬ", decline:"ОТКЛОНИТЬ",
      inviteText:"{nick} приглашает тебя в приватную комнату {room}. Открыть приглашение смогла только эта личность.",
      copyDone:"Фраза переписана! Теперь можно ОТПРАВИТЬ", copyHintDone:"Фраза готова · нажми ОТПРАВИТЬ", copyHint:"Перепиши ключом · дальше: {letter} {code}", cancel:"ОТМЕНА",
      copyIncomplete:"Буква не закончена: доведи отмеченную букву", copyFull:"Фраза готова: нажми ОТПРАВИТЬ",
      copyWrongDash:"Неверный сигнал: нужно — тире (долгое нажатие)", copyWrongDot:"Неверный сигнал: нужна · точка (короткое нажатие)",
      copyAutoSpace:"Пробелы между словами добавляются сами", copyRequired:"Перепиши всю фразу ключом, чтобы отправить",
      badSequence:"Неверная последовательность для выбранного языка", writeWithKey:"Напиши сообщение ключом Морзе", noLetters:"Нет подходящих букв для преобразования",
      needRoom:"Сначала создай или открой приватную комнату", roomCreated:"Приватная комната создана", roomOpened:"Приватная комната открыта", roomBadKey:"Неверный формат приватного ключа", roomOpenFail:"Не удалось открыть приватный ключ",
      roomLabel:"Комната {room} · Ключ: {key}", inviteSent:"Зашифрованное приглашение отправлено {nick}", inviteFail:"Не удалось зашифровать приглашение", inviteAccepted:"Приватное приглашение принято",
      keyCopied:"Приватный ключ скопирован", keyCopyFail:"Не удалось скопировать ключ", sendFail:"Не удалось отправить",
      pasteBlocked:"Вставка запрещена: передавай ключом Морзе", copyMsg:"КОПИРОВАТЬ", msgCopied:"Сообщение скопировано (только для чтения: вставка запрещена)", msgCopyFail:"Не удалось скопировать сообщение",
      ownerBadge:"СОЗДАТЕЛЬ ПОДТВЕРЖДЁН", stopBlocked:"Доступ к чату заблокирован после 3 нарушений STOP.", ownerStop:"Сообщение STOP отклонено. Подтверждённый создатель не получает блокировок.",
      stopThird:"Третье предупреждение: доступ заблокирован.", stopWarn:"Предупреждение STOP {n}/3. Сообщение отклонено. Осталось {left}.", adminBlocked:"Администратор заблокировал тебе доступ к чату.",
      muted:"Пользователь заглушён после 3 сообщений STOP", held:"Сообщение STOP задержано модерацией"
    }
  };
  function t(key, vars={}) {
    const text = (I18N[state.language] || I18N.ES)[key] ?? I18N.ES[key] ?? key;
    return text.replace(/\{(\w+)\}/g, (_, name) => vars[name] ?? "");
  }

  const enc = new TextEncoder(), dec = new TextDecoder();
  const channel = "BroadcastChannel" in window ? new BroadcastChannel("morse-chat-v1") : null;
  const $ = (selector, root=document) => root.querySelector(selector);
  const $$ = (selector, root=document) => [...root.querySelectorAll(selector)];
  const escapeText = value => String(value || "").trim();
  const b64 = bytes => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/g,"");
  const unb64 = text => Uint8Array.from(atob(text.replace(/-/g,"+").replace(/_/g,"/").padEnd(Math.ceil(text.length/4)*4,"=")), c => c.charCodeAt(0));
  const mapFor = lang => MAPS[lang] || LATIN;

  function moderationCheck(text,lang) {
    return window.MorseModeration?.check(text,lang)||{blocked:false};
  }

  function updateModerationUI(message="") {
    const badge=$("#mc-moderation"), banner=$("#mc-stop-banner");
    if(badge) badge.textContent=state.ownerVerified?t("ownerBadge"):`STOP ${Math.min(state.strikes,3)}/3`;
    if(!banner)return;
    banner.hidden=!message&&!state.blocked;
    banner.textContent=message||(state.blocked?t("stopBlocked"):"");
    $("#morse-chat-app")?.classList.toggle("mc-blocked",state.blocked);
    $$(".mc-compose button, .mc-compose input").forEach(control=>control.disabled=state.blocked);
  }

  async function moderationStatus() {
    const base=apiBase(); if(base===null)return;
    try{
      const response=await fetch(`${base}/api/moderation/status`,{headers:{Accept:"application/json"}});
      if(!response.ok)return;const data=await response.json();
      // El servidor es la autoridad: un administrador puede desbloquear o reiniciar avisos.
      state.strikes=Number(data.strikes)||0;state.blocked=Boolean(data.blocked);state.ownerVerified=data.owner===true;
      localStorage.setItem("mc-stop-strikes",String(state.strikes));
      if(state.blocked&&!state.ownerVerified)localStorage.setItem("mc-stop-blocked","1");else localStorage.removeItem("mc-stop-blocked");
    }catch(_){/* El servidor de moderación es opcional en la versión estática. */}
  }

  async function recordStrike(verdict) {
    if(state.ownerVerified){updateModerationUI(t("ownerStop"));return;}
    state.strikes=Math.min(3,state.strikes+1);localStorage.setItem("mc-stop-strikes",String(state.strikes));
    const base=apiBase(); if(base!==null)try{
      const proof=b64(await sha(enc.encode(`${verdict.category}:${verdict.rule}`)));
      const response=await fetch(`${base}/api/moderation/strike`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({category:verdict.category,proof})});
      if(response.ok){const data=await response.json();state.strikes=Math.max(state.strikes,Number(data.strikes)||0);state.blocked=Boolean(data.blocked);state.ownerVerified=data.owner===true;}
    }catch(_){/* Mantener el contador local si el backend no existe. */}
    if(state.strikes>=3&&!state.ownerVerified){state.blocked=true;localStorage.setItem("mc-stop-blocked","1");}
    const left=Math.max(0,3-state.strikes);
    updateModerationUI(state.blocked?t("stopThird"):t("stopWarn",{n:state.strikes,left}));
  }

  function post(data) {
    const packet = {...data, senderId:state.id, sentAt:Date.now(), pid:uuid(), sourceIp:state.localIp||""};
    state.seen.add(packet.pid);
    if (channel) channel.postMessage(packet);
    else {
      localStorage.setItem("mc-event", JSON.stringify(packet));
      localStorage.removeItem("mc-event");
    }
    if (state.server) fetch(`${state.server}/api/send`,{method:"POST",headers:{"Content-Type":"text/plain"},body:JSON.stringify(packet)})
      .then(response=>{if(response.status===403){state.blocked=true;updateModerationUI();}else if(!response.ok&&response.status!==429)throw new Error();})
      .catch(()=>serverLost());
  }

  /* ---------- Red local: servidor Flask opcional con descubrimiento automático ---------- */
  const SERVER_PORT = 5050;
  const isPrivateIp = ip => /^(10\.\d+|192\.168|172\.(1[6-9]|2\d|3[01]))\.\d+\.\d+$/.test(ip);
  const pageIsHttp = /^https?:$/.test(location.protocol);

  function apiBase() { return state.server ?? (pageIsHttp ? "" : null); }

  async function reserveNickname(nickname) {
    const base=apiBase();
    if(base===null)return true; // modo local sin servidor: no hay usuarios de otros dispositivos
    try{
      const response=await fetch(`${base}/api/nickname`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({senderId:state.id,nickname})});
      if(response.status===409)return false;
      if(response.ok)return true;
      // Un alojamiento estático responde 404, 405 o 501 a esta ruta, y un Flask
      // caído no responde nada. Comprobar el apodo es una comodidad, no un
      // permiso: nadie se queda fuera del chat porque el servidor falle, así
      // que se avisa de la caída y se entra en modo local.
      serverLost(); return true;
    }catch(_){ serverLost(); return true; }
  }

  function releaseNickname() {
    const base=apiBase();
    if(base===null)return;
    fetch(`${base}/api/nickname`,{method:"DELETE",headers:{"Content-Type":"application/json"},body:JSON.stringify({senderId:state.id}),keepalive:true}).catch(()=>{});
  }

  function setNet(key, kind, vars={}) {
    state.net={key,kind,vars};
    const node=$("#mc-net"); if(!node) return;
    node.textContent=t(key,vars); node.dataset.kind=kind;
  }

  async function probe(base, timeout=900) {
    const controller=new AbortController(), timer=setTimeout(()=>controller.abort(),timeout);
    try {
      const response=await fetch(`${base}/api/ping`,{signal:controller.signal,cache:"no-store"});
      const data=response.ok?await response.json():null;
      if(data?.client_ip){state.localIp=String(data.client_ip);renderMe();}
      return data?.app==="morse-chat"?data:null;
    } catch (_) { return null; }
    finally { clearTimeout(timer); }
  }

  function localIps() {
    // IPs de la red local vía WebRTC (algunos navegadores las ocultan con nombres .local).
    return new Promise(resolve=>{
      const found=new Set();
      try {
        const pc=new RTCPeerConnection({iceServers:[]});
        pc.createDataChannel("x");
        pc.onicecandidate=event=>{
          if(!event.candidate){pc.close();resolve([...found]);return;}
          (event.candidate.candidate.match(/\d+\.\d+\.\d+\.\d+/g)||[]).filter(isPrivateIp).forEach(ip=>found.add(ip));
        };
        pc.createOffer().then(offer=>pc.setLocalDescription(offer)).catch(()=>resolve([]));
        setTimeout(()=>{try{pc.close()}catch(_){}resolve([...found])},1500);
      } catch (_) { resolve([]); }
    });
  }

  async function scanHosts(hosts) {
    let index=0, result=null;
    const worker=async()=>{
      while(!result && index<hosts.length){
        const host=hosts[index++], base=`http://${host}:${SERVER_PORT}`;
        if(await probe(base,700)) result=result||base;
      }
    };
    await Promise.all(Array.from({length:48},worker));
    return result;
  }

  async function discoverServer() {
    if (state.server || state.scanning || !navigator.onLine) return;
    // Una página https no puede hablar con un servidor http de la red local.
    if (location.protocol==="https:" && !isPrivateIp(location.hostname)) { setNet("netLocal","local"); return; }
    state.scanning=true; setNet("netScan","scan");
    try {
      const params=new URLSearchParams(location.search), direct=[];
      if (params.get("server")) direct.push(/^https?:/.test(params.get("server"))?params.get("server"):`http://${params.get("server")}`);
      if (pageIsHttp) direct.push(location.origin);
      const remembered=localStorage.getItem("mc-server"); if (remembered) direct.push(remembered);
      for (const base of direct) if (await probe(base)) return connectServer(base);

      const subnets=new Set();
      if (isPrivateIp(location.hostname)) subnets.add(location.hostname.split(".").slice(0,3).join("."));
      (await localIps()).forEach(ip=>subnets.add(ip.split(".").slice(0,3).join(".")));
      if (!subnets.size) ["192.168.1","192.168.0","10.0.0","192.168.100","192.168.2","10.0.1"].forEach(net=>subnets.add(net));
      const hosts=[];
      subnets.forEach(net=>{for(let i=1;i<255;i++) hosts.push(`${net}.${i}`);});
      const found=await scanHosts(hosts);
      if (found) return connectServer(found);
      setNet("netNone","local");
    } finally { state.scanning=false; }
  }

  function connectServer(base) {
    state.server=base; localStorage.setItem("mc-server",base);
    const host=base.replace(/^https?:\/\//,"");
    state.events?.close();
    loadRules(base); moderationStatus().then(()=>updateModerationUI());
    const admin=$("#mc-admin"); if(admin){admin.href=`${base}/admin`;admin.hidden=false;}
    const events=new EventSource(`${base}/api/events`); state.events=events;
    events.onopen=()=>{setNet("netLan","lan",{host});announce();refreshNetworkDevices(false);};
    events.onmessage=event=>{
      let packet; try{packet=JSON.parse(event.data)}catch(_){return;}
      // Avisos que solo puede emitir el servidor (los clientes no pueden enviarlos por /api/send).
      if(packet.senderId==="server"){
        if(packet.type==="rules") loadRules(base);
        if(packet.type==="blocked"){state.blocked=true;localStorage.setItem("mc-stop-blocked","1");updateModerationUI(t("adminBlocked"));}
        return;
      }
      receive(packet);
    };
    events.onerror=()=>{ if(events.readyState===EventSource.CLOSED) serverLost(); else setNet("netReconnect","scan",{host}); };
    setNet("netConnecting","scan",{host});
  }

  function serverLost() {
    if (!state.server) return;
    state.events?.close(); state.events=null; state.server=null;
    const admin=$("#mc-admin"); if(admin) admin.hidden=true;
    if (state.blocked) { setNet("netBlocked","local"); return; } // se reintenta cada 60 s
    setNet("netLost","local"); toast(t("serverDown"));
    setTimeout(discoverServer,5000);
  }

  const deviceIcons={server:"◆",apple:"●",android:"◉",media:"▣",printer:"▤",device:"○"};

  function renderNetworkDevices(data) {
    state.networkData=data;
    const list=$("#mc-device-list"), status=$("#mc-device-status");
    if(!list||!status)return;
    list.replaceChildren();
    const devices=Array.isArray(data?.devices)?data.devices:[];
    status.textContent=data?.scanning?t("devicesScan"):(data?.error||t("devicesFound",{count:devices.length,network:data?.network||"LAN"}));
    devices.forEach(device=>{
      const item=document.createElement("li"); item.className="mc-device";
      if(device.server)item.classList.add("is-server");
      const icon=document.createElement("span"); icon.className="mc-device-icon"; icon.textContent=deviceIcons[device.kind]||deviceIcons.device;
      const body=document.createElement("span"); body.className="mc-device-body";
      const name=document.createElement("b"); name.textContent=device.name||device.ip;
      const ip=document.createElement("code"); ip.textContent=device.ip||"";
      const mac=document.createElement("small"); mac.textContent=device.mac||t("noMac");
      body.append(name,ip,mac); item.append(icon,body);
      if(device.server){const badge=document.createElement("em");badge.textContent=t("thisServer");item.append(badge);}
      list.append(item);
    });
    if(!devices.length&&!data?.scanning){const empty=document.createElement("li");empty.className="mc-device-empty";empty.textContent=t("devicesEmpty");list.append(empty);}
  }

  async function refreshNetworkDevices(force=false) {
    const base=apiBase(), status=$("#mc-device-status");
    if(base===null){if(status)status.textContent=t("devicesUnavailable");return;}
    try{
      const response=await fetch(`${base}/api/network/devices${force?"?refresh=1":""}`,{cache:"no-store"});
      if(!response.ok)throw new Error(String(response.status));
      const data=await response.json(); renderNetworkDevices(data);
      if(data.scanning)setTimeout(()=>refreshNetworkDevices(false),1800);
    }catch(_){if(status)status.textContent=t("devicesUnavailable");}
  }

  async function loadRules(base) {
    try {
      const response=await fetch(`${base}/api/moderation/words`,{cache:"no-store"});
      if(response.ok) window.MorseModeration?.setRules((await response.json()).rules);
    } catch (_) { /* se mantiene la lista integrada */ }
  }

  function encodeMorse(text, lang) {
    const map = mapFor(lang), words = String(text).toLocaleUpperCase(lang === "RU" ? "ru" : lang === "ES" ? "es" : "en").trim().split(/\s+/);
    return words.map(word => [...word].map(letter => map[letter]).filter(Boolean).join(" ")).filter(Boolean).join(" / ");
  }

  function decodeMorse(code, lang) {
    const reverse = REVERSE[lang] || REVERSE.EN;
    return String(code).trim().split(/\s*\/\s*/).map(word => word.trim().split(/\s+/).map(token => reverse[token] || "□").join("")).join(" ");
  }

  async function sha(bytes) { return nacl.hash(new Uint8Array(bytes)); }
  async function importRoomKey(raw) { if (raw.length !== nacl.secretbox.keyLength) throw new Error("key"); return new Uint8Array(raw); }
  async function encryptRoom(payload) {
    const nonce = nacl.randomBytes(nacl.secretbox.nonceLength);
    // El id de sala va dentro del sobre cifrado: un mensaje no se puede trasladar a otra sala.
    const cipher = nacl.secretbox(enc.encode(JSON.stringify({roomId:state.roomId, payload})), nonce, state.roomKey);
    return {v:2, nonce:b64(nonce), cipher:b64(cipher)};
  }
  async function decryptRoom(packet) {
    const plain = nacl.secretbox.open(unb64(packet.cipher), unb64(packet.nonce), state.roomKey);
    if (!plain) throw new Error("cipher");
    const box = JSON.parse(dec.decode(plain));
    if (box.roomId !== packet.roomId) throw new Error("room");
    return box.payload;
  }

  async function ensureIdentity() {
    if (state.keys) return state.keys;
    const saved = sessionStorage.getItem("mc-nacl-identity-v2");
    let pair = null;
    if (saved) try { pair = nacl.box.keyPair.fromSecretKey(unb64(saved)); } catch (_) { sessionStorage.removeItem("mc-nacl-identity-v2"); }
    if (!pair) { pair = nacl.box.keyPair(); sessionStorage.setItem("mc-nacl-identity-v2", b64(pair.secretKey)); }
    state.keys = {secretKey:pair.secretKey, publicKey:b64(pair.publicKey)};
    return state.keys;
  }

  function template() {
    const tabs = document.createElement("nav");
    tabs.id = "morse-chat-tabs";
    tabs.setAttribute("data-i18n-aria", "sections");
    tabs.innerHTML = '<button data-view="chat" aria-selected="true" data-i18n="tabChat"></button><button data-view="practice" aria-selected="false" data-i18n="tabPractice"></button>';
    document.body.appendChild(tabs);

    const app = document.createElement("section");
    app.id = "morse-chat-app";
    app.innerHTML = `
      <div class="mc-layout">
        <aside class="mc-devices" aria-labelledby="mc-devices-title">
          <div class="mc-devices-head"><div><h2 id="mc-devices-title" data-i18n="devicesTitle"></h2><p id="mc-device-status" data-i18n="devicesUnavailable"></p></div><span class="mc-radar" aria-hidden="true"></span></div>
          <ol class="mc-device-list" id="mc-device-list"></ol>
          <button class="mc-device-refresh" id="mc-device-refresh" type="button" data-i18n="devicesRefresh"></button>
        </aside>
      <div class="mc-shell">
        <header class="mc-head"><span class="mc-dot"></span><strong data-i18n="title"></strong><span class="mc-me" id="mc-me" data-i18n-title="youTitle" hidden></span><button class="mc-net" id="mc-net" type="button" data-kind="local" data-i18n-title="netTitle"></button><a class="mc-net mc-admin" id="mc-admin" target="_blank" rel="noopener" hidden>ADMIN</a></header>
        <form class="mc-register" id="mc-register">
          <h2 data-i18n="regTitle"></h2>
          <p data-i18n="regIntro"></p>
          <div class="mc-field"><label for="mc-nick" data-i18n="nick"></label><input id="mc-nick" maxlength="20" autocomplete="nickname" placeholder="RadioLuna" required></div>
          <div class="mc-field"><label for="mc-lang" data-i18n="lang"></label><select id="mc-lang"><option value="ES">Español</option><option value="EN">English</option><option value="RU">Русский</option></select></div>
          <button class="mc-btn mc-btn-primary" type="submit" data-i18n="enter"></button><div class="mc-status" id="mc-register-status" aria-live="polite"></div>
          <button class="mc-btn mc-train" type="button" id="mc-go-practice" data-i18n="firstTime"></button>
          <p class="mc-note" data-i18n="regNote"></p>
        </form>
        <div class="mc-main">
          <div class="mc-toolbar">
            <button class="mc-btn" id="mc-public" aria-pressed="true" data-i18n="modeFree"></button>
            <button class="mc-btn" id="mc-private" aria-pressed="false" data-i18n="modePrivate"></button>
            <button class="mc-btn" id="mc-beginner" aria-pressed="false"></button>
            <button class="mc-btn" id="mc-reveal-all" aria-pressed="false"></button>
            <span class="mc-moderation" id="mc-moderation">STOP 0/3</span>
            <span class="mc-grow"></span><select id="mc-chat-lang" data-i18n-aria="lang"><option value="ES">ES</option><option value="EN">EN</option><option value="RU">RU</option></select>
            <button class="mc-btn mc-btn-danger" id="mc-exit" data-i18n="exit"></button>
          </div>
          <div class="mc-clean-controls">
            <button class="mc-btn" id="mc-clear-chat" type="button" data-i18n="clearChat"></button>
            <label class="mc-auto-clean"><input id="mc-auto-clean" type="checkbox"><span data-i18n="autoClean"></span></label>
            <label class="mc-line-limit" for="mc-line-limit"><span id="mc-line-limit-text"></span><input id="mc-line-limit" type="range" min="100" max="1000" step="50" value="100"></label>
          </div>
          <div class="mc-room">
            <div class="mc-row"><button class="mc-btn mc-btn-primary" id="mc-new-room" data-i18n="newRoom"></button><input class="mc-input mc-grow" id="mc-room-key" data-i18n-ph="roomKeyPh" autocomplete="off"><button class="mc-btn" id="mc-join-room" data-i18n="open"></button></div>
            <div class="mc-row"><div class="mc-room-code mc-grow" id="mc-room-code" data-i18n="roomEmpty"></div><button class="mc-btn" id="mc-copy-room" disabled data-i18n="copyKey"></button></div>
            <div><div class="mc-note" data-i18n="peopleTitle"></div><div class="mc-online" id="mc-online"></div></div>
          </div>
          <div class="mc-messages" id="mc-messages"><div class="mc-empty" data-i18n="emptyChat"></div></div>
          <div class="mc-stop-banner" id="mc-stop-banner" role="alert" hidden></div>
          <div class="mc-compose">
            <div class="mc-beginner">
              <div class="mc-copy" id="mc-copy" hidden></div>
              <input class="mc-input" id="mc-normal" maxlength="180" autocomplete="off">
              <button class="mc-btn" id="mc-convert" data-i18n="convert"></button><p class="mc-note" data-i18n="beginnerNote"></p>
            </div>
            <div class="mc-keyboard">
              <div class="mc-buffer"><div class="mc-buffer-code" id="mc-buffer-code">· —</div><div class="mc-buffer-text" id="mc-buffer-text"></div></div>
              <button class="mc-key" id="mc-key" type="button" data-i18n-aria="keyAria"><span class="mc-tk" aria-hidden="true"><span class="mc-tk-base"></span><span class="mc-tk-contact"></span><span class="mc-tk-post"></span><span class="mc-tk-lever"><span class="mc-tk-knob"></span></span></span><small data-i18n="keyHint"></small></button>
            </div>
            <div class="mc-actions"><button class="mc-btn" id="mc-letter" data-i18n="endLetter"></button><button class="mc-btn" id="mc-space" data-i18n="space"></button><button class="mc-btn" id="mc-undo" data-i18n="undo"></button><span class="mc-grow"></span><button class="mc-btn mc-btn-primary" id="mc-send" data-i18n="send"></button></div>
            <div class="mc-help" data-i18n="keyHelp"></div>
          </div>
        </div>
      </div></div>
      <div class="mc-toast" id="mc-toast" aria-live="polite"></div>
      <div class="mc-modal" id="mc-invite-modal" role="dialog" aria-modal="true"><div class="mc-modal-card"><h3 data-i18n="inviteTitle"></h3><p id="mc-invite-text"></p><div class="mc-row"><button class="mc-btn mc-btn-primary" id="mc-accept" data-i18n="accept"></button><button class="mc-btn" id="mc-decline" data-i18n="decline"></button></div></div></div>`;
    document.body.appendChild(app);
  }

  let toastTimer;
  function toast(message) {
    const node = $("#mc-toast"); node.textContent = message; node.classList.add("show");
    clearTimeout(toastTimer); toastTimer = setTimeout(() => node.classList.remove("show"), 2400);
  }

  function setView(view) {
    document.body.classList.toggle("morse-chat-active", view === "chat");
    try { history.replaceState(null, "", view === "practice" ? "#practica" : "#chat"); } catch (_) {}
    $$("#morse-chat-tabs button").forEach(button => button.setAttribute("aria-selected", String(button.dataset.view === view)));
    if (view === "chat" && state.ready) announce();
  }

  function announce() {
    if (!state.ready || !state.keys) return;
    post({type:"presence", nickname:state.nickname, language:state.language, publicKey:state.keys.publicKey});
  }

  function renderPeople() {
    const now = Date.now(), list = $("#mc-online"); list.replaceChildren();
    [...state.people.entries()].filter(([id, p]) => id !== state.id && now - p.seen < 25000).forEach(([id, person]) => {
      const button = document.createElement("button"); button.className = "mc-person";
      const name=document.createElement("b"); name.textContent=person.nickname; button.append(name, ` · ${person.ip||"IP ?"} · ${person.language} · ${t("invite")}`);
      button.addEventListener("click", () => invitePerson(id, person)); list.appendChild(button);
    });
    if (!list.children.length) { const empty=document.createElement("span"); empty.className="mc-note"; empty.textContent=t("nobody"); list.appendChild(empty); }
  }

  function clearCopy() {
    state.copyTarget=null; state.copyDone=false;
    const n=$("#mc-normal"); n.disabled=false; n.value=""; n.placeholder=t("normalPh");
    renderCopy();
  }

  function buildCopyTarget(text) {
    const map=mapFor(state.language), items=[];
    String(text).toLocaleUpperCase(state.language==="RU"?"ru":state.language==="ES"?"es":"en").trim().split(/\s+/).forEach(word=>{
      const letters=[...word].filter(letter=>map[letter]).map(letter=>({letter, code:map[letter]}));
      if(!letters.length) return;
      if(items.length) items.push({letter:" ", code:"/"});
      items.push(...letters);
    });
    return items;
  }

  function copyExpected() { return state.copyTarget?.[state.tokens.length]?.code || ""; }

  function copyAdvance() {
    while (copyExpected()==="/") state.tokens.push("/");
    state.copyDone=state.tokens.length===state.copyTarget.length;
    if (state.copyDone) toast(t("copyDone"));
  }

  function copyError(message) {
    state.current=""; toast(message);
    const box=$("#mc-copy"); box.classList.remove("err"); void box.offsetWidth; box.classList.add("err");
  }

  function renderCopy() {
    const box=$("#mc-copy"), target=state.copyTarget;
    box.hidden=!target; box.replaceChildren(); if(!target) return;
    const line=document.createElement("div"); line.className="mc-copy-line";
    target.forEach((item,index)=>{
      if (item.code==="/") { const gap=document.createElement("span"); gap.className="mc-copy-gap"; gap.textContent="/"; if(index<state.tokens.length) gap.classList.add("ok"); line.appendChild(gap); return; }
      const cell=document.createElement("span"); cell.className="mc-copy-cell";
      const letter=document.createElement("b"); letter.textContent=item.letter;
      const code=document.createElement("code");
      if (index<state.tokens.length) { cell.classList.add("ok"); code.textContent=item.code.replace(/-/g,"—"); }
      else if (index===state.tokens.length) {
        cell.classList.add("now");
        const typed=document.createElement("span"); typed.className="mc-copy-typed"; typed.textContent=state.current.replace(/-/g,"—");
        code.append(typed, item.code.slice(state.current.length).replace(/-/g,"—"));
      } else code.textContent=item.code.replace(/-/g,"—");
      cell.append(letter,code); line.appendChild(cell);
    });
    const foot=document.createElement("div"); foot.className="mc-copy-foot";
    const hint=document.createElement("span");
    const next=state.copyTarget[state.tokens.length];
    hint.textContent=state.copyDone?t("copyHintDone"):t("copyHint",{letter:next.letter,code:next.code.replace(/-/g,"—")});
    const cancel=document.createElement("button"); cancel.className="mc-btn mc-copy-cancel"; cancel.type="button"; cancel.textContent=t("cancel");
    cancel.addEventListener("click",()=>{state.tokens=[];state.current="";clearCopy();renderBuffer()});
    foot.append(hint,cancel);
    box.append(line,foot); box.classList.toggle("complete",state.copyDone);
  }

  function renderBuffer() {
    const joined = [...state.tokens, state.current].filter(Boolean).join(" ");
    $("#mc-buffer-code").textContent = joined || "· —";
    $("#mc-buffer-text").textContent = joined ? decodeMorse(joined, state.language) : t("waiting");
  }

  function renderMessages() {
    const box = $("#mc-messages"); box.replaceChildren();
    const visible = state.messages.filter(message => message.mode === state.mode && (message.mode === "public" || message.roomId === state.roomId));
    if (!visible.length) { const empty=document.createElement("div"); empty.className="mc-empty"; empty.textContent=state.mode === "private" && !state.roomId ? t("emptyRoom") : t("emptyChat"); box.appendChild(empty); return; }
    visible.forEach(message => {
      const article=document.createElement("article"); article.className=`mc-msg${message.senderId === state.id ? " mine" : ""}${state.revealAll || message.revealed ? " revealed" : ""}${message.chatId===state.latestMessageId ? " is-latest" : ""}`;
      const head=document.createElement("div"); head.className="mc-msg-head";
      const name=document.createElement("b"); name.textContent=message.nickname; const meta=document.createElement("span"); meta.textContent=`${message.ip||"IP ?"} · ${message.language} · ${new Date(message.time).toLocaleTimeString([], {hour:"2-digit",minute:"2-digit"})}`; head.append(name,meta);
      const code=document.createElement("div"); code.className="mc-code"; code.textContent=message.morse.replace(/-/g,"—");
      const translation=document.createElement("div"); translation.className="mc-translation"; translation.textContent=decodeMorse(message.morse,message.language);
      const reveal=document.createElement("button"); reveal.className="mc-reveal"; reveal.textContent=article.classList.contains("revealed")?t("hideTr"):t("showTr");
      reveal.addEventListener("click",()=>{message.revealed=!message.revealed;renderMessages()});
      const copy=document.createElement("button"); copy.className="mc-reveal mc-msg-copy"; copy.type="button"; copy.textContent=t("copyMsg");
      copy.addEventListener("click",()=>copyMessage(message));
      const actions=document.createElement("div"); actions.className="mc-msg-actions"; actions.append(reveal,copy);
      article.append(head,code,translation,actions); box.appendChild(article);
    });
    requestAnimationFrame(()=>box.scrollTo({top:box.scrollHeight,behavior:"smooth"}));
  }

  async function copyMessage(message) {
    const text=`${message.morse}
${decodeMorse(message.morse,message.language)}`;
    try { await navigator.clipboard.writeText(text); toast(t("msgCopied")); }
    catch (_) {
      try {
        const area=document.createElement("textarea"); area.value=text; area.setAttribute("readonly","");
        area.style.position="fixed"; area.style.opacity="0";
        document.body.appendChild(area); area.select(); const done=document.execCommand("copy"); area.remove();
        toast(done?t("msgCopied"):t("msgCopyFail"));
      } catch (__) { toast(t("msgCopyFail")); }
    }
  }

  function finishLetter() {
    clearTimeout(state.letterTimer);
    if (!state.current) return true;
    if (state.copyTarget) { copyError(t("copyIncomplete")); renderCopy(); renderBuffer(); return false; }
    if (!REVERSE[state.language][state.current]) { toast(t("badSequence")); return false; }
    state.tokens.push(state.current); state.current=""; renderBuffer(); return true;
  }

  function addWordSpace() {
    if (state.copyTarget) return toast(t("copyAutoSpace"));
    if (!finishLetter() || !state.tokens.length || state.tokens.at(-1) === "/") return;
    state.tokens.push("/"); renderBuffer();
  }

  const audio = { ctx:null, osc:null, gain:null };
  function toneStart() {
    try {
      if (!audio.ctx) audio.ctx=new (window.AudioContext||window.webkitAudioContext)();
      const ctx=audio.ctx; if (ctx.state==="suspended") ctx.resume();
      toneStop();
      const osc=ctx.createOscillator(), gain=ctx.createGain();
      osc.type="sine"; osc.frequency.value=680;
      gain.gain.setValueAtTime(0,ctx.currentTime); gain.gain.linearRampToValueAtTime(0.2,ctx.currentTime+0.012);
      osc.connect(gain); gain.connect(ctx.destination); osc.start();
      audio.osc=osc; audio.gain=gain;
    } catch (_) {}
  }

  function toneStop() {
    if (!audio.ctx || !audio.osc) return;
    const ctx=audio.ctx, osc=audio.osc;
    audio.gain.gain.cancelScheduledValues(ctx.currentTime); audio.gain.gain.linearRampToValueAtTime(0,ctx.currentTime+0.035);
    setTimeout(()=>{try{osc.stop();osc.disconnect()}catch(_){}},70);
    audio.osc=null; audio.gain=null;
  }

  function keyDown(event) {
    if (state.pressed) return;
    state.pressed=true; state.downAt=performance.now(); clearTimeout(state.letterTimer); $("#mc-key").classList.add("is-down");
    toneStart(); event?.preventDefault?.();
  }

  function keyUp(event) {
    if (!state.pressed) return;
    state.pressed=false; toneStop(); $("#mc-key").classList.remove("is-down"); event?.preventDefault?.();
    const symbol=Math.max(8,performance.now()-state.downAt) < 280 ? "." : "-";
    if (state.copyTarget) {
      if (state.copyDone) return toast(t("copyFull"));
      const expected=copyExpected(), attempt=state.current+symbol;
      if (!expected.startsWith(attempt)) copyError(symbol==="."?t("copyWrongDash"):t("copyWrongDot"));
      else if (attempt===expected) { state.tokens.push(attempt); state.current=""; copyAdvance(); }
      else state.current=attempt;
      renderCopy(); renderBuffer(); return;
    }
    state.current += symbol; renderBuffer();
    state.letterTimer=setTimeout(finishLetter,700);
  }

  function messageInCurrentChat(message) {
    return message.mode===state.mode&&(message.mode==="public"||message.roomId===state.roomId);
  }

  function clearCurrentChat(showNotice=true) {
    state.messages=state.messages.filter(message=>!messageInCurrentChat(message));
    state.latestMessageId=null; renderMessages();
    if(showNotice)toast(t("chatCleared"));
  }

  function updateCleanControls() {
    const checkbox=$("#mc-auto-clean"),slider=$("#mc-line-limit"),label=$("#mc-line-limit-text");
    if(checkbox)checkbox.checked=state.autoClean;
    if(slider)slider.value=String(state.lineLimit);
    if(label)label.textContent=t("lineLimit",{count:state.lineLimit});
  }

  function addMessage(message) {
    if(state.autoClean&&state.messages.filter(messageInCurrentChat).length>=state.lineLimit){
      clearCurrentChat(false); toast(t("autoCleaned"));
    }
    const chatId=message.chatId||uuid();
    state.messages.push({...message,chatId,revealed:false});
    state.messages=state.messages.slice(-1000);
    state.latestMessageId=chatId; renderMessages();
  }

  function acceptIncoming(payload) {
    if(!payload?.morse||state.blockedSenders.has(payload.senderId))return;
    const verdict=moderationCheck(decodeMorse(payload.morse,payload.language),payload.language);
    if(!verdict.blocked){addMessage(payload);return;}
    const count=(state.remoteViolations.get(payload.senderId)||0)+1;state.remoteViolations.set(payload.senderId,count);
    if(count>=3)state.blockedSenders.add(payload.senderId);
    toast(count>=3?t("muted"):t("held"));
  }

  async function sendMessage() {
    if(state.blocked)return updateModerationUI();
    if(state.copyTarget&&!state.copyDone)return toast(t("copyRequired"));
    if (!finishLetter()) return;
    while (state.tokens.at(-1) === "/") state.tokens.pop();
    const morse=state.tokens.join(" "); if (!morse) return toast(t("writeWithKey"));
    const verdict=moderationCheck(decodeMorse(morse,state.language),state.language);
    if(verdict.blocked){state.tokens=[];state.current="";clearCopy();renderBuffer();await recordStrike(verdict);return;}
    const payload={nickname:state.nickname, ip:state.localIp, language:state.language, morse, time:Date.now(), senderId:state.id, mode:state.mode, roomId:state.roomId};
    if (state.mode === "private") {
      if (!state.roomKey) return toast(t("needRoom"));
      const encrypted=await encryptRoom(payload); post({type:"private-message", roomId:state.roomId, ...encrypted});
    } else post({type:"public-message", payload});
    addMessage(payload); state.tokens=[]; state.current=""; clearCopy(); renderBuffer();
  }

  async function createRoom() {
    const raw=crypto.getRandomValues(new Uint8Array(32)), digest=new Uint8Array(await sha(raw));
    await enterRoom(b64(digest.slice(0,12)),raw); toast(t("roomCreated"));
  }

  async function enterRoom(roomId, raw) {
    state.roomId=roomId; state.roomRaw=new Uint8Array(raw); state.roomKey=await importRoomKey(state.roomRaw); state.mode="private";
    sessionStorage.setItem("mc-room",`${roomId}.${b64(state.roomRaw)}`);
    document.body.classList.add("mc-private"); $("#mc-public").setAttribute("aria-pressed","false"); $("#mc-private").setAttribute("aria-pressed","true");
    $("#mc-room-code").textContent=t("roomLabel",{room:roomId,key:`MC1.${roomId}.${b64(state.roomRaw)}`}); $("#mc-copy-room").disabled=false; renderMessages();
  }

  async function joinRoom() {
    const value=escapeText($("#mc-room-key").value), match=/^MC1\.([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)$/.exec(value);
    if (!match) return toast(t("roomBadKey"));
    try { await enterRoom(match[1],unb64(match[2])); $("#mc-room-key").value=""; toast(t("roomOpened")); }
    catch (_) { toast(t("roomOpenFail")); }
  }

  async function invitePerson(id, person) {
    if (!state.roomRaw) await createRoom();
    try {
      // Sobre de un solo uso: clave efímera + clave pública del invitado. Solo él puede abrirlo.
      const ephemeral=nacl.box.keyPair(), nonce=nacl.randomBytes(nacl.box.nonceLength);
      const cipher=nacl.box(state.roomRaw,nonce,unb64(person.publicKey),ephemeral.secretKey);
      post({type:"invite",toId:id,fromNickname:state.nickname,roomId:state.roomId,keyCipher:b64(cipher),nonce:b64(nonce),ephemeralKey:b64(ephemeral.publicKey)}); toast(t("inviteSent",{nick:person.nickname}));
    } catch (_) { toast(t("inviteFail")); }
  }

  async function receive(packet) {
    if (!packet || packet.senderId === state.id) return;
    if (packet.pid) { if (state.seen.has(packet.pid)) return; state.seen.add(packet.pid); if (state.seen.size>2000) state.seen=new Set([...state.seen].slice(-1000)); }
    if (packet.type === "presence") {
      if (typeof packet.publicKey !== "string") return; // cliente de una versión anterior
      state.people.set(packet.senderId,{nickname:packet.nickname,ip:packet.sourceIp||"",language:packet.language,publicKey:packet.publicKey,seen:Date.now()}); renderPeople(); return;
    }
    if (packet.type === "public-message" && packet.payload?.morse) { acceptIncoming({...packet.payload,ip:packet.sourceIp||packet.payload.ip||"",mode:"public"}); return; }
    if (packet.type === "invite" && packet.toId === state.id && state.keys) {
      try {
        const raw=nacl.box.open(unb64(packet.keyCipher),unb64(packet.nonce),unb64(packet.ephemeralKey),state.keys.secretKey);
        if (!raw) return;
        state.pendingInvite={roomId:packet.roomId,raw:new Uint8Array(raw)}; $("#mc-invite-text").textContent=t("inviteText",{nick:packet.fromNickname,room:packet.roomId}); $("#mc-invite-modal").classList.add("open");
      } catch (_) { /* El sobre no pertenece a esta identidad. */ }
      return;
    }
    if (packet.type === "private-message" && state.roomKey && packet.roomId === state.roomId) {
      try { const payload=await decryptRoom(packet); if (payload?.morse) acceptIncoming({...payload,ip:packet.sourceIp||payload.ip||"",mode:"private",roomId:packet.roomId}); }
      catch (_) { /* Mensaje de otra llave o alterado. */ }
    }
  }

  function renderMe() {
    const me=$("#mc-me"); if(!me) return;
    me.hidden=!state.nickname;
    if(!state.nickname){me.textContent="";return;}
    const label=t("you",{nick:state.nickname,ip:state.localIp||"IP ?"});
    me.textContent=state.localIp&&!label.includes(state.localIp)?`${label} · ${state.localIp}`:label;
  }

  function renderToggles() {
    $("#mc-beginner").textContent=t("help",{state:state.beginner?"ON":"OFF"});
    $("#mc-reveal-all").textContent=state.revealAll?t("revealShown"):t("revealHidden");
    updateCleanControls();
  }

  /* Un solo idioma para todo: interfaz del chat, alfabeto Morse y pestaña de práctica. */
  function setLanguage(lang, fromPractice=false) {
    if (!I18N[lang]) return;
    state.language=lang;
    try { localStorage.setItem("mc-lang", lang); } catch (_) {}
    document.documentElement.lang=lang.toLowerCase();
    $$("[data-i18n]").forEach(node=>node.textContent=t(node.dataset.i18n));
    $$("[data-i18n-ph]").forEach(node=>node.placeholder=t(node.dataset.i18nPh));
    $$("[data-i18n-title]").forEach(node=>node.title=t(node.dataset.i18nTitle));
    $$("[data-i18n-aria]").forEach(node=>node.setAttribute("aria-label",t(node.dataset.i18nAria)));
    $("#mc-lang").value=lang; $("#mc-chat-lang").value=lang;
    $("#mc-normal").placeholder=state.copyTarget?t("copyPh"):t("normalPh");
    if (state.roomRaw) $("#mc-room-code").textContent=t("roomLabel",{room:state.roomId,key:`MC1.${state.roomId}.${b64(state.roomRaw)}`});
    if (state.net) setNet(state.net.key,state.net.kind,state.net.vars);
    renderToggles(); renderMe(); updateModerationUI(); renderBuffer(); renderMessages(); renderPeople();
    if(state.networkData)renderNetworkDevices(state.networkData);
    if (state.copyTarget) { state.tokens=[]; state.current=""; clearCopy(); renderBuffer(); } // la frase era de otro alfabeto
    if (!fromPractice) syncPractice(lang);
    if (state.ready) announce();
  }

  function syncPractice(lang) {
    // La práctica (React) tiene sus propios botones de idioma: se pulsan por código.
    let tries=0;
    const attempt=()=>{
      const button=document.querySelector(`#root [data-testid="lang-${lang}"]`);
      if (button) { state.syncingPractice=true; button.click(); state.syncingPractice=false; return; }
      if (++tries<40) setTimeout(attempt,250);
    };
    attempt();
  }

  function bind() {
    $$("#morse-chat-tabs button").forEach(button=>button.addEventListener("click",()=>setView(button.dataset.view)));
    $("#mc-go-practice").addEventListener("click",()=>setView("practice"));
    $("#mc-register").addEventListener("submit",async event=>{
      event.preventDefault(); const nickname=escapeText($("#mc-nick").value);
      if (!/^[\p{L}\p{N}_-]{2,20}$/u.test(nickname)) { $("#mc-register-status").textContent=t("nickInvalid"); return; }
      if (!window.nacl || !window.crypto?.getRandomValues) { $("#mc-register-status").textContent=t("noCrypto"); return; }
      $("#mc-register-status").textContent=t("creatingId");
      try {
        await moderationStatus();
        if(state.blocked&&!state.ownerVerified){$("#mc-register-status").textContent=t("regBlocked");return;}
        await ensureIdentity();
        $("#mc-register-status").textContent=t("nickChecking");
        const available=await reserveNickname(nickname);
        if(available===false){$("#mc-register-status").textContent=t("nickTaken");$("#mc-nick").focus();return;}
        state.nickname=nickname; state.ready=true; renderMe();
        $("#morse-chat-app").classList.add("mc-ready");
        if (state.savedRoom) await enterRoom(state.savedRoom.roomId,state.savedRoom.raw);
        announce(); renderPeople(); renderMessages(); updateModerationUI();
      }
      catch (_) { $("#mc-register-status").textContent=t("idFailed"); }
    });
    $("#mc-public").addEventListener("click",()=>{state.mode="public";document.body.classList.remove("mc-private");$("#mc-public").setAttribute("aria-pressed","true");$("#mc-private").setAttribute("aria-pressed","false");renderMessages()});
    $("#mc-private").addEventListener("click",()=>{state.mode="private";document.body.classList.add("mc-private");$("#mc-public").setAttribute("aria-pressed","false");$("#mc-private").setAttribute("aria-pressed","true");renderMessages()});
    $("#mc-beginner").addEventListener("click",event=>{state.beginner=!state.beginner;$("#morse-chat-app").classList.toggle("mc-beginner-on",state.beginner);event.currentTarget.setAttribute("aria-pressed",String(state.beginner));renderToggles()});
    $("#mc-reveal-all").addEventListener("click",event=>{state.revealAll=!state.revealAll;event.currentTarget.setAttribute("aria-pressed",String(state.revealAll));renderToggles();renderMessages()});
    $("#mc-clear-chat").addEventListener("click",()=>clearCurrentChat(true));
    $("#mc-auto-clean").addEventListener("change",event=>{state.autoClean=event.currentTarget.checked;updateCleanControls()});
    $("#mc-line-limit").addEventListener("input",event=>{state.lineLimit=Math.max(100,Math.min(1000,Number(event.currentTarget.value)||100));updateCleanControls()});
    $("#mc-chat-lang").addEventListener("change",event=>setLanguage(event.target.value));
    $("#mc-lang").addEventListener("change",event=>setLanguage(event.target.value));
    document.addEventListener("click",event=>{
      const button=event.target.closest?.('#root [data-testid^="lang-"]');
      if (button && !state.syncingPractice) setLanguage(button.dataset.testid.slice(5),true);
    },true);
    $("#mc-new-room").addEventListener("click",createRoom); $("#mc-join-room").addEventListener("click",joinRoom);
    $("#mc-copy-room").addEventListener("click",async()=>{if(!state.roomRaw)return;const key=`MC1.${state.roomId}.${b64(state.roomRaw)}`;try{await navigator.clipboard.writeText(key);toast(t("keyCopied")) }catch(_){toast(t("keyCopyFail"))}});
    $("#mc-convert").addEventListener("click",()=>{
      const input=$("#mc-normal"), target=buildCopyTarget(input.value);
      if(!target.length) return toast(t("noLetters"));
      clearTimeout(state.letterTimer); state.tokens=[]; state.current=""; state.copyTarget=target; state.copyDone=false;
      input.value=""; input.disabled=true; input.placeholder=t("copyPh");
      document.activeElement?.blur?.(); renderCopy(); renderBuffer();
    });
    $("#mc-letter").addEventListener("click",finishLetter); $("#mc-space").addEventListener("click",addWordSpace);
    $("#mc-undo").addEventListener("click",()=>{clearTimeout(state.letterTimer);if(state.current)state.current=state.current.slice(0,-1);else if(state.copyTarget){while(state.tokens.at(-1)==="/")state.tokens.pop();state.tokens.pop();state.copyDone=false;}else state.tokens.pop();if(state.copyTarget)renderCopy();renderBuffer()});
    $("#mc-send").addEventListener("click",()=>sendMessage().catch(()=>toast(t("sendFail"))));
    const key=$("#mc-key"); key.addEventListener("pointerdown",event=>{key.setPointerCapture?.(event.pointerId);keyDown(event)}); key.addEventListener("pointerup",keyUp); key.addEventListener("pointercancel",keyUp);
    // El fondo del chat y el búfer también actúan como una llave Morse con el
    // botón izquierdo. Los controles interactivos quedan excluidos.
    $("#morse-chat-app").addEventListener("pointerdown",event=>{
      if(event.pointerType!=="mouse"||event.button!==0||!state.ready||state.blocked)return;
      if(!event.target.closest?.(".mc-messages,.mc-buffer")||event.target.closest?.("button,input,select,a"))return;
      // El texto de los mensajes se puede seleccionar para copiarlo: ahi no actua la llave.
      if(event.target.closest?.(".mc-code,.mc-translation,.mc-msg-head"))return;
      state.mouseMorse=true; keyDown(event);
    });
    window.addEventListener("pointerup",event=>{if(!state.mouseMorse)return;state.mouseMorse=false;keyUp(event)},true);
    window.addEventListener("pointercancel",event=>{if(!state.mouseMorse)return;state.mouseMorse=false;keyUp(event)},true);
    $("#mc-accept").addEventListener("click",async()=>{if(state.pendingInvite)await enterRoom(state.pendingInvite.roomId,state.pendingInvite.raw);state.pendingInvite=null;$("#mc-invite-modal").classList.remove("open");toast(t("inviteAccepted"))});
    $("#mc-decline").addEventListener("click",()=>{state.pendingInvite=null;$("#mc-invite-modal").classList.remove("open")});
    $("#mc-exit").addEventListener("click",()=>{releaseNickname();state.ready=false;state.nickname="";renderMe();$("#morse-chat-app").classList.remove("mc-ready");$("#mc-register-status").textContent=""});
    window.addEventListener("pagehide",()=>{if(state.ready)releaseNickname()});
    window.addEventListener("keydown",event=>{if(!document.body.classList.contains("morse-chat-active")||!state.ready||!['Space','Enter','NumpadEnter'].includes(event.code)||(event.target.id!=="mc-key"&&/INPUT|TEXTAREA|SELECT|BUTTON/.test(event.target.tagName))||event.repeat)return;event.preventDefault();event.stopImmediatePropagation();keyDown(event)},true);
    window.addEventListener("keyup",event=>{if(!document.body.classList.contains("morse-chat-active")||!state.ready||!['Space','Enter','NumpadEnter'].includes(event.code))return;event.preventDefault();event.stopImmediatePropagation();keyUp(event)},true);
    window.addEventListener("blur",()=>keyUp());
    $("#morse-chat-app").addEventListener("paste",event=>{if(event.target.id==="mc-room-key")return;event.preventDefault();toast(t("pasteBlocked"))});
    $("#morse-chat-app").addEventListener("beforeinput",event=>{if(event.target.id==="mc-room-key"||!/^insertFrom(Paste|Drop)/.test(event.inputType||""))return;event.preventDefault();toast(t("pasteBlocked"))});
    $("#morse-chat-app").addEventListener("drop",event=>event.preventDefault());
    window.addEventListener("storage",event=>{if(event.key==="mc-event"&&event.newValue)try{receive(JSON.parse(event.newValue))}catch(_){}});
    if(channel) channel.addEventListener("message",event=>receive(event.data));
    setInterval(()=>{announce();renderPeople()},8000);
    $("#mc-device-refresh").addEventListener("click",()=>refreshNetworkDevices(true));
    $("#mc-net").addEventListener("click",()=>{if(state.server){toast(t("connectedTo",{server:state.server}));return;}discoverServer()});
    window.addEventListener("online",discoverServer);
    setInterval(discoverServer,60000);
    setInterval(()=>refreshNetworkDevices(false),30000);
    discoverServer();
  }

  function init() {
    template(); bind(); setLanguage(state.language);
    const saved=sessionStorage.getItem("mc-room");
    if(saved){const dot=saved.indexOf(".");if(dot>0) state.savedRoom={roomId:saved.slice(0,dot),raw:unb64(saved.slice(dot+1))};}
    // La aplicación arranca en el chat; la práctica es una pestaña para entrenar antes.
    setView(location.hash === "#practica" ? "practice" : "chat");
  }

  if(document.readyState === "loading") document.addEventListener("DOMContentLoaded",init); else init();
})();
