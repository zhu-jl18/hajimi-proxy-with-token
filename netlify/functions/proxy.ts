// Netlify Edge Runtime 会按约定注入 context，这里用宽松类型避免本地类型依赖问题
type Context = any;

const pickHeaders = (headers: Headers, keys: (string | RegExp)[]): Headers => {
  const picked = new Headers();
  for (const key of headers.keys()) {
    if (keys.some((k) => (typeof k === "string" ? k === key : k.test(key)))) {
      const value = headers.get(key);
      if (typeof value === "string") {
        picked.set(key, value);
      }
    }
  }
  return picked;
};

const CORS_HEADERS: Record<string, string> = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "*",
  "access-control-allow-headers": "*",
};

export default async (request: Request, context: Context) => {

  if (request.method === "OPTIONS") {
    return new Response(null, {
      headers: CORS_HEADERS,
    });
  }

  // --- Optional auth gate -------------------------------------------------
  // If you set env var PROXY_TOKEN in Netlify, every request (except CORS preflight)
  // must provide the same token via one of the following:
  // 1) Authorization: Bearer <token>
  // 2) Authorization: Basic base64(":" + <token>)
  // 3) X-Proxy-Token: <token>
  // 4) ?token=<token> as a query parameter
  const getEnv = (k: string): string | undefined => {
    // Access env in Netlify Edge safely without type errors
    const g: any = (globalThis as any);
    const fromDeno = g?.Deno?.env?.get?.(k);
    // Some runtimes may expose env via context.env
    const fromContext = (context as any)?.env?.[k];
    // Node/Classic functions: process.env（通过 globalThis 访问避免本地缺少 @types/node 的报错）
    const fromNode = g?.process?.env?.[k];
    return fromDeno ?? fromContext ?? fromNode ?? undefined;
  };

  const requiredToken = getEnv("PROXY_TOKEN");
  const allowIpsRaw = getEnv("PROXY_ALLOW_IPS"); // e.g. "1.2.3.4, 5.6.0.0/16"
  // 默认显示首页；只有当 PROXY_SHOW_INDEX 显式为 false/0/off/no 时隐藏
  const showIndex = (() => {
    const v = (getEnv("PROXY_SHOW_INDEX") || "").toLowerCase().trim();
    if (v === "") return true;
    return !["0", "false", "off", "no"].includes(v);
  })();

  // helper: get client ip from headers
  const getClientIp = (req: Request): string | undefined => {
    const h = req.headers;
    // Netlify provides x-nf-client-connection-ip
    const nfIp = h.get("x-nf-client-connection-ip");
    if (nfIp) return nfIp.split(",")[0].trim();
    const xff = h.get("x-forwarded-for");
    if (xff) return xff.split(",")[0].trim();
    // fallback: Cloudflare style cf-connecting-ip
    const cf = h.get("cf-connecting-ip");
    if (cf) return cf.split(",")[0].trim();
    return undefined;
  };

  // helper: basic IP match supports exact IP and CIDR (ipv4)
  const ipInCidr = (ip: string, cidr: string): boolean => {
    const [base, bitsStr] = cidr.split("/");
    const bits = Number(bitsStr);
    if (!base || isNaN(bits)) return false;
    const toInt = (x: string) => x.split(".").reduce((a, b) => (a << 8) + Number(b), 0) >>> 0;
    try {
      const ipInt = toInt(ip);
      const baseInt = toInt(base);
      const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
      return (ipInt & mask) === (baseInt & mask);
    } catch (_) {
      return false;
    }
  };

  const ipAllowed = (ip?: string): boolean => {
    if (!allowIpsRaw) return true; // not configured -> allow all
    if (!ip) return false;
    const allowList = allowIpsRaw.split(",").map(s => s.trim()).filter(Boolean);
    for (const rule of allowList) {
      if (rule.includes("/")) {
        if (ipInCidr(ip, rule)) return true;
      } else if (rule === ip) {
        return true;
      }
    }
    return false;
  };

  const extractToken = (req: Request): string | undefined => {
    // Header: X-Proxy-Token
    const headerToken = req.headers.get("x-proxy-token") || undefined;
    if (headerToken) return headerToken;

    // Header: Authorization: Bearer/Basic
    const auth = req.headers.get("authorization");
    if (auth) {
      const [scheme, value = ""] = auth.split(/\s+/, 2);
      if (/^bearer$/i.test(scheme)) return value;
      if (/^basic$/i.test(scheme)) {
        try {
          const decoded = atob(value);
          // Basic uses "username:password"; Netlify site password often uses empty username
          const [, password = ""] = decoded.split(":", 2);
          return password || undefined;
        } catch (_) {
          // ignore decode error
        }
      }
    }

    // Query: ?token=...
    try {
      const u = new URL(req.url);
      const qp = u.searchParams.get("token") || u.searchParams.get("key") || u.searchParams.get("access_token");
      if (qp) return qp;
    } catch (_) {
      // ignore URL parse error
    }

    return undefined;
  };

  if (requiredToken) {
    const provided = extractToken(request);
    if (!provided || provided !== requiredToken) {
      return new Response("Unauthorized", {
        status: 401,
        headers: {
          ...CORS_HEADERS,
          // Do NOT send a Basic challenge, otherwise browsers show a login popup.
          // Use a Bearer challenge instead (standards-compliant, no popup in browsers).
          "www-authenticate": 'Bearer realm="palm-proxy"',
          // Optional hint header for clients/tools
          "x-auth-required": "token",
        },
      });
    }
  }
  // ------------------------------------------------------------------------

  const { pathname, searchParams } = new URL(request.url);
  if(pathname === "/" && showIndex) {
    const body = "success";
    return new Response(body, {
      headers: {
        ...CORS_HEADERS,
        "content-type": "text/plain; charset=utf-8"
      },
    });
  }
  // IP whitelist gate (after OPTIONS and before upstream)
  const clientIp = getClientIp(request);
  if (!ipAllowed(clientIp)) {
    return new Response("Forbidden", { status: 403, headers: CORS_HEADERS });
  }

  const url = new URL(pathname, "https://generativelanguage.googleapis.com");
  searchParams.delete("_path");

  searchParams.forEach((value, key) => {
    url.searchParams.append(key, value);
  });

  const headers = pickHeaders(request.headers, ["content-type", "authorization", "x-goog-api-client", "x-goog-api-key", "accept-encoding"]);
  // 如果站点开启了 Password protection，会附带 Authorization: Basic ...
  // 为避免与上游 OAuth Bearer 冲突，这里不向上游转发 Basic 认证头。
  const incomingAuth = request.headers.get("authorization");
  if (incomingAuth && /^basic\s/i.test(incomingAuth)) {
    headers.delete("authorization");
  }

  const response = await fetch(url, {
    body: request.body,
    method: request.method,
    headers,
    // 在 Edge Runtime/Node18 中可用，但 TS DOM 类型没有该字段；用 any 断言规避
    ...( { duplex: "half" } as any )
  });

  // 合并上游响应头，但防止把 WWW-Authenticate 透传给浏览器（否则会弹出登录框）
  const rawHeaders = Object.fromEntries(response.headers);
  delete (rawHeaders as any)["www-authenticate"]; // case-insensitive 处理见下
  // Headers 对象小写化键名，确保覆盖
  const normalized: Record<string, string> = {};
  for (const [k, v] of Object.entries(rawHeaders)) {
    normalized[k.toLowerCase()] = v as any;
  }
  delete normalized["www-authenticate"]; // 保险删除

  const responseHeaders = {
    ...CORS_HEADERS,
    ...normalized,
  };

  return new Response(response.body, {
    headers: responseHeaders,
    status: response.status
  });
};
