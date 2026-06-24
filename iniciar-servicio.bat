@echo off
REM ============================================================
REM  TIENDA DE ROPA - Inicio con consola visible
REM  Util para ver logs del servidor o depurar errores.
REM  Para uso diario usa: iniciar-servicio-silencioso.bat
REM ============================================================

cd /d %~dp0

REM Mata cualquier proceso usando el puerto 3001 (Inicio Limpio)
for /f "tokens=5" %%a in ('netstat -aon ^| find ":3001" ^| find "LISTENING"') do taskkill /f /pid %%a >nul 2>&1

REM Abre el navegador y luego inicia el servidor
start http://localhost:3001
npm run dev

REM Mantiene la ventana abierta si hay algun error
pause
