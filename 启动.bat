@echo off
title 自助打印系统
cd /d "%~dp0"

echo 正在启动，请稍候...

pushd print-server
start "自助打印-服务" node "%~dp0print-server\src\index.js"
popd

:wait
timeout /t 2 >nul
powershell -Command "try{$r=Invoke-WebRequest -Uri 'http://localhost:3000' -TimeoutSec 2 -UseBasicParsing;exit 0}catch{exit 1}" >nul 2>nul
if %errorlevel% neq 0 goto wait

start "自助打印-代理" node "%~dp0print-agent\src\index.js"
start http://localhost:3000/shop.html

echo 系统已启动
