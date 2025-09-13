# palm-netlify-proxy

Google PaLM API proxy on Netlify Edge


## Deploy

### Deploy With Netlify

[![Deploy to Netlify](https://www.netlify.com/img/deploy/button.svg)](https://app.netlify.com/start/deploy?repository=https://github.com/antergone/palm-netlify-proxy)


## Discussion

Please Visit Simon's Blog. https://simonmy.com/posts/使用netlify反向代理google-palm-api.html

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
