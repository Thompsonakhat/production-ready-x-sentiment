export const SENTIMENT_VERSION = "rules-crypto-v1";

const POSITIVE = [
  "bullish",
  "moon",
  "mooning",
  "pump",
  "pumping",
  "breakout",
  "partnership",
  "listing",
  "listed",
  "strong",
  "undervalued",
  "gem",
  "accumulate",
  "accumulating",
  "support",
  "adoption",
  "growth",
  "win",
  "winning",
  "good news",
  "great",
  "excellent",
  "love",
  "solid",
  "buying",
  "bought",
];

const NEGATIVE = [
  "bearish",
  "dump",
  "dumping",
  "rug",
  "rugged",
  "scam",
  "hack",
  "hacked",
  "exploit",
  "exploited",
  "lawsuit",
  "sec",
  "fraud",
  "down bad",
  "selloff",
  "selling",
  "crash",
  "crashing",
  "dead project",
  "avoid",
  "rekt",
  "unlock dump",
  "fud",
  "bad",
  "terrible",
  "broken",
  "warning",
];

const NEGATIONS = ["not", "never", "no", "isn't", "isnt", "wasn't", "wasnt", "don't", "dont"];

function normalize(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/[^a-z0-9#$@'\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function hasNegationBefore(text, term) {
  const index = text.indexOf(term);
  if (index <= 0) return false;
  const before = text.slice(Math.max(0, index - 24), index).split(/\s+/).filter(Boolean);
  return before.some((word) => NEGATIONS.includes(word));
}

function scoreTerms(text, terms, polarity) {
  let score = 0;
  const reasons = [];

  for (const term of terms) {
    if (!text.includes(term)) continue;
    const negated = hasNegationBefore(text, term);
    const weight = term.includes(" ") ? 2 : 1;
    const delta = negated ? -weight : weight;
    score += polarity * delta;
    reasons.push(`${negated ? "negated " : ""}${term}`);
  }

  return { score, reasons };
}

export function classifySentiment(text) {
  const clean = normalize(text);
  const positive = scoreTerms(clean, POSITIVE, 1);
  const negative = scoreTerms(clean, NEGATIVE, -1);
  const score = positive.score + negative.score;

  let sentiment = "neutral";
  if (score >= 1) sentiment = "positive";
  if (score <= -1) sentiment = "negative";

  return {
    sentiment,
    score,
    reasons: [...positive.reasons.map((r) => `positive:${r}`), ...negative.reasons.map((r) => `negative:${r}`)].slice(0, 12),
    version: SENTIMENT_VERSION,
  };
}
