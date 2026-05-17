@echo off
title 自助打印系统
cd /d "%~dp0"

echo.
echo =========================================
echo   自助打印系统 v1.0
echo =========================================
echo.

where node >nul 2>nul
if %errorlevel% neq 0 (
    echo [错误] 没有安装 Node.js，请先安装
    echo 下载地址：https://nodejs.org
    pause
    exit /b 1
)

echo 正在启动，稍后会自动打开浏览器...
start "自助打印-服务" node "%~dp0print-server\src\index.js"
start "自助打印-代理" node "%~dp0print-agent\src\index.js"
pause
