# Changelog

All notable changes to this bot project are recorded here.

## 2026-05-29 22:39:36. UTC
- Request: Build an X bot that monitors sentiment for a crypto project: - Monitor keywords/hashtags + specific accounts. - Compute simple sentiment buckets (positive/neutral/negative) and track changes over time. - Post periodic r…
- Summary: Built Sentiment Sentinel as a single-process X bot with CookMyBots X Proxy access, MongoDB checkpoints/dedupe/trends, local sentiment scoring, scheduled reports, spike alerts, dry-run safety, and no AI integrations.
- Files: .cookmybots/manifest.json, .env.sample, DOCS.md, package.json, src/bot.js, src/db/mongo.js, src/db/repositories.js, src/handlers/onMention.js, src/handlers/onSearchHit.js, src/index.js, src/lib/ai.js, src/lib/config.js, src/lib/db.js, src/lib/logger.js (+12 m…

