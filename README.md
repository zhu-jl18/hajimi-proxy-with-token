

## 中文说明（目录）

- 快速开始
- 安全与改动说明
- 部署方式
  - 使用 Netlify CLI（多账号/多站点）
  - 使用 Git 连接（多个站点连接同一仓库）
  - 迁移已有站点到本仓库或改为 CLI 部署
  - 批量增量发布脚本（tools）
- gptload 上游配置建议
- 验证与常见问答

## 快速开始

1) （推荐）设置环境变量：
	- 私有上游：`PROXY_TOKEN=<强随机>`
	- 可选：`PROXY_SHOW_INDEX=false`（隐藏首页）、`PROXY_ALLOW_IPS="203.0.113.10, 198.51.100.0/24"`
2) 直接部署（二选一）：
	- CLI：`ntl deploy --prod --dir .`（直传部署）或 `ntl deploy --prod --build`（构建型部署）
	- Git：连接本仓库/分支，保存后触发构建

### 项目来源

- 原项目仓库：https://github.com/antergone/palm-netlify-proxy
- 主要作用：在 Netlify Edge 上做一个反向代理，把对 Google PaLM/Gemini 等 API 的调用转发到 `https://generativelanguage.googleapis.com`，用于规避地域/网络等限制。

## 安全与改动说明

1) 新增“令牌鉴权”PROXY_TOKEN（强烈推荐）
	- 在 Netlify 站点的环境变量里设置 `PROXY_TOKEN` 后，所有非 OPTIONS 请求都必须携带同样的令牌，否则返回 401。
	- 支持以下携带方式（任选其一）：
	  - Header: `Authorization: Bearer <token>`
	  - Header: `X-Proxy-Token: <token>`
	  - Query: `?token=<token>`（或 `?key=<token>`、`?access_token=<token>`；仅建议调试用）
	- 代理函数不会把 `X-Proxy-Token` 转发给 Google。

2) 兼容“站点级密码保护”（可选）
	- 若你在 Netlify 启用了 Password protection，浏览器会自动携带 `Authorization: Basic ...`；我们在向 Google 转发时会移除该 Basic 头，避免干扰上游的 `Bearer`/`x-goog-api-key`。
	- 注意：站点密码只用于隐藏入口，不等于 API 鉴权；机器到机器调用仍建议使用 `PROXY_TOKEN`。

3) 可选 IP 白名单（PROXY_ALLOW_IPS）
	- 不配置则不启用；配置形如：`203.0.113.10, 198.51.100.0/24`。
	- 来访 IP 从 `x-nf-client-connection-ip`（优先）、`x-forwarded-for`、`cf-connecting-ip` 中获取。

4) 首页显示（PROXY_SHOW_INDEX）
	- 默认首页返回简短暗号 `success`（text/plain），便于健康检查但不暴露用途。
	- 如需隐藏首页，设置 `PROXY_SHOW_INDEX=false`（或 `0/off/no`）。

## 部署方式

两种常用方式：

### 使用 Netlify CLI（适合多账号、多站点快速部署）

在每个 Netlify 账号创建 Personal Access Token（PAT），然后在 PowerShell（Windows）中：

```powershell
# 进入工程目录
cd x:\Projcet\palm-netlify-proxy

# 设置当前会话使用的账号（PAT）
$env:NETLIFY_AUTH_TOKEN = "<该账号的PAT>"

# （第一次需要）安装 CLI
npm i -g netlify-cli

# 创建站点（名字需全局唯一）
ntl sites:create --name <站点名>

# 设置环境变量（私有上游建议设置令牌）
ntl env:set PROXY_TOKEN "<强随机串>"

# （可选）显示首页
# ntl env:set PROXY_SHOW_INDEX "true"

# （可选）IP 白名单
# ntl env:set PROXY_ALLOW_IPS "203.0.113.10, 198.51.100.0/24"

# 部署到生产
ntl deploy --prod --dir .
```

重复执行即可在同一账号创建多个站点；切换 `$env:NETLIFY_AUTH_TOKEN` 就能在不同账号下批量创建。

### 使用 Git 连接（多个站点连接同一仓库）

- Netlify → New site from Git → 选择 GitHub → 选择同一仓库/分支。
- 本项目无需 Build command 与 Publish directory 的特殊配置（默认即可）。
- 每个站点在 Site settings → Environment 里分别设置各自变量（例如 `PROXY_TOKEN`）。
- 可在“Build & deploy”里控制是否自动随 push 部署。

