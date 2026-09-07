/**
 * main.js — 应用入口
 */

import { PianoApp } from './app/PianoApp.js';

const canvas = document.getElementById('scene');
const app = new PianoApp(canvas);

// 暴露到全局，方便在控制台调试（例如 __piano.playDemo('canon')）
window.__piano = app;

// ---------------- 音频解锁（浏览器策略要求用户手势） ----------------
const overlay = document.getElementById('start-overlay');
let started = false;

async function start() {
  if (started) return;
  started = true;
  await app.ensureAudio();
  overlay.classList.add('hidden');
}

document.getElementById('btn-start')?.addEventListener('click', start);
overlay?.addEventListener('pointerdown', start);

// 即使用户直接敲键盘/点琴键，也照样解锁
window.addEventListener('keydown', start, { once: true });
canvas.addEventListener('pointerdown', start, { once: true });

// ---------------- 面板折叠 ----------------
const panel = document.getElementById('panel');
document.getElementById('btn-collapse')?.addEventListener('click', (e) => {
  const collapsed = panel.classList.toggle('collapsed');
  e.target.textContent = collapsed ? '+' : '—';
});

// ---------------- 安全网 ----------------
window.addEventListener('contextmenu', (e) => {
  if (e.target === canvas) e.preventDefault();
});
