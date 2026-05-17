const { exec } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const config = require('./config');

function printFile(filePath, options = {}) {
  return new Promise((resolve, reject) => {
    const absPath = path.resolve(filePath);
    if (!fs.existsSync(absPath)) {
      return reject(new Error(`文件不存在: ${absPath}`));
    }

    const {
      copies = 1,
      colorMode = 'bw',
      duplex = 'single',
      paperSize = 'A4',
      layout = '1in1',
    } = options;

    const printerName = config.printerName;

    if (process.platform === 'win32') {
      printWindows(absPath, printerName, copies).then(resolve).catch(reject);
    } else if (process.platform === 'darwin') {
      const lpCmd = `lp -d "${printerName}" -n ${copies} -o sides=${duplex === 'duplex' ? 'two-sided-long-edge' : 'one-sided'} "${absPath}"`;
      exec(lpCmd, { timeout: 120000 }, (err, stdout, stderr) => {
        if (err) return reject(err);
        resolve({ method: 'lp', stdout });
      });
    } else {
      const lprCmd = `lpr -P "${printerName}" -# ${copies} "${absPath}"`;
      exec(lprCmd, { timeout: 120000 }, (err, stdout, stderr) => {
        if (err) return reject(err);
        resolve({ method: 'lpr', stdout });
      });
    }
  });
}

function printWindows(filePath, printerName, copies) {
  return new Promise((resolve, reject) => {
    // 方案1: 用 PowerShell 设置目标打印机为默认 → 调用 Shell print → 恢复默认
    const psScript = `
$ErrorActionPreference = 'Stop'
$file = '${filePath.replace(/'/g, "''")}'
$target = '${printerName.replace(/'/g, "''")}'
$copies = ${copies}

try {
  $oldDefault = (Get-WmiObject -Class Win32_Printer -Filter "Default = TRUE" | Select-Object -First 1).Name

  $printer = Get-WmiObject -Class Win32_Printer -Filter "Name = '$target'" | Select-Object -First 1
  if (-not $printer) {
    Write-Error "找不到打印机: $target"
    exit 1
  }

  if ($oldDefault -ne $target) {
    $printer.SetDefaultPrinter() | Out-Null
    Start-Sleep -Milliseconds 500
  }

  $shell = New-Object -ComObject Shell.Application
  $folder = $shell.Namespace((Get-Item $file).DirectoryName)
  $shellFile = $folder.ParseName((Get-Item $file).Name)
  For ($i = 1; $i -le $copies; $i++) {
    $shellFile.InvokeVerbEx('print')
    Start-Sleep -Milliseconds 500
  }
  Start-Sleep -Seconds 5

  if ($oldDefault -ne $target -and $oldDefault) {
    $oldPrinter = Get-WmiObject -Class Win32_Printer -Filter "Name = '$oldDefault'" | Select-Object -First 1
    if ($oldPrinter) { $oldPrinter.SetDefaultPrinter() | Out-Null }
  }

  Write-Output 'OK'
} catch {
  Write-Error $_.Exception.Message
  exit 1
}
`;

    const psFile = path.join(os.tmpdir(), `print_${Date.now()}.ps1`);
    fs.writeFileSync(psFile, psScript, 'utf-8');

    exec(`powershell -ExecutionPolicy Bypass -File "${psFile}"`, { timeout: 120000 }, (err, stdout, stderr) => {
      try { fs.unlinkSync(psFile); } catch (e) { /* ignore */ }

      if (err) {
        // 降级: 直接用 Shell print (打向系统默认打印机)
        console.error('[Print] PowerShell方案失败:', err.message);
        fallbackPrint(filePath, copies).then(resolve).catch(reject);
      } else {
        resolve({ method: 'powershell', stdout });
      }
    });
  });
}

function fallbackPrint(filePath, copies) {
  return new Promise((resolve, reject) => {
    const vbs = `
Set objShell = CreateObject("Shell.Application")
Set objFolder = objShell.Namespace(0)
Set objFile = objFolder.ParseName("${filePath.replace(/\\/g, '\\\\')}")
For i = 1 To ${copies}
  objFile.InvokeVerbEx("print")
Next
WScript.Sleep 5000
`;
    const tmpVbs = path.join(os.tmpdir(), `print_${Date.now()}.vbs`);
    fs.writeFileSync(tmpVbs, vbs, 'utf-8');

    exec(`cscript //Nologo "${tmpVbs}"`, { timeout: 120000 }, (err, stdout, stderr) => {
      try { fs.unlinkSync(tmpVbs); } catch (e) { /* ignore */ }
      if (err) return reject(err);
      resolve({ method: 'vbs', stdout });
    });
  });
}

function getDefaultPrinter() {
  return new Promise((resolve) => {
    if (process.platform === 'win32') {
      exec('powershell -Command "(Get-WmiObject -Class Win32_Printer -Filter \\"Default = TRUE\\" | Select-Object -First 1).Name"',
        (err, stdout) => {
          if (err) return resolve(null);
          const name = stdout.trim();
          resolve(name || null);
        });
    } else {
      exec('lpstat -d', (err, stdout) => {
        if (err) return resolve(null);
        const match = stdout.match(/: (.+)$/);
        resolve(match ? match[1].trim() : null);
      });
    }
  });
}

function listPrinters() {
  return new Promise((resolve) => {
    if (process.platform === 'win32') {
      exec('powershell -Command "Get-Printer | Select-Object Name, PrinterStatus | ConvertTo-Json"',
        (err, stdout) => {
          if (err) return resolve([]);
          try {
            const parsed = JSON.parse(stdout);
            resolve(Array.isArray(parsed) ? parsed : [parsed].filter(Boolean));
          } catch (e) { resolve([]); }
        });
    } else {
      exec('lpstat -p', (err, stdout) => {
        if (err) return resolve([]);
        resolve(stdout.split('\n').filter(l => l.startsWith('printer')));
      });
    }
  });
}

module.exports = { printFile, getDefaultPrinter, listPrinters };
