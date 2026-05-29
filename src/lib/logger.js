export function safeErr(err) {
  return err?.response?.data?.error?.message ||
    err?.response?.data?.message ||
    err?.message ||
    String(err);
}

function write(level, message, meta = {}) {
  const row = {
    level,
    message,
    ts: new Date().toISOString(),
    ...meta,
  };

  const line = JSON.stringify(row);
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export function info(message, meta = {}) {
  write("info", message, meta);
}

export function warn(message, meta = {}) {
  write("warn", message, meta);
}

export function error(message, meta = {}) {
  write("error", message, meta);
}

let lastMemoryLogAt = 0;

export function memoryLog() {
  const now = Date.now();
  if (now - lastMemoryLogAt < 60_000) return;
  lastMemoryLogAt = now;

  const m = process.memoryUsage();
  info("memory", {
    rssMB: Math.round(m.rss / 1e6),
    heapUsedMB: Math.round(m.heapUsed / 1e6),
  });
}
