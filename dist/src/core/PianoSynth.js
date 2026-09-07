/**
 * PianoSynth — 基于 Web Audio API 的物理建模式钢琴合成器
 *
 * 音色方案（不依赖任何外部采样文件，纯合成）：
 *   1. 加性合成：每个音由 1~6 个分音(partial)组成，分音频率带「非谐性」(inharmonicity)
 *      修正 f_n = n·f0·sqrt(1 + B·n²)，真实钢琴琴弦的刚度会让高次分音偏高。
 *   2. 同音弦组(unison)：中高音区每个分音用 2~3 根相差 ±0.7 音分的弦叠加，产生自然的拍频(beating)。
 *   3. 亮度随力度变化：力度越大，高次分音越丰富（真实钢琴的核心表现力来源）。
 *   4. 槌击噪声：短促带通白噪声模拟榔头触弦的"击弦音"。
 *   5. 滤波器包络：每个音一个 lowpass，起振瞬间打开、随后快速收拢模拟音头→余韵。
 *   6. 制音噪声：松键时一小段低通噪声模拟制音呢回落。
 *   7. 卷积混响：算法生成的 IR，模拟琴体与厅堂空间感。
 */

import { midiToFreq } from './NoteUtils.js';
import { createImpulseResponse, createNoiseBuffer } from './Reverb.js';

const MAX_VOICES = 44;

export class PianoSynth {
  constructor() {
    this.ctx = null;
    this.ready = false;
    this.voices = [];            // 正在发声的 voice
    this.pendingRelease = [];    // 踏板踩下时挂起待释放的 voice
    this.pedalDown = false;
    this.sostenutoDown = false;
    this.softDown = false;
    this._masterVolume = 0.75;
    this._reverbAmount = 0.32;
  }

  /** 必须在用户手势中调用（浏览器自动播放策略） */
  async init() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') await this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    const ctx = new AC({ latencyHint: 'interactive' });
    this.ctx = ctx;

    // ---------- 总线 ----------
    this.master = ctx.createGain();
    this.master.gain.value = this._masterVolume;

    this.comp = ctx.createDynamicsCompressor();
    this.comp.threshold.value = -16;
    this.comp.knee.value = 14;
    this.comp.ratio.value = 3.5;
    this.comp.attack.value = 0.003;
    this.comp.release.value = 0.28;

    // 温和高切，削掉合成器常见的"毛刺感"
    this.tone = ctx.createBiquadFilter();
    this.tone.type = 'highshelf';
    this.tone.frequency.value = 6500;
    this.tone.gain.value = -2.5;

    this.dry = ctx.createGain();
    this.wetSend = ctx.createGain();
    this.convolver = ctx.createConvolver();
    this.convolver.buffer = createImpulseResponse(ctx, 2.8, 2.6, 0.35);
    this.wet = ctx.createGain();

    this.dry.connect(this.tone);
    this.wetSend.connect(this.convolver);
    this.convolver.connect(this.wet);
    this.wet.connect(this.tone);
    this.tone.connect(this.master);
    this.master.connect(this.comp);
    this.comp.connect(ctx.destination);

    this.noiseBuffer = createNoiseBuffer(ctx, 1.0);
    this.setReverb(this._reverbAmount);

