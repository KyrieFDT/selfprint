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

    const copies = options.copies || 1;
    const printerName = config.printerName;

    console.log(`[Print] 打印: ${absPath} -> "${printerName}" x${copies}`);

    if (process.platform === 'win32') {
      printWindows(absPath, printerName, copies).then(resolve).catch(reject);
    } else if (process.platform === 'darwin') {
      const lpCmd = `lp -d "${printerName}" -n ${copies} "${absPath}"`;
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
    // 参数通过命令行传入 VBS，避免嵌入脚本导致中文编码问题
    const vbsPath = path.join(os.tmpdir(), 'selfprint_print.vbs');

    // 纯 ASCII VBS 脚本，不嵌入任何参数
    const lines = [
      'Set objWMIService = GetObject("winmgmts:")',
      'Set fso = CreateObject("Scripting.FileSystemObject")',
      '',
      'filePath = WScript.Arguments(0)',
      'printerName = WScript.Arguments(1)',
      'copies = CInt(WScript.Arguments(2))',
      '',
      "oldDefault = \"\"",
      'Set colPrinters = objWMIService.ExecQuery("SELECT * FROM Win32_Printer WHERE Default = TRUE")',
      'For Each p In colPrinters',
      '  oldDefault = p.Name',
      'Next',
      'WScript.Echo "OLD:" & oldDefault',
      'WScript.Echo "TARGET:" & printerName',
      '',
      'If oldDefault <> printerName Then',
      '  q = "SELECT * FROM Win32_Printer WHERE Name = """ & Replace(printerName, """", """""") & """"',
      '  Set colTargets = objWMIService.ExecQuery(q)',
      '  found = False',
      '  For Each p In colTargets',
      '    p.SetDefaultPrinter()',
      '    found = True',
      '  Next',
      '  If Not found Then',
      '    WScript.Echo "WARN: printer not found: " & printerName',
      '  End If',
      '  WScript.Sleep 500',
      'End If',
      '',
      'fileDir = fso.GetParentFolderName(filePath)',
      'fileName = fso.GetFileName(filePath)',
      'Set objShell = CreateObject("Shell.Application")',
      'Set objFolder = objShell.Namespace(fileDir)',
      'If objFolder Is Nothing Then',
      '  WScript.Echo "ERR: bad folder: " & fileDir',
      '  WScript.Quit 1',
      'End If',
      'Set objFile = objFolder.ParseName(fileName)',
      'If objFile Is Nothing Then',
      '  WScript.Echo "ERR: file not found: " & fileName',
      '  WScript.Quit 1',
      'End If',
      'WScript.Echo "Printing..."',
      'For i = 1 To copies',
      '  objFile.InvokeVerbEx("print")',
      '  WScript.Sleep 800',
      'Next',
      'WScript.Sleep 4000',
      'WScript.Echo "DONE"',
      '',
      'If oldDefault <> "" And oldDefault <> printerName Then',
      '  q2 = "SELECT * FROM Win32_Printer WHERE Name = """ & Replace(oldDefault, """", """""") & """"',
      '  Set colRestore = objWMIService.ExecQuery(q2)',
      '  For Each p In colRestore',
      '    p.SetDefaultPrinter()',
      '  Next',
      '  WScript.Echo "RESTORED:" & oldDefault',
      'End If'
    ];
    const vbsCode = lines.join('\r\n');

    fs.writeFileSync(vbsPath, vbsCode, 'ascii');

    const cmd = `cscript //Nologo "${vbsPath}" "${filePath}" "${printerName}" ${copies}`;
    console.log('[Print] cscript + VBS 打印');

    exec(cmd, { timeout: 120000 }, (err, stdout, stderr) => {
      if (stdout) console.log('[Print]', stdout.trim());
      if (stderr) console.log('[Print] err:', stderr.trim());
      if (err) {
        console.error('[Print] VBS 失败:', err.message);
        fallbackPrint(filePath, copies).then(resolve).catch(reject);
      } else {
        resolve({ method: 'vbs', stdout: stdout.trim() });
      }
    });
  });
}

function fallbackPrint(filePath, copies) {
  return new Promise((resolve, reject) => {
    console.log('[Print] 降级: Start-Process -Verb Print');
    let done = 0;
    const runOne = () => {
      if (done >= copies) return resolve({ method: 'fallback' });
      done++;
      exec(`powershell -Command "Start-Process -FilePath '${filePath.replace(/'/g, "''")}' -Verb Print"`,
        { timeout: 60000 }, (err) => {
          if (err) return reject(err);
          setTimeout(runOne, 2000);
        });
    };
    runOne();
  });
}

function getDefaultPrinter() {
  return new Promise((resolve) => {
    if (process.platform === 'win32') {
      exec('powershell -Command "(Get-CimInstance -Class Win32_Printer -Filter \\"Default = TRUE\\" | Select-Object -First 1).Name"',
        (err, stdout) => {
          if (err) {
            exec('powershell -Command "(Get-WmiObject -Class Win32_Printer -Filter \\"Default = TRUE\\" | Select-Object -First 1).Name"',
              (err2, stdout2) => {
                if (err2) return resolve(null);
                resolve(stdout2.trim() || null);
              });
            return;
          }
          resolve(stdout.trim() || null);
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
      exec('powershell -Command "$OutputEncoding = [Console]::OutputEncoding = [Text.Encoding]::UTF8; Get-Printer | Select-Object Name, PrinterStatus | ConvertTo-Json"',
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
