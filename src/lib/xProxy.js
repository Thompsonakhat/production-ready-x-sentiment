import { info, warn, error, safeErr } from "./logger.js";

function trimSlash(value) {
  let out = String(value || "");
  while (out.endsWith("/")) out = out.slice(0, -1);
  return out;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function readResponse(response) {
  const text = await response.text().catch(() => "");
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { text, json };
}

function headerValue(headers, key) {
  return headers?.[key] || headers?.[key.toLowerCase()] || headers?.[key.toUpperCase()] || null;
}

function computeBackoffMs(out, attempt) {
  const retryAfter = Number(headerValue(out.headers, "retry-after") || headerValue(out.headers, "retryAfter") || 0);
  if (out.status === 429 && Number.isFinite(retryAfter) && retryAfter > 0) {
    return Math.min(retryAfter * 1000, 15 * 60 * 1000);
  }

  const reset = Number(headerValue(out.headers, "x-rate-limit-reset") || headerValue(out.headers, "rateLimitReset") || 0);
  if (out.status === 429 && Number.isFinite(reset) && reset > 0) {
    const waitMs = Math.max((reset - Math.floor(Date.now() / 1000)) * 1000 + 2000, 60_000);
    return Math.min(waitMs, 15 * 60 * 1000);
  }

  return Math.min(1000 * Math.pow(2, attempt), 60_000) + Math.floor(Math.random() * 1000);
}

function normalizeProxyResponse(response, text, json) {
  const status = Number(json?.status || response.status || 0);
  const headers = json?.headers || Object.fromEntries(response.headers.entries());
  const ok = Boolean(response.ok && status < 400 && json?.error !== "X_GATEWAY_RATE_LIMITED" && json?.error !== "X_GATEWAY_DAILY_LIMITED");

  return {
    ok,
    status,
    data: json?.data ?? json,
    headers,
    error: json?.error || json?.message || (response.ok ? "" : text.slice(0, 300)),
    text,
  };
}

export async function xProxyRequest(cfg, { path, method = "GET", query, body, headers } = {}) {
  const endpoint = trimSlash(cfg.COOKMYBOTS_X_ENDPOINT || "");
  const key = String(cfg.COOKMYBOTS_X_KEY || "");
  const finalPath = String(path || "");
  const finalMethod = String(method || "GET").toUpperCase();

  if (!endpoint || !key) {
    return {
      ok: false,
      status: 412,
      data: null,
      headers: {},
      error: "X_PROXY_NOT_CONFIGURED",
      text: "",
    };
  }

  if (!finalPath.startsWith("/2/")) {
    return {
      ok: false,
      status: 400,
      data: null,
      headers: {},
      error: "X_PROXY_PATH_MUST_START_WITH_/2/",
      text: "",
    };
  }

  const payload = {
    path: finalPath,
    method: finalMethod,
    query: query || undefined,
    body: finalMethod === "GET" || finalMethod === "HEAD" ? undefined : body,
    headers: headers || undefined,
  };

  let lastOut = null;

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const started = Date.now();
    info("x proxy call start", {
      path: finalPath,
      method: finalMethod,
      attempt: attempt + 1,
    });

    try {
      const response = await fetch(endpoint + "/proxy", {
        method: "POST",
        headers: {
          Authorization: "Bearer " + key,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      const { text, json } = await readResponse(response);
      const out = normalizeProxyResponse(response, text, json);
      lastOut = out;

      const meta = {
        path: finalPath,
        method: finalMethod,
        status: out.status,
        ms: Date.now() - started,
        rateLimitRemaining: headerValue(out.headers, "x-rate-limit-remaining") || headerValue(out.headers, "rateLimitRemaining"),
        rateLimitReset: headerValue(out.headers, "x-rate-limit-reset") || headerValue(out.headers, "rateLimitReset"),
        retryAfter: headerValue(out.headers, "retry-after") || headerValue(out.headers, "retryAfter"),
      };

      if (out.ok) {
        info("x proxy call success", meta);
        return out;
      }

      warn("x proxy call failure", {
        ...meta,
        error: out.error,
        bodySnippet: String(out.text || "").slice(0, 300),
      });

      const limited = out.status === 402 || out.status === 429 || out.error === "X_GATEWAY_RATE_LIMITED" || out.error === "X_GATEWAY_DAILY_LIMITED";
      const transient = limited || out.status >= 500 || out.status === 408;

      if (!transient || attempt === 3) return out;

      const waitMs = computeBackoffMs(out, attempt + 1);
      warn("x proxy backoff", {
        path: finalPath,
        method: finalMethod,
        status: out.status,
        waitMs,
      });
      await sleep(waitMs);
    } catch (err) {
      error("x proxy call exception", {
        path: finalPath,
        method: finalMethod,
        attempt: attempt + 1,
        error: safeErr(err),
      });

      if (attempt === 3) {
        return {
          ok: false,
          status: 0,
          data: null,
          headers: {},
          error: safeErr(err),
          text: "",
        };
      }

      await sleep(computeBackoffMs(lastOut || { status: 0, headers: {} }, attempt + 1));
    }
  }

  return lastOut || {
    ok: false,
    status: 0,
    data: null,
    headers: {},
    error: "X_PROXY_UNKNOWN_FAILURE",
    text: "",
  };
}

export function healthCheck(cfg) {
  return xProxyRequest(cfg, {
    path: "/2/users/me",
    method: "GET",
  });
}

export function searchRecent(cfg, query) {
  return xProxyRequest(cfg, {
    path: "/2/tweets/search/recent",
    method: "GET",
    query,
  });
}

export function createPost(cfg, text) {
  return xProxyRequest(cfg, {
    path: "/2/tweets",
    method: "POST",
    body: { text },
  });
}
