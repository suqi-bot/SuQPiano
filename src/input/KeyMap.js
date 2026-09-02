/**
 * KeyMap — 电脑键盘 → 半音偏移 的映射（QWERTY 双排钢琴布局）
 * 下排 Z X C V B N M 为白键、S D G H J 为黑键（低八度区）
 * 上排 Q W E R T Y U 为白键、2 3 5 6 7 为黑键（高八度区）
 * 整体覆盖 base ~ base+28（约 2.3 个八度），通过八度平移覆盖 81 键全域。
 */

export const KEY_TO_OFFSET = {
  // ---- 下排（低八度）----
  KeyZ: 0, KeyS: 1, KeyX: 2, KeyD: 3, KeyC: 4, KeyV: 5, KeyG: 6,
  KeyB: 7, KeyH: 8, KeyN: 9, KeyJ: 10, KeyM: 11,
  Comma: 12, KeyL: 13, Period: 14, Semicolon: 15, Slash: 16,
  // ---- 上排（高八度）----
  KeyQ: 12, Digit2: 13, KeyW: 14, Digit3: 15, KeyE: 16, KeyR: 17, Digit5: 18,
  KeyT: 19, Digit6: 20, KeyY: 21, Digit7: 22, KeyU: 23,
  KeyI: 24, Digit9: 25, KeyO: 26, Digit0: 27, KeyP: 28,
};

/** 每个半音偏移优先展示的按键字符（用于键面贴标） */
export const OFFSET_LABELS = [
  'Z', 'S', 'X', 'D', 'C', 'V', 'G', 'B', 'H', 'N', 'J', 'M',
  ',', 'L', '.', ';', '/',
  'R', '5', 'T', '6', 'Y', '7', 'U',
  'I', '9', 'O', '0', 'P',
];

export const CODE_DISPLAY = {
  Comma: ',', Period: '.', Slash: '/', Semicolon: ';', Quote: "'",
  BracketLeft: '[', BracketRight: ']', Minus: '-', Equal: '=',
};

export function codeToLabel(code) {
  if (code in CODE_DISPLAY) return CODE_DISPLAY[code];
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  return code;
}

/** 由半音偏移反查应该贴在琴键上的标签 */
export function labelForOffset(offset) {
  return OFFSET_LABELS[offset] ?? null;
}
