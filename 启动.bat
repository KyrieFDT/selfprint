@echo off
title 自助打印系统

set "ROOT=%~dp0"
set "ROOT=%ROOT:~0,-1%"

echo.
echo =========================================
echo   自助打印系统 v1.0
echo =========================================
echo.

:: ====================== 检查环境 ======================
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo [错误] 没有安装 Node.js
    echo 下载地址：https://nodejs.org 选左边 LTS
    pause
    exit /b 1
)

if not exist "%ROOT%\print-server\node_modules" (
    echo [错误] 依赖未安装，请先运行：
    echo   cd "%ROOT%\print-server" ^&^& npm install
    echo   cd "%ROOT%\print-agent" ^&^& npm install
    pause
    exit /b 1
)

echo 环境检查通过

:: ====================== 启动打印服务 ======================
echo.
echo 启动打印服务...
start "打印服务" /D "%ROOT%\print-server" node src\index.js

echo 等待服务就绪...
set tries=0
:waitloop
timeout /t 3 >nul
set /a tries+=1
powershell -Command "try{$r=Invoke-WebRequest -Uri 'http://localhost:3000/shop.html' -TimeoutSec 3 -UseBasicParsing;exit 0}catch{exit 1}" >nul 2>nul
if %errorlevel% equ 0 goto ready
if %tries% geq 15 (
    echo.
    echo [错误] 等待45秒服务未就绪
    echo 请检查是否有红色报错窗口弹出
    pause
    exit /b 1
)
goto waitloop

:ready
echo 服务就绪

:: ====================== 启动打印代理 ======================
echo.
echo 启动打印代理...
start "PC打印代理" /D "%ROOT%\print-agent" node src\index.js

:: ====================== 打开浏览器 ======================
echo.
echo 正在打开店家工作台...
start http://localhost:3000/shop.html

echo.
echo =========================================
echo   启动完成
echo   店家工作台 : http://localhost:3000/shop.html
echo   顾客端入口 : http://localhost:3000
echo   关闭两个命令行窗口停止服务
echo =========================================

pause
