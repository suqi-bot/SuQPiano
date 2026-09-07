/**
 * MidiFile — 零依赖的 Standard MIDI File(SMF) 解析器
 *
 * 只做"读谱"这一件事：把 .mid 的 ArrayBuffer 解析成与本项目示范曲 / 录音
 * 完全一致的事件格式 { t, d, m, v }（单位：秒），外加踏板事件，供上层用
 * AudioContext 时钟调度、驱动 3D 琴键联动。
 *
 * 支持：Format 0/1/2、running status、可变长度(VLQ)、Meta(setTempo / trackName /
 * EOT)、通道 Note On/Off、Control Change(64 延音 / 66 持音 / 67 柔音)。
 * 时间轴：按 tempo map 把 tick 精确换算为秒（含中途变速），SMPTE 分度亦支持。
 */

const DEFAULT_USQ = 500000;               // 120 BPM（微秒 / 四分音符）

/** 解析 MIDI 文件，返回 { format, numTracks, ppq, bpm, tracks, notes, pedals, duration, defaultTrack } */
export function parseMidi(buffer) {
  const u8 = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  let p = 0;

  const u8r = () => u8[p++];
  const u16 = () => { const v = (u8[p] << 8) | u8[p + 1]; p += 2; return v; };
  const u32 = () => { const v = ((u8[p] << 24) | (u8[p + 1] << 16) | (u8[p + 2] << 8) | u8[p + 3]) >>> 0; p += 4; return v; };
  const tag = (n) => { let s = ''; for (let i = 0; i < n; i++) s += String.fromCharCode(u8[p++]); return s; };
  const vlq = () => { let v = 0, b; do { b = u8[p++]; v = (v << 7) | (b & 0x7f); } while (b & 0x80); return v >>> 0; };

  if (tag(4) !== 'MThd') throw new Error('不是有效的 MIDI 文件（缺少 MThd 头）');
  p += 4;                                 // 跳过 header 数据长度（固定 6）
  const format = u16();
  const numTracks = u16();
  const division = u16();

  // 分度：PPQ（每四分音符 tick 数）或 SMPTE 帧 / 秒
  let ppq = null, smpteSecPerTick = null;
  if (division & 0x8000) {
    let hi = (division >> 8) & 0xff; if (hi & 0x80) hi -= 256;
    const fps = (-hi) || 30; const tpf = division & 0xff;
    smpteSecPerTick = 1 / (fps * tpf);
  } else {
    ppq = division || 480;
  }

  const tempoEvents = [];                 // 全局 { tick, uspq }
  const rawTracks = [];                   // 每轨 { name, notes[], pedals[] }

  for (let t = 0; t < numTracks; t++) {
    if (tag(4) !== 'MTrk') break;         // 结构异常则停止读取后续轨
    const len = u32();
    const bound = p + len;                // 严格对齐轨道边界，容错多余 / 缺失字节
    rawTracks.push(readTrack(bound));
    p = bound;
  }

  /** 读取一条轨道的事件（p 由外层推进到 bound） */
  function readTrack(bound) {
    const notes = [];                     // { onTick, offTick, midi, vel, ch }
    const pedals = [];                    // { tick, index, down, ch }
    const open = new Map();               // midi -> { tick, vel, ch }
    let name = '', running = -1, tick = 0, lastTick = 0;

    while (p < bound) {
      tick += vlq();
      let st = u8[p];
      if (st < 0x80) {                     // running status 延续：当前字节即首帧数据，不跳过
        if (running < 0) break;
        st = running;
      } else {
        p++;
        if (st < 0xf0) running = st;       // 仅通道消息可作为 running status
      }

      if (st >= 0x80 && st < 0xf0) {       // ---- 通道消息 ----
        const type = st & 0xf0, ch = st & 0x0f;
        const d1 = u8r();
        const d2 = (type === 0xc0 || type === 0xd0) ? 0 : u8r();   // Program / 通道压感只有 1 帧
        if (type === 0x90 && d2 > 0) {     // Note On（力度 > 0）
          const prev = open.get(d1);
          if (prev) notes.push({ onTick: prev.tick, offTick: tick, midi: d1, vel: prev.vel, ch: prev.ch });
          open.set(d1, { tick, vel: d2, ch });
        } else if (type === 0x80 || (type === 0x90 && d2 === 0)) {  // Note Off / 力度 0 视作 Off
          const on = open.get(d1);
          if (on) { notes.push({ onTick: on.tick, offTick: Math.max(tick, on.tick + 1), midi: d1, vel: on.vel, ch: on.ch }); open.delete(d1); }
        } else if (type === 0xb0) {        // Control Change：踏板
          if (d1 === 64 || d1 === 66 || d1 === 67) {
            const index = d1 === 64 ? 0 : d1 === 66 ? 1 : 2;        // 0 延音 / 1 持音 / 2 柔音
            pedals.push({ tick, index, down: d2 >= 64, ch });
          }
        }
        // 0xa0 复音压感 / 0xc0  Program / 0xd0 通道压感 / 0xe0 弯音：忽略
      } else if (st === 0xff) {            // ---- Meta ----
        const mtype = u8r();
        const mlen = vlq();
        const data = u8.subarray(p, p + mlen);
        p += mlen;
        if (mtype === 0x51) {              // set tempo（微秒 / 四分音符）
          tempoEvents.push({ tick, uspq: (data[0] << 16) | (data[1] << 8) | data[2] });
        } else if (mtype === 0x03) {       // track name
          name = decodeText(data);
        }
      } else if (st === 0xf0 || st === 0xf7) {   // SysEx：按长度跳过
        p += vlq();
      }
      lastTick = tick;
    }
    // 轨道结束仍有未抬起的音：补到轨道末尾，避免悬挂
    for (const [midi, on] of open) {
      notes.push({ onTick: on.tick, offTick: Math.max(lastTick, on.tick + 1), midi, vel: on.vel, ch: on.ch });
    }
    return { name, notes, pedals };
  }

  // ---- tempo map：tick → 秒 ----
  const tickToSec = smpteSecPerTick
    ? (tick) => tick * smpteSecPerTick
    : buildTickToSec();

  function buildTickToSec() {
    const evs = tempoEvents.slice().sort((a, b) => a.tick - b.tick);
    if (!evs.length || evs[0].tick > 0) evs.unshift({ tick: 0, uspq: DEFAULT_USQ });
    const segs = [{ fromTick: 0, fromSec: 0, secPerTick: (DEFAULT_USQ / 1e6) / ppq }];
    let prevTick = 0, prevSecPerTick = (DEFAULT_USQ / 1e6) / ppq, accSec = 0;
    for (const e of evs) {
      if (e.tick < prevTick) continue;
      accSec += (e.tick - prevTick) * prevSecPerTick;
      const secPerTick = (e.uspq / 1e6) / ppq;
      segs.push({ fromTick: e.tick, fromSec: accSec, secPerTick });
      prevTick = e.tick; prevSecPerTick = secPerTick;
    }
    return (tick) => {
      let lo = 0, hi = segs.length - 1, idx = 0;
      while (lo <= hi) { const mid = (lo + hi) >> 1; if (segs[mid].fromTick <= tick) { idx = mid; lo = mid + 1; } else hi = mid - 1; }
      const s = segs[idx];
      return s.fromSec + (tick - s.fromTick) * s.secPerTick;
    };
  }

  // ---- 展平所有轨道为秒制事件（格式与示范曲 / 录音一致）----
  const notes = [];
  const pedals = [];
  const tracks = rawTracks.map((tr, ti) => {
    let melodic = 0;
    for (const n of tr.notes) {
      const on = tickToSec(n.onTick);
      const off = tickToSec(n.offTick);
      notes.push({
        t: on,
        d: Math.max(0.04, off - on),
        m: n.midi,
        v: Math.max(0.05, Math.min(1, n.vel / 127)),
        track: ti,
        ch: n.ch,
      });
      if (n.ch !== 9) melodic++;           // 通道 10（0 基的 9）通常是打击乐
    }
    for (const pd of tr.pedals) pedals.push({ t: tickToSec(pd.tick), index: pd.index, down: pd.down, track: ti });
    return { name: tr.name, noteCount: melodic, drum: melodic === 0 };
  });

  notes.sort((a, b) => a.t - b.t);
  pedals.sort((a, b) => a.t - b.t);

  const duration = notes.length ? notes.reduce((m, n) => Math.max(m, n.t + n.d), 0) : 0;
  let defaultTrack = 0, best = -1;
  tracks.forEach((tr, i) => { if (tr.noteCount > best) { best = tr.noteCount; defaultTrack = i; } });

  const bpm = tempoEvents.length
    ? Math.round(60e6 / tempoEvents.slice().sort((a, b) => a.tick - b.tick)[0].uspq)
    : 120;

  return { format, numTracks, ppq, smpte: !!smpteSecPerTick, bpm, tracks, notes, pedals, duration, defaultTrack };
}

function decodeText(bytes) {
  let s;
  try { s = new TextDecoder('utf-8').decode(bytes); }
  catch { s = String.fromCharCode.apply(null, bytes); }
  return s.replace(/\u0000+/g, '').replace(/[\r\n]+/g, ' ').trim();
}

/** 秒数 → "m:ss" */
export function formatSeconds(sec) {
  sec = Math.max(0, Math.floor(sec || 0));
  const m = Math.floor(sec / 60);
  return m + ':' + String(sec % 60).padStart(2, '0');
}
