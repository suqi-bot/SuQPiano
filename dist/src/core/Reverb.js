/**
 * Reverb — 用算法生成的脉冲响应做卷积混响（无需外部 IR 音频文件）
 * 采用噪声 + 指数衰减包络 + 一阶低通平滑，模拟音乐厅的自然衰减。
 */

export function createImpulseResponse(ctx, duration = 2.8, decay = 2.6, damp = 0.35) {
  const rate = ctx.sampleRate;
  const len = Math.max(1, Math.floor(rate * duration));
  const ir = ctx.createBuffer(2, len, rate);

  for (let ch = 0; ch < 2; ch++) {
    const data = ir.getChannelData(ch);
    let lp = 0;
    for (let i = 0; i < len; i++) {
      const t = i / len;
      // 前 8ms 做淡入，避免脉冲头部的"咔哒"声
      const fadeIn = Math.min(1, i / (rate * 0.008));
      const env = Math.pow(1 - t, decay) * fadeIn;
      const noise = Math.random() * 2 - 1;
      // 一阶低通：随时间增强阻尼，高频先衰减，更接近真实厅堂
      const cutoff = 0.45 - damp * t * 0.35;
      lp += cutoff * (noise - lp);
      data[i] = lp * env;
    }
  }
  return ir;
}

/** 生成一段可复用的白噪声缓冲，用于槌击/制音器噪声 */
export function createNoiseBuffer(ctx, duration = 1.0) {
  const rate = ctx.sampleRate;
  const len = Math.floor(rate * duration);
  const buf = ctx.createBuffer(1, len, rate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  return buf;
}
