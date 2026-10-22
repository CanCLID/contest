import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { OFFICIAL_THRESHOLDS, mulberry32, roundMetrics } from "../demo/games/common.mjs";
import {
  OFFICIAL_ROUNDS,
  OFFICIAL_ROUND_ORDER,
  SUBMISSION_LOG_VERSION,
  appendSubmission,
  createSubmissionLog,
  median,
  normalizeRound,
  parseSubmissionLog,
  serializeSubmissionLog,
  settleCompetition,
  simulateField,
} from "../demo/games/official.mjs";

const source = readFileSync(new URL("../demo/games/official.mjs", import.meta.url), "utf8");

// Raw round score from counters: R = (C ÷ T) × A = correctPerMinute × accuracy.
const raw = (correct, submitted, seconds) => roundMetrics({ correct, submitted, seconds }).officialScore;
const normalized = (value, middle) => Math.min(150, 100 * value / middle);

function closeTo(actual, expected, message) {
  assert.ok(Math.abs(actual - expected) < 1e-9, `${message ?? ""}（實際 ${actual}，預期 ${expected}）`);
}

function pearson(left, right) {
  const mean = values => values.reduce((sum, value) => sum + value, 0) / values.length;
  const leftMean = mean(left);
  const rightMean = mean(right);
  let covariance = 0;
  let leftSpread = 0;
  let rightSpread = 0;
  for (let index = 0; index < left.length; index++) {
    const a = left[index] - leftMean;
    const b = right[index] - rightMean;
    covariance += a * b;
    leftSpread += a * a;
    rightSpread += b * b;
  }
  return covariance / Math.sqrt(leftSpread * rightSpread);
}

const valid = { seq: 0, op: "submit", answer: "nei", clientAt: 100, itemIndex: 0 };
const fresh = () => createSubmissionLog({ roundId: "words", accountId: "acc-2" });

test("the three official rounds carry the agreed weights, thresholds and durations", () => {
  assert.deepEqual(OFFICIAL_ROUND_ORDER, ["single", "words", "passage"]);
  assert.deepEqual(Object.keys(OFFICIAL_ROUNDS), OFFICIAL_ROUND_ORDER);
  assert.deepEqual(OFFICIAL_ROUNDS.single,
    { game: "rocks", label: "單字", durationSeconds: 90, threshold: 0.9, weight: 0.3 });
  assert.deepEqual(OFFICIAL_ROUNDS.words,
    { game: "chain", label: "詞組", durationSeconds: 120, threshold: 0.9, weight: 0.3 });
  assert.deepEqual(OFFICIAL_ROUNDS.passage,
    { game: "ghost", label: "篇章", threshold: 0.85, weight: 0.4 });
  closeTo(OFFICIAL_ROUND_ORDER.reduce((sum, roundId) => sum + OFFICIAL_ROUNDS[roundId].weight, 0), 1,
    "權重合計要係 1");
  assert.equal(OFFICIAL_ROUNDS.single.threshold, OFFICIAL_THRESHOLDS.timed);
  assert.equal(OFFICIAL_ROUNDS.words.threshold, OFFICIAL_THRESHOLDS.timed);
  assert.equal(OFFICIAL_ROUNDS.passage.threshold, OFFICIAL_THRESHOLDS.passage);
});

test("a submission log round-trips through serialize and parse", () => {
  const log = createSubmissionLog({ roundId: "single", accountId: "acc-1" });
  assert.deepEqual(log, {
    version: SUBMISSION_LOG_VERSION,
    roundId: "single",
    accountId: "acc-1",
    submissions: [],
  });
  assert.equal(SUBMISSION_LOG_VERSION, 1);

  assert.equal(appendSubmission(log, valid), log, "append 要回傳同一個 log");
  appendSubmission(log, { seq: 1, op: "submit", answer: "hou", clientAt: 1400, itemIndex: 1 });
  appendSubmission(log, { seq: 2, op: "undo", answer: "", clientAt: 1900, itemIndex: 1 });
  appendSubmission(log, { seq: 3, op: "submit", answer: "hou", clientAt: 2200, itemIndex: 1 });
  assert.deepEqual(log.submissions, [
    { seq: 0, op: "submit", answer: "nei", clientAt: 100, itemIndex: 0 },
    { seq: 1, op: "submit", answer: "hou", clientAt: 1400, itemIndex: 1 },
    { seq: 2, op: "undo", answer: "", clientAt: 1900, itemIndex: 1 },
    { seq: 3, op: "submit", answer: "hou", clientAt: 2200, itemIndex: 1 },
  ]);

  const json = serializeSubmissionLog(log);
  assert.equal(typeof json, "string");
  assert.deepEqual(JSON.parse(json), {
    version: 1,
    roundId: "single",
    accountId: "acc-1",
    submissions: log.submissions,
  });
  const parsed = parseSubmissionLog(json);
  assert.deepEqual(parsed, log, "round-trip 要一模一樣");
  assert.notEqual(parsed, log, "parse 要出一個新 log");
  assert.deepEqual(parseSubmissionLog(serializeSubmissionLog(parsed)), log);
});

