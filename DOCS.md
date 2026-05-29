# Sentiment Sentinel

Sentiment Sentinel is a single-process Node.js X bot that monitors public X conversation for a crypto project, classifies new posts with a local rules-based sentiment scorer, stores durable checkpoints and aggregates in MongoDB, and optionally posts periodic reports and spike alerts.

It does not use AI. It does not call OpenAI or any other AI provider. All X reads and writes go through the CookMyBots X Proxy.

## Public capabilities

### Monitoring loop
The bot polls X recent search for configured keywords, hashtags, cashtags, and posts from configured accounts.

Configuration:
- `X_MONITOR_KEYWORDS`: comma-separated terms such as `$TOKEN,#TokenName,TokenName`
- `X_MONITOR_ACCOUNTS`: comma-separated X handles without or with `@`

If both variables are blank, the service starts safely, logs that no monitor targets are configured, and skips polling work.

### Sentiment processing
Each new matching post is deduplicated in MongoDB before classification. New posts are classified locally into:
- positive
- neutral
- negative

The classifier uses simple crypto-aware keyword and phrase rules. It stores the sentiment bucket, numeric score, matched reasons, and classifier version with each processed post.

### Trend aggregation
The bot updates MongoDB trend buckets as posts are processed. It also stores processed post metadata so report and alert windows can be recomputed safely.

Collections used:
- `checkpoints`
- `processedPosts`
- `trendBuckets`
- `reports`
- `alerts`
- `runtimeState`

### Scheduled reports
Reports summarize the latest completed reporting window. The default interval is 6 hours.

Reports include:
- monitored project summary
- window length
- mention count
- positive, neutral, and negative counts
- sentiment percentages
- change versus the previous comparable window
- short interpretation

Posting controls:
- `X_POST_REPORTS=true` enables report posting
- `X_DRY_RUN=true` stores report attempts but skips publishing

### Spike alerts
The bot checks the latest completed spike window against the previous comparable window.

Alert triggers:
- mention volume rises above `X_SPIKE_VOLUME_MULTIPLIER`
- negative sentiment share reaches `X_SPIKE_NEGATIVE_SHARE_THRESHOLD`

Posting controls:
- `X_POST_ALERTS=true` enables alert posting
- `X_DRY_RUN=true` stores alert attempts but skips publishing

Alerts are deduplicated by type and window so the same spike is not posted every poll cycle.

## Environment variables

Required:
- `COOKMYBOTS_X_ENDPOINT`: CookMyBots X Gateway base endpoint. The bot posts to `{endpoint}/proxy`.
- `COOKMYBOTS_X_KEY`: secret key for CookMyBots X Gateway authorization.
- `MONGODB_URI`: MongoDB connection string for all bot state and history.

Optional with safe defaults:
- `X_MONITOR_KEYWORDS`: comma-separated keywords, hashtags, or cashtags to monitor. Default: blank.
- `X_MONITOR_ACCOUNTS`: comma-separated X handles to monitor through search queries. Default: blank.
- `X_POLL_INTERVAL_SECONDS`: polling interval. Default: `300`. Values below 300 are clamped to 300.
- `X_REPORT_INTERVAL_HOURS`: report interval. Default: `6`.
- `X_SPIKE_WINDOW_MINUTES`: spike detection window. Default: `60`.
- `X_SPIKE_VOLUME_MULTIPLIER`: volume spike multiplier. Default: `3`.
- `X_SPIKE_NEGATIVE_SHARE_THRESHOLD`: negative share threshold from 0 to 1. Default: `0.5`.
- `X_POST_REPORTS`: set `true` to publish scheduled reports. Default: `false`.
- `X_POST_ALERTS`: set `true` to publish spike alerts. Default: `false`.
- `X_DRY_RUN`: set `true` to skip publishing while still reading and storing. Default: `true`.

## Setup

1) Install dependencies:

bash
npm install


2) Copy `.env.sample` to `.env` and fill required values.

3) Configure monitoring targets:

bash
X_MONITOR_KEYWORDS=$TOKEN,#TokenName,TokenName
X_MONITOR_ACCOUNTS=officialAccount,founderAccount


4) Start locally:

bash
npm run dev


5) Start in production:

bash
npm run build
npm start


## Deployment notes

Use one Render service or one equivalent always-on Node.js service. Do not run a separate worker or queue process.

Required deployment variables:
- `COOKMYBOTS_X_ENDPOINT`
- `COOKMYBOTS_X_KEY`
- `MONGODB_URI`

Recommended first deployment:
- Keep `X_DRY_RUN=true`
- Keep `X_POST_REPORTS=false`
- Keep `X_POST_ALERTS=false`
- Confirm logs show successful polling and MongoDB writes
- Then enable posting toggles intentionally

## Operational behavior

On first startup with no checkpoint, the bot syncs the cursor to the newest available result and skips backlog processing.

Polling is cursor-based and runs in one async loop with sleep after each cycle. Poll cycles do not overlap.

X proxy calls include retry/backoff handling for transient failures and rate limits. The bot logs rate limit metadata without logging secrets.

MongoDB writes use safe update patterns. `createdAt` is insert-only and is never overwritten during updates or upserts.

## Troubleshooting

If the bot exits during startup, check that all required variables are set.

If no posts are processed, check:
- `X_MONITOR_KEYWORDS` or `X_MONITOR_ACCOUNTS` are configured
- the X query is not too narrow
- the first cycle may have skipped backlog intentionally

If reports or alerts are stored but not posted, check:
- `X_DRY_RUN`
- `X_POST_REPORTS`
- `X_POST_ALERTS`

Logs show startup env sanity as booleans only and never print secrets.
