const { exec } = require('child_process');
const path = require('path');
const fs = require('fs');
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

    if (process.platform === 'win32') {
      const printerName = config.printerName.replace(/"/g, '\\"');
      const vbsScript = createPrintVBS(absPath, printerName, copies);

      const tmpVbs = path.join(require('os').tmpdir(), `print_${Date.now()}.vbs`);
      fs.writeFileSync(tmpVbs, vbsScript, 'utf-8');

      exec(`cscript //Nologo "${tmpVbs}"`, { timeout: 60000 }, (err, stdout, stderr) => {
        try { fs.unlinkSync(tmpVbs); } catch (e) { /* ignore */ }

        if (err) {
          console.error('[Print] VBS执行失败:', err.message);
          exec(`powershell -Command "Start-Process -FilePath '${absPath}' -ArgumentList '/p','/d:'${config.printerName}'' -NoNewWindow -Wait"`,
            { timeout: 60000 }, (err2, stdout2, stderr2) => {
              if (err2) return reject(err2);
              resolve({ method: 'powershell', stdout: stdout2 });
            });
        } else {
          resolve({ method: 'vbs', stdout });
        }
      });
    } else if (process.platform === 'darwin') {
      const lpCmd = `lp -d "${config.printerName}" -n ${copies} "${absPath}"`;
      exec(lpCmd, { timeout: 60000 }, (err, stdout, stderr) => {
        if (err) return reject(err);
        resolve({ method: 'lp', stdout });
      });
    } else {
      const lprCmd = `lpr -P "${config.printerName}" -# ${copies} "${absPath}"`;
      exec(lprCmd, { timeout: 60000 }, (err, stdout, stderr) => {
        if (err) return reject(err);
        resolve({ method: 'lpr', stdout });
      });
    }
  });
}

function createPrintVBS(filePath, printerName, copies) {
  return `
Set objShell = CreateObject("Shell.Application")
Set objFolder = objShell.Namespace(0)
Set objFile = objFolder.ParseName("${filePath.replace(/\\/g, '\\\\')}")
For i = 1 To ${copies}
  objFile.InvokeVerbEx("print")
Next
WScript.Sleep 3000
`;
}

function getDefaultPrinter() {
  return new Promise((resolve) => {
    if (process.platform === 'win32') {
      exec('powershell -Command "Get-WmiObject -Query \\"SELECT * FROM Win32_Printer WHERE Default = TRUE\\" | Select-Object -ExpandProperty Name"',
        (err, stdout) => {
          if (err) return resolve(null);
          resolve(stdout.trim());
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
          try { resolve(JSON.parse(stdout)); } catch (e) { resolve([]); }
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
