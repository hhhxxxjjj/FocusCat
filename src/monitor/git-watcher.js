// FocusCat - Git 仓库监听
//
// 监听 <repo>/.git/logs/HEAD 文件——这个文件在每次 commit / checkout / merge / reset 时
// 都会追加一行新记录。我们解析新增的行,只对 commit 类型的事件触发 onCommit 回调。
//
// 实现:用 Node 自带的 fs.watchFile (轮询 2 秒)避免引入 chokidar 这类外部依赖,
// 在 Windows 上比 fs.watch 更稳。

const fs = require('fs');
const path = require('path');

// HEAD log 行格式:
//   <old-sha> <new-sha> <author> <unix-ts> <tz>\t<event>: <message>
// event 值常见的有:commit、commit (initial)、commit (amend)、commit (merge)、checkout、reset、merge 等
// 我们只关心 commit*。
const COMMIT_EVENT_REGEX = /\tcommit(?:\s*\([^)]+\))?:\s*(.*)$/;

class GitWatcher {
  /**
   * @param {Object} opts
   * @param {string}   opts.repoPath     仓库根目录(包含 .git/ 的那级)
   * @param {Function} opts.onCommit({sha, message, raw}) 检测到新 commit 时触发
   * @param {Function} [opts.onError]
   * @param {number}   [opts.intervalMs] 轮询间隔,默认 2000ms
   */
  constructor({ repoPath, onCommit, onError, intervalMs = 2000 }) {
    this.repoPath = repoPath;
    this.headLogPath = repoPath ? path.join(repoPath, '.git', 'logs', 'HEAD') : '';
    this.onCommit = onCommit;
    this.onError = onError || ((e) => console.error('[GitWatcher]', e.message));
    this.intervalMs = intervalMs;
    this.lastSize = 0;
    this.running = false;
  }

  start() {
    if (this.running) return;
    if (!this.repoPath) {
      console.log('[GitWatcher] no repoPath configured, skipping');
      return;
    }
    this.running = true;
    this._waitedNotice = false;
    this._tryAttach();
  }

  // 如果 .git/logs/HEAD 不存在(用户还没 git init),每 3 秒重试一次,
  // 这样用户先启动 FocusCat 再 git init 也能正常衔接
  _tryAttach() {
    if (!this.running) return;
    if (this._watching) return;

    if (!fs.existsSync(this.headLogPath)) {
      if (!this._waitedNotice) {
        console.log(
          `[GitWatcher] ${this.headLogPath} not found yet — waiting (try 'git init' in ${this.repoPath})`
        );
        this._waitedNotice = true;
      }
      this._retryTimer = setTimeout(() => this._tryAttach(), 3000);
      return;
    }

    // 文件存在了,正式接上
    try {
      this.lastSize = fs.statSync(this.headLogPath).size;
    } catch (_) {
      this.lastSize = 0;
    }

    fs.watchFile(this.headLogPath, { interval: this.intervalMs }, (curr, prev) => {
      if (!this.running) return;
      if (curr.size > prev.size) {
        this._handleGrowth(prev.size, curr.size);
      } else if (curr.size > 0 && curr.size !== this.lastSize && curr.mtimeMs !== prev.mtimeMs) {
        const start = Math.min(this.lastSize, curr.size);
        this._handleGrowth(start, curr.size);
      }
    });

    this._watching = true;
    console.log(`[GitWatcher] watching ${this.headLogPath}`);
  }

  _handleGrowth(prevSize, newSize) {
    if (newSize <= prevSize) {
      this.lastSize = newSize;
      return;
    }
    try {
      const fd = fs.openSync(this.headLogPath, 'r');
      const buf = Buffer.alloc(newSize - prevSize);
      fs.readSync(fd, buf, 0, newSize - prevSize, prevSize);
      fs.closeSync(fd);

      const added = buf.toString('utf-8');
      const lines = added.split('\n').map((l) => l.trim()).filter(Boolean);

      for (const line of lines) {
        const m = line.match(COMMIT_EVENT_REGEX);
        if (!m) continue;
        const message = (m[1] || '').trim();
        const parts = line.split(' ');
        const sha = parts[1] || '';
        if (this.onCommit) {
          this.onCommit({ sha, message, raw: line });
        }
      }

      this.lastSize = newSize;
    } catch (e) {
      this.onError(e);
    }
  }

  stop() {
    if (!this.running) return;
    this.running = false;
    if (this._retryTimer) {
      clearTimeout(this._retryTimer);
      this._retryTimer = null;
    }
    if (this._watching) {
      fs.unwatchFile(this.headLogPath);
      this._watching = false;
    }
    console.log('[GitWatcher] stopped');
  }
}

module.exports = GitWatcher;
