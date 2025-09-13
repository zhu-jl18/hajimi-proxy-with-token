param(
  [Parameter(Mandatory = $true)] [string]$TargetsJsonPath,
  [Parameter(Mandatory = $false)] [string]$Dir = "."
)

function Ensure-Cli {
  $cli = & npm cmd ls -g netlify-cli 2>$null | Out-String
  if ($LASTEXITCODE -ne 0 -or -not ($cli -match "netlify-cli")) {
    Write-Host "Installing Netlify CLI globally..." -ForegroundColor Yellow
    npm i -g netlify-cli | Out-Null
  }
}

if (-not (Test-Path $TargetsJsonPath)) { throw "找不到目标文件：$TargetsJsonPath" }

Ensure-Cli

$targets = Get-Content $TargetsJsonPath | ConvertFrom-Json
foreach ($t in $targets) {
  $env:NETLIFY_AUTH_TOKEN = $t.Token
  Write-Host "Deploying to site: $($t.SiteId)" -ForegroundColor Cyan
  ntl deploy --prod --dir $Dir --site $t.SiteId
  if ($LASTEXITCODE -ne 0) { throw "部署失败：$($t.SiteId)" }
}

Write-Host "All deployments completed." -ForegroundColor Green
