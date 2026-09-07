# build.ps1 —— 生成仅含运行所需文件的 dist/ 部署目录
# 用法：powershell -NoProfile -ExecutionPolicy Bypass -File tools/build.ps1
$ErrorActionPreference = 'Stop'

# 以脚本自身位置定位项目根目录（tools 的上一级），保证任意 cwd 下都能运行
$root = Split-Path -Parent $PSScriptRoot
$dist = Join-Path $root 'dist'

# 需要打包进 dist 的文件与目录（three.js 已本地化到 vendor，运行无需 node_modules）
$files   = @('index.html', 'README.md')
$folders = @('styles', 'src', 'vendor')

# 清理并重建 dist/
if (Test-Path $dist) { Remove-Item $dist -Recurse -Force }
New-Item -ItemType Directory -Path $dist | Out-Null

foreach ($f in $files)   { Copy-Item (Join-Path $root $f) -Destination $dist -Force }
foreach ($d in $folders) { Copy-Item (Join-Path $root $d) -Destination $dist -Recurse -Force }

Write-Host "[build] dist ready -> $dist"
