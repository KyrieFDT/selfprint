@echo off
title 自助打印系统
cd /d "%~dp0"

echo.
echo =========================================
echo   自助打印系统 v1.0
echo =========================================
echo.

:: ====================== 检查 ======================
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo [错误] 没有安装 Node.js
    echo 下载地址：https://nodejs.org 选左边 LTS
    pause
    exit /b 1
)

if not exist "print-server\node_modules" (
    echo [错误] 依赖没装，请先运行以下命令：
    echo.
    echo   cd print-server ^&^& npm install
    echo   cd ..\print-agent ^&^& npm install
    echo.
    pause
    exit /b 1
)

echo 环境检查通过

:: ====================== 启动服务 ======================
echo.
echo 启动打印服务...
start "打印服务" cmd /c "cd /d "%~dp0print-server" && node src\index.js"

echo 等待服务就绪（轮询检测）...
set tries=0
:waitloop
timeout /t 3 >nul
set /a tries+=1
powershell -Command "try { $r = Invoke-WebRequest -Uri 'http://localhost:3000/shop.html' -TimeoutSec 3 -UseBasicParsing; exit 0 } catch { exit 1 }" >nul 2>nul
if %errorlevel% equ 0 goto ready
if %tries% geq 15 (
    echo.
    echo [错误] 等了45秒服务还没就绪，请检查弹出窗口是否有红色报错
    echo 常见原因：端口3000被占用、缺少依赖、系统防火墙拦截
    pause
    exit /b 1
)
goto waitloop

:ready
echo 服务就绪 (耗时约 %tries%0 秒)

:: ====================== 启动代理 ======================
echo.
echo 启动打印代理...
start "PC打印代理" cmd /c "cd /d "%~dp0print-agent" && node src\index.js"

:: ====================== 打开浏览器 ======================
echo.
echo 正在打开店家工作台...
start http://localhost:3000/shop.html

echo.
echo =========================================
echo   启动完成
echo   店家工作台 : http://localhost:3000/shop.html
echo   顾客端入口 : http://localhost:3000
echo   停止服务   : 关闭弹出的两个命令行窗口
echo =========================================

pause
