@echo off
:: 右键以管理员身份运行此文件
:: 效果：开机自动启动自助打印系统

set "STARTUP=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"
set "TARGET=%~dp0启动.bat"

:: 创建启动文件夹的快捷方式
powershell -Command "$ws=New-Object -ComObject WScript.Shell;$s=$ws.CreateShortcut('%STARTUP%\自助打印系统.lnk');$s.TargetPath='%TARGET%';$s.WorkingDirectory='%~dp0';$s.WindowStyle=7;$s.Save()"

echo 已设置开机自启
echo 下次开机时系统会自动启动
pause