test("appendSubmission rejects an out-of-order seq, an illegal op or a dirty answer", () => {
  assert.throws(() => appendSubmission(null, valid), TypeError);
  assert.throws(() => appendSubmission(fresh(), undefined), TypeError);
  assert.throws(() => appendSubmission(fresh(), { ...valid, op: "skip" }), TypeError);
  assert.throws(() => appendSubmission(fresh(), { ...valid, op: "SUBMIT" }), TypeError);
  assert.throws(() => appendSubmission(fresh(), { ...valid, op: undefined }), TypeError);
  assert.throws(() => appendSubmission(fresh(), { ...valid, answer: "Nei" }), TypeError);
  assert.throws(() => appendSubmission(fresh(), { ...valid, answer: "nei1" }), TypeError);
  assert.throws(() => appendSubmission(fresh(), { ...valid, answer: "nei 5" }), TypeError);
  assert.throws(() => appendSubmission(fresh(), { ...valid, answer: "123" }), TypeError);
  assert.throws(() => appendSubmission(fresh(), { ...valid, answer: "你好" }), TypeError);
  assert.throws(() => appendSubmission(fresh(), { ...valid, answer: "" }), TypeError, "submit 一定要有答案");
  assert.throws(() => appendSubmission(fresh(), { ...valid, seq: -1 }), TypeError);
  assert.throws(() => appendSubmission(fresh(), { ...valid, seq: 1.5 }), TypeError);
  assert.throws(() => appendSubmission(fresh(), { ...valid, seq: "0" }), TypeError);
  assert.throws(() => appendSubmission(fresh(), { ...valid, clientAt: NaN }), TypeError);
  assert.throws(() => appendSubmission(fresh(), { ...valid, clientAt: -1 }), TypeError);
  assert.throws(() => appendSubmission(fresh(), { ...valid, itemIndex: -1 }), TypeError);
  assert.throws(() => appendSubmission(fresh(), { ...valid, itemIndex: 2.5 }), TypeError);
  assert.throws(() => appendSubmission(fresh(), { ...valid, itemIndex: undefined }), TypeError);

  const log = appendSubmission(fresh(), valid);
  appendSubmission(log, { ...valid, seq: 1, answer: "hou", itemIndex: 1 });
  assert.throws(() => appendSubmission(log, { ...valid, seq: 1 }), TypeError, "seq 要嚴格遞增");
  assert.throws(() => appendSubmission(log, { ...valid, seq: 0 }), TypeError);
  assert.equal(log.submissions.length, 2, "壞操作唔會入 log");

  // An undo may carry the restored answer, or nothing at all.
  const undone = appendSubmission(fresh(), { seq: 0, op: "undo", answer: "", clientAt: 10, itemIndex: 0 });
  assert.equal(undone.submissions[0].answer, "");
  assert.throws(() => appendSubmission(fresh(), { ...valid, op: "undo", answer: "N/A" }), TypeError);

  assert.throws(() => createSubmissionLog({}), TypeError);
  assert.throws(() => createSubmissionLog({ roundId: "single" }), TypeError);
  assert.throws(() => createSubmissionLog({ roundId: "", accountId: "acc-1" }), TypeError);
  assert.throws(() => createSubmissionLog({ roundId: "single", accountId: "   " }), TypeError);
});

test("parseSubmissionLog refuses a broken export and serialize refuses a tampered log", () => {
  assert.throws(() => parseSubmissionLog(42), TypeError);
  assert.throws(() => parseSubmissionLog("{"), TypeError);
  assert.throws(() => parseSubmissionLog("[]"), TypeError);
  assert.throws(() => parseSubmissionLog(JSON.stringify({
    version: 2, roundId: "single", accountId: "acc-1", submissions: [],
  })), TypeError);
  assert.throws(() => parseSubmissionLog(JSON.stringify({
    version: 1, roundId: "single", accountId: "acc-1", submissions: "nope",
  })), TypeError);
  assert.throws(() => parseSubmissionLog(JSON.stringify({
    version: 1, roundId: "single", accountId: "acc-1",
    submissions: [
      { seq: 5, op: "submit", answer: "nei", clientAt: 1, itemIndex: 0 },
      { seq: 4, op: "submit", answer: "hou", clientAt: 2, itemIndex: 1 },
    ],
  })), TypeError, "匯入時要再檢查 seq 次序");

  const log = appendSubmission(createSubmissionLog({ roundId: "single", accountId: "acc-1" }), valid);
  log.submissions[0].answer = "NEI";
  assert.throws(() => serializeSubmissionLog(log), TypeError, "匯出前要驗一次");
  assert.throws(() => serializeSubmissionLog({ roundId: "single", accountId: "acc-1", submissions: [] }), TypeError);
});

