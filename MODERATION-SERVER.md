# Contrato de moderación del servidor

La interfaz aplica tres avisos localmente. Para que el bloqueo por IP y la
excepción del creador sean reales, el servidor de transporte debe implementar:

- `GET /api/moderation/status`: responde `{ "strikes": 0, "blocked": false,
  "owner": false }`. La IP se obtiene de la conexión en el servidor, nunca de
  una cabecera enviada por el navegador.
- `POST /api/moderation/strike`: incrementa atómicamente los avisos de esa IP.
  Al tercero responde `{ "strikes": 3, "blocked": true }` y rechaza después
  tanto conexiones como mensajes de esa IP.
- La excepción `owner` solo se concede después de OAuth de GitHub y de validar
  en el servidor que `login === "niki2510"`. Un apodo, parámetro del cliente o
  cabecera sin verificar nunca concede privilegios.
- Usar `429` o `403` para IP bloqueada, conservar auditoría, caducidad definida
  y un mecanismo de apelación. Si existe proxy/CDN, confiar en `X-Forwarded-For`
  únicamente desde proxies configurados.

Las salas privadas usan cifrado de extremo a extremo. El servidor no puede
leer su contenido; recibe solamente la señal de infracción generada por el
cliente. Un cliente modificado puede omitirla, así que no debe anunciarse como
moderación infalible sin un modelo de confianza adicional.
