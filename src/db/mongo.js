import { MongoClient } from "mongodb";
import { error, info, safeErr } from "../lib/logger.js";

let client = null;
let db = null;

export async function connectMongo(uri) {
  if (db) return db;

  try {
    client = new MongoClient(uri, {
      maxPoolSize: 5,
      ignoreUndefined: true,
    });

    await client.connect();
    db = client.db();

    info("mongodb connected", {
      hasDb: Boolean(db),
    });

    return db;
  } catch (err) {
    error("mongodb connection failure", {
      operation: "connect",
      collection: "n/a",
      error: safeErr(err),
    });
    throw err;
  }
}

export async function ensureIndexes(database) {
  try {
    await database.collection("checkpoints").createIndex({ stream: 1 }, { unique: true });
    await database.collection("processedPosts").createIndex({ xPostId: 1 }, { unique: true });
    await database.collection("processedPosts").createIndex({ processedAt: -1 });
    await database.collection("processedPosts").createIndex({ sentiment: 1, processedAt: -1 });
    await database.collection("trendBuckets").createIndex({ bucketStart: 1, bucketMinutes: 1, scope: 1 }, { unique: true });
    await database.collection("reports").createIndex({ periodKey: 1 }, { unique: true });
    await database.collection("alerts").createIndex({ fingerprint: 1 }, { unique: true });
    await database.collection("runtimeState").createIndex({ key: 1 }, { unique: true });

    info("mongodb indexes ensured", {
      collections: ["checkpoints", "processedPosts", "trendBuckets", "reports", "alerts", "runtimeState"],
    });
  } catch (err) {
    error("mongodb index failure", {
      operation: "ensureIndexes",
      collection: "multiple",
      error: safeErr(err),
    });
    throw err;
  }
}

export async function closeMongo() {
  if (!client) return;
  await client.close();
  client = null;
  db = null;
  info("mongodb closed");
}
