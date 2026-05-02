// FocusCat - 活动窗口监听
// Day 6:周期检查活动窗口,不在白名单 → 调用 onIntruder 回调
// Day 7:在 onIntruder 里加上"真的最小化"

const activeWin = require('active-win');

class WindowMonitor {
  /**
   * @param {Object} opts
   * @param {string[]} opts.whitelist  允许的进程名(大小写不敏感)
   * @param {number}   opts.intervalMs 轮询间隔
   * @param {number}   opts.cooldownMs 同一 PID 多久不重复触发
   * @param {Function} opts.onIntruder({processName, pid, title, window}) 回调
   * @param {Function} [opts.onError]  错误回调
   */
  constructor({ whitelist = [], intervalMs = 1000, cooldownMs = 5000, onIntruder, onError }) {
    this.setWhitelist(whitelist);
    this.intervalMs = intervalMs;
    this.cooldownMs = cooldownMs;
    this.onIntruder = onIntruder;
    this.onError = onError || ((e) => console.error('[WindowMonitor]', e.message));

    this.cooldownByPid = new Map();
    this.timer = null;
    this.running = false;
    this.lastIntruderPid = null; // 用来判断"切走又切回来"
  }

  setWhitelist(list) {
    this.whitelist = new Set((list || []).map((s) => String(s).toLowerCase()));
  }

  // 尝试用 owner.name 和 path 的文件名两种形式匹配。
  // active-win 在 Windows 上对部分应用(Claude / Windows Explorer / Task Manager 等)
  // 返回的是显示名而不是 .exe 文件名,所以单看 name 容易漏。
  isWhitelisted(processName, processPath) {
    const candidates = new Set();
    if (processName) candidates.add(String(processName).toLowerCase());
    if (processPath) {
      const basename = String(processPath).split(/[\\/]/).pop();
      if (basename) candidates.add(basename.toLowerCase());
    }
    if (candidates.size === 0) return true; // 拿不到任何信息时放行,避免误伤
    for (const c of candidates) {
      if (this.whitelist.has(c)) return true;
    }
    return false;
  }

  // 自己/Electron 进程不算"入侵",防止猫盯着自己看
  isSelf(processName) {
    if (!processName) return false;
    const n = processName.toLowerCase();
    return n === 'focuscat.exe' || n === 'electron.exe' || n === 'electron';
  }

  cleanupCooldown() {
    const now = Date.now();
    for (const [pid, until] of this.cooldownByPid) {
      if (until < now) this.cooldownByPid.delete(pid);
    }
  }

  async tick() {
    try {
      const win = await activeWin();
      if (!win || !win.owner) return;

      const processName = win.owner.name || '';
      const processPath = win.owner.path || '';
      const pid = win.owner.processId || 0;

      if (this.isSelf(processName)) return;
      if (this.isWhitelisted(processName, processPath)) return;

      const now = Date.now();
      const cooldownUntil = this.cooldownByPid.get(pid);
      if (cooldownUntil && now < cooldownUntil) return;

      // 入侵!
      this.cooldownByPid.set(pid, now + this.cooldownMs);
      this.lastIntruderPid = pid;
      this.cleanupCooldown();

      if (this.onIntruder) {
        this.onIntruder({
          processName,
          processPath,
          pid,
          hwnd: win.id || 0, // active-win 在 Windows 上 id 即是 HWND
          title: win.title || '',
          window: win,
        });
      }
    } catch (e) {
      this.onError(e);
    }
  }

  start() {
    if (this.running) return;
    this.running = true;
    // 立刻查一次,避免等满第一秒
    this.tick();
    this.timer = setInterval(() => this.tick(), this.intervalMs);
    console.log('[WindowMonitor] started, interval =', this.intervalMs, 'ms, whitelist =', [...this.whitelist].join(', '));
  }

  stop() {
    if (!this.running) return;
    this.running = false;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    console.log('[WindowMonitor] stopped');
  }
}

module.exports = WindowMonitor;
