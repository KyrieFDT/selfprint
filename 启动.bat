@echo off
title 自助打印系统
cd /d "%~dp0"

:: ====================== 检查环境 ======================
echo.
echo 正在检查环境...

where node >nul 2>nul
if %errorlevel% neq 0 (
    echo [错误] 没有安装 Node.js
    echo 请先下载安装：https://nodejs.org （选左边 LTS 版本）
    pause
    exit /b 1
)

if not exist "print-server\node_modules" (
    echo [提示] 正在安装依赖包，首次运行需要 1-2 分钟...
    cd print-server
    call npm install
    cd ..
    if %errorlevel% neq 0 (
        echo [错误] 依赖安装失败，请检查网络连接
        pause
        exit /b 1
    )
)

if not exist "print-agent\node_modules" (
    echo [提示] 正在安装打印代理依赖...
    cd print-agent
    call npm install
    cd ..
)

:: ====================== 启动 ======================
echo.
echo ========================================
echo   自助打印系统 v1.0
echo ========================================
echo.

echo [1/2] 启动打印服务...
start "打印服务" cmd /c "cd /d "%~dp0print-server" && node src\index.js"

echo 等待服务就绪...
set /a count=0
:waitloop
timeout /t 2 >nul
set /a count+=2

:: 用 curl 测试服务是否就绪
curl -s -o nul http://localhost:3000/shop.html 2>nul
if %errorlevel% equ 0 goto ready

if %count% geq 40 (
    echo.
    echo [错误] 服务启动超时，请检查弹出的命令行窗口是否有报错
    pause
    exit /b 1
)
echo 已等待 %count% 秒...
goto waitloop

:ready
echo 服务已就绪（耗时 %count% 秒）

echo [2/2] 启动打印代理...
start "PC打印代理" cmd /c "cd /d "%~dp0print-agent" && node src\index.js"

echo.
echo ========================================
echo   系统已启动
echo ========================================
echo.
echo   正在打开店家工作台...
start http://localhost:3000/shop.html
echo.
echo   店家工作台：http://localhost:3000/shop.html
echo   顾客端地址：http://localhost:3000
echo.
echo   关闭那两个命令行窗口即可停止服务
echo ========================================

pause
