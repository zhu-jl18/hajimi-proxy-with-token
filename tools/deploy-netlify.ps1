param(
  [Parameter(Mandatory = $true)] [string]$SiteName,
  [Parameter(Mandatory = $false)] [string]$ProxyToken,
  [Parameter(Mandatory = $false)] [string]$AuthToken = $env:NETLIFY_AUTH_TOKEN,
  [Parameter(Mandatory = $false)] [switch]$ShowIndex,
  [Parameter(Mandatory = $false)] [string]$AllowIps,
  [Parameter(Mandatory = $false)] [string]$Dir = "."
)

function Ensure-Cli {
  $cli = & npm cmd ls -g netlify-cli 2>$null | Out-String
  if ($LASTEXITCODE -ne 0 -or -not ($cli -match "netlify-cli")) {
    Write-Host "Installing Netlify CLI globally..." -ForegroundColor Yellow
    npm i -g netlify-cli | Out-Null
  }
}

if (-not $AuthToken) {
  Write-Error "缺少 Netlify 账号的 PAT。请通过 -AuthToken 传入，或先设置 `$env:NETLIFY_AUTH_TOKEN。"
  exit 1
}

$env:NETLIFY_AUTH_TOKEN = $AuthToken
Ensure-Cli

Write-Host "Creating site: $SiteName" -ForegroundColor Cyan
ntl sites:create --name $SiteName
if ($LASTEXITCODE -ne 0) { throw "创建站点失败" }

if ($ProxyToken) { ntl env:set PROXY_TOKEN $ProxyToken }
if ($ShowIndex) { ntl env:set PROXY_SHOW_INDEX "true" }
if ($AllowIps) { ntl env:set PROXY_ALLOW_IPS $AllowIps }

Write-Host "Deploying to production..." -ForegroundColor Cyan
ntl deploy --prod --dir $Dir
if ($LASTEXITCODE -ne 0) { throw "部署失败" }

Write-Host "Done. 站点 $SiteName 已部署完成。" -ForegroundColor Green
