# Script PowerShell para iniciar el servidor de Tienda de Ropa
Set-Location (Split-Path -Parent $MyInvocation.MyCommand.Path)

# Verifica que npm este instalado
if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
    Write-Host "ERROR: npm no esta instalado. Instala Node.js desde https://nodejs.org" -ForegroundColor Red
    Read-Host "Presiona Enter para salir"
    exit
}

# Si no existe el build (dist/), generarlo antes de servir
if (-not (Test-Path "dist\index.html")) {
    npm run build
}

# Sirve el build estatico en puerto 3001 (vite preview, no modo desarrollo)
Write-Host "Iniciando Tienda de Ropa en http://localhost:3001 ..." -ForegroundColor Magenta
npm run start

Read-Host "Presiona Enter para cerrar"
