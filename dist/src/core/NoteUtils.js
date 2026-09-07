/**
 * NoteUtils — 乐理 / 键位排布计算
 * 单位说明：几何尺寸使用「米」(m)，符合真实钢琴物理尺寸。
 */

export const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
export const BLACK_PC = new Set([1, 3, 6, 8, 10]);

/** 81 键电钢琴标准音域：E1 (MIDI 28) ~ C8 (MIDI 108) */
export const RANGE_81 = { start: 28, end: 108 };
/** 88 键标准钢琴音域：A0 (MIDI 21) ~ C8 (MIDI 108) */
export const RANGE_88 = { start: 21, end: 108 };

export const midiToFreq = (m) => 440 * Math.pow(2, (m - 69) / 12);
export const midiToName = (m) => NOTE_NAMES[((m % 12) + 12) % 12] + (Math.floor(m / 12) - 1);
export const isBlackKey = (m) => BLACK_PC.has(((m % 12) + 12) % 12);
export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

/**
 * 计算键盘排布（真实钢琴尺寸比例）
 * 白键宽 23.5mm，黑键宽 13.7mm，一个八度 164.5mm。
 * 黑键中心线固定偏移在其「下方白键左边缘」+ 0.85 * 白键宽 处，
 * 使黑键跨越白键交界并略微左偏 —— 与真实键盘一致。
 */
export function computeKeyLayout(startMidi, endMidi, opts = {}) {
  const whiteW = opts.whiteWidth ?? 0.0235;      // 23.5 mm
  const blackW = opts.blackWidth ?? 0.0137;      // 13.7 mm
  const whiteL = opts.whiteLength ?? 0.148;      // 148 mm
  const blackL = opts.blackLength ?? 0.096;      // 96 mm
  const gap = opts.gap ?? 0.0012;                // 键间缝隙

  const keys = [];
  const whiteLeftByMidi = new Map();
  let whiteIndex = 0;

  for (let m = startMidi; m <= endMidi; m++) {
    if (!isBlackKey(m)) {
      const left = whiteIndex * whiteW;
      whiteLeftByMidi.set(m, left);
      keys.push({
        midi: m,
        isBlack: false,
        width: whiteW - gap,
        length: whiteL,
        centerX: left + whiteW / 2,
      });
      whiteIndex++;
    } else {
      // 黑键下方相邻的白键（m-1 一定为白键）
      const lowerWhiteLeft = whiteLeftByMidi.get(m - 1) ?? 0;
      keys.push({
        midi: m,
        isBlack: true,
        width: blackW,
        length: blackL,
        centerX: lowerWhiteLeft + 0.85 * whiteW,
      });
    }
  }

  const whiteCount = whiteIndex;
  const totalWidth = whiteCount * whiteW;
  return { keys, whiteCount, totalWidth, whiteW, blackW, whiteL, blackL };
}
