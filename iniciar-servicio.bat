@echo off
REM ============================================================
REM  TIENDA DE ROPA - Inicio con consola visible
REM  Util para ver logs del servidor o depurar errores.
REM  Para uso diario usa: iniciar-servicio-silencioso.bat
REM
REM  Sirve dist/ con vite preview (npm run start), no npm run dev.
REM ============================================================

setlocal
cd /d "%~dp0."
if errorlevel 1 (
    echo [ERROR] No se pudo entrar a la carpeta del sistema.
    pause
    exit /b 1
)

where node >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Node.js no esta instalado o no esta en el PATH.
    echo Instala Node.js 22 LTS desde https://nodejs.org
    pause
    exit /b 1
)

if not exist "node_modules\vite\package.json" (
    echo [INFO] Faltan modulos. Ejecutando npm ci...
    call npm.cmd ci
    if errorlevel 1 (
        echo [ERROR] Fallo npm ci.
        pause
        exit /b 1
    )
)

REM Mata cualquier proceso usando el puerto 3001 (Inicio Limpio)
for /f "tokens=5" %%a in ('netstat -aon ^| findstr /R /C:":3001 .*LISTENING"') do taskkill /f /pid %%a >nul 2>&1

if not exist "dist\index.html" (
    echo [INFO] Generando dist\ ...
    call npm.cmd run build
    if errorlevel 1 (
        echo [ERROR] Fallo npm run build.
        pause
        exit /b 1
    )
)

echo Abriendo http://localhost:3001 y sirviendo dist\ (vite preview^)...
start "" http://localhost:3001
call npm.cmd run start

echo.
echo El servidor se detuvo.
pause
exit /b %ERRORLEVEL%
