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
  const showIndex = (getEnv("PROXY_SHOW_INDEX") || "").toLowerCase() === "true";

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
          // Hint browsers/clients they can use Basic as well
          "www-authenticate": 'Basic realm="palm-proxy", charset="UTF-8"',
        },
      });
    }
  }
  // ------------------------------------------------------------------------

  const { pathname, searchParams } = new URL(request.url);
  if(pathname === "/" && showIndex) {
    let blank_html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Google PaLM API proxy on Netlify Edge</title>
</head>
<body>
  <h1 id="google-palm-api-proxy-on-netlify-edge">Google PaLM API proxy on Netlify Edge</h1>
  <p>Tips: This project uses a reverse proxy to solve problems such as location restrictions in Google APIs. </p>
  <p>If you have any of the following requirements, you may need the support of this project.</p>
  <ol>
  <li>When you see the error message &quot;User location is not supported for the API use&quot; when calling the Google PaLM API</li>
  <li>You want to customize the Google PaLM API</li>
  </ol>
  <p>For technical discussions, please visit <a href="https://simonmy.com/posts/google-palm-api-proxy-on-netlify-edge.html">https://simonmy.com/posts/google-palm-api-proxy-on-netlify-edge.html</a></p>
</body>
</html>
    `
    return new Response(blank_html, {
      headers: {
        ...CORS_HEADERS,
        "content-type": "text/html"
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

  const responseHeaders = {
    ...CORS_HEADERS,
    ...Object.fromEntries(response.headers),
  };

  return new Response(response.body, {
    headers: responseHeaders,
    status: response.status
  });
};
