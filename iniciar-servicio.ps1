# Script PowerShell para iniciar el servidor de Tienda de Ropa
Set-Location (Split-Path -Parent $MyInvocation.MyCommand.Path)

# Verifica que npm este instalado
if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
    Write-Host "ERROR: npm no esta instalado. Instala Node.js desde https://nodejs.org" -ForegroundColor Red
    Read-Host "Presiona Enter para salir"
    exit
}

# Inicia el servidor en puerto 3001
Write-Host "Iniciando Tienda de Ropa en http://localhost:3001 ..." -ForegroundColor Magenta
npm run dev

Read-Host "Presiona Enter para cerrar"