test("median averages the middle pair and reads an empty field as zero", () => {
  assert.equal(median([]), 0);
  assert.equal(median("nope"), 0);
  assert.equal(median([5]), 5);
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([1, 2, 3, 4]), 2.5);
  assert.equal(median([4, 2, 1, 3]), 2.5);
  assert.equal(median([1, NaN, 3, undefined]), 2, "非有限值要剔除");
  assert.equal(median([10, 10, 10, 10]), 10);
  const input = [3, 1, 2];
  median(input);
  assert.deepEqual(input, [3, 1, 2], "唔可以改動傳入嘅陣列");
});

test("normalizeRound scores against the field median and caps at 150", () => {
  const results = [
    { accountId: "a", correct: 45, submitted: 45, seconds: 90 },
    { accountId: "b", correct: 60, submitted: 60, seconds: 90 },
    { accountId: "c", correct: 30, submitted: 30, seconds: 90 },
    { accountId: "d", correct: 90, submitted: 90, seconds: 90 },
  ];
  const entries = normalizeRound({ results });
  assert.ok(Array.isArray(entries));
  assert.deepEqual(entries.map(entry => entry.accountId), ["a", "b", "c", "d"]);
  assert.deepEqual(entries.map(entry => entry.raw), [30, 40, 20, 60], "R = (C ÷ 1.5) × A");
  for (const entry of entries) {
    assert.equal(entry.median, 35, "四個 raw 值 20/30/40/60 嘅中位數係 35");
    assert.equal(entry.population, 4);
    assert.equal(entry.threshold, OFFICIAL_THRESHOLDS.timed);
    assert.equal(entry.belowThreshold, false);
    assert.equal(entry.excluded, false);
  }
  closeTo(entries[0].normalized, normalized(30, 35));
  closeTo(entries[1].normalized, normalized(40, 35));
  closeTo(entries[2].normalized, normalized(20, 35));
  assert.equal(entries[3].normalized, 150, "100 × 60 ÷ 35 超過封頂");

  const tighter = normalizeRound({ results, cap: 120 });
  assert.equal(tighter[3].normalized, 120);
  closeTo(tighter[0].normalized, 100 * 30 / 35);
  assert.equal(tighter[0].median, 35, "封頂唔會影響中位數");

  assert.throws(() => normalizeRound({ results: "nope" }), TypeError);
  assert.throws(() => normalizeRound({ results: [{ correct: 1, submitted: 1, seconds: 60 }] }), TypeError);
  assert.throws(() => normalizeRound({ results: [{ accountId: "a" }, { accountId: "a" }] }), TypeError);
  assert.throws(() => normalizeRound({ results: [], cap: 0 }), TypeError);
  assert.throws(() => normalizeRound({ results: [], roster: "nope" }), TypeError);
  assert.throws(() => normalizeRound({ results: [], roster: [""] }), TypeError);
});

test("normalizeRound reads accuracy from counters, ratios or percentages", () => {
  const entries = normalizeRound({
    threshold: 0.9,
    results: [
      { accountId: "counters", correct: 45, submitted: 50, seconds: 60 },
      { accountId: "percent", accuracy: 90, raw: 30 },
      { accountId: "ratio", accuracy: 0.9, raw: 30 },
      { accountId: "none", raw: 30 },
    ],
  });
  assert.deepEqual(entries.map(entry => entry.accountId), ["counters", "percent", "ratio", "none"]);
  closeTo(entries[0].accuracy, 0.9, "計數器優先");
  closeTo(entries[0].raw, 40.5);
  closeTo(entries[1].accuracy, 0.9, "engine 嘅百分比要轉返比率");
  closeTo(entries[2].accuracy, 0.9);
  assert.equal(entries[3].accuracy, 0);
  assert.deepEqual(entries.map(entry => entry.belowThreshold), [false, false, false, true]);
  assert.equal(entries[3].normalized, 0, "冇準確度就當未達門檻");
  assert.equal(entries[0].median, 30, "raw 值 40.5/30/30/30 嘅中位數係 30");
});

