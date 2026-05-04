// Committen - Electron 主进程
// v0.1 Day 6: 加入活动窗口监听,非白名单窗口 → 触发猫切到 eat 状态
//             (Day 7 再加上"真的最小化")

const { app, BrowserWindow, screen, ipcMain, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const WindowMonitor = require('./monitor/window-monitor');
const GitWatcher = require('./monitor/git-watcher');
const HungerSystem = require('./core/hunger-system');
const { minimizeByHwnd } = require('./monitor/minimize');

// 小猫窗口尺寸(像素)
// 80x64 原始 sprite × scale(2.4) ≈ 192x154,加 hint 区域和入场动画余量,定 220x220
const CAT_WIDTH = 220;
const CAT_HEIGHT = 220;
// 默认位置距离屏幕右下角的边距
const DEFAULT_MARGIN_RIGHT = 40;
const DEFAULT_MARGIN_BOTTOM = 80;
// 边界吸附阈值:松手时离屏幕边缘小于这个距离就吸过去
const SNAP_THRESHOLD = 30;
// 移动后多久把位置写盘(防抖,避免拖动时频繁 IO)
const SAVE_DEBOUNCE_MS = 400;

let catWindow = null;
let saveTimer = null;
let snapping = false; // 防止吸附 setPosition 触发的 move 事件再次走吸附逻辑
let monitor = null;   // WindowMonitor 实例
let gitWatchers = []; // GitWatcher 实例数组(支持多 repo)
let hunger = null;    // HungerSystem 实例
let decayTimer = null; // 每分钟 -1 的定时器
let appConfig = null; // 加载后的配置
let returnToIdleTimer = null; // 吃完几秒后回 idle 的定时器
let currentSpriteState = 'idle'; // 主进程持有的"猫当前 sprite 状态"
let inTransientState = false;    // 是否在 eat 等临时状态中(不被 hunger 自动覆盖)
let roamTimer = null;            // walk 状态下推动窗口位移的定时器
let roamDirection = 1;           // 1 = 向右,-1 = 向左
let roamLastTickAt = 0;
let roaming = false;             // 是否正在桌面行走(给 move 处理器看的)
const ROAM_TICK_MS = 50;         // ~20fps,够顺滑且不烧 CPU
const ROAM_SPEED_PX_S = 35;      // 速度 px/秒

// ==================== 配置加载 ====================

const DEFAULT_CONFIG = {
  whitelist: [
    // IDE / 编辑器
    'Code.exe', 'Cursor.exe',
    // 终端(可能以多种形式出现)
    'WindowsTerminal.exe', 'Windows Terminal Host', 'cmd.exe', 'powershell.exe',
    // 系统外壳(active-win 经常返回显示名而非 .exe)
    'explorer.exe', 'Windows Explorer', 'Task Manager', 'taskmgr.exe',
    'TextInputHost.exe', 'SnippingTool.exe', 'Snipping Tool',
    // Windows 搜索 / 开始菜单 / Shell UI
    'Search', 'SearchApp.exe', 'SearchHost.exe', 'SearchUI.exe',
    'StartMenuExperienceHost.exe', 'ShellExperienceHost.exe',
    'ApplicationFrameHost.exe', 'SystemSettings.exe', 'LockApp.exe',
    // 浏览器
    'chrome.exe', 'msedge.exe', 'firefox.exe',
    // Committen 自己(包含老名字 FocusCat.exe 兼容老安装)
    'Committen.exe', 'FocusCat.exe', 'electron.exe',
    // AI 助手
    'Claude', 'Claude.exe', 'ClaudeDesktop.exe',
    // 录屏 / 流媒体工具(用户要做 demo / 教程 / 直播,不该被吃)
    'obs64.exe', 'obs32.exe', 'OBS Studio',
    'ScreenToGif.exe', 'ScreenToGif',
    'ShareX.exe', 'ShareX',
    'Bandicam.exe', 'Camtasia.exe', 'CamtasiaStudio.exe',
    'GameBar.exe',
    // 开发运行时 / IDE 跑的程序进程(用户在调试自己写的程序时,不该被吃)
    'java.exe', 'javaw.exe',
    'python.exe', 'pythonw.exe', 'py.exe',
    'node.exe', 'npm.exe',
    'dotnet.exe',
    'cargo.exe', 'rustc.exe',
    'go.exe',
    'ruby.exe',
  ],
  monitor: {
    intervalMs: 1000,
    eatDurationMs: 3000,
    cooldownMs: 5000,
    actuallyMinimize: false, // 默认 false 安全模式;true 才真最小化
    passive: false,          // v0.1.2:true 时完全不 attack(录屏 / 演示用)
  },
  hunger: {
    initial: 80,
    decayPerMinute: 1,
    commitReward: 30,
    intruderPenalty: 10,
  },
};

// v0.1.2 起,用户配置文件统一放在 userData(可写位置),装机用户能自己改。
// 首次启动会把 bundled config.example.json 拷一份到那里。
function getUserConfigPath() {
  return path.join(app.getPath('userData'), 'config.json');
}

function ensureUserConfigExists() {
  const userPath = getUserConfigPath();
  if (fs.existsSync(userPath)) return userPath;

  // 首次启动:从 app 内置的 config.example.json 拷一份过去
  const projectRoot = path.join(__dirname, '..');
  const examplePath = path.join(projectRoot, 'config.example.json');
  try {
    if (fs.existsSync(examplePath)) {
      // 确保 userData 目录存在
      const userDir = path.dirname(userPath);
      if (!fs.existsSync(userDir)) fs.mkdirSync(userDir, { recursive: true });
      fs.copyFileSync(examplePath, userPath);
      console.log(`[Committen] First run: copied config to ${userPath}`);
    } else {
      console.warn('[Committen] bundled config.example.json missing, will use built-in defaults');
    }
  } catch (e) {
    console.warn('[Committen] failed to seed config:', e.message);
  }
  return userPath;
}

function loadConfig() {
  const userPath = ensureUserConfigExists();

  try {
    if (fs.existsSync(userPath)) {
      const raw = fs.readFileSync(userPath, 'utf-8');
      const cfg = JSON.parse(raw);

      // v0.1.2 修复:whitelist 用 union 合并,不是 cfg 完全替换 DEFAULT。
      // 这样以后我们在 DEFAULT_CONFIG 里加新条目(如 java.exe),所有现有用户也能拿到,
      // 不需要他们重新 seed 配置或手动加。
      // 用户在 cfg 里加的条目仍然生效(扩展默认),但也不能"删除"默认条目——
      // 那种需求是 v0.2 的事(可加 whitelistExclude 字段)。
      const mergedWhitelist = [
        ...new Set([
          ...(DEFAULT_CONFIG.whitelist || []),
          ...((cfg.whitelist || []).filter((s) => typeof s === 'string')),
        ]),
      ];

      const merged = {
        ...DEFAULT_CONFIG,
        ...cfg,
        monitor: { ...DEFAULT_CONFIG.monitor, ...(cfg.monitor || {}) },
        hunger: { ...DEFAULT_CONFIG.hunger, ...(cfg.hunger || {}) },
        whitelist: mergedWhitelist,
      };
      console.log(
        `[Committen] config loaded from ${userPath} (whitelist: ${DEFAULT_CONFIG.whitelist.length} default + ${(cfg.whitelist || []).length} user = ${mergedWhitelist.length} total)`
      );
      return merged;
    }
  } catch (e) {
    console.warn(`[Committen] config parse failed at ${userPath}:`, e.message);
  }

  console.log('[Committen] using built-in defaults');
  return DEFAULT_CONFIG;
}

// ==================== 状态持久化 ====================

function getStatePath() {
  return path.join(app.getPath('userData'), 'state.json');
}

function loadState() {
  try {
    const raw = fs.readFileSync(getStatePath(), 'utf-8');
    const obj = JSON.parse(raw);
    if (obj && typeof obj === 'object') return obj;
  } catch (_e) {
    // 第一次运行,或文件损坏,都走默认
  }
  return {};
}

function saveState(patch) {
  try {
    const cur = loadState();
    const next = { ...cur, ...patch };
    fs.writeFileSync(getStatePath(), JSON.stringify(next, null, 2), 'utf-8');
  } catch (e) {
    console.error('[Committen] saveState failed:', e.message);
  }
}

// ==================== 显示器/位置工具 ====================

// 找到包含指定点的显示器(用窗口左上角附近 20px 偏移点判断,避免临界值)
function findDisplayContaining(x, y) {
  return screen.getAllDisplays().find((d) => {
    const { x: dx, y: dy, width, height } = d.workArea;
    return x >= dx && x < dx + width && y >= dy && y < dy + height;
  });
}

function getDefaultPosition() {
  const primary = screen.getPrimaryDisplay();
  const { x, y, width, height } = primary.workArea;
  return {
    x: x + width - CAT_WIDTH - DEFAULT_MARGIN_RIGHT,
    y: y + height - CAT_HEIGHT - DEFAULT_MARGIN_BOTTOM,
  };
}

// 把 (x, y) 限制在某个显示器的工作区内
function clampToDisplay(x, y, display) {
  const { x: dx, y: dy, width, height } = display.workArea;
  return {
    x: Math.max(dx, Math.min(dx + width - CAT_WIDTH, x)),
    y: Math.max(dy, Math.min(dy + height - CAT_HEIGHT, y)),
  };
}

// 找离 (x, y) 最近的显示器(用工作区中心点距离)
function findNearestDisplay(x, y) {
  const all = screen.getAllDisplays();
  let best = all[0];
  let bestDist = Infinity;
  for (const d of all) {
    const dcx = d.workArea.x + d.workArea.width / 2;
    const dcy = d.workArea.y + d.workArea.height / 2;
    const dist = Math.hypot(dcx - x, dcy - y);
    if (dist < bestDist) {
      bestDist = dist;
      best = d;
    }
  }
  return best;
}

// 如果窗口中心已经不在任何显示器的工作区内,把它拉回最近那一块的边内
// 返回拯救后的位置 { x, y } 或 null(还在屏幕里,不需要救)
function rescueOffScreen(winX, winY) {
  const cx = winX + CAT_WIDTH / 2;
  const cy = winY + CAT_HEIGHT / 2;
  if (findDisplayContaining(cx, cy)) return null;
  const nearest = findNearestDisplay(cx, cy);
  return clampToDisplay(winX, winY, nearest);
}

// 启动时拿一个有效的初始位置:优先用保存的,无效就用默认
function resolveInitialPosition() {
  const saved = loadState().position;
  if (
    saved &&
    Number.isFinite(saved.x) &&
    Number.isFinite(saved.y)
  ) {
    // 保存位置的"窗口中心点"必须落在某个连接的显示器上
    const cx = saved.x + CAT_WIDTH / 2;
    const cy = saved.y + CAT_HEIGHT / 2;
    const display = findDisplayContaining(cx, cy);
    if (display) {
      // 顺手 clamp 一下,防止显示器分辨率变了导致部分超出
      return clampToDisplay(saved.x, saved.y, display);
    }
  }
  return getDefaultPosition();
}

// ==================== 边界吸附 ====================

// 给定窗口中心点所在的显示器,如果窗口离任一边距离 < SNAP_THRESHOLD,就吸过去
// 返回 { x, y } 或 null(不需要吸附)
function computeSnap(winX, winY) {
  const cx = winX + CAT_WIDTH / 2;
  const cy = winY + CAT_HEIGHT / 2;
  const display = findDisplayContaining(cx, cy);
  if (!display) return null;

  const { x: dx, y: dy, width, height } = display.workArea;
  const left = winX - dx;
  const right = dx + width - (winX + CAT_WIDTH);
  const top = winY - dy;
  const bottom = dy + height - (winY + CAT_HEIGHT);

  let nx = winX;
  let ny = winY;
  let snapped = false;

  if (left < SNAP_THRESHOLD && left < right) {
    nx = dx;
    snapped = true;
  } else if (right < SNAP_THRESHOLD) {
    nx = dx + width - CAT_WIDTH;
    snapped = true;
  }

  if (top < SNAP_THRESHOLD && top < bottom) {
    ny = dy;
    snapped = true;
  } else if (bottom < SNAP_THRESHOLD) {
    ny = dy + height - CAT_HEIGHT;
    snapped = true;
  }

  return snapped ? { x: nx, y: ny } : null;
}

// ==================== 窗口创建 ====================

function createCatWindow() {
  const { x, y } = resolveInitialPosition();

  catWindow = new BrowserWindow({
    width: CAT_WIDTH,
    height: CAT_HEIGHT,
    x,
    y,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    movable: true,
    hasShadow: false,
    focusable: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'renderer', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // 让窗口飘在所有应用之上(包括全屏应用之上)
  catWindow.setAlwaysOnTop(true, 'screen-saver');

  catWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  catWindow.once('ready-to-show', () => {
    catWindow.show();
  });

  if (process.argv.includes('--dev')) {
    catWindow.webContents.openDevTools({ mode: 'detach' });
  }

  // ---- 拖动期间持续移动会触发 'move' 事件;松手时触发 'moved' ----
  // 写盘用 'move' + 防抖(节流即可,无需精确)
  catWindow.on('move', () => {
    if (snapping || roaming) return; // 吸附 / 桌面行走自身的 setPosition 都不该触发保存
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      if (!catWindow) return;
      const [px, py] = catWindow.getPosition();
      saveState({ position: { x: px, y: py } });
    }, SAVE_DEBOUNCE_MS);
  });

  // 'moved' 在用户松手停止拖动后触发(Windows/macOS 都有)
  // 优先级:越界营救 > 边界吸附 > 不动
  catWindow.on('moved', () => {
    if (!catWindow || snapping || roaming) return;
    const [px, py] = catWindow.getPosition();

    // 1. 越界营救:猫被拖出屏幕了 → 强制拉回最近的屏内
    const rescue = rescueOffScreen(px, py);
    if (rescue) {
      snapping = true;
      catWindow.setPosition(rescue.x, rescue.y, true);
      setTimeout(() => {
        snapping = false;
        saveState({ position: rescue });
      }, 50);
      return;
    }

    // 2. 边界吸附:在屏内但贴近边缘 → 吸过去
    const snap = computeSnap(px, py);
    if (snap) {
      snapping = true;
      catWindow.setPosition(snap.x, snap.y, true);
      setTimeout(() => {
        snapping = false;
        saveState({ position: { x: snap.x, y: snap.y } });
      }, 50);
    }
  });

  // 显示器拓扑变化(插拔外接屏、分辨率切换):重新校验位置
  const handleDisplayChange = () => {
    if (!catWindow) return;
    const [px, py] = catWindow.getPosition();
    const cx = px + CAT_WIDTH / 2;
    const cy = py + CAT_HEIGHT / 2;
    const display = findDisplayContaining(cx, cy);
    if (!display) {
      // 当前位置已经不在任何显示器上了,回主屏右下角
      const def = getDefaultPosition();
      snapping = true;
      catWindow.setPosition(def.x, def.y);
      setTimeout(() => { snapping = false; }, 50);
      saveState({ position: def });
    }
  };
  screen.on('display-removed', handleDisplayChange);
  screen.on('display-metrics-changed', handleDisplayChange);

  catWindow.on('closed', () => {
    catWindow = null;
    screen.removeListener('display-removed', handleDisplayChange);
    screen.removeListener('display-metrics-changed', handleDisplayChange);
    if (monitor) {
      monitor.stop();
      monitor = null;
    }
    for (const w of gitWatchers) w.stop();
    gitWatchers = [];
    if (decayTimer) {
      clearInterval(decayTimer);
      decayTimer = null;
    }
    if (roamTimer) {
      clearInterval(roamTimer);
      roamTimer = null;
    }
    if (returnToIdleTimer) {
      clearTimeout(returnToIdleTimer);
      returnToIdleTimer = null;
    }
  });
}

// ==================== 状态切换 + 监听器 ====================
// 状态机职责:
//   - "base state":由 hunger.getBaseSpriteState() 决定(idle / walk),hunger 一变就重算
//   - "transient state":eat,由触发事件设入,持续 eatDurationMs,完事自动回 base
//   - inTransientState 锁住期间,hunger 变化不会立刻盖掉显示

function _sendStateToRenderer(state) {
  if (!catWindow || catWindow.isDestroyed()) return;
  if (state === currentSpriteState) return;
  currentSpriteState = state;
  catWindow.webContents.send('cat:set-state', state);

  // walk 状态 → 启动桌面行走;其他状态 → 停下并保存位置
  if (state === 'walk') {
    startRoaming();
  } else {
    stopRoaming();
  }
}

// ==================== 桌面行走(walk 状态时窗口位移) ====================

function notifyDirection() {
  if (catWindow && !catWindow.isDestroyed()) {
    catWindow.webContents.send('cat:direction', roamDirection);
  }
}

function startRoaming() {
  if (roamTimer || !catWindow || catWindow.isDestroyed()) return;
  roaming = true;
  roamLastTickAt = Date.now();
  notifyDirection();
  roamTimer = setInterval(roamTick, ROAM_TICK_MS);
  console.log('[Committen] roam start dir=', roamDirection);
}

function stopRoaming() {
  if (!roamTimer && !roaming) return;
  if (roamTimer) {
    clearInterval(roamTimer);
    roamTimer = null;
  }
  roaming = false;
  // 落点保存
  if (catWindow && !catWindow.isDestroyed()) {
    const [px, py] = catWindow.getPosition();
    saveState({ position: { x: px, y: py } });
  }
  console.log('[Committen] roam stop');
}

function roamTick() {
  if (!catWindow || catWindow.isDestroyed()) {
    stopRoaming();
    return;
  }

  const now = Date.now();
  const dt = (now - roamLastTickAt) / 1000;
  roamLastTickAt = now;
  if (dt <= 0 || dt > 1) return; // 异常 dt 跳过

  const [px, py] = catWindow.getPosition();
  const stepX = roamDirection * ROAM_SPEED_PX_S * dt;
  let nx = px + stepX;

  // 边界判断:用窗口中心点定位当前显示器
  const cx = px + CAT_WIDTH / 2;
  const cy = py + CAT_HEIGHT / 2;
  const display = findDisplayContaining(cx, cy);
  if (display) {
    const { x: dx, width } = display.workArea;
    const minX = dx;
    const maxX = dx + width - CAT_WIDTH;
    if (nx < minX) {
      nx = minX;
      roamDirection = 1;
      notifyDirection();
    } else if (nx > maxX) {
      nx = maxX;
      roamDirection = -1;
      notifyDirection();
    }
  }

  const targetX = Math.round(nx);
  if (targetX !== px) {
    catWindow.setPosition(targetX, py);
  }
}

function _sendHungerToRenderer(value) {
  if (!catWindow || catWindow.isDestroyed()) return;
  catWindow.webContents.send('cat:hunger', value);
}

function applyBaseState() {
  if (inTransientState) return; // 临时状态中,等结束再算
  if (!hunger) return;
  _sendStateToRenderer(hunger.getBaseSpriteState());
}

function startTransientState(state, durationMs) {
  if (returnToIdleTimer) clearTimeout(returnToIdleTimer);
  inTransientState = true;
  _sendStateToRenderer(state);
  returnToIdleTimer = setTimeout(() => {
    returnToIdleTimer = null;
    inTransientState = false;
    applyBaseState();
  }, durationMs);
}

// 函数名 triggerEat 是历史遗留:原本所有触发都用 eat 状态。
// 现在分了:窗口入侵 → attack 状态(扑爪);git commit → eat 状态(真吃)
function triggerEat({ processName, processPath, title, hwnd }) {
  // v0.1.2:passive 模式下完全跳过——给录屏 / 演示用
  if (appConfig?.monitor?.passive === true) {
    console.log(`[Committen] passive mode, skipping attack on "${processName}"`);
    return;
  }

  const willMinimize = appConfig?.monitor?.actuallyMinimize === true;
  const penalty = appConfig?.hunger?.intruderPenalty ?? 10;
  if (hunger) hunger.subtract(penalty);

  console.log(
    `[Committen] ATTACK name="${processName}" path="${processPath || ''}" title="${title}" hwnd=${hwnd} minimize=${willMinimize} hunger=${hunger?.value}`
  );

  if (willMinimize && hwnd) {
    minimizeByHwnd(hwnd).then((ok) => {
      if (!ok) console.warn(`[Committen] minimize hwnd=${hwnd} returned false`);
    });
  }

  const dur = appConfig?.monitor?.eatDurationMs ?? 3000;
  startTransientState('attack', dur);
}

function triggerCommit({ sha, message }) {
  const shortSha = (sha || '').substring(0, 7);
  const reward = appConfig?.hunger?.commitReward ?? 30;
  if (hunger) hunger.add(reward);

  console.log(
    `[Committen] COMMIT sha=${shortSha} msg="${message}" reward=+${reward} hunger=${hunger?.value}`
  );

  const dur = appConfig?.monitor?.eatDurationMs ?? 3000;
  startTransientState('eat', dur);
}

function startMonitor() {
  const m = appConfig.monitor || {};
  monitor = new WindowMonitor({
    whitelist: appConfig.whitelist || [],
    intervalMs: m.intervalMs || 1000,
    cooldownMs: m.cooldownMs || 5000,
    onIntruder: triggerEat,
    onError: (e) => console.error('[Committen] monitor error:', e.message),
  });

  // 等 renderer ready 之后再开始监听,避免 IPC 没建立就触发
  if (catWindow) {
    catWindow.webContents.once('did-finish-load', () => {
      setTimeout(() => monitor.start(), 1000);
    });
  }
}

function startHunger() {
  const cfg = appConfig.hunger || {};
  const initialFromConfig = cfg.initial ?? 80;

  hunger = new HungerSystem({ initial: initialFromConfig });

  // 从 state.json 恢复(如果有持久化的值)
  const savedHunger = loadState().hunger;
  if (savedHunger) {
    hunger.loadFromJSON(savedHunger);
    console.log('[Committen] hunger restored:', hunger.value);
  } else {
    console.log('[Committen] hunger init:', hunger.value);
  }

  // 数值变化:广播给 renderer + 重算 base state + 持久化
  hunger.on('change', ({ value, delta }) => {
    _sendHungerToRenderer(value);
    saveState({ hunger: hunger.toJSON() });
    if (!inTransientState) applyBaseState();
    // 数值跨过 50 这条线时打个日志
    if ((delta > 0 && value >= 50 && value - delta < 50) ||
        (delta < 0 && value < 50 && value - delta >= 50)) {
      console.log(`[Committen] hunger crossed 50 -> ${value} (${hunger.getLevel()})`);
    }
  });

  // 每分钟自然衰减
  const decayPerMinute = cfg.decayPerMinute ?? 1;
  decayTimer = setInterval(() => {
    hunger.decay(decayPerMinute);
  }, 60 * 1000);

  // 启动后 1 秒把当前数值推一次给 renderer(初始化显示)
  if (catWindow) {
    catWindow.webContents.once('did-finish-load', () => {
      setTimeout(() => {
        _sendHungerToRenderer(hunger.value);
        applyBaseState();
      }, 800);
    });
  }
}

// v0.1.2:从当前目录向上找最多 5 层,看看有没有 .git 文件夹。
// 给 cwd 启动场景用(npm run dev / 在仓库内启动 .exe)。
function autoDetectGitRepoFromCwd() {
  let dir = process.cwd();
  for (let i = 0; i < 5; i++) {
    const gitDir = path.join(dir, '.git');
    try {
      if (fs.existsSync(gitDir)) {
        return dir;
      }
    } catch (_) { /* ignore */ }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

// v0.1.2:扫常见开发目录一层深度,把所有 .git 仓库找出来。
// 这样用户开 .exe 装机版后,就算从开始菜单启动(cwd 是 install dir),
// 也能自动监听他们硬盘上的所有项目,不用手动填路径。
function scanForGitRepos(maxResults = 30) {
  const home = require('os').homedir();
  // Windows 常见开发目录(覆盖大部分人)
  const candidates = [
    path.join(home, 'Documents'),
    path.join(home, 'Desktop'),
    path.join(home, 'Projects'),
    path.join(home, 'projects'),
    path.join(home, 'Code'),
    path.join(home, 'code'),
    path.join(home, 'Dev'),
    path.join(home, 'dev'),
    path.join(home, 'source', 'repos'),  // Visual Studio 默认
    path.join(home, 'repos'),
    path.join(home, 'workspace'),
    path.join(home, 'src'),
    'D:\\',
    'E:\\',
    'F:\\',
  ];

  const found = [];
  for (const root of candidates) {
    if (found.length >= maxResults) break;
    try {
      if (!fs.existsSync(root)) continue;
      // 自身是 git 仓库
      if (fs.existsSync(path.join(root, '.git'))) {
        found.push(root);
        if (found.length >= maxResults) break;
      }
      // 一层深
      const entries = fs.readdirSync(root, { withFileTypes: true });
      for (const entry of entries) {
        if (found.length >= maxResults) break;
        if (!entry.isDirectory()) continue;
        // 跳过隐藏 / 系统目录
        if (entry.name.startsWith('.') || entry.name.startsWith('$')) continue;
        const sub = path.join(root, entry.name);
        try {
          if (fs.existsSync(path.join(sub, '.git'))) {
            found.push(sub);
          }
        } catch (_) { /* ignore */ }
      }
    } catch (_) { /* permission / etc */ }
  }
  return [...new Set(found)];
}

// 解析 appConfig.gitRepo 成最终监听的仓库路径列表。
// 支持:
//   "auto"               → cwd 向上找 + 扫常见开发目录,所有 .git 都加上
//   "D:\\proj"           → 显式单仓库
//   ["D:\\a", "D:\\b"]   → 显式多仓库
//   ["auto", "D:\\b"]    → 混合("auto" 自动找全部 + "D:\\b" 补充)
function resolveGitRepos() {
  const raw = appConfig.gitRepo;
  const collected = [];

  const items = Array.isArray(raw) ? raw : [raw];
  for (const item of items) {
    if (typeof item !== 'string') continue;
    const v = item.trim();

    if (!v || v.includes('path\\to\\your\\repo') || v.toLowerCase() === 'auto') {
      // 真·自动模式:cwd-detect + 扫硬盘
      const cwdRepo = autoDetectGitRepoFromCwd();
      const scanned = scanForGitRepos();
      if (cwdRepo) collected.push(cwdRepo);
      collected.push(...scanned);
      const total = [...new Set([cwdRepo, ...scanned].filter(Boolean))].length;
      console.log(`[Committen] auto-discovered ${total} git repo(s) (cwd-detect + filesystem scan)`);
      continue;
    }

    // 绝对路径,直接用
    collected.push(v);
  }

  // 去重(同一路径不重复创建 watcher)
  return [...new Set(collected)];
}

function startGitWatcher() {
  const repos = resolveGitRepos();

  if (repos.length === 0) {
    console.log('[Committen] no gitRepo configured/detected; commit feeding disabled');
    return;
  }

  console.log(`[Committen] watching ${repos.length} git repo(s):`, repos.join(', '));

  for (const repoPath of repos) {
    const watcher = new GitWatcher({
      repoPath,
      onCommit: triggerCommit,
      onError: (e) => console.error(`[Committen] git error (${repoPath}):`, e.message),
    });
    gitWatchers.push(watcher);
  }

  if (catWindow) {
    catWindow.webContents.once('did-finish-load', () => {
      setTimeout(() => {
        for (const w of gitWatchers) w.start();
      }, 1100);
    });
  }
}

// ==================== IPC ====================

ipcMain.on('cat:quit', () => {
  app.quit();
});

// 重置位置(右键菜单将来用得到;Day 2 暂留)
ipcMain.on('cat:reset-position', () => {
  if (!catWindow) return;
  const def = getDefaultPosition();
  snapping = true;
  catWindow.setPosition(def.x, def.y);
  setTimeout(() => { snapping = false; }, 50);
  saveState({ position: def });
});

// v0.1.2: 用户点 ⚙️ 按钮 → 用默认编辑器(记事本等)打开 config.json
ipcMain.on('cat:open-config', async () => {
  const userPath = ensureUserConfigExists(); // 不存在就先建
  console.log(`[Committen] opening config: ${userPath}`);
  const error = await shell.openPath(userPath);
  if (error) {
    console.error('[Committen] failed to open config:', error);
  }
});

// ==================== App 生命周期 ====================

app.whenReady().then(() => {
  appConfig = loadConfig();
  console.log('[Committen] whitelist:', (appConfig.whitelist || []).join(', '));
  console.log('[Committen] interval:', appConfig.monitor?.intervalMs, 'ms, actuallyMinimize:', appConfig.monitor?.actuallyMinimize);
  console.log('[Committen] gitRepo:', appConfig.gitRepo || '(none)');

  createCatWindow();
  startHunger();
  startMonitor();
  startGitWatcher();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createCatWindow();
    }
  });
});

app.on('window-all-closed', () => {
  app.quit();
});
