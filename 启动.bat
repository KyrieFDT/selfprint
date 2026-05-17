@echo off
title 自助打印系统

:: ====================== 先检查环境 ======================
echo.
echo 正在检查环境...

where node >nul 2>nul
if %errorlevel% neq 0 (
    echo [错误] 没有找到 Node.js，请先安装！
    echo 下载地址：https://nodejs.org 选左边 LTS 版本
    pause
    exit /b 1
)

echo Node.js 已就绪

:: ====================== 进入脚本所在目录 ======================
cd /d "%~dp0"
if not exist "print-server\package.json" (
    echo [错误] 找不到 print-server 文件夹
    echo 请确保 启动.bat 放在正确的目录下
    pause
    exit /b 1
)

:: ====================== 启动 ======================
echo.
echo ========================================
echo   自助打印系统 v1.0
echo ========================================
echo.

echo [1/2] 启动打印服务...
start "打印服务" cmd /c "cd /d "%~dp0print-server" && node src\index.js"
echo 等待服务启动...
timeout /t 5 >nul

echo [2/2] 启动打印代理...
start "PC打印代理" cmd /c "cd /d "%~dp0print-agent" && node src\index.js"
timeout /t 2 >nul

echo.
echo ========================================
echo   系统已启动
echo ========================================
echo.
echo   正在打开店家工作台...
echo   如果没有弹出浏览器，请手动打开：
echo.
echo      http://localhost:3000/shop.html
echo.
echo   要停止服务：关闭弹出的两个命令行窗口
echo ========================================

start http://localhost:3000/shop.html

pause
