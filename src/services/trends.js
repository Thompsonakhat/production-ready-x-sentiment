import { incrementTrendBucket, summarizePosts } from "../db/repositories.js";

const BUCKET_MINUTES = 15;

function floorDate(date, minutes) {
  const ms = minutes * 60 * 1000;
  return new Date(Math.floor(date.getTime() / ms) * ms);
}

export async function recordPostTrend({ db, processedAt, sentiment }) {
  await incrementTrendBucket(db, {
    bucketStart: floorDate(processedAt, BUCKET_MINUTES),
    bucketMinutes: BUCKET_MINUTES,
    scope: "global",
    sentiment,
  });
}

export function percent(part, total) {
  if (!total) return 0;
  return Math.round((part / total) * 100);
}

export async function getSummary(db, start, end) {
  return summarizePosts(db, start, end);
}