test("normalizeRound scores a timed round against its own T0 whatever the result carries", () => {
  // A rocks-style metrics object: no `seconds`, elapsed time instead, accuracy
  // as a percentage, no officialScore. 單字 scores against T0 = 90s, so
  // R = (45 ÷ 1.5) × 1 = 30, not (45 ÷ 60) × 60 = 45.
  const timed = normalizeRound({
    roundId: "single",
    results: [{ accountId: "rocks-metrics", correct: 45, submitted: 45, elapsedSeconds: 60, accuracy: 100 }],
  });
  closeTo(timed[0].raw, 30, "定時輪唔可以用實際用時代替 T0");
  assert.equal(timed[0].accuracy, 1);
  assert.equal(timed[0].normalized, 100);
  assert.equal(timed[0].seconds, 60, "用時照樣記錄落嚟");

  // The passage round has no T0: it scores with the finish time it is given.
  const passage = normalizeRound({
    roundId: "passage",
    results: [{ accountId: "ghost-metrics", correct: 180, submitted: 200, elapsedSeconds: 240, accuracy: 90 }],
  });
  closeTo(passage[0].raw, 40.5, "篇章 R = (180 ÷ 4) × 0.9");
  assert.equal(passage[0].threshold, 0.85);

  // An already computed R wins when there are no counters to derive one from.
  const precomputed = normalizeRound({
    roundId: "passage",
    results: [{ accountId: "raw-only", raw: 40.5, accuracy: 0.9 }],
  });
  closeTo(precomputed[0].raw, 40.5);
  closeTo(precomputed[0].normalized, 100);
  const legacy = normalizeRound({ results: [{ accountId: "old-metrics", officialScore: 40.5, accuracy: 0.9 }] });
  closeTo(legacy[0].raw, 40.5);
});

test("normalizeRound zeroes a round under the threshold and drops absentees from the median", () => {
  const results = [
    { accountId: "a", correct: 45, submitted: 50, seconds: 90 },
    { accountId: "b", correct: 60, submitted: 66, seconds: 90 },
    { accountId: "c", correct: 30, submitted: 40, seconds: 90 },
    { accountId: "d", correct: 0, submitted: 0, seconds: 90, excluded: true },
  ];
  const entries = normalizeRound({ results, roster: ["a", "b", "c", "d", "e"], roundId: "single" });
  assert.deepEqual(entries.map(entry => entry.accountId), ["a", "b", "c", "d", "e"]);
  const byId = new Map(entries.map(entry => [entry.accountId, entry]));

  assert.equal(byId.get("a").threshold, 0.9, "roundId 帶出門檻");
  assert.equal(byId.get("c").belowThreshold, true, "75% 未夠 90%");
  assert.equal(byId.get("c").excluded, false, "未達門檻仍然係出席");
  assert.equal(byId.get("c").normalized, 0);
  closeTo(byId.get("c").raw, 15, "未達門檻都照報 raw R");
  assert.equal(byId.get("d").excluded, true);
  assert.equal(byId.get("e").excluded, true, "roster 有但冇 result 就當缺席");
  assert.equal(byId.get("e").normalized, 0);
  assert.equal(byId.get("a").population, 3, "缺席嘅人要離開中位數母體");
  closeTo(byId.get("a").median, 27, "15/27/36.36… 嘅中位數");
  closeTo(byId.get("a").normalized, 100);
  closeTo(byId.get("b").normalized, normalized(raw(60, 66, 90), raw(45, 50, 90)));

  const absent = normalizeRound({ results, roster: ["a", "b", "c", "d", "e"] });
  assert.equal(absent.find(entry => entry.accountId === "e").threshold, OFFICIAL_THRESHOLDS.timed);
});

