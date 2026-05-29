import { info, warn, error, memoryLog, safeErr } from "./lib/logger.js";
import { healthCheck } from "./lib/xProxy.js";
import { runPollCycle } from "./services/poller.js";
import { runReportIfDue } from "./services/reports.js";
import { runAlertCheck } from "./services/alerts.js";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function jitter(ms) {
  return ms + Math.floor(Math.random() * 1000);
}

export async function startBot({ cfg, db }) {
  info("bot startup", {
    platform: "x",
    purpose: "Monitor X sentiment for a crypto project using local rules and MongoDB persistence.",
  });

  const health = await healthCheck(cfg);
  if (!health.ok) {
    error("x proxy health check failed", {
      status: health.status,
      message: health.error,
    });
    throw new Error("CookMyBots X Proxy health check failed. Confirm Connect X and required env vars.");
  }

  info("x proxy health check ok", {
    status: health.status,
  });

  info("polling started", {
    intervalSeconds: cfg.pollIntervalSeconds,
    reportIntervalHours: cfg.reportIntervalHours,
    spikeWindowMinutes: cfg.spikeWindowMinutes,
  });

  let backoffMs = 0;
  let cycle = 0;

  while (true) {
    cycle += 1;
    const started = Date.now();

    try {
      info("polling cycle run", { cycle });

      await runPollCycle({ cfg, db });
      await runAlertCheck({ cfg, db });
      await runReportIfDue({ cfg, db });

      backoffMs = 0;
    } catch (err) {
      error("polling cycle failure", {
        cycle,
        error: safeErr(err),
      });

      backoffMs = backoffMs ? Math.min(backoffMs * 2, 15 * 60 * 1000) : 30 * 1000;
    } finally {
      info("polling cycle complete", {
        cycle,
        ms: Date.now() - started,
      });

      memoryLog();
    }

    const delayMs = jitter(Math.max(cfg.pollIntervalSeconds * 1000, backoffMs));
    await sleep(delayMs);
  }
}
