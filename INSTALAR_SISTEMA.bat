@echo off
title INSTALADOR - TIENDA DE ROPA
color 0d
cls

echo ================================================================
echo       INSTALADOR AUTOMATICO - SISTEMA TIENDA DE ROPA
echo ================================================================
echo.
echo Ubicacion del sistema: %~dp0
echo.

cd /d "%~dp0"

REM 1. Verificacion de Node.js
where node >nul 2>&1
if errorlevel 1 (
    color 0c
    echo [ERROR] Node.js NO esta instalado.
    echo.
    echo Por favor instala Node.js desde: https://nodejs.org
    echo (Descarga la version LTS recomendada)
    echo.
    pause
    exit /b
)
echo [OK] Node.js detectado correctamente.

REM 2. Instalacion de dependencias
if not exist "node_modules" (
    echo.
    echo [INFO] Primera instalacion... descargando modulos del sistema.
    echo        Esto puede tardar unos minutos segun tu internet.
    echo.
    call npm install
    if errorlevel 1 (
        color 0c
        echo.
        echo [ERROR] No se pudieron instalar las dependencias.
        echo Verifica tu conexion a internet e intenta nuevamente.
        pause
        exit /b
    )
    echo.
    echo [OK] Modulos instalados correctamente.
) else (
    echo [OK] Modulos ya instalados, no se necesita reinstalar.
)

REM 3. Creacion del acceso directo en el Escritorio
echo.
echo [INFO] Creando acceso directo en el Escritorio...
powershell -ExecutionPolicy Bypass -File "%~dp0crear-acceso-directo.ps1"

if errorlevel 1 (
    color 0e
    echo [ADVERTENCIA] No se pudo crear el acceso directo automaticamente.
    echo Puedes crear el acceso directo manualmente apuntando a:
    echo %~dp0iniciar-servicio-silencioso.bat
) else (
    color 0a
    echo [OK] Acceso directo creado en el Escritorio exitosamente.
)

echo.
echo ================================================================
echo           INSTALACION COMPLETADA EXITOSAMENTE
echo ================================================================
echo.
echo Busca el icono "Tienda de Ropa" en tu Escritorio para abrir
echo el sistema. El primer inicio puede tardar unos segundos.
echo.
echo Puerto del sistema: 3001
echo URL: http://localhost:3001
echo.
pause
