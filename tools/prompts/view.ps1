# Builds pipeline/out/prompt-viewer.html from the last bulletin's saved prompts and answers (pipeline/out/ai-prompts.json
# and ai-draft.json), a page to read what each piece was sent, in sections, next to what it wrote. -Baseline takes an
# older ai-prompts.json to show how each piece's size changed. The page is one file with the data inside it.
# Usage: powershell -ExecutionPolicy Bypass -File tools\prompts\view.ps1 [-Baseline path\to\ai-prompts.json] [-NoOpen]
param(
  [string]$Baseline = '',
  [switch]$NoOpen
)
$ErrorActionPreference = 'Stop'
$root = (Resolve-Path "$PSScriptRoot\..\..").Path
$out = Join-Path $root 'pipeline\out'
$read = { param($p) if ($p -and (Test-Path $p)) { (Get-Content $p -Raw -Encoding UTF8) -replace '</', '<\/' } else { '{}' } }
$promptFile = Join-Path $out 'ai-prompts.json'
$html = Get-Content (Join-Path $PSScriptRoot 'viewer.template.html') -Raw -Encoding UTF8
# String.Replace, not -replace: the data has "$" and "\" in it.
$html = $html.Replace('__PROMPTS__', (& $read $promptFile)).Replace('__DRAFT__', (& $read (Join-Path $out 'ai-draft.json'))).Replace('__BASELINE__', (& $read $Baseline)).Replace('__WHEN__', ('Bulletin of ' + (Get-Item $promptFile).LastWriteTime.ToString('d MMM HH:mm')))
$dest = Join-Path $out 'prompt-viewer.html'
[IO.File]::WriteAllText($dest, $html, [Text.UTF8Encoding]::new($false))
Write-Host "Wrote $dest"
if (-not $NoOpen) { Start-Process $dest }
