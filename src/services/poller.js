import { getCheckpoint, insertProcessingPost, finalizeProcessedPost, upsertCheckpoint } from "../db/repositories.js";
import { info, warn } from "../lib/logger.js";
import { searchRecent } from "../lib/xProxy.js";
import { classifySentiment } from "./sentiment.js";
import { recordPostTrend } from "./trends.js";

const STREAM = "x-monitor-search";
let active = false;

function quoteTerm(term) {
  const clean = String(term || "").trim();
  if (!clean) return "";
  if (clean.includes(" ")) return `"${clean.replace(/"/g, "")}"`;
  return clean;
}

function buildSearchQuery(cfg) {
  const keywordTerms = cfg.monitorKeywords.map(quoteTerm).filter(Boolean);
  const accountTerms = cfg.monitorAccounts.map((account) => `from:${account}`).filter(Boolean);
  const all = [...keywordTerms, ...accountTerms].slice(0, 25);

  if (!all.length) return "";
  return `(${all.join(" OR ")}) -is:retweet`;
}

function parseTweets(data) {
  return Array.isArray(data?.data) ? data.data : [];
}

function newestIdFrom(data, tweets) {
  return String(data?.meta?.newest_id || tweets?.[0]?.id || "");
}

function matchedTargets(tweet, cfg) {
  const text = String(tweet?.text || "").toLowerCase();
  const author = String(tweet?.author_id || "").toLowerCase();
  const matches = [];

  for (const keyword of cfg.monitorKeywords) {
    if (text.includes(String(keyword).toLowerCase().replace(/^#/, "#"))) matches.push(keyword);
  }

  for (const account of cfg.monitorAccounts) {
    if (author && author === String(account).toLowerCase()) matches.push(`@${account}`);
  }

  return matches;
}

export async function runPollCycle({ cfg, db }) {
  if (active) {
    warn("polling cycle skipped because another cycle is active");
    return;
  }

  active = true;

  try {
    const query = buildSearchQuery(cfg);

    if (!query) {
      warn("no monitor targets configured; skipping polling work", {
        monitorKeywordsConfigured: false,
        monitorAccountsConfigured: false,
      });
      return;
    }

    const checkpoint = await getCheckpoint(db, STREAM);
    const initialized = Boolean(checkpoint?.initialized);
    const sinceId = checkpoint?.sinceId ? String(checkpoint.sinceId) : "";
    const initializedAt = checkpoint?.initializedAt instanceof Date ? checkpoint.initializedAt : null;

    const requestQuery = {
      query,
      max_results: 10,
      "tweet.fields": "id,text,author_id,created_at,public_metrics,lang",
      sort_order: "recency",
    };

    if (initialized && sinceId) requestQuery.since_id = sinceId;
    if (initialized && !sinceId && initializedAt) requestQuery.start_time = initializedAt.toISOString();

    info("polling x search", {
      stream: STREAM,
      hasSinceId: Boolean(requestQuery.since_id),
      hasStartTime: Boolean(requestQuery.start_time),
    });

    const response = await searchRecent(cfg, requestQuery);

    if (!response.ok) {
      await upsertCheckpoint(db, STREAM, {
        initialized,
        sinceId,
        lastFailureAt: new Date(),
        lastFailureStatus: response.status,
        lastFailureError: response.error,
      });
      throw new Error(`X search failed: ${response.status} ${response.error || ""}`.trim());
    }

    const tweets = parseTweets(response.data);
    const newestId = newestIdFrom(response.data, tweets);
    const now = new Date();

    if (!initialized) {
      await upsertCheckpoint(db, STREAM, {
        initialized: true,
        initializedAt: now,
        sinceId: newestId,
        lastSuccessfulPollAt: now,
        firstSyncSkippedBacklog: true,
      });

      info("first startup checkpoint initialized; backlog skipped", {
        stream: STREAM,
        newestIdSet: Boolean(newestId),
        skippedCount: tweets.length,
      });
      return;
    }

    let processed = 0;
    let duplicates = 0;
    const items = tweets.slice().reverse();

    for (const tweet of items) {
      const xPostId = String(tweet?.id || "");
      if (!xPostId) continue;

      const processedAt = new Date();
      const inserted = await insertProcessingPost(db, {
        xPostId,
        authorId: String(tweet?.author_id || ""),
        text: String(tweet?.text || ""),
        xCreatedAt: tweet?.created_at ? new Date(tweet.created_at) : null,
        processedAt,
        matchedTargets: matchedTargets(tweet, cfg),
        publicMetrics: tweet?.public_metrics || {},
        lang: tweet?.lang || "",
      });

      if (!inserted) {
        duplicates += 1;
        continue;
      }

      const classification = classifySentiment(tweet?.text || "");

      await finalizeProcessedPost(db, xPostId, {
        sentiment: classification.sentiment,
        sentimentScore: classification.score,
        sentimentReasons: classification.reasons,
        classifierVersion: classification.version,
        processedAt,
      });

      await recordPostTrend({
        db,
        processedAt,
        sentiment: classification.sentiment,
      });

      processed += 1;
    }

    await upsertCheckpoint(db, STREAM, {
      initialized: true,
      initializedAt: initializedAt || now,
      sinceId: newestId || sinceId,
      lastSuccessfulPollAt: now,
      lastFetchedCount: tweets.length,
      lastProcessedCount: processed,
      lastDuplicateCount: duplicates,
    });

    info("polling search processed", {
      fetched: tweets.length,
      processed,
      duplicates,
      cursorUpdated: Boolean(newestId),
    });
  } finally {
    active = false;
  }
}
