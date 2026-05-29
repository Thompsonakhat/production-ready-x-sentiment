import "dotenv/config";

function safeErr(err) {
  return err?.response?.data?.error?.message ||
    err?.response?.data?.message ||
    err?.message ||
    String(err);
}

process.on("unhandledRejection", (err) => {
  console.error("[fatal] unhandledRejection", { error: safeErr(err) });
  process.exit(1);
});

process.on("uncaughtException", (err) => {
  console.error("[fatal] uncaughtException", { error: safeErr(err) });
  process.exit(1);
});

async function boot() {
  console.log("[boot] start");

  try {
    const [{ loadConfig }, { connectMongo, ensureIndexes, closeMongo }, { startBot }, logger] = await Promise.all([
      import("./lib/config.js"),
      import("./db/mongo.js"),
      import("./bot.js"),
      import("./lib/logger.js"),
    ]);

    const cfg = loadConfig();

    logger.info("config loaded", {
      platform: "x",
      COOKMYBOTS_X_ENDPOINT_set: Boolean(cfg.COOKMYBOTS_X_ENDPOINT),
      COOKMYBOTS_X_KEY_set: Boolean(cfg.COOKMYBOTS_X_KEY),
      MONGODB_URI_set: Boolean(cfg.MONGODB_URI),
      monitorKeywordsConfigured: cfg.monitorKeywords.length > 0,
      monitorAccountsConfigured: cfg.monitorAccounts.length > 0,
      dryRun: cfg.dryRun,
      postReports: cfg.postReports,
      postAlerts: cfg.postAlerts,
    });

    const missing = [];
    if (!cfg.COOKMYBOTS_X_ENDPOINT) missing.push("COOKMYBOTS_X_ENDPOINT");
    if (!cfg.COOKMYBOTS_X_KEY) missing.push("COOKMYBOTS_X_KEY");
    if (!cfg.MONGODB_URI) missing.push("MONGODB_URI");

    if (missing.length) {
      console.error("[boot] missing required environment variables", { missing });
      console.error("[boot] set the missing variables in your service configuration and restart.");
      process.exit(1);
    }

    const db = await connectMongo(cfg.MONGODB_URI);
    await ensureIndexes(db);

    const shutdown = async (signal) => {
      logger.info("shutdown requested", { signal });
      await closeMongo();
      process.exit(0);
    };

    process.once("SIGINT", () => void shutdown("SIGINT"));
    process.once("SIGTERM", () => void shutdown("SIGTERM"));

    await startBot({ cfg, db });
  } catch (err) {
    console.error("[boot] failed", { error: safeErr(err) });
    console.error("[boot] check package installation, environment variables, MongoDB access, and relative imports.");
    process.exit(1);
  }
}

await boot();
