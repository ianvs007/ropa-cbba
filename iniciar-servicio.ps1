# Script PowerShell para iniciar el servidor de Tienda de Ropa (consola visible).
# Uso diario: iniciar-servicio-silencioso.bat (vite preview / npm run start).
Set-Location -LiteralPath $PSScriptRoot

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Host "ERROR: Node.js no esta instalado. Instala Node.js 22 LTS desde https://nodejs.org" -ForegroundColor Red
    Read-Host "Presiona Enter para salir"
    exit 1
}

if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
    Write-Host "ERROR: npm no esta instalado. Instala Node.js desde https://nodejs.org" -ForegroundColor Red
    Read-Host "Presiona Enter para salir"
    exit 1
}

if (-not (Test-Path -LiteralPath "node_modules\vite\package.json")) {
    Write-Host "Faltan modulos. Ejecutando npm ci..." -ForegroundColor Yellow
    npm.cmd ci
    if ($LASTEXITCODE -ne 0) {
        Write-Host "ERROR: Fallo npm ci." -ForegroundColor Red
        Read-Host "Presiona Enter para salir"
        exit 1
    }
}

if (-not (Test-Path -LiteralPath "dist\index.html")) {
    Write-Host "Generando dist\ ..." -ForegroundColor Yellow
    npm.cmd run build
    if ($LASTEXITCODE -ne 0) {
        Write-Host "ERROR: Fallo npm run build." -ForegroundColor Red
        Read-Host "Presiona Enter para salir"
        exit 1
    }
}

Write-Host "Iniciando Tienda de Ropa en http://localhost:3001 (vite preview) ..." -ForegroundColor Magenta
npm.cmd run start

Read-Host "Presiona Enter para cerrar"
