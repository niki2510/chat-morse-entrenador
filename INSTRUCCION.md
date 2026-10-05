# Instruccion Unica De Ahorro De Tokens

Antes de hacer cualquier cosa en este repositorio (leer, planificar, editar,
responder), consulta y cumple TODO lo relacionado con ahorro de tokens que
hay en la carpeta `ahorro-tokens/` de la raiz de este proyecto:

- `ahorro-tokens/REGLAS-AHORRO-TOKENS.md` — reglas de comportamiento,
  obligatorio, empieza por aqui.
- `ahorro-tokens/INTEGRACION-HEADROOM-OPCIONAL.md` — si existe la subcarpeta
  `ahorro-tokens/headroom/`, revisa esta guia para saber cuando conviene
  usar o sugerir al usuario la compresion mecanica real que incluye
  (opcional, complementaria a las reglas de comportamiento, no obligatoria).

Esto aplica a cualquier asistente de IA: Claude Code, Codex/CLI, GitHub
Copilot, Cursor, Continue, Windsurf, Gemini, Cline u otro.

El objetivo es ahorrar tokens de verdad (lectura, salida y contexto
repetido) sin bajar la calidad tecnica ni la seguridad. Si `ahorro-tokens/`
no existe en este proyecto, ignora esta instruccion.

## Como usar este fichero

Este es el UNICO fichero que necesitas copiar y pegar junto con la carpeta
`ahorro-tokens/` (copia ambos al mismo nivel, por ejemplo la raiz del
proyecto). No hace falta copiar ni repartir el resto de ficheros de
`ahorro-tokens/` por el proyecto: con que la IA lea este puntero y la carpeta
completa, es suficiente.

Para que tu herramienta lo cargue automaticamente sin configuracion extra,
copia o renombra este mismo fichero (el contenido no cambia) con el nombre
que tu herramienta busque en la raiz del proyecto, por ejemplo: `CLAUDE.md`,
`AGENTS.md`, `GEMINI.md`, `.github/copilot-instructions.md`,
`.cursor/rules/00-instruccion.mdc`, `.continue/rules/00-instruccion.md` o
`.windsurf/rules/00-instruccion.md`. Si tu herramienta no lee ficheros del
repo, pega este mismo texto como "custom instructions" o como primer mensaje
de la sesion.
