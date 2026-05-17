const { exec } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const config = require('./config');

// Python 打印助手的路径
const PY_HELPER = path.join(__dirname, '..', 'print_helper.py');
let pyAvailable = null; // null=未检测, true=可用, false=不可用

function printFile(filePath, options = {}) {
  return new Promise((resolve, reject) => {
    const absPath = path.resolve(filePath);
    if (!fs.existsSync(absPath)) {
      return reject(new Error(`文件不存在: ${absPath}`));
    }

    const copies = options.copies || 1;
    const colorMode = options.colorMode || 'bw';
    const duplex = options.duplex || 'single';
    const printerName = config.printerName;

    console.log(`[Print] 打印: ${absPath} -> "${printerName}" ${colorMode} ${duplex} x${copies}`);

    if (process.platform === 'win32') {
      printWithPython(absPath, printerName, colorMode, duplex, copies)
        .then(resolve)
        .catch((pyErr) => {
          console.log('[Print] Python方案不可用, 降级VBS:', pyErr.message);
          printWithVBS(absPath, printerName, copies)
            .then(resolve)
            .catch((vbsErr) => {
              console.log('[Print] VBS也失败, 最终降级:', vbsErr.message);
              fallbackShellPrint(absPath, copies).then(resolve).catch(reject);
            });
        });
    } else if (process.platform === 'darwin') {
      const lpCmd = `lp -d "${printerName}" -n ${copies} -o sides=${duplex === 'double' ? 'two-sided-long-edge' : 'one-sided'} "${absPath}"`;
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

function printWithPython(filePath, printerName, colorMode, duplex, copies) {
  return new Promise((resolve, reject) => {
    if (pyAvailable === false) {
      return reject(new Error('Python不可用(已检测)'));
    }

    // 构建参数: 使用双引号包裹路径，单引号包裹打印机名
    const args = [
      `"${PY_HELPER}"`,
      `"${filePath}"`,
      `--printer`, `"${printerName}"`,
      `--color`, colorMode,
      `--duplex`, duplex === 'double' ? 'double' : 'single',
      `--copies`, copies,
    ].join(' ');

    const cmd = `python ${args}`;
    console.log('[Print] Python:', cmd.substring(0, 120) + '...');

    exec(cmd, { timeout: 120000 }, (err, stdout, stderr) => {
      if (stderr) console.log('[Print] py stderr:', stderr.trim());

      if (err) {
        // 检测是否是 pywin32 未安装
        if (stderr && stderr.includes('ModuleNotFoundError') || (stdout && stdout.includes('请先安装 pywin32'))) {
          pyAvailable = false;
        }
        return reject(new Error(stderr?.trim() || err.message));
      }

      try {
        const result = JSON.parse(stdout.trim());
        if (result.success) {
          pyAvailable = true;
          resolve({ method: 'python-win32print', ...result });
        } else {
          reject(new Error(result.error || '打印失败'));
        }
      } catch (e) {
        // JSON解析失败，可能是Python崩溃
        pyAvailable = false;
        reject(new Error(`Python输出异常: ${stdout?.trim()}`));
      }
    });
  });
}

function printWithVBS(filePath, printerName, copies) {
  return new Promise((resolve, reject) => {
    const vbsPath = path.join(os.tmpdir(), 'selfprint_print.vbs');

    const lines = [
      'Set objWMIService = GetObject("winmgmts:")',
      'Set fso = CreateObject("Scripting.FileSystemObject")',
      '',
      'filePath = WScript.Arguments(0)',
      'printerName = WScript.Arguments(1)',
      'copies = CInt(WScript.Arguments(2))',
      '',
      'oldDefault = ""',
      'Set colPrinters = objWMIService.ExecQuery("SELECT * FROM Win32_Printer WHERE Default = TRUE")',
      'For Each p In colPrinters',
      '  oldDefault = p.Name',
      'Next',
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
      'End If'
    ];
    fs.writeFileSync(vbsPath, lines.join('\r\n'), 'ascii');

    const cmd = `cscript //Nologo "${vbsPath}" "${filePath}" "${printerName}" ${copies}`;
    console.log('[Print] VBS: cscript print.vbs');

    exec(cmd, { timeout: 120000 }, (err, stdout, stderr) => {
      if (stdout) console.log('[Print]', stdout.trim());
      if (err) return reject(new Error(stderr?.trim() || err.message));
      resolve({ method: 'vbs', stdout: stdout.trim() });
    });
  });
}

function fallbackShellPrint(filePath, copies) {
  return new Promise((resolve, reject) => {
    console.log('[Print] 最终降级: Start-Process -Verb Print');
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
