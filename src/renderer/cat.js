// Committen renderer
// v0.1.2: 单 ⚙ 按钮 + 弹出菜单(Reset / Open config / Quit)

(function () {
  const sprite = document.getElementById('catSprite');
  const hungerEl = document.getElementById('catHunger');
  const hungerFill = document.getElementById('hungerFill');
  const hungerNum = document.getElementById('hungerNum');

  const btnMenu = document.getElementById('btnMenu');
  const menuEl = document.getElementById('catMenu');
  const menuReset = document.getElementById('menuReset');
  const menuConfig = document.getElementById('menuConfig');
  const menuQuit = document.getElementById('menuQuit');

  // ============ 状态机(sprite) ============
  const STATES = ['idle', 'walk', 'eat', 'sleep', 'attack'];
  let currentState = 'idle';

  function setState(name) {
    if (!STATES.includes(name)) {
      console.warn('[Committen] unknown state:', name);
      return;
    }
    if (name === currentState) return;
    sprite.classList.remove(`cat-sprite--${currentState}`);
    sprite.classList.add(`cat-sprite--${name}`);
    currentState = name;
    console.log('[Committen] state →', name);
  }

  // 主进程通知方向变化(走到边缘要转身)
  // dir = 1 表示向右,-1 表示向左
  // 素材默认朝向是"左",所以向右走 (dir=1) 时要翻转
  window.committen.onDirection((dir) => {
    document.body.classList.toggle('cat-flipped', dir === 1);
  });

  window.committen.onSetState((state) => {
    setState(state);
  });

  // ============ 饱腹感 ============
  let lastHunger = null;

  function levelFor(value) {
    if (value >= 80) return 'full';
    if (value >= 50) return 'normal';
    if (value >= 20) return 'hungry';
    return 'starving';
  }

  function updateHunger(value) {
    if (!Number.isFinite(value)) return;
    const v = Math.max(0, Math.min(100, Math.round(value)));

    document.body.classList.add('cat-hunger-ready');

    if (lastHunger !== null && v !== lastHunger) {
      const delta = v - lastHunger;
      spawnHungerPopup(delta);
    }
    lastHunger = v;

    hungerFill.style.width = `${v}%`;
    hungerNum.textContent = String(v);
    hungerEl.dataset.level = levelFor(v);
  }

  function spawnHungerPopup(delta) {
    if (!delta) return;
    const popup = document.createElement('div');
    popup.className = 'cat-hunger-popup ' + (delta > 0 ? 'is-up' : 'is-down');
    popup.textContent = (delta > 0 ? '+' : '') + delta;
    hungerEl.appendChild(popup);
    setTimeout(() => popup.remove(), 1300);
  }

  window.committen.onHunger((value) => {
    updateHunger(value);
  });

  // ============ 调试入口 ============
  window.committenDebug = {
    setState,
    getState: () => currentState,
    getHunger: () => lastHunger,
    getSTATES: () => STATES.slice(),
  };

  // ============ 首次启动 ============
  document.body.classList.add('cat--intro');
  setTimeout(() => document.body.classList.remove('cat--intro'), 5000);

  // ============ 菜单交互 ============
  function openMenu() {
    menuEl.hidden = false;
  }
  function closeMenu() {
    menuEl.hidden = true;
  }
  function toggleMenu() {
    if (menuEl.hidden) openMenu();
    else closeMenu();
  }

  btnMenu.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleMenu();
  });

  // 点菜单外面任意位置 → 关闭菜单
  document.addEventListener('click', (e) => {
    if (menuEl.hidden) return;
    if (menuEl.contains(e.target) || btnMenu.contains(e.target)) return;
    closeMenu();
  });

  // Esc 也关菜单
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !menuEl.hidden) closeMenu();
  });

  // 菜单项点击
  menuReset.addEventListener('click', () => {
    window.committen.resetPosition();
    closeMenu();
  });

  menuConfig.addEventListener('click', () => {
    window.committen.openConfig();
    closeMenu();
  });

  menuQuit.addEventListener('click', () => {
    closeMenu();
    if (confirm("Quit Committen? (She'll starve.)")) {
      window.committen.quit();
    }
  });

  console.log('[Committen] renderer ready');
  console.log('[Committen] Debug: window.committenDebug.setState("attack") / .getHunger()');
})();
