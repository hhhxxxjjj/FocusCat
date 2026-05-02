// Committen - 最小化指定窗口
//
// 实现:调用同目录下的 minimize.ps1,传 HWND 参数过去。
// 用 PowerShell + User32.ShowWindow,避免引入需要本地编译的原生模块。
//
// 性能:每次调用大约 150-300ms 延迟(spawn powershell + Add-Type)。
// 对"切走应用 → 几百毫秒后窗口被收掉"的视觉效果完全够用。

const { execFile } = require('child_process');
const path = require('path');

const SCRIPT_PATH = path.join(__dirname, 'minimize.ps1');

/**
 * 最小化指定 HWND 的窗口。
 * @param {number|string} hwnd  来自 active-win 的 win.id
 * @returns {Promise<boolean>}  true 成功(或窗口已经隐藏),false 失败
 */
function minimizeByHwnd(hwnd) {
  if (process.platform !== 'win32') return Promise.resolve(false);
  if (!hwnd || hwnd === 0 || hwnd === '0') return Promise.resolve(false);

  return new Promise((resolve) => {
    execFile(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy', 'Bypass',
        '-File', SCRIPT_PATH,
        '-Hwnd', String(hwnd),
      ],
      { windowsHide: true, timeout: 5000 },
      (err, stdout, stderr) => {
        if (err) {
          console.error(
            `[Committen] minimize hwnd=${hwnd} failed:`,
            err.message,
            stderr ? `| stderr: ${stderr.trim()}` : ''
          );
          resolve(false);
          return;
        }
        // 调试日志,确认确实跑了
        if (stdout && stdout.trim()) {
          console.log(`[Committen] minimize ok: ${stdout.trim()}`);
        }
        resolve(true);
      }
    );
  });
}

module.exports = { minimizeByHwnd };