test("an empty, all-zero or all-below field settles safely", () => {
  assert.deepEqual(normalizeRound({ results: [] }), []);
  const rosterOnly = normalizeRound({ results: [], roster: ["a", "b"] });
  assert.deepEqual(rosterOnly.map(entry => entry.accountId), ["a", "b"]);
  for (const entry of rosterOnly) {
    assert.equal(entry.normalized, 0);
    assert.equal(entry.excluded, true);
    assert.equal(entry.median, 0);
    assert.equal(entry.population, 0);
  }

  const below = normalizeRound({ results: [{ accountId: "x", correct: 1, submitted: 10, seconds: 90 }] });
  assert.equal(below[0].belowThreshold, true);
  assert.equal(below[0].normalized, 0);
  assert.equal(below[0].population, 1, "未達門檻仍然計入母體");
  closeTo(below[0].median, raw(1, 10, 90));

  const zero = normalizeRound({
    results: [
      { accountId: "y", correct: 0, submitted: 0, seconds: 90 },
      { accountId: "z", correct: 0, submitted: 0, seconds: 90 },
    ],
  });
  assert.deepEqual(zero.map(entry => entry.normalized), [0, 0]);
  assert.equal(zero[0].median, 0);
  assert.equal(zero[0].population, 2);

  // A zero median with a passing field must not turn into NaN/Infinity.
  const flat = normalizeRound({
    results: [
      { accountId: "y", accuracy: 0.95, raw: 0 },
      { accountId: "z", accuracy: 0.95, raw: 0 },
    ],
  });
  assert.deepEqual(flat.map(entry => entry.normalized), [0, 0], "中位數 0 唔可以變成 NaN");
  assert.deepEqual(flat.map(entry => entry.belowThreshold), [false, false]);
  assert.ok(flat.every(entry => Number.isFinite(entry.normalized)));
});

// Five hand-built players over the three rounds. a5 misses the words and
// passage rounds entirely; a4 is present everywhere but misses the passage
// threshold. Raw scores come straight from R = (C ÷ T) × A.
const single = [
  { accountId: "a1", correct: 45, submitted: 50, seconds: 90 },
  { accountId: "a2", correct: 60, submitted: 60, seconds: 90 },
  { accountId: "a3", correct: 45, submitted: 45, seconds: 90 },
  { accountId: "a4", correct: 30, submitted: 30, seconds: 90 },
  { accountId: "a5", correct: 30, submitted: 40, seconds: 90 },
];
const words = [
  { accountId: "a1", correct: 50, submitted: 55, seconds: 120 },
  { accountId: "a2", correct: 60, submitted: 60, seconds: 120 },
  { accountId: "a3", correct: 40, submitted: 40, seconds: 120 },
  { accountId: "a4", correct: 45, submitted: 50, seconds: 120 },
];
const passage = [
  { accountId: "a1", correct: 180, submitted: 200, seconds: 240 },
  { accountId: "a2", correct: 200, submitted: 200, seconds: 200 },
  { accountId: "a3", correct: 200, submitted: 210, seconds: 300 },
  { accountId: "a4", correct: 150, submitted: 180, seconds: 250 },
];

