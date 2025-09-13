param(
  [Parameter(Mandatory = $true)] [string]$TargetsJsonPath
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
  $token  = $t.Token
  $siteId = $t.SiteId
  $dir    = if ($t.PSObject.Properties.Name -contains 'Dir' -and $t.Dir) { [string]$t.Dir } else { '.' }
  $build  = $false
  if ($t.PSObject.Properties.Name -contains 'Build') { $build = [bool]$t.Build }

  if (-not $token)  { throw "缺少 Token（PAT）: $($siteId)" }
  if (-not $siteId) { throw "缺少 SiteId" }

  $env:NETLIFY_AUTH_TOKEN = $token

  # 先设置环境变量（如提供）
  if ($t.PSObject.Properties.Name -contains 'Env' -and $t.Env) {
    $envEntries = $t.Env | Get-Member -MemberType NoteProperty | Select-Object -ExpandProperty Name
    foreach ($key in $envEntries) {
      $val = $t.Env.$key
      Write-Host "Setting env [$key] for site $siteId" -ForegroundColor Yellow
      ntl env:set $key "$val" --site $siteId | Out-Null
      if ($LASTEXITCODE -ne 0) { throw "设置环境变量失败：$key @ $siteId" }
    }
  }

  # 部署
  Write-Host "Deploying to site: $siteId (build=$build, dir=$dir)" -ForegroundColor Cyan
  if ($build) {
    ntl deploy --prod --build --site $siteId
  } else {
    ntl deploy --prod --dir $dir --site $siteId
  }
  if ($LASTEXITCODE -ne 0) { throw "部署失败：$siteId" }
}

Write-Host "All deployments completed." -ForegroundColor Green