> 关于控制台里显示的 “Skipped”
>
> 在 Netlify 日志里，`Initializing/Building/Deploying/Cleanup` 显示为 `Skipped` 多见于以下情况：
> - 你使用了 `ntl deploy --prod --dir .` 进行“直传”部署（不是“构建型”部署），因此 Build 步骤被跳过；
> - 项目没有定义 Build command，或者当前这次部署无需运行构建；
> - 这些都是正常现象，不影响函数与重写规则的生效。若你需要强制触发一次“构建型”部署（例如希望后端重新拉取环境变量），可以：
>   - 控制台 → Deploys → Trigger deploy → Clear cache and deploy site；或
>   - CLI：`ntl deploy --prod --build`（在已链接对应站点的仓库目录执行）。

### 迁移已有站点到“本仓库”或改为 CLI 部署

两种选择：

1) 直接“转移站点”：老站点 → Site settings → General → Site details → Transfer site（或 Transfer to another team）。
	- 需要在目标团队/账号具备接收权限。
	- 转移后站点名、历史部署、环境变量会随站点迁移。

2) 目标账号“新建站点”再部署：
	- 在目标账号按上文 CLI 或 Git 连接方式新建站点并部署同一份源码。
	- 这种方式无需团队协作即可完成“迁移效果”。

## 批量增量发布脚本（tools）

仓库已内置：
- `tools/deploy-netlify.ps1`：创建站点 + 设置环境变量 + 首次生产部署
- `tools/redeploy.ps1`：读取 `targets.json` 批量把当前目录直传到多个站点
- `tools/targets.sample.json`：批量脚本示例参数

示例：

```powershell
# 一次创建并上线（需 PAT）
./tools/deploy-netlify.ps1 -SiteName "my-proxy-001" -ProxyToken "xxxx" -AuthToken "<PAT>"

# 批量重发（填好 targets.json 后）
./tools/redeploy.ps1 -TargetsJsonPath ./tools/targets.sample.json
```

> 若需要将 `targets.sample.json` 复制为 `targets.json` 并维护自己的站点列表，记得不要把包含私密 PAT 的真实文件提交到公共仓库。

`targets.sample.json` 字段说明：

```json
[
	{
		"Token": "<PAT>",        // 必填：该站点所属账号的 Personal Access Token
		"SiteId": "<SITE_ID>",   // 必填：站点 ID（Site settings → General）
		"Dir": ".",              // 可选：部署目录，默认 "."
		"Build": false,            // 可选：true 则使用 --build，false 用直传 --dir
		"Env": {                   // 可选：在部署前设置/覆盖的环境变量键值对
			"PROXY_TOKEN": "<token>"
		}
	}
]
```

## gptload 上游配置建议

- 指向你“私有代理站点”的上游：在自定义请求头里添加
  - `X-Proxy-Token: <你的PROXY_TOKEN>`（或 `Authorization: Bearer <token>`）
- 指向公共/他人上游：无需添加上述头；若系统全局统一加了，绝大多数上游会忽略未知头，不会报错。
- 我们的代理仅向 Google 转发白名单头（`authorization`、`x-goog-api-key` 等），不会把 `X-Proxy-Token` 继续传给 Google。

## 验证

- 未带令牌且设置了 `PROXY_TOKEN`：应返回 401。
- 正确带令牌并提供 Google 所需认证（`Authorization: Bearer ya29...` 或 `x-goog-api-key: AI...`）：应返回正常响应。

## 常见问答

Q: 一份代码能在同一账号或不同账号部署多次吗？

A: 可以。每个站点独立，互不影响。你可以让多个站点连接到同一个 Git 仓库，或用 CLI 多次创建站点并部署。

### 迁移已有站点到“本仓库”或改为 CLI 部署（教程）

你现在可能已经有很多旧站点，它们连接着“旧的 GitHub 仓库”。下面两条路线任选其一：

路线 A：把旧站点改连到“本仓库”