test("settleCompetition combines three rounds by median, weight and tie-break", () => {
  const standings = settleCompetition({ single, words, passage });
  const byId = new Map(standings.map(standing => [standing.accountId, standing]));
  assert.deepEqual(standings.map(standing => standing.accountId), ["a2", "a1", "a3", "a4", "a5"]);
  assert.deepEqual(standings.map(standing => standing.rank), [1, 2, 3, 4, 5]);

  const singleRaw = {
    a1: raw(45, 50, 90), a2: raw(60, 60, 90), a3: raw(45, 45, 90), a4: raw(30, 30, 90), a5: raw(30, 40, 90),
  };
  const wordsRaw = { a1: raw(50, 55, 120), a2: raw(60, 60, 120), a3: raw(40, 40, 120), a4: raw(45, 50, 120) };
  const passageRaw = { a1: raw(180, 200, 240), a2: raw(200, 200, 200), a3: raw(200, 210, 300), a4: raw(150, 180, 250) };
  assert.deepEqual([singleRaw.a1, singleRaw.a2, singleRaw.a3, singleRaw.a4, singleRaw.a5], [27, 40, 30, 20, 15]);
  closeTo(passageRaw.a1, 40.5);

  // Medians by hand: 單字 27（五個分 15/20/27/30/40 嘅中間一個，a5 未達門檻
  // 但仍然在母體）、詞組 (20.25 + 22.727…) ÷ 2、篇章 (38.095… + 40.5) ÷ 2 —
  // 只有缺席嘅 a5 要離開詞組同篇章母體。
  const middle = {
    single: singleRaw.a1,
    words: (wordsRaw.a4 + wordsRaw.a1) / 2,
    passage: (passageRaw.a3 + passageRaw.a1) / 2,
  };
  assert.deepEqual(middle, { single: 27, words: 21.488636363636363, passage: 39.29761904761905 });
  for (const roundId of OFFICIAL_ROUND_ORDER) {
    closeTo(byId.get("a1").perRound[roundId].median, middle[roundId], `${roundId} 中位數`);
  }
  assert.deepEqual(
    OFFICIAL_ROUND_ORDER.map(roundId => byId.get("a1").perRound[roundId].population),
    [5, 4, 4], "缺席嘅人要離開母體");
  assert.equal(byId.get("a1").perRound.single.label, "單字");
  assert.equal(byId.get("a1").perRound.single.weight, 0.3);
  assert.equal(byId.get("a1").perRound.passage.weight, 0.4);
  assert.equal(byId.get("a1").perRound.passage.game, "ghost");

  const n = {
    single: normalized(singleRaw.a1, middle.single),
    words: normalized(wordsRaw.a1, middle.words),
    passage: normalized(passageRaw.a1, middle.passage),
  };
  closeTo(byId.get("a1").perRound.single.normalized, n.single);
  closeTo(byId.get("a1").perRound.words.normalized, n.words);
  closeTo(byId.get("a1").perRound.passage.normalized, n.passage);
  closeTo(byId.get("a1").total, 0.3 * n.single + 0.3 * n.words + 0.4 * n.passage, "總分 = 0.3N單 + 0.3N詞 + 0.4N篇");
  assert.equal(byId.get("a2").perRound.passage.normalized, 150, "篇章冠軍要封頂 150");
  closeTo(byId.get("a2").total, 0.3 * normalized(singleRaw.a2, middle.single) +
    0.3 * normalized(wordsRaw.a2, middle.words) + 0.4 * 150);
  closeTo(byId.get("a3").total, 0.3 * normalized(singleRaw.a3, middle.single) +
    0.3 * normalized(wordsRaw.a3, middle.words) + 0.4 * normalized(passageRaw.a3, middle.passage));
  closeTo(byId.get("a4").total, 0.3 * normalized(singleRaw.a4, middle.single) +
    0.3 * normalized(wordsRaw.a4, middle.words) + 0.4 * 0, "篇章未達門檻就食 0");

  assert.equal(byId.get("a4").perRound.passage.belowThreshold, true);
  assert.equal(byId.get("a4").perRound.passage.excluded, false);
  assert.equal(byId.get("a4").overallStatus, "complete", "三輪齊就係 complete");
  assert.equal(byId.get("a4").roundsPlayed, 3);
  closeTo(byId.get("a1").tiebreak.combinedAccuracy, (45 + 50 + 180) / (50 + 55 + 200), "三輪合計準確度");
  closeTo(byId.get("a1").tiebreak.passageAccuracy, 0.9);
  assert.equal(byId.get("a1").tiebreak.passageSeconds, 240);

  // a5 answered one round badly and missed two: N = 0 but still listed.
  const last = byId.get("a5");
  assert.equal(last.overallStatus, "incomplete");
  assert.equal(last.roundsPlayed, 1);
  assert.equal(last.total, 0);
  assert.equal(last.rank, 5);
  assert.equal(last.perRound.single.belowThreshold, true);
  assert.equal(last.perRound.words.excluded, true);
  assert.equal(last.perRound.passage.excluded, true);
  assert.equal(last.tiebreak.passageSeconds, null);
});

test("settleCompetition breaks a tie by combined accuracy, then passage time, then shares the rank", () => {
  // Same R (40.5) with different accuracy: the accurate one ranks higher.
  const accuracyTie = settleCompetition({
    passage: [
      { accountId: "fast-sloppy", correct: 180, submitted: 200, seconds: 240 },
      { accountId: "slow-clean", correct: 162, submitted: 162, seconds: 240 },
    ],
  });
  assert.deepEqual(accuracyTie.map(standing => standing.accountId), ["slow-clean", "fast-sloppy"]);
  assert.deepEqual(accuracyTie.map(standing => standing.rank), [1, 2]);
  closeTo(accuracyTie[0].total, accuracyTie[1].total, "先要同分先至比同分次序");

  // Same total and same accuracy: the faster passage wins.
  const timeTie = settleCompetition({
    passage: [
      { accountId: "q1", correct: 162, submitted: 162, seconds: 240 },
      { accountId: "q2", correct: 81, submitted: 81, seconds: 120 },
      { accountId: "q3", correct: 200, submitted: 200, seconds: 100 },
    ],
  });
  assert.deepEqual(timeTie.map(standing => standing.accountId), ["q3", "q2", "q1"]);
  assert.deepEqual(timeTie.map(standing => standing.rank), [1, 2, 3]);
  assert.equal(timeTie[0].perRound.passage.normalized, 150);
  closeTo(timeTie[1].total, timeTie[2].total);
  assert.equal(timeTie[1].tiebreak.passageSeconds, 120);
  assert.equal(timeTie[2].tiebreak.passageSeconds, 240);
  assert.equal(timeTie[0].overallStatus, "incomplete", "只打一輪都可以排，但係 incomplete");

  // Two identical runs share rank 2 and the next player takes rank 4.
  const shared = settleCompetition({
    passage: [
      { accountId: "t1", correct: 162, submitted: 162, seconds: 240 },
      { accountId: "t2", correct: 162, submitted: 162, seconds: 240 },
      { accountId: "t3", correct: 200, submitted: 200, seconds: 100 },
      { accountId: "t4", correct: 180, submitted: 200, seconds: 240 },
    ],
  });
  assert.deepEqual(shared.map(standing => standing.accountId), ["t3", "t1", "t2", "t4"]);
  assert.deepEqual(shared.map(standing => standing.rank), [1, 2, 2, 4]);
  closeTo(shared[1].total, shared[2].total);
  closeTo(shared[1].total, shared[3].total, "t4 同 t1/t2 一樣分");
  closeTo(shared[3].tiebreak.combinedAccuracy, 0.9, "同分但準確度輸");
});

