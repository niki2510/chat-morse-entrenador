@echo off
chcp 65001 >nul
title Chat Morse - servidor de red local
cd /d "%~dp0"

where python >nul 2>nul
if errorlevel 1 (
  echo Python no esta instalado o no esta en el PATH.
  echo Descargalo de https://www.python.org/downloads/ y marca "Add python.exe to PATH".
  pause
  exit /b 1
)

python -c "import flask" >nul 2>nul
if errorlevel 1 (
  echo Instalando Flask...
  python -m pip install -r requirements.txt
  if errorlevel 1 (
    echo No se pudo instalar Flask.
    pause
    exit /b 1
  )
)

echo.
echo La aplicacion comprobara el firewall para el puerto elegido.
echo Si aparece Control de cuentas de usuario, acepta la solicitud:
echo la regla solo permite conexiones desde la misma red local.
echo Cierra esta ventana para detener el servidor.
echo.
python server.py --open %*
pause
