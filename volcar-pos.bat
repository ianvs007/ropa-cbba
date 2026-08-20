@echo off
REM ============================================================
REM  VOLCAR PRODUCTOS DEL POS — Abre la página de solo lectura
REM  que exporta los productos (pos-productos.json) para
REM  compararlos con la tienda virtual.
REM
REM  Requisito: el POS debe estar corriendo (iniciar-servicio-
REM  silencioso.bat). Esta página se abre en el MISMO perfil de
REM  Chrome que usa el POS, para poder leer su IndexedDB.
REM ============================================================

set "DATA_DIR=%USERPROFILE%\.tienda_ropa_data"

echo Abriendo la página de volcado (solo lectura)...
start "" "chrome.exe" --app="http://localhost:3001/volcar-pos.html" --user-data-dir="%DATA_DIR%" --no-first-run >nul 2>&1
if errorlevel 1 (
    start "" "msedge.exe" --app="http://localhost:3001/volcar-pos.html" --user-data-dir="%DATA_DIR%" --no-first-run >nul 2>&1
)

echo.
echo Cuando se abra la página, pulsá "Volcar productos" y luego
echo "Descargar pos-productos.json".
echo.
echo Después ejecutá:
echo   node comparar-pos-nube.cjs pos-productos.json --salida=reporte.txt
echo.
pause