test("settleCompetition tolerates an empty or wrapped round list and an extra roster", () => {
  assert.deepEqual(settleCompetition(), []);
  assert.deepEqual(settleCompetition({}), []);
  assert.throws(() => settleCompetition(null), TypeError);
  assert.throws(() => settleCompetition({ single: [{ accountId: "a" }, { accountId: "a" }] }), TypeError);
  assert.throws(() => settleCompetition({}, { roster: "nope" }), TypeError);

  const wrapped = settleCompetition({
    single: { results: [{ accountId: "solo", correct: 45, submitted: 45, seconds: 90 }] },
  });
  assert.equal(wrapped.length, 1);
  assert.equal(wrapped[0].roundsPlayed, 1);
  assert.equal(wrapped[0].overallStatus, "incomplete");
  assert.equal(wrapped[0].perRound.single.normalized, 100, "一個人嘅組：自己就係中位數");
  assert.equal(wrapped[0].perRound.single.population, 1);
  assert.equal(wrapped[0].perRound.words.excluded, true);
  assert.equal(wrapped[0].perRound.passage.excluded, true);
  assert.equal(wrapped[0].tiebreak.passageSeconds, null);
  assert.equal(wrapped[0].tiebreak.combinedAccuracy, 1);

  // A name that never shows up in a result list can still be listed.
  const withRoster = settleCompetition({ single }, { roster: ["a1", "ghost-account"] });
  const ghost = withRoster.find(standing => standing.accountId === "ghost-account");
  assert.equal(withRoster.length, 6, "重複嘅 roster 名唔會出兩次");
  assert.equal(ghost.overallStatus, "incomplete");
  assert.equal(ghost.roundsPlayed, 0);
  assert.equal(ghost.total, 0);
  assert.equal(ghost.rank, 6);
  assert.equal(ghost.tiebreak.passageSeconds, null);
});

test("a simulated field is reproducible per seed and settles end to end", () => {
  const first = simulateField(mulberry32(20261022), { size: 40, profile: { mobile: true } });
  const repeat = simulateField(mulberry32(20261022), { size: 40, profile: { mobile: true } });
  assert.deepEqual(first, repeat, "同一個 seed 要出同一個場");
  assert.deepEqual(simulateField(7, { size: 12 }), simulateField(mulberry32(7), { size: 12 }), "數值 seed 要等於 mulberry32");
  assert.notDeepEqual(simulateField(1, { size: 12 }), simulateField(2, { size: 12 }));

  assert.deepEqual(Object.keys(first), OFFICIAL_ROUND_ORDER);
  for (const roundId of OFFICIAL_ROUND_ORDER) assert.equal(first[roundId].length, 40);
  for (const roundId of OFFICIAL_ROUND_ORDER) {
    for (const result of first[roundId]) {
      assert.match(result.accountId, /^sim-\d{2}$/);
      assert.equal(result.division, "mobile");
      assert.ok(Number.isInteger(result.correct) && Number.isInteger(result.submitted));
      assert.ok(result.correct >= 0 && result.correct <= result.submitted);
      assert.ok(result.submitted > 0);
      assert.ok(Number.isFinite(result.seconds) && result.seconds > 0);
    }
  }
  for (const result of first.single) assert.equal(result.seconds, OFFICIAL_ROUNDS.single.durationSeconds, "定時輪用 T0");
  for (const result of first.words) assert.equal(result.seconds, OFFICIAL_ROUNDS.words.durationSeconds);

  const desktop = simulateField(mulberry32(20261022), { size: 40, profile: { mobile: false } });
  assert.equal(desktop.single[0].division, "desktop");
  assert.equal(simulateField(mulberry32(1), { size: 8 }).single[0].division, "desktop", "預設係電腦組");

  // A deliberately slow field runs into the passage protection cap.
  const slow = simulateField(mulberry32(9), { size: 200, profile: { baseCpm: 24, cpmSpread: 0.3 } });
  assert.ok(slow.passage.some(result => result.seconds === 540), "慢過保護上限就要截數");
  assert.ok(slow.passage.some(result => result.seconds < 540));
  assert.ok(slow.passage.filter(result => result.seconds === 540)
    .every(result => result.submitted < 200), "截數嘅人打唔完篇章");

  assert.throws(() => simulateField(null, { size: 10 }), TypeError);
  assert.throws(() => simulateField("nope", { size: 10 }), TypeError);
  assert.throws(() => simulateField(mulberry32(1), { size: 0 }), TypeError);
  assert.throws(() => simulateField(mulberry32(1), { size: 2.5 }), TypeError);
  assert.throws(() => simulateField(mulberry32(1), { size: 10, profile: "mobile" }), TypeError);
});