    this.ready = true;
    if (ctx.state === 'suspended') await ctx.resume();
    return ctx;
  }

  setMasterVolume(v) {
    this._masterVolume = v;
    if (this.master) this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.02);
  }

  setReverb(amount) {
    this._reverbAmount = amount;
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    // 等功率分配，保证干湿比例变化时响度大致恒定
    this.dry.gain.setTargetAtTime(Math.cos(amount * Math.PI * 0.5), t, 0.05);
    this.wet.gain.setTargetAtTime(Math.sin(amount * Math.PI * 0.5) * 0.9, t, 0.05);
  }

  _pedalSound(index, down) {
    if (!this.ready) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const freq = index === 2 ? 210 : (index === 1 ? 145 : 105);
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(freq * (down ? 1 : 0.82), now);
    osc.frequency.exponentialRampToValueAtTime(freq * 0.58, now + 0.07);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.linearRampToValueAtTime(0.018, now + 0.003);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.085);
    osc.connect(gain); gain.connect(this.dry);
    osc.start(now); osc.stop(now + 0.10);

    const n = ctx.createBufferSource();
    const ng = ctx.createGain();
    n.buffer = this.noiseBuffer;
    ng.gain.setValueAtTime(0.012, now);
    ng.gain.exponentialRampToValueAtTime(0.0001, now + 0.045);
    n.connect(ng); ng.connect(this.dry);
    n.start(now); n.stop(now + 0.06);
  }

  /** 输出延迟（ms），用于 HUD 显示音画同步状态 */
  getLatencyMs() {
    if (!this.ctx) return 0;
    const base = (this.ctx.baseLatency || 0) * 1000;
    const out = (this.ctx.outputLatency || 0) * 1000;
    return base + out;
  }

  get activeVoiceCount() { return this.voices.length; }

  // ------------------------------------------------------------------
  //  发音 / 止音
  // ------------------------------------------------------------------
  /** @param {number} [when] 可选的绝对发声时刻（AudioContext 时钟），用于示范曲精确调度 */
  noteOn(midi, velocity = 0.8, when) {
    if (!this.ready) return null;
    const ctx = this.ctx;
    const t0 = Math.max(ctx.currentTime, when ?? ctx.currentTime);
    const vel = Math.max(0.03, Math.min(1, velocity));
    const expressiveVel = this.softDown ? vel * 0.68 : vel;

    // 同音重击：先快速制音旧 voice（真实钢琴的行为）
    for (let i = this.voices.length - 1; i >= 0; i--) {
      const v = this.voices[i];
      if (v.midi === midi && !v.released) this._releaseVoice(v, 0.03);
    }
    this._enforcePolyphony();

    const f0 = midiToFreq(midi);
    // 非谐性系数：低音 ~0.0001，高音 ~0.0018
    const x = Math.max(0, Math.min(1, (midi - 21) / 87));
    const B = 0.00008 + x * x * 0.0018;
    // 基频衰减时间：低音 26s，高音 ~1.7s
    const decay = 26 * Math.pow(2, -(midi - 21) / 22);
    const bright = Math.pow(expressiveVel, 1.25) * (this.softDown ? 0.72 : 1);

    // ---------- voice 输出链 ----------
    const out = ctx.createGain();
    out.gain.value = 1;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.Q.value = 0.6;
    const openHz = Math.min(17000, f0 * 10 + 600 + bright * 5200);
    const restHz = Math.min(17000, f0 * 5 + 400 + bright * 1200);
    filter.frequency.setValueAtTime(openHz, t0);
    filter.frequency.exponentialRampToValueAtTime(Math.max(220, restHz), t0 + 0.35);
    filter.connect(out);
    out.connect(this.dry);
    out.connect(this.wetSend);

    // ---------- 分音 ----------
    const baseAmp = 0.17 * Math.pow(expressiveVel, 1.35) * (1 + (1 - x) * 0.55);
    const partialGains = [
      1,
      0.52 * bright,
      0.30 * bright * bright,
      0.16 * Math.pow(bright, 2.6),
      0.085 * Math.pow(bright, 3.2),
      0.045 * Math.pow(bright, 3.8),
    ];
    const unison = midi < 36 ? 2 : 3;
    const unisonCents = midi < 36 ? 0.55 : 0.85;

    const now = t0;
    const attack = 0.002 + (1 - expressiveVel) * 0.004;
    let longest = 0;

    for (let n = 1; n <= partialGains.length; n++) {
      const fn = f0 * n * Math.sqrt(1 + B * n * n);
      if (fn > 17500) break;                       // 超出听觉/采样上限则丢弃
      const amp = baseAmp * partialGains[n - 1];
      if (amp < 0.00008) continue;
      const pDecay = decay / (1 + 0.62 * (n - 1)); // 高次分音衰减更快
      longest = Math.max(longest, pDecay);

      const copies = n <= 2 ? unison : 1;
      for (let u = 0; u < copies; u++) {
        const osc = ctx.createOscillator();
        osc.type = 'sine';
        osc.frequency.value = fn;
        const det = copies === 1 ? 0 : (u - (copies - 1) / 2) * (unisonCents * 2 / Math.max(1, copies - 1));
        osc.detune.value = det + (Math.random() - 0.5) * 0.4;

        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, now);
        g.gain.linearRampToValueAtTime(amp / copies, now + attack);
        g.gain.exponentialRampToValueAtTime(Math.max(0.00002, amp / copies * 0.0008), now + attack + pDecay);

        osc.connect(g);
        g.connect(filter);
        osc.start(now);
        osc.stop(now + attack + pDecay + 0.05);
      }
    }

    // ---------- 槌击噪声 ----------
    const hammer = ctx.createBufferSource();
    hammer.buffer = this.noiseBuffer;
    hammer.loop = true;
    const hbp = ctx.createBiquadFilter();
    hbp.type = 'bandpass';
    hbp.frequency.value = Math.min(9000, f0 * 3.2 + 300);
    hbp.Q.value = 0.9;
    const hg = ctx.createGain();
    const hAmp = 0.055 * Math.pow(vel, 1.6);
    hg.gain.setValueAtTime(0.0001, now);
    hg.gain.linearRampToValueAtTime(hAmp, now + 0.0015);
    hg.gain.exponentialRampToValueAtTime(0.0001, now + 0.075);
    hammer.connect(hbp); hbp.connect(hg); hg.connect(out);
    hammer.start(now);
    hammer.stop(now + 0.12);

    const voice = {
      midi, out, filter, t0, decay: longest, released: false,
      pending: false, sostenutoLatched: false,
      releaseAt: Infinity, killer: null,
    };

    // 自动回收：自然衰减结束后断开节点
    const lifeMs = (attack + longest + 0.4) * 1000;
    voice.killer = setTimeout(() => this._disposeVoice(voice), lifeMs);

    this.voices.push(voice);
    return voice;
  }

  noteOff(midi, when) {
    if (!this.ready) return;
    for (let i = this.voices.length - 1; i >= 0; i--) {
      const v = this.voices[i];
      if (v.midi === midi && !v.released) {
        if (this.pedalDown || v.sostenutoLatched) {
          v.pending = true;                       // 延音或持音踏板踩下 → 延后制音
        } else {
          this._releaseVoice(v, undefined, when);
        }
      }
    }
  }

  /** 控制三块踏板：0 延音 / 1 持音 / 2 柔音。保留 setPedal(bool) 兼容旧调用。 */
  setPedal(index, down) {
    if (typeof index === 'boolean') { down = index; index = 0; }
    const next = !!down;
    const previous = index === 0 ? this.pedalDown : (index === 1 ? this.sostenutoDown : this.softDown);
    if (index === 0) this.pedalDown = next;
    else if (index === 1) {
      if (next && !this.sostenutoDown) {
        for (const v of this.voices) if (!v.released) v.sostenutoLatched = true;
      }
      this.sostenutoDown = next;
    } else if (index === 2) this.softDown = next;
    if (previous !== next) this._pedalSound(index, next);
    if (this.ready && (index === 0 || index === 1) && !down) {
      for (const v of this.voices) {
        if (!v.released && v.pending && !this.pedalDown && !v.sostenutoLatched) {
          v.pending = false; this._releaseVoice(v);
        }
        if (!v.released && index === 1) v.sostenutoLatched = false;
      }
      // 释放持音踏板后，尚未被延音踏板保护的声音立即进入制音阶段。
      if (index === 1) for (const v of this.voices) {
        if (!v.released && v.pending && !this.pedalDown) { v.pending = false; this._releaseVoice(v); }
      }
    }
  }

  allNotesOff() {
    if (!this.ready) return;
    for (const v of [...this.voices]) { v.pending = false; this._releaseVoice(v, 0.08); }
  }

  // ------------------------------------------------------------------
  _releaseVoice(voice, forcedTau, when) {
    if (voice.released) return;
    voice.released = true;
    const ctx = this.ctx;
    const now = Math.max(ctx.currentTime, when ?? ctx.currentTime);
    // 制音时间随音区变化：低音弦质量大，制音更慢
    const tau = forcedTau ?? (0.045 + Math.max(0, (108 - voice.midi) / 87) * 0.14);

    voice.out.gain.cancelScheduledValues(now);
    voice.out.gain.setValueAtTime(Math.max(0.0001, voice.out.gain.value), now);
    voice.out.gain.setTargetAtTime(0.0001, now, tau);

    // 制音呢回落噪声
    const n = ctx.createBufferSource();
    n.buffer = this.noiseBuffer;
    n.loop = true;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 2600;
    const g = ctx.createGain();
    const lvl = Math.max(0.0005, voice.out.gain.value) * 0.9;
    g.gain.setValueAtTime(Math.min(0.02, lvl), now);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.09);
    n.connect(lp); lp.connect(g); g.connect(this.dry);
    n.start(now); n.stop(now + 0.12);

    clearTimeout(voice.killer);
    voice.killer = setTimeout(() => this._disposeVoice(voice), (tau * 8 + 0.3) * 1000);
  }

  _disposeVoice(voice) {
    const i = this.voices.indexOf(voice);
    if (i >= 0) this.voices.splice(i, 1);
    clearTimeout(voice.killer);
    try { voice.out.disconnect(); voice.filter.disconnect(); } catch (e) { /* noop */ }
  }

  _enforcePolyphony() {
    while (this.voices.length >= MAX_VOICES) {
      // 优先淘汰已释放的，其次淘汰最早的
      let idx = this.voices.findIndex((v) => v.released);
      if (idx < 0) idx = 0;
      const v = this.voices[idx];
      this._releaseVoice(v, 0.05);
      this._disposeVoice(v);
    }
  }
}
