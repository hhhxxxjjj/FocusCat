// FocusCat - 饱腹感系统
//
// 文档第 5.3.3 节定义的 0-100 数值。她的世界观:
//   - 写代码 (git commit) → 变饱
//   - 走神 (切到非白名单应用) → 变瘦
//   - 时间流逝 → 微微减少
//
// 状态分级(文档 4.2 v1.0 完整版,v0.1 用前两个区间驱动 sprite):
//   80-100  full      😋
//   50-80   normal    😊
//   20-50   hungry    🥺
//   0-20    starving  😱

const EventEmitter = require('events');

class HungerSystem extends EventEmitter {
  constructor({ initial = 80, min = 0, max = 100 } = {}) {
    super();
    this.min = min;
    this.max = max;
    this._value = this._clamp(initial);
  }

  get value() {
    return this._value;
  }

  set(v) {
    const next = this._clamp(Math.round(v));
    if (next === this._value) return;
    const prev = this._value;
    this._value = next;
    this.emit('change', { value: next, prev, delta: next - prev });
  }

  add(n) {
    this.set(this._value + n);
  }

  subtract(n) {
    this.set(this._value - n);
  }

  decay(n = 1) {
    this.subtract(n);
  }

  // 文档 4.2 的状态分级
  getLevel() {
    const v = this._value;
    if (v >= 80) return 'full';
    if (v >= 50) return 'normal';
    if (v >= 20) return 'hungry';
    return 'starving';
  }

  // 给主进程用的"基础动画状态"——传给 renderer 的 sprite 状态
  // 触发性事件(eat / commit)会临时盖掉这个,完了再回到这个
  // 100 满 → sleep(她吃饱了打盹)
  // 50-99   → idle
  // 0-49    → walk(在徘徊找食物)
  getBaseSpriteState() {
    const v = this._value;
    if (v >= 100) return 'sleep';
    if (v >= 50)  return 'idle';
    return 'walk';
  }

  toJSON() {
    return { value: this._value };
  }

  loadFromJSON(obj) {
    if (obj && Number.isFinite(obj.value)) {
      this._value = this._clamp(Math.round(obj.value));
    }
  }

  _clamp(v) {
    if (!Number.isFinite(v)) return this._value || 0;
    return Math.max(this.min, Math.min(this.max, v));
  }
}

module.exports = HungerSystem;
