// 临时：绕开 PowerShell 的 GBK 转码，原样抓取自检输出并只打印失败行。
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
let out = '';
try {
  out = execFileSync(process.execPath, ['tools/selfcheck.mjs'], { encoding: 'utf8' });
} catch (e) {
  out = e.stdout || '';
}
if (process.argv.includes('--all')) {
  writeFileSync('check.log', out, 'utf8');
  console.log('written check.log');
  process.exit(0);
}
const bad = out.split('\n').filter((l) => l.includes('\u2717'));
console.log(bad.length ? bad.join('\n') : 'NO FAILURES');