test("simulated speed and accuracy move together and straddle both thresholds", () => {
  const field = simulateField(mulberry32(5), { size: 200 });
  const cpm = field.single.map(result => result.correct * 60 / result.seconds);
  const accuracy = field.single.map(result => result.correct / result.submitted);
  const correlation = pearson(cpm, accuracy);
  assert.ok(correlation > 0.3, `快同準要有正相關（實際 ${correlation.toFixed(2)}）`);

  const standings = settleCompetition(field);
  assert.equal(standings.length, 200);
  assert.equal(standings[0].rank, 1);
  assert.ok(standings.some(standing => standing.overallStatus === "complete"));
  assert.ok(standings.some(standing => standing.perRound.single.belowThreshold), "要有人低過單字門檻");
  assert.ok(standings.some(standing => standing.perRound.passage.belowThreshold), "要有人低過篇章門檻");
  for (const standing of standings) {
    assert.ok(Number.isFinite(standing.total) && standing.total >= 0 && standing.total <= 150);
    for (const roundId of OFFICIAL_ROUND_ORDER) {
      const round = standing.perRound[roundId];
      assert.ok(Number.isFinite(round.normalized) && round.normalized >= 0 && round.normalized <= 150);
    }
  }

  const phone = settleCompetition(simulateField(mulberry32(11), { size: 60, profile: { mobile: true } }));
  const laptop = settleCompetition(simulateField(mulberry32(11), { size: 60, profile: { mobile: false } }));
  assert.ok(median(phone.map(standing => standing.perRound.single.raw)) <
    median(laptop.map(standing => standing.perRound.single.raw)), "手機組預設慢過電腦組");
});

test("an absent rate drops rounds and settles them as incomplete", () => {
  const field = simulateField(mulberry32(3), { size: 30, profile: { absentRate: 0.25 } });
  assert.ok(field.single.length < 30, "缺席率要真係扣人");
  assert.ok(field.single.length > 0);
  const players = new Set(OFFICIAL_ROUND_ORDER.flatMap(roundId => field[roundId].map(result => result.accountId)));

  const standings = settleCompetition(field);
  assert.equal(standings.length, players.size, "有出過場嘅人都要列榜");
  assert.ok(standings.some(standing => standing.overallStatus === "incomplete"));
  assert.ok(standings.some(standing => standing.overallStatus === "complete"));
  for (const standing of standings) {
    const excluded = OFFICIAL_ROUND_ORDER.filter(roundId => standing.perRound[roundId].excluded);
    assert.equal(standing.overallStatus === "complete", excluded.length === 0);
    assert.equal(standing.roundsPlayed, OFFICIAL_ROUND_ORDER.length - excluded.length);
  }

  const empty = simulateField(mulberry32(1), { size: 5, profile: { absentRate: 1 } });
  assert.deepEqual(empty.single, []);
  assert.deepEqual(settleCompetition(empty), [], "全場缺席就冇榜，唔會 throw");
});

test("a 200-player field simulates and settles in well under a second", () => {
  const started = performance.now();
  const settled = settleCompetition(simulateField(mulberry32(20261022), { size: 200 }));
  const elapsed = performance.now() - started;
  assert.equal(settled.length, 200);
  assert.ok(elapsed < 1000, `預演結算用咗 ${elapsed.toFixed(1)}ms`);
});

test("the official module stays free of DOM, window and storage access", () => {
  for (const banned of ["document", "window", "localStorage", "sessionStorage"]) {
    assert.doesNotMatch(source, new RegExp(`\\b${banned}\\b`), `official.mjs 唔應該用 ${banned}`);
  }
  assert.match(source, /from "\.\/common\.mjs"/, "共用公式要來自 games/common.mjs");
  assert.doesNotMatch(source, /from "\.\.\//, "純邏輯檔唔應該 import 上層模組");
});
