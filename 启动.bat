@echo off
title SelfPrint
cd /d "%~dp0"

where node >nul 2>nul
if %errorlevel% neq 0 (
    echo Node.js not found. Please install from https://nodejs.org
    pause
    exit /b 1
)

start "SelfPrint-Server" node "%~dp0print-server\src\index.js"
start "SelfPrint-Agent" node "%~dp0print-agent\src\index.js"
