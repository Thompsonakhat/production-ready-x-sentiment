import { getRuntimeState, setRuntimeState, upsertReportAttempt } from "../db/repositories.js";
import { info, warn } from "../lib/logger.js";
import { createPost } from "../lib/xProxy.js";
import { getSummary, percent } from "./trends.js";

function periodBounds(hours) {
  const periodMs = hours * 60 * 60 * 1000;
  const endMs = Math.floor(Date.now() / periodMs) * periodMs;
  return {
    start: new Date(endMs - periodMs),
    end: new Date(endMs),
    previousStart: new Date(endMs - periodMs * 2),
    previousEnd: new Date(endMs - periodMs),
    key: `${hours}h:${new Date(endMs - periodMs).toISOString()}`,
  };
}

function interpretation(summary) {
  if (!summary.total) return "quiet window";
  const negativePct = percent(summary.negative, summary.total);
  const positivePct = percent(summary.positive, summary.total);
  if (negativePct >= 50) return "negative risk elevated";
  if (positivePct >= 50) return "conversation leaning positive";
  return "conversation mixed";
}

function shorten(text) {
  if (text.length <= 275) return text;
  const compact = text
    .replace("Sentiment Sentinel", "Sentinel")
    .replace("mentions", "mntns")
    .replace("Change vs prior", "Vs prior")
    .replace("conversation", "talk");
  if (compact.length <= 275) return compact;
  return compact.slice(0, 272).trimEnd() + "...";
}

function formatReport({ cfg, summary, previous }) {
  const pos = percent(summary.positive, summary.total);
  const neu = percent(summary.neutral, summary.total);
  const neg = percent(summary.negative, summary.total);
  const previousNeg = percent(previous.negative, previous.total);
  const mentionDelta = summary.total - previous.total;
  const negDelta = neg - previousNeg;
  const targets = [...cfg.monitorKeywords.slice(0, 3), ...cfg.monitorAccounts.slice(0, 2).map((a) => `@${a}`)].join(", ") || "configured project";

  return shorten(
    `Sentiment Sentinel ${cfg.reportIntervalHours}h report for ${targets}: ${summary.total} mentions. Pos ${summary.positive} (${pos}%), Neu ${summary.neutral} (${neu}%), Neg ${summary.negative} (${neg}%). Change vs prior: ${mentionDelta >= 0 ? "+" : ""}${mentionDelta} mentions, neg ${negDelta >= 0 ? "+" : ""}${negDelta} pts. Read: ${interpretation(summary)}.`
  );
}

export async function runReportIfDue({ cfg, db }) {
  const bounds = periodBounds(cfg.reportIntervalHours);
  const lastKey = await getRuntimeState(db, "lastReportPeriodKey");

  if (!lastKey) {
    await setRuntimeState(db, "lastReportPeriodKey", bounds.key);
    info("report schedule initialized", {
      periodKey: bounds.key,
      posted: false,
    });
    return;
  }

  if (lastKey === bounds.key) return;

  const summary = await getSummary(db, bounds.start, bounds.end);
  const previous = await getSummary(db, bounds.previousStart, bounds.previousEnd);
  const text = formatReport({ cfg, summary, previous });

  const baseAttempt = {
    periodStart: bounds.start,
    periodEnd: bounds.end,
    text,
    summary,
    previousSummary: previous,
    dryRun: cfg.dryRun,
    postingEnabled: cfg.postReports,
    attemptedAt: new Date(),
  };

  if (cfg.dryRun || !cfg.postReports) {
    warn("report posting skipped", {
      dryRun: cfg.dryRun,
      postReports: cfg.postReports,
    });

    await upsertReportAttempt(db, bounds.key, {
      ...baseAttempt,
      status: "skipped",
      skippedReason: cfg.dryRun ? "dry_run" : "posting_disabled",
    });
    await setRuntimeState(db, "lastReportPeriodKey", bounds.key);
    return;
  }

  const post = await createPost(cfg, text);

  await upsertReportAttempt(db, bounds.key, {
    ...baseAttempt,
    status: post.ok ? "posted" : "failed",
    xStatus: post.status,
    xResponse: post.ok ? post.data : null,
    failureReason: post.ok ? "" : post.error,
  });

  if (post.ok) {
    info("report posted", {
      periodKey: bounds.key,
      status: post.status,
    });
    await setRuntimeState(db, "lastReportPeriodKey", bounds.key);
  } else {
    warn("report post failed", {
      periodKey: bounds.key,
      status: post.status,
      error: post.error,
    });
  }
}
