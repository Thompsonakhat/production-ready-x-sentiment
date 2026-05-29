import { createAlertAttempt, updateAlertOutcome } from "../db/repositories.js";
import { info, warn } from "../lib/logger.js";
import { createPost } from "../lib/xProxy.js";
import { getSummary, percent } from "./trends.js";

function completedWindow(minutes) {
  const ms = minutes * 60 * 1000;
  const endMs = Math.floor(Date.now() / ms) * ms;
  return {
    start: new Date(endMs - ms),
    end: new Date(endMs),
    previousStart: new Date(endMs - ms * 2),
    previousEnd: new Date(endMs - ms),
    key: `${minutes}m:${new Date(endMs - ms).toISOString()}`,
  };
}

function alertText(type, cfg, current, previous) {
  if (type === "volume_spike") {
    return `Sentiment alert: volume spike over ${cfg.spikeWindowMinutes}m. Current ${current.total} mentions vs baseline ${previous.total}. Trigger ${cfg.spikeVolumeMultiplier}x. Neg share ${percent(current.negative, current.total)}%.`;
  }

  return `Sentiment alert: negative share high over ${cfg.spikeWindowMinutes}m. Current ${percent(current.negative, current.total)}% negative (${current.negative}/${current.total}) vs baseline ${percent(previous.negative, previous.total)}%. Threshold ${Math.round(cfg.spikeNegativeShareThreshold * 100)}%.`;
}

function shorten(text) {
  if (text.length <= 275) return text;
  return text.slice(0, 272).trimEnd() + "...";
}

async function handleAlert({ cfg, db, type, window, current, previous }) {
  const fingerprint = `${type}:${window.key}`;
  const text = shorten(alertText(type, cfg, current, previous));

  const created = await createAlertAttempt(db, fingerprint, {
    type,
    windowStart: window.start,
    windowEnd: window.end,
    current,
    baseline: previous,
    text,
    dryRun: cfg.dryRun,
    postingEnabled: cfg.postAlerts,
    status: "created",
  });

  if (!created) {
    info("alert duplicate skipped", {
      fingerprint,
      type,
    });
    return;
  }

  if (cfg.dryRun || !cfg.postAlerts) {
    warn("alert posting skipped", {
      fingerprint,
      dryRun: cfg.dryRun,
      postAlerts: cfg.postAlerts,
    });

    await updateAlertOutcome(db, fingerprint, {
      status: "skipped",
      skippedReason: cfg.dryRun ? "dry_run" : "posting_disabled",
      attemptedAt: new Date(),
    });
    return;
  }

  const post = await createPost(cfg, text);

  await updateAlertOutcome(db, fingerprint, {
    status: post.ok ? "posted" : "failed",
    attemptedAt: new Date(),
    xStatus: post.status,
    xResponse: post.ok ? post.data : null,
    failureReason: post.ok ? "" : post.error,
  });

  if (post.ok) {
    info("alert posted", {
      fingerprint,
      type,
      status: post.status,
    });
  } else {
    warn("alert post failed", {
      fingerprint,
      type,
      status: post.status,
      error: post.error,
    });
  }
}

export async function runAlertCheck({ cfg, db }) {
  const window = completedWindow(cfg.spikeWindowMinutes);
  const current = await getSummary(db, window.start, window.end);
  const previous = await getSummary(db, window.previousStart, window.previousEnd);

  if (current.total <= 0) return;

  const baselineVolume = Math.max(previous.total, 1);
  const volumeTrigger = current.total >= Math.max(5, baselineVolume * cfg.spikeVolumeMultiplier);
  const negativeShare = current.total ? current.negative / current.total : 0;
  const negativeTrigger = current.total >= 5 && negativeShare >= cfg.spikeNegativeShareThreshold;

  if (volumeTrigger) {
    await handleAlert({
      cfg,
      db,
      type: "volume_spike",
      window,
      current,
      previous,
    });
  }

  if (negativeTrigger) {
    await handleAlert({
      cfg,
      db,
      type: "negative_share",
      window,
      current,
      previous,
    });
  }
}
