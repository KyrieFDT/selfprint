@echo off
cd /d "%~dp0"

where node >nul 2>nul
if %errorlevel% neq 0 (
    echo Node.js not found
    pause
    exit /b 1
)

echo [Setup] Configuring firewall for port 3000...
netsh advfirewall firewall add rule name="SelfPrint (TCP 3000)" dir=in action=allow protocol=TCP localport=3000 >nul 2>&1
if %errorlevel% equ 0 (echo [Setup] Firewall rule OK) else (echo [Setup] Firewall config failed - run as Administrator)

start "SelfPrint-Server" cmd /k node "%~dp0print-server\src\index.js"
start "SelfPrint-Agent" cmd /k node "%~dp0print-agent\src\index.js"
