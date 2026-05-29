function parseList(value) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseBool(value, fallback = false) {
  const raw = String(value ?? "").trim().toLowerCase();
  if (!raw) return fallback;
  return ["1", "true", "yes", "on"].includes(raw);
}

function numberInRange(value, fallback, min, max) {
  const n = Number(value ?? fallback);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function normalizeAccounts(accounts) {
  return accounts
    .map((account) => account.replace(/^@+/, "").trim())
    .filter(Boolean);
}

export function loadConfig() {
  const monitorKeywords = parseList(process.env.X_MONITOR_KEYWORDS || "");
  const monitorAccounts = normalizeAccounts(parseList(process.env.X_MONITOR_ACCOUNTS || ""));

  return {
    COOKMYBOTS_X_ENDPOINT: process.env.COOKMYBOTS_X_ENDPOINT || "",
    COOKMYBOTS_X_KEY: process.env.COOKMYBOTS_X_KEY || "",
    MONGODB_URI: process.env.MONGODB_URI || "",

    monitorKeywords,
    monitorAccounts,

    pollIntervalSeconds: numberInRange(process.env.X_POLL_INTERVAL_SECONDS, 300, 300, 24 * 60 * 60),
    reportIntervalHours: numberInRange(process.env.X_REPORT_INTERVAL_HOURS, 6, 1, 168),
    spikeWindowMinutes: numberInRange(process.env.X_SPIKE_WINDOW_MINUTES, 60, 5, 24 * 60),
    spikeVolumeMultiplier: numberInRange(process.env.X_SPIKE_VOLUME_MULTIPLIER, 3, 1, 100),
    spikeNegativeShareThreshold: numberInRange(process.env.X_SPIKE_NEGATIVE_SHARE_THRESHOLD, 0.5, 0.01, 1),

    postReports: parseBool(process.env.X_POST_REPORTS || "false", false),
    postAlerts: parseBool(process.env.X_POST_ALERTS || "false", false),
    dryRun: parseBool(process.env.X_DRY_RUN || "true", true),
  };
}
