# package.ps1 —— 先构建 dist/，再压缩成带版本号的 zip
# 用法：powershell -NoProfile -ExecutionPolicy Bypass -File tools/package.ps1
$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$dist = Join-Path $root 'dist'

# 1) 复用 build 逻辑，保证 dist/ 是最新的（内部会先清理重建）
& (Join-Path $PSScriptRoot 'build.ps1')

# 2) 读取版本号：用正则直接抽取 "version": "x.y.z"（纯 ASCII 子串）
#    避免在 npm 生命周期内嵌套调用 npm 取不到值，也规避中文编码导致的整份 JSON 解析失败
$pkgRaw  = Get-Content (Join-Path $root 'package.json') -Raw
$version = [regex]::Match($pkgRaw, '"version"\s*:\s*"([^"]+)"').Groups[1].Value
if (-not $version) { throw '无法从 package.json 读取 version' }

# 3) 打包 zip（内容置于压缩包根目录，解压即得 index.html / styles / src / vendor）
$zip = Join-Path $root ('GrandPiano-Simulator-v' + $version + '.zip')
if (Test-Path $zip) { Remove-Item $zip -Force }
Compress-Archive -Path (Join-Path $dist '*') -DestinationPath $zip -Force

Write-Host ('[package] created ' + (Split-Path -Leaf $zip))
