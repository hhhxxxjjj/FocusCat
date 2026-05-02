// FocusCat renderer
// Day 10-11: 状态由主进程驱动 + 饱腹感血条显示

(function () {
  const sprite = document.getElementById('catSprite');
  const btnQuit = document.getElementById('btnQuit');
  const btnReset = document.getElementById('btnReset');
  const hungerEl = document.getElementById('catHunger');
  const hungerFill = document.getElementById('hungerFill');
  const hungerNum = document.getElementById('hungerNum');

  // ============ 状态机(sprite) ============
  // attack = 扑爪(窗口入侵触发);eat = 低头吃(git commit 触发)
  const STATES = ['idle', 'walk', 'eat', 'sleep', 'attack'];
  let currentState = 'idle';

  function setState(name) {
    if (!STATES.includes(name)) {
      console.warn('[FocusCat] unknown state:', name);
      return;
    }
    if (name === currentState) return;
    sprite.classList.remove(`cat-sprite--${currentState}`);
    sprite.classList.add(`cat-sprite--${name}`);
    currentState = name;
    console.log('[FocusCat] state →', name);
  }

  // 主进程通知方向变化(走到边缘要转身)
  // dir = 1 表示向右,-1 表示向左
  // 素材默认朝向是"左",所以向右走 (dir=1) 时要翻转
  window.focusCat.onDirection((dir) => {
    document.body.classList.toggle('cat-flipped', dir === 1);
  });

  window.focusCat.setState = setState;
  window.focusCat.getState = () => currentState;

  window.focusCat.onSetState((state) => {
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

    // 第一次拿到数值后,允许 hunger 自身的 fade-in(intro 之外也显示)
    document.body.classList.add('cat-hunger-ready');

    // 数字变化的浮字反馈(+30 / -10)
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

  window.focusCat.onHunger((value) => {
    updateHunger(value);
  });

  // 调试用
  window.focusCat.getHunger = () => lastHunger;

  // ============ 首次启动 ============
  document.body.classList.add('cat--intro');
  setTimeout(() => document.body.classList.remove('cat--intro'), 5000);

  // ============ 按钮 ============
  btnQuit.addEventListener('click', () => {
    if (confirm('让 FocusCat 退出吗?(她会饿死的)')) {
      window.focusCat.quit();
    }
  });

  btnReset.addEventListener('click', () => {
    window.focusCat.resetPosition();
  });

  console.log('[FocusCat] renderer ready (Day 10-11)');
  console.log('[FocusCat] 调试:window.focusCat.setState(...) / getHunger()');
})();
