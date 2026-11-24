@echo off
title ACTUALIZADOR - TIENDA DE ROPA
color 0b
cls

echo ================================================================
echo      ACTUALIZADOR AUTOMATICO - SISTEMA TIENDA DE ROPA
echo ================================================================
echo.

setlocal enabledelayedexpansion
cd /d "%~dp0"

REM 1. Detener el servidor Node para liberar archivos y cerrar SQLite limpio
echo [1/5] Deteniendo el servicio en segundo plano...
taskkill /F /IM node.exe /T >nul 2>&1
timeout /t 2 /nobreak >nul 2>&1

REM 2. Respaldo preventivo automatico de SQLite antes de actualizar
if exist "datos-pos\pos.sqlite" (
    echo [2/5] Creando copia preventiva de datos-pos\pos.sqlite...
    if not exist "datos-pos\backups" mkdir "datos-pos\backups"
    for /f %%i in ('powershell -NoProfile -Command "Get-Date -Format yyyyMMdd-HHmmss"') do set "STAMP=%%i"
    copy /Y "datos-pos\pos.sqlite" "datos-pos\backups\backup-pre-update-!STAMP!.sqlite" >nul 2>&1
    echo [OK] Respaldo guardado en datos-pos\backups\backup-pre-update-!STAMP!.sqlite
) else (
    echo [2/5] Sin pos.sqlite previo, continuando...
)

REM 3. Guardar hash previo de package-lock.json y limpiar dist si quedo modificado
set "OLD_LOCK="
for /f "tokens=*" %%h in ('git rev-parse HEAD:package-lock.json 2^>nul') do set "OLD_LOCK=%%h"
git checkout -- dist >nul 2>&1

REM 4. Descargar cambios desde GitHub (solo fast-forward, nunca toca datos-pos/)
echo.
echo [3/5] Descargando ultima version desde GitHub (origin/main)...
git pull --ff-only origin main
if errorlevel 1 (
    color 0c
    echo.
    echo [ERROR] No se pudo actualizar desde GitHub.
    echo Verifica tu conexion a internet o ejecuta git status para revisar archivos locales.
    pause
    exit /b 1
)

REM 5. Ejecutar npm ci si cambio el lock O si faltan node_modules (clon fresco)
set "NEW_LOCK="
for /f "tokens=*" %%h in ('git rev-parse HEAD:package-lock.json 2^>nul') do set "NEW_LOCK=%%h"
set "NEED_CI=0"
if not "!OLD_LOCK!"=="!NEW_LOCK!" set "NEED_CI=1"
if not exist "node_modules\vite\package.json" set "NEED_CI=1"
if "!NEED_CI!"=="1" (
    echo.
    echo [4/5] Instalando dependencias con npm ci...
    call npm.cmd ci
    if errorlevel 1 (
        color 0c
        echo [ERROR] Fallo npm ci. Verifica tu conexion a internet.
        pause
        exit /b 1
    )
) else (
    echo [4/5] Dependencias sin cambios ^(no hace falta reinstalar node_modules^).
)

echo.
echo [5/5] Iniciando nuevamente el sistema...
call "%~dp0iniciar-servicio-silencioso.bat"

color 0a
echo.
echo ================================================================
echo         SISTEMA ACTUALIZADO E INICIADO CORRECTAMENTE
echo ================================================================
echo Tus datos en datos-pos\pos.sqlite y datos-pos\imagenes\ estan intactos.
echo Si tenias la ventana del POS abierta, presiona F5 para recargar.
echo.
timeout /t 5
exit /b 0