1) Netlify 控制台（目标旧站点）→ Site settings → Build & deploy → Continuous Deployment → Edit settings
2) 选择“Link to a different repository”（或先 Disconnect from Git，再 Connect to Git provider）
3) 选择 GitHub 仓库：`zhu-jl18/hajimi-proxy-with-token`，分支 `main`
4) 保存后，进入 Deploys → Trigger deploy → Clear cache and deploy site（建议清缓存）
5) 检查/补充环境变量：
	 - 私有上游：`PROXY_TOKEN=<强随机>`
	 - 公共上游：不设置 `PROXY_TOKEN`
	 - 可选：`PROXY_SHOW_INDEX` / `PROXY_ALLOW_IPS`

优点：不动原仓库历史，切一次即可，后续只维护本仓库。

路线 B：保持旧站点连接“旧仓库”，但把“本仓库代码”同步过去

方式 B1（推荐，安全）：创建 PR 合并

```powershell
# 在“本仓库”的本地工作副本里
git remote add target <旧仓库URL>
git fetch target
git push target main:upgrade-netlify-proxy
```

然后到旧仓库发 PR，合并后旧站点会自动部署。若想让站点改用该新分支，可在 Site settings 里把 Branch to deploy 改为 `upgrade-netlify-proxy`。

方式 B2（一把梭，慎用）：强制覆盖旧仓库主分支

```powershell
git remote add target <旧仓库URL>
git fetch target
git push target main:main -f
```

推送后旧站点会自动构建部署；建议到 Deploys 点击“Clear cache and deploy site”再做一次干净构建。

路线 C：改为“CLI 直传”站点（不再连接 Git）

1) 控制台：Site settings → Build & deploy → Continuous Deployment → Disconnect site from Git（或关闭自动部署）
2) 在本机发版（PowerShell）：

```powershell
$env:NETLIFY_AUTH_TOKEN = "<该站点所属账号的PAT>"
cd x:\Projcet\palm-netlify-proxy

# 链接到目标站点（交互选择或用 --site 指定 ID）
ntl link

# 直传为生产部署（本项目适用）
ntl deploy --prod --dir .

# 如果希望强制“构建型部署”（拉取环境变量、跑构建）
# ntl deploy --prod --build
```

批量给多个站点“增量直传”示例（非 Git 站点或暂时想覆盖的场景）

```powershell
$targets = @(
	@{ Token="<PAT-账号A>"; SiteId="<SITE_ID_A1>" },
	@{ Token="<PAT-账号A>"; SiteId="<SITE_ID_A2>" },
	@{ Token="<PAT-账号B>"; SiteId="<SITE_ID_B1>" }
)

foreach ($t in $targets) {
	$env:NETLIFY_AUTH_TOKEN = $t.Token
	ntl deploy --prod --dir . --site $t.SiteId
	if ($LASTEXITCODE -ne 0) { throw "部署失败：$($t.SiteId)" }
}
```

提示：Site ID 可在 Site settings → General 看到，或 `ntl sites:list` 获取。

## Protect the proxy with a token

This proxy can be protected by a simple token. In Netlify, set an environment variable named `PROXY_TOKEN` (Site settings → Build & deploy → Environment → Environment variables). When it is set, every request must include the same token in one of the following places:

- HTTP header: `Authorization: Bearer <token>`
- HTTP header: `X-Proxy-Token: <token>`
- Query string: `?token=<token>` (or `?key=<token>` or `?access_token=<token>`)
- Basic auth: `Authorization: Basic base64(":" + token)`

If not provided or mismatched, the proxy returns `401 Unauthorized`.

Notes:
- If you enable Netlify "Password protection" for the site, the browser will send `Authorization: Basic ...` to the proxy. We strip that Basic header to avoid conflicting with upstream Google API auth. Site password is suitable to hide the site UI, but for machine-to-machine API calls prefer `PROXY_TOKEN`.
- CORS preflight (`OPTIONS`) requests are always allowed.

## Optional: IP allowlist

Set `PROXY_ALLOW_IPS` to a comma-separated list of IPv4 addresses or CIDR blocks, e.g.:

```
PROXY_ALLOW_IPS=203.0.113.10, 198.51.100.0/24
```

The proxy will only accept requests whose client IP matches this list. Client IP is read from `x-nf-client-connection-ip` (preferred), then `x-forwarded-for`, then `cf-connecting-ip`.

## Optional: Index page behavior

By default the index returns `success` (text/plain) for simple health checks. To hide the index page, set:

```
PROXY_SHOW_INDEX=false
```
