import { error, safeErr } from "../lib/logger.js";

function removeImmutable(obj) {
  const copy = { ...(obj || {}) };
  delete copy._id;
  delete copy.createdAt;
  return copy;
}

async function guarded(collection, operation, fn) {
  try {
    return await fn();
  } catch (err) {
    error("mongodb operation failure", {
      collection,
      operation,
      error: safeErr(err),
    });
    throw err;
  }
}

export async function getCheckpoint(db, stream) {
  return guarded("checkpoints", "findOne", () => db.collection("checkpoints").findOne({ stream }));
}

export async function upsertCheckpoint(db, stream, fields) {
  const mutable = removeImmutable(fields);
  return guarded("checkpoints", "updateOne", () => db.collection("checkpoints").updateOne(
    { stream },
    {
      $setOnInsert: { createdAt: new Date() },
      $set: {
        stream,
        ...mutable,
        updatedAt: new Date(),
      },
    },
    { upsert: true },
  ));
}

export async function insertProcessingPost(db, post) {
  return guarded("processedPosts", "insertOne", async () => {
    try {
      await db.collection("processedPosts").insertOne({
        ...removeImmutable(post),
        status: "processing",
        updatedAt: new Date(),
      });
      return true;
    } catch (err) {
      if (err?.code === 11000) return false;
      throw err;
    }
  });
}

export async function finalizeProcessedPost(db, xPostId, fields) {
  const mutable = removeImmutable(fields);
  return guarded("processedPosts", "updateOne", () => db.collection("processedPosts").updateOne(
    { xPostId },
    {
      $set: {
        ...mutable,
        status: "processed",
        updatedAt: new Date(),
      },
    },
  ));
}

export async function incrementTrendBucket(db, bucket) {
  const sentimentField = `${bucket.sentiment}Count`;
  return guarded("trendBuckets", "updateOne", () => db.collection("trendBuckets").updateOne(
    {
      bucketStart: bucket.bucketStart,
      bucketMinutes: bucket.bucketMinutes,
      scope: bucket.scope,
    },
    {
      $setOnInsert: {
        bucketStart: bucket.bucketStart,
        bucketMinutes: bucket.bucketMinutes,
        scope: bucket.scope,
      },
      $set: {
        updatedAt: new Date(),
      },
      $inc: {
        totalCount: 1,
        [sentimentField]: 1,
      },
    },
    { upsert: true },
  ));
}

export async function summarizePosts(db, start, end) {
  return guarded("processedPosts", "aggregate", async () => {
    const rows = await db.collection("processedPosts").aggregate([
      {
        $match: {
          status: "processed",
          processedAt: { $gte: start, $lt: end },
        },
      },
      {
        $group: {
          _id: "$sentiment",
          count: { $sum: 1 },
        },
      },
    ]).toArray();

    const summary = {
      total: 0,
      positive: 0,
      neutral: 0,
      negative: 0,
    };

    for (const row of rows) {
      const key = row._id || "neutral";
      const count = Number(row.count || 0);
      if (key === "positive") summary.positive += count;
      else if (key === "negative") summary.negative += count;
      else summary.neutral += count;
      summary.total += count;
    }

    return summary;
  });
}

export async function getRuntimeState(db, key) {
  const row = await guarded("runtimeState", "findOne", () => db.collection("runtimeState").findOne({ key }));
  return row?.value ?? null;
}

export async function setRuntimeState(db, key, value) {
  return guarded("runtimeState", "updateOne", () => db.collection("runtimeState").updateOne(
    { key },
    {
      $setOnInsert: { },
      $set: {
        key,
        value,
        updatedAt: new Date(),
      },
    },
    { upsert: true },
  ));
}

export async function upsertReportAttempt(db, periodKey, fields) {
  const mutable = removeImmutable(fields);
  return guarded("reports", "updateOne", () => db.collection("reports").updateOne(
    { periodKey },
    {
      $setOnInsert: { },
      $set: {
        periodKey,
        ...mutable,
        updatedAt: new Date(),
      },
    },
    { upsert: true },
  ));
}

export async function createAlertAttempt(db, fingerprint, fields) {
  return guarded("alerts", "insertOne", async () => {
    try {
      await db.collection("alerts").insertOne({
        fingerprint,
        ...removeImmutable(fields),
        updatedAt: new Date(),
      });
      return true;
    } catch (err) {
      if (err?.code === 11000) return false;
      throw err;
    }
  });
}

export async function updateAlertOutcome(db, fingerprint, fields) {
  const mutable = removeImmutable(fields);
  return guarded("alerts", "updateOne", () => db.collection("alerts").updateOne(
    { fingerprint },
    {
      $set: {
        ...mutable,
        updatedAt: new Date(),
      },
    },
  ));
}
