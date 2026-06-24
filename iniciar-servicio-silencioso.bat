@echo off
REM ============================================================
REM  TIENDA DE ROPA - Inicio Silencioso
REM  Lanza el servidor en segundo plano (sin ventana) y abre
REM  el navegador en Modo App (sin barra de direcciones).
REM ============================================================

setlocal enabledelayedexpansion

REM Obtiene la ruta raiz del proyecto
set "PROJECT_DIR=%~dp0"
cd /d "!PROJECT_DIR!"

REM Mata cualquier proceso que este usando el puerto 3001 (Inicio Limpio)
for /f "tokens=5" %%a in ('netstat -aon ^| find ":3001" ^| find "LISTENING"') do taskkill /f /pid %%a >nul 2>&1

REM ============================================================
REM  Crea un script VBS para ejecutar npm SIN ventana visible
REM ============================================================
set "VBS_FILE=%TEMP%\run_tienda_ropa.vbs"

(
    echo Set objShell = CreateObject("WScript.Shell"^)
    echo strCommand = "cmd.exe /c cd /d ""!PROJECT_DIR!"" && npm run dev"
    echo objShell.Run strCommand, 0, False
) > "!VBS_FILE!"

REM Ejecuta el VBS en silencio
cscript.exe "!VBS_FILE!" >nul 2>&1

REM Limpia el archivo temporal
del "!VBS_FILE!" >nul 2>&1

REM Espera 5 segundos para que el servidor levante
timeout /t 5 /nobreak >nul 2>&1

REM ============================================================
REM  MODO APP - PROTECCION DE DATOS
REM  Se usa un perfil dedicado para que los datos de la BD
REM  (IndexedDB) NO sean borrados por limpiadores del sistema
REM  ni por "Borrar Historial" del navegador normal.
REM ============================================================
set "DATA_DIR=%USERPROFILE%\.tienda_ropa_data"
if not exist "%DATA_DIR%" mkdir "%DATA_DIR%"

REM --- Intenta abrir con Google Chrome en Modo App
start "" "chrome.exe" --app="http://localhost:3001" --user-data-dir="%DATA_DIR%" --no-first-run --no-default-browser-check >nul 2>&1

REM --- Si Chrome falla, intenta con Microsoft Edge
if errorlevel 1 (
    start "" "msedge.exe" --app="http://localhost:3001" --user-data-dir="%DATA_DIR%" --no-first-run --no-default-browser-check >nul 2>&1
)

exit /b
