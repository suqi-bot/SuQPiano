/**
 * serve.mjs —— 零依赖静态服务器（用于本地预览）
 *
 * 为什么需要它：package.json 里的 `npm start` 依赖 `python -m http.server`，
 * 而本机没有可用的 python。Node 已经因为构建脚本而必备，所以补一个等价实现。
 *
 * 用法：
 *   node tools/serve.mjs            # 默认 http://127.0.0.1:8123/
 *   node tools/serve.mjs 9000       # 指定端口
 *   node tools/serve.mjs 9000 dist  # 指定端口 + 指定根目录（如 dist/）
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.argv[2] || process.env.PORT || 8123);
const root = path.resolve(projectRoot, process.argv[3] || '.');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.mid': 'audio/midi',
  '.midi': 'audio/midi',
  '.woff2': 'font/woff2',
};

http.createServer((req, res) => {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  } catch {
    res.writeHead(400); res.end('bad request'); return;
  }
  if (pathname.endsWith('/')) pathname += 'index.html';

  const file = path.join(root, pathname);
  if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(`404 ${pathname}`);
    return;
  }
  res.writeHead(200, {
    'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
    'Cache-Control': 'no-cache',   // 改完源码刷新即可生效
  });
  fs.createReadStream(file).pipe(res);
}).listen(port, '127.0.0.1', () => {
  console.log(`Grand Piano Simulator → http://127.0.0.1:${port}/`);
  console.log(`root: ${root}`);
});
