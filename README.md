# palm-netlify-proxy

Google PaLM API proxy on Netlify Edge


## Deploy

### Deploy With Netlify

[![Deploy to Netlify](https://www.netlify.com/img/deploy/button.svg)](https://app.netlify.com/start/deploy?repository=https://github.com/antergone/palm-netlify-proxy)


## Discussion

Please Visit Simon's Blog. https://simonmy.com/posts/使用netlify反向代理google-palm-api.html

---

## 中文说明

### 项目来源

- 原项目仓库：https://github.com/antergone/palm-netlify-proxy
- 主要作用：在 Netlify Edge 上做一个反向代理，把对 Google PaLM/Gemini 等 API 的调用转发到 `https://generativelanguage.googleapis.com`，用于规避地域/网络等限制。

### 本仓库的改动（安全与可运维性）

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

4) 首页显示开关（PROXY_SHOW_INDEX）
	- 默认隐藏首页说明；若需显示，设置 `PROXY_SHOW_INDEX=true`。

### 部署方案（推荐 CLI；也支持 Git 连接）

两种常用方式：

1) Netlify CLI（适合多账号、多站点快速部署）

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

2) Git 连接（多个站点连接同一个仓库）

- Netlify → New site from Git → 选择 GitHub → 选择同一仓库/分支。
- 本项目无需 Build command 与 Publish directory 的特殊配置（默认即可）。
- 每个站点在 Site settings → Environment 里分别设置各自变量（例如 `PROXY_TOKEN`）。
- 可在“Build & deploy”里控制是否自动随 push 部署。

### 迁移已有老站点（无令牌、作为公共上游）

两种选择：

1) 直接“转移站点”：老站点 → Site settings → General → Site details → Transfer site（或 Transfer to another team）。
	- 需要在目标团队/账号具备接收权限。
	- 转移后站点名、历史部署、环境变量会随站点迁移。

2) 目标账号“新建站点”再部署：
	- 在目标账号按上文 CLI 或 Git 连接方式新建站点并部署同一份源码。
	- 这种方式无需团队协作即可完成“迁移效果”。

### gptload 上游配置建议

- 指向你“私有代理站点”的上游：在自定义请求头里添加
  - `X-Proxy-Token: <你的PROXY_TOKEN>`（或 `Authorization: Bearer <token>`）
- 指向公共/他人上游：无需添加上述头；若系统全局统一加了，绝大多数上游会忽略未知头，不会报错。
- 我们的代理仅向 Google 转发白名单头（`authorization`、`x-goog-api-key` 等），不会把 `X-Proxy-Token` 继续传给 Google。

### 验证

- 未带令牌且设置了 `PROXY_TOKEN`：应返回 401。
- 正确带令牌并提供 Google 所需认证（`Authorization: Bearer ya29...` 或 `x-goog-api-key: AI...`）：应返回正常响应。

### 常见问答

Q: 一份代码能在同一账号或不同账号部署多次吗？

A: 可以。每个站点独立，互不影响。你可以让多个站点连接到同一个 Git 仓库，或用 CLI 多次创建站点并部署。

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

## Optional: Hide the index page

By default the index page is hidden. To show it, set:

```
PROXY_SHOW_INDEX=true
```
