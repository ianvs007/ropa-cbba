# Script PowerShell para crear acceso directo de la Tienda de Ropa en el Escritorio
# Ejecutar desde: powershell -ExecutionPolicy Bypass -File crear-acceso-directo.ps1

$TargetFile = "$PSScriptRoot\iniciar-servicio-silencioso.bat"
$DesktopPath = [System.Environment]::GetFolderPath('Desktop')
$ShortcutFile = "$DesktopPath\Tienda de Ropa.lnk"

# Icono personalizado si existe (puedes poner un .ico en la carpeta)
$IconFile = "$PSScriptRoot\src\assets\logo.ico"

$WScriptShell = New-Object -ComObject WScript.Shell
$Shortcut = $WScriptShell.CreateShortcut($ShortcutFile)
$Shortcut.TargetPath = $TargetFile
$Shortcut.WorkingDirectory = $PSScriptRoot
$Shortcut.Description = "Abrir Sistema de Tienda de Ropa"
$Shortcut.WindowStyle = 7   # 7 = Minimizado (sin ventana visible)

# Usar icono si existe
if (Test-Path $IconFile) {
    $Shortcut.IconLocation = $IconFile
}

$Shortcut.Save()

Write-Host "Acceso directo creado en el Escritorio: $ShortcutFile" -ForegroundColor Green
