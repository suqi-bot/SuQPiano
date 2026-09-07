/**
 * NoteWaterfall — 实时音名流
 * 演奏时，每弹一个音就在左侧音名流顶部落下一张音名卡片，
 * 旧卡片随之下沉并淡出，直观呈现"正在弹哪些音符"。
 *
 * 颜色语义：
 *   - 白键卡片为浅色，黑键卡片为深色（与键盘一致）
 *   - 卡片亮度/不透明度随触键力度变化（力度越大越亮）
 * 键盘、鼠标、触摸、示范曲都走 pressNote，因此都会汇入这条流。
 */

export class NoteWaterfall {
  /** @param {HTMLElement} streamEl 卡片容器（已存在于 DOM 中） */
  constructor(streamEl) {
    this.el = streamEl;
    this.max = 16;          // 同时可见的卡片上限
    this.items = [];
  }

  /**
   * 推入一个音符。
   * @param {string} name  音名（如 C4 / F#5）
   * @param {number} vel   归一化力度 0~1
   * @param {boolean} isBlack 是否黑键
   */
  push(name, vel, isBlack) {
    if (!this.el) return;
    const v = Math.max(0.08, Math.min(1, vel));

    const chip = document.createElement('div');
    chip.className = 'wf-chip' + (isBlack ? ' is-black' : '');
    chip.style.setProperty('--v', v.toFixed(2));
    chip.innerHTML = `<span class="wf-name">${name}</span><span class="wf-vel">${Math.round(v * 100)}</span>`;

    // 新卡片自顶部进入，旧卡片被自然下推
    this.el.prepend(chip);
    // 触发入场过渡
    requestAnimationFrame(() => chip.classList.add('in'));

    this.items.push(chip);
    while (this.items.length > this.max) {
      const old = this.items.shift();
      old.classList.add('out');
      setTimeout(() => old.remove(), 420);
    }
  }

  clear() {
    if (!this.el) return;
    this.el.innerHTML = '';
    this.items = [];
  }
}
