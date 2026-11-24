@echo off
REM ============================================================
REM  TIENDA DE ROPA - Inicio Silencioso
REM  Double-click: levanta el servidor en segundo plano y abre
REM  Chrome/Edge en Modo App (sin barra de direcciones).
REM
REM  Sirve dist/ con "vite preview" (npm run start), NO npm run dev.
REM  Misma bat para central y sucursal. Datos en datos-pos\ (intactos).
REM  Para limitar a esta PC: set POS_HOST=127.0.0.1 antes de lanzar.
REM ============================================================

setlocal enabledelayedexpansion

REM %~dp0 termina en \ ; el "." evita el bug de comillas con barra final
cd /d "%~dp0."
if errorlevel 1 (
    echo [ERROR] No se pudo entrar a la carpeta del sistema.
    pause
    exit /b 1
)
set "PROJECT_DIR=%cd%"
set "LOG_DIR=%PROJECT_DIR%\datos-pos"
set "LOG_FILE=%LOG_DIR%\servidor.log"
if not exist "%LOG_DIR%" mkdir "%LOG_DIR%"

REM --- Node.js ---
where node >nul 2>&1
if errorlevel 1 (
    call :aviso "Node.js no esta instalado o no esta en el PATH. Instala Node.js 22 LTS desde https://nodejs.org y vuelve a intentar."
    exit /b 1
)

REM --- Dependencias ---
if not exist "%PROJECT_DIR%\node_modules\vite\package.json" (
    echo [INFO] Faltan modulos. Ejecutando npm ci ^(puede tardar^)...
    call npm.cmd ci
    if errorlevel 1 (
        call :aviso "Fallo npm ci. Revisa la conexion a internet o ejecuta INSTALAR_SISTEMA.bat. Ver tambien: %LOG_FILE%"
        exit /b 1
    )
)

REM --- Build estatico ---
if not exist "%PROJECT_DIR%\dist\index.html" (
    echo [INFO] Generando dist\ con npm run build...
    call npm.cmd run build
    if errorlevel 1 (
        call :aviso "Fallo npm run build. Abre iniciar-servicio.bat para ver el error."
        exit /b 1
    )
)

REM Mata lo que escuche en 3001 (inicio limpio). tokens=5 = PID en netstat -aon.
for /f "tokens=5" %%a in ('netstat -aon ^| findstr /R /C:":3001 .*LISTENING"') do (
    taskkill /f /pid %%a >nul 2>&1
)

REM --- Servidor oculto, con log ---
echo ===== Inicio %DATE% %TIME% =====>> "%LOG_FILE%"
set "VBS_FILE=%TEMP%\run_tienda_ropa.vbs"
(
    echo Set objShell = CreateObject("WScript.Shell"^)
    echo objShell.CurrentDirectory = "%PROJECT_DIR%"
    echo strCommand = "cmd.exe /c npm.cmd run start ^>^> ""datos-pos\servidor.log"" 2^>^&1"
    echo objShell.Run strCommand, 0, False
) > "%VBS_FILE%"
cscript.exe //nologo "%VBS_FILE%" >nul 2>&1
del "%VBS_FILE%" >nul 2>&1

REM Espera a que el puerto responda (hasta ~30 s)
set "LISTO=0"
for /l %%i in (1,1,30) do (
    powershell -NoProfile -Command "try { $r = Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:3001/' -TimeoutSec 1; if ($r.StatusCode -ge 200) { exit 0 } else { exit 1 } } catch { exit 1 }" >nul 2>&1
    if not errorlevel 1 (
        set "LISTO=1"
        goto :abrir_navegador
    )
    timeout /t 1 /nobreak >nul 2>&1
)

if "!LISTO!"=="0" (
    call :aviso "El servidor no arranco en http://localhost:3001. Revisa datos-pos\servidor.log o usa iniciar-servicio.bat para ver el error. No uses npm run dev en la tienda."
    exit /b 1
)

:abrir_navegador
set "DATA_DIR=%USERPROFILE%\.tienda_ropa_data"
if not exist "%DATA_DIR%" mkdir "%DATA_DIR%"
set "APP_URL=http://localhost:3001"

set "CHROME="
if exist "%ProgramFiles%\Google\Chrome\Application\chrome.exe" set "CHROME=%ProgramFiles%\Google\Chrome\Application\chrome.exe"
if not defined CHROME if exist "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe" set "CHROME=%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"
if not defined CHROME if exist "%LocalAppData%\Google\Chrome\Application\chrome.exe" set "CHROME=%LocalAppData%\Google\Chrome\Application\chrome.exe"

if defined CHROME (
    start "" "%CHROME%" --app="%APP_URL%" --user-data-dir="%DATA_DIR%" --no-first-run --no-default-browser-check
    exit /b 0
)

set "EDGE="
if exist "%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe" set "EDGE=%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"
if not defined EDGE if exist "%ProgramFiles%\Microsoft\Edge\Application\msedge.exe" set "EDGE=%ProgramFiles%\Microsoft\Edge\Application\msedge.exe"

if defined EDGE (
    start "" "%EDGE%" --app="%APP_URL%" --user-data-dir="%DATA_DIR%" --no-first-run --no-default-browser-check
    exit /b 0
)

REM Ultimo recurso: navegador por defecto (sin perfil dedicado)
start "" "%APP_URL%"
exit /b 0

:aviso
echo %~1> "%TEMP%\pos-aviso.txt"
powershell -NoProfile -Command "Add-Type -AssemblyName System.Windows.Forms; [void][System.Windows.Forms.MessageBox]::Show((Get-Content -Raw (Join-Path $env:TEMP 'pos-aviso.txt')), 'Tienda de Ropa')" >nul 2>&1
if errorlevel 1 (
    echo.
    echo [ERROR] %~1
    pause
)
del "%TEMP%\pos-aviso.txt" >nul 2>&1
exit /b 0
