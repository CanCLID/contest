// Official three-round competition rules for demo/games/ — pure logic only.
// The 1c rehearsal page and the node:test suite import this directly, and the
// real backend re-runs the same settlement over the submission logs it
// receives, so nothing here may touch the DOM, browser globals or storage.
// Rules, weights and tie-breaks follow SPEC §5.5 and docs/INTEGRATION-PLAN.md §C.
import { OFFICIAL_THRESHOLDS, mulberry32, normalizeAnswer, roundMetrics } from "./common.mjs";

// Round order on the day: 單字 → 詞組 → 篇章.
export const OFFICIAL_ROUND_ORDER = ["single", "words", "passage"];

// Round parameters agreed in docs/INTEGRATION-PLAN.md §A2. `weight` is the
// share of the total score (0.3 + 0.3 + 0.4 = 1), `threshold` is the accuracy
// floor below which the round scores nothing, and the two timed rounds score
// against their fixed T0 while the passage round is measured by its own finish
// time. 單字/詞組 use the rocks/chain shells, 篇章 uses the ghost shell.
export const OFFICIAL_ROUNDS = Object.freeze({
  single: Object.freeze({
    game: "rocks",
    label: "單字",
    durationSeconds: 90,
    threshold: OFFICIAL_THRESHOLDS.timed,
    weight: 0.3,
  }),
  words: Object.freeze({
    game: "chain",
    label: "詞組",
    durationSeconds: 120,
    threshold: OFFICIAL_THRESHOLDS.timed,
    weight: 0.3,
  }),
  passage: Object.freeze({
    game: "ghost",
    label: "篇章",
    threshold: OFFICIAL_THRESHOLDS.passage,
    weight: 0.4,
  }),
});

// Local export format for one round of one account (docs/INTEGRATION-PLAN.md §C0.2).
export const SUBMISSION_LOG_VERSION = 1;

// Simulated-field defaults in syllables per minute. Timed rounds use the
// round's own T0; the passage round runs to the protection cap, so a slow
// simulated player can end up unfinished.
const SIMULATION = {
  baseCpm: { mobile: 42, desktop: 68 },
  cpmSpread: 0.24,
  baseAccuracy: { mobile: 0.9, desktop: 0.93 },
  accuracySlope: 0.03,
  accuracyNoise: 0.05,
  roundSpeed: { single: 1, words: 0.92, passage: 0.96 },
  roundAccuracy: { single: 1, words: 0.99, passage: 1 },
  roundNoise: 0.06,
  roundAccuracyNoise: 0.02,
  passageSyllables: 200,
  passageCapSeconds: 540,
};

function isLabel(value) {
  return typeof value === "string" && value.trim() !== "";
}

function clamp01(value) {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

// Box–Muller normal deviate from any () => [0, 1) source.
function gaussian(random) {
  const first = Math.max(random(), Number.EPSILON);
  const second = random();
  return Math.sqrt(-2 * Math.log(first)) * Math.cos(2 * Math.PI * second);
}

/**
 * Start an empty submission log for one round of one account.
 * Shape: { version, roundId, accountId, submissions: [] }.
 */
export function createSubmissionLog({ roundId, accountId } = {}) {
  if (!isLabel(roundId)) throw new TypeError("A submission log needs a non-empty roundId string.");
  if (!isLabel(accountId)) throw new TypeError("A submission log needs a non-empty accountId string.");
  return { version: SUBMISSION_LOG_VERSION, roundId, accountId, submissions: [] };
}

/**
 * Append one { seq, op, answer, clientAt, itemIndex } operation to a log, in
 * place, and return the same log so callers can chain. `seq` must increase
 * strictly, `op` is "submit" or "undo", `answer` must already be
 * normalizeAnswer() output (lowercase a–z; empty is allowed only for "undo"),
 * `clientAt` is the client clock in ms and `itemIndex` is the 0-based syllable
 * the operation applies to. Anything else throws.
 */
export function appendSubmission(log, { seq, op, answer, clientAt, itemIndex } = {}) {
  if (!log || !Array.isArray(log.submissions)) {
    throw new TypeError("appendSubmission needs a log from createSubmissionLog().");
  }
  const last = log.submissions.at(-1);
  if (!Number.isInteger(seq) || seq < 0) {
    throw new TypeError(`A submission needs a non-negative integer seq (got ${seq}).`);
  }
  if (last && seq <= last.seq) {
    throw new TypeError(`seq must increase: got ${seq} after ${last.seq}.`);
  }
  if (op !== "submit" && op !== "undo") {
    throw new TypeError(`Unsupported op "${op}": only "submit" or "undo".`);
  }
  const normalized = normalizeAnswer(answer);
  if (normalized !== answer) {
    throw new TypeError(`Answers must already be lowercase a–z Jyutping (got ${JSON.stringify(answer)}).`);
  }
  if (op === "submit" && normalized === "") {
    throw new TypeError("A submit operation needs a non-empty answer.");
  }
  if (!Number.isFinite(clientAt) || clientAt < 0) {
    throw new TypeError(`A submission needs a finite, non-negative clientAt (got ${clientAt}).`);
  }
  if (!Number.isInteger(itemIndex) || itemIndex < 0) {
    throw new TypeError(`A submission needs a non-negative integer itemIndex (got ${itemIndex}).`);
  }
  log.submissions.push({ seq, op, answer: normalized, clientAt, itemIndex });
  return log;
}

/**
 * Validate a whole log without touching it — used by the export path so a
 * malformed log never reaches the server.
 */
function assertSubmissionLog(log) {
  if (!log || !isLabel(log.roundId) || !isLabel(log.accountId) || !Array.isArray(log.submissions)) {
    throw new TypeError("Not a submission log.");
  }
  if (log.version !== SUBMISSION_LOG_VERSION) {
    throw new TypeError(`Unsupported submission log version ${log.version}.`);
  }
  const checked = createSubmissionLog({ roundId: log.roundId, accountId: log.accountId });
  for (const entry of log.submissions) {
    appendSubmission(checked, entry);
  }
  return checked;
}

/**
 * Export a log as a JSON string for upload (compact, one line, stable keys).
 */
export function serializeSubmissionLog(log) {
  const checked = assertSubmissionLog(log);
  return JSON.stringify({
    version: checked.version,
    roundId: checked.roundId,
    accountId: checked.accountId,
    submissions: checked.submissions,
  });
}

/**
 * Rebuild a log from serializeSubmissionLog() output. Round-trips: parsing a
 * serialized log deep-equals the log it came from, and every rule that
 * appendSubmission enforces is re-checked here.
 */
export function parseSubmissionLog(json) {
  if (typeof json !== "string") throw new TypeError("A submission log parses from a JSON string.");
  let data;
  try {
    data = JSON.parse(json);
  } catch (error) {
    throw new TypeError(`A submission log must be valid JSON: ${error.message}`);
  }
  if (!data || typeof data !== "object" || !Array.isArray(data.submissions)) {
    throw new TypeError("A submission log needs a submissions array.");
  }
  if (data.version !== SUBMISSION_LOG_VERSION) {
    throw new TypeError(`Unsupported submission log version ${data.version}.`);
  }
  const log = createSubmissionLog({ roundId: data.roundId, accountId: data.accountId });
  for (const entry of data.submissions) appendSubmission(log, entry);
  return log;
}

/**
 * Median of the finite numbers in `values` (average of the two middle values
 * for an even population). An empty or all-invalid population reads as 0 so a
 * settlement can never divide by NaN.
 */
export function median(values) {
  const numbers = (Array.isArray(values) ? values : [])
    .map(Number)
    .filter(Number.isFinite)
    .sort((left, right) => left - right);
  if (numbers.length === 0) return 0;
  const middle = numbers.length >> 1;
  return numbers.length % 2 === 1 ? numbers[middle] : (numbers[middle - 1] + numbers[middle]) / 2;
}

// The wall-clock seconds a result carries, under either name the games use:
// rocks/chain/engine report elapsedSeconds, a hand-built result reports seconds.
function resultSeconds(result) {
  const seconds = Number(result?.seconds);
  if (Number.isFinite(seconds) && seconds > 0) return seconds;
  const elapsed = Number(result?.elapsedSeconds);
  return Number.isFinite(elapsed) ? elapsed : NaN;
}

// Raw round score R = (C ÷ T) × A = correctPerMinute × accuracy (SPEC §5.5).
// A timed round always scores against its own fixed T0, so its counters are
// authoritative; the passage round uses the time the result carries, falling
// back to an R the game already computed.
function resultRaw(result, round = null) {
  const correct = Number(result?.correct);
  const submitted = Number(result?.submitted);
  const seconds = round && Number.isFinite(round.durationSeconds)
    ? round.durationSeconds : resultSeconds(result);
  if (Number.isFinite(correct) && Number.isFinite(submitted) && Number.isFinite(seconds)) {
    return roundMetrics({ correct, submitted, seconds }).officialScore;
  }
  if (Number.isFinite(result?.raw)) return result.raw;
  if (Number.isFinite(result?.officialScore)) return result.officialScore;
  return 0;
}

// Accuracy as a 0–1 ratio. Counters are authoritative; a bare `accuracy` is
// accepted as a ratio, or as a percentage when it exceeds 1
// (engine.getMetrics() reports percentages, roundMetrics() reports ratios).
function resultAccuracy(result) {
  const correct = Number(result?.correct);
  const submitted = Number(result?.submitted);
  if (Number.isFinite(correct) && Number.isFinite(submitted) && submitted > 0) {
    return correct / submitted;
  }
  const accuracy = Number(result?.accuracy);
  if (!Number.isFinite(accuracy)) return 0;
  return accuracy > 1 ? clamp01(accuracy / 100) : clamp01(accuracy);
}

/**
 * Normalise one round against its own field: N = min(cap, 100 × R ÷ median(R)).
 * Every entry of `results` ({ accountId, correct, submitted, seconds,
 * accuracy }) becomes { accountId, raw, normalized, accuracy, belowThreshold,
 * excluded, … }. A participant under `threshold` scores N = 0 with
 * belowThreshold: true but still counts in the median; a participant marked
 * excluded (or listed in `roster` without a result) is dropped from the median
 * and reads excluded: true. An empty population or a median of 0 makes every
 * N 0 — settlement never divides by zero and never throws for a thin field.
 */
export function normalizeRound({
  results,
  roster = [],
  cap = 150,
  threshold = null,
  roundId = null,
} = {}) {
  if (!Array.isArray(results)) throw new TypeError("A round needs an array of results.");
  if (!Array.isArray(roster)) throw new TypeError("A round roster must be an array of accountIds.");
  if (!Number.isFinite(cap) || cap <= 0) throw new TypeError("The normalisation cap must be a positive number.");
  const round = roundId && OFFICIAL_ROUNDS[roundId] ? OFFICIAL_ROUNDS[roundId] : null;
  const floor = Number.isFinite(threshold) ? threshold
    : round ? round.threshold : OFFICIAL_THRESHOLDS.timed;

  const entries = [];
  const seen = new Set();
  for (const result of results) {
    const accountId = result?.accountId;
    if (!isLabel(accountId)) throw new TypeError("Every round result needs a non-empty accountId.");
    if (seen.has(accountId)) throw new TypeError(`Duplicate result for account ${accountId}.`);
    seen.add(accountId);
    entries.push({
      accountId,
      excluded: result.excluded === true || result.absent === true,
      correct: Number(result.correct) || 0,
      submitted: Number(result.submitted) || 0,
      seconds: resultSeconds(result) || 0,
      raw: resultRaw(result, round),
      accuracy: resultAccuracy(result),
    });
  }
  for (const accountId of roster) {
    if (!isLabel(accountId)) throw new TypeError("Roster accountIds must be non-empty strings.");
    if (seen.has(accountId)) continue;
    seen.add(accountId);
    entries.push({ accountId, excluded: true, correct: 0, submitted: 0, seconds: 0, raw: 0, accuracy: 0 });
  }

  const scored = entries.filter(entry => !entry.excluded);
  const middle = median(scored.map(entry => entry.raw));

  return entries.map(entry => {
    const belowThreshold = !entry.excluded && entry.accuracy < floor;
    const normalized = entry.excluded || belowThreshold || middle <= 0
      ? 0
      : Math.min(cap, 100 * entry.raw / middle);
    return {
      accountId: entry.accountId,
      raw: entry.raw,
      normalized,
      accuracy: entry.accuracy,
      correct: entry.correct,
      submitted: entry.submitted,
      seconds: entry.seconds,
      belowThreshold,
      excluded: entry.excluded,
      median: middle,
      population: scored.length,
      threshold: floor,
    };
  });
}

// total desc → 三輪合計準確度 desc → 篇章準確度 desc → 篇章用時 asc → tie.
function compareStandings(left, right) {
  if (right.total !== left.total) return right.total - left.total;
  const accuracy = right.tiebreak.combinedAccuracy - left.tiebreak.combinedAccuracy;
  if (accuracy !== 0) return accuracy;
  const passage = right.tiebreak.passageAccuracy - left.tiebreak.passageAccuracy;
  if (passage !== 0) return passage;
  return (left.tiebreak.passageSeconds ?? Infinity) - (right.tiebreak.passageSeconds ?? Infinity);
}

/**
 * Settle a whole competition from { single, words, passage } result lists.
 * Each round is normalised on its own median, then every participant gets
 * total = 0.3 × N單 + 0.3 × N詞 + 0.4 × N篇 over the rounds they actually took
 * part in, plus rank (equal scores share a rank) and overallStatus —
 * "incomplete" when any of the three rounds has no result for them. Order:
 * total desc → combined accuracy desc → passage accuracy desc → passage time
 * asc → tie (SPEC §5.5). The roster comes from the results themselves;
 * pass { roster: [...] } as a second argument to also list an account that is
 * missing from all three rounds.
 */
export function settleCompetition(roundsById = {}, { roster: extraRoster = [] } = {}) {
  if (roundsById === null || typeof roundsById !== "object") {
    throw new TypeError("Settlement needs a { single, words, passage } object.");
  }
  if (!Array.isArray(extraRoster)) throw new TypeError("Settlement roster must be an array of accountIds.");

  const raw = {};
  const roster = [];
  const seen = new Set();
  for (const roundId of OFFICIAL_ROUND_ORDER) {
    const source = roundsById[roundId];
    raw[roundId] = Array.isArray(source) ? source : Array.isArray(source?.results) ? source.results : [];
    for (const result of raw[roundId]) {
      const accountId = result?.accountId;
      if (isLabel(accountId) && !seen.has(accountId)) {
        seen.add(accountId);
        roster.push(accountId);
      }
    }
  }
  for (const accountId of extraRoster) {
    if (!isLabel(accountId)) throw new TypeError("Roster accountIds must be non-empty strings.");
    if (seen.has(accountId)) continue;
    seen.add(accountId);
    roster.push(accountId);
  }

  const settled = {};
  for (const roundId of OFFICIAL_ROUND_ORDER) {
    settled[roundId] = new Map(normalizeRound({
      results: raw[roundId],
      roster,
      threshold: OFFICIAL_ROUNDS[roundId].threshold,
      roundId,
    }).map(entry => [entry.accountId, entry]));
  }

  const standings = roster.map(accountId => {
    const perRound = {};
    let total = 0;
    let roundsPlayed = 0;
    let correct = 0;
    let submitted = 0;

    for (const roundId of OFFICIAL_ROUND_ORDER) {
      const round = OFFICIAL_ROUNDS[roundId];
      const entry = settled[roundId].get(accountId);
      const excluded = !entry || entry.excluded;
      perRound[roundId] = {
        roundId,
        label: round.label,
        game: round.game,
        weight: round.weight,
        threshold: round.threshold,
        raw: entry?.raw ?? 0,
        normalized: entry?.normalized ?? 0,
        accuracy: entry?.accuracy ?? 0,
        correct: entry?.correct ?? 0,
        submitted: entry?.submitted ?? 0,
        seconds: entry?.seconds ?? 0,
        belowThreshold: entry?.belowThreshold ?? false,
        excluded,
        median: entry?.median ?? 0,
        population: entry?.population ?? 0,
      };
      if (excluded) continue;
      total += round.weight * perRound[roundId].normalized;
      roundsPlayed += 1;
      correct += perRound[roundId].correct;
      submitted += perRound[roundId].submitted;
    }

    const passage = perRound.passage;
    return {
      accountId,
      total,
      roundsPlayed,
      overallStatus: roundsPlayed === OFFICIAL_ROUND_ORDER.length ? "complete" : "incomplete",
      perRound,
      tiebreak: {
        combinedAccuracy: submitted > 0 ? correct / submitted : 0,
        passageAccuracy: passage.excluded ? 0 : passage.accuracy,
        passageSeconds: passage.excluded ? null : passage.seconds,
      },
    };
  });

  const ordered = [...standings].sort(compareStandings);
  const ranked = [];
  for (const [position, standing] of ordered.entries()) {
    const previous = ranked[position - 1];
    ranked.push({
      ...standing,
      rank: previous && compareStandings(previous, standing) === 0 ? previous.rank : position + 1,
    });
  }
  return ranked;
}

// One simulated round for one simulated player.
function simulateRound({ roundId, accountId, division, cpm, accuracy, random }) {
  const round = OFFICIAL_ROUNDS[roundId];
  const speed = Math.max(1, cpm * SIMULATION.roundSpeed[roundId] *
    (1 + SIMULATION.roundNoise * gaussian(random)));
  const roundAccuracy = clamp01(accuracy * SIMULATION.roundAccuracy[roundId] +
    SIMULATION.roundAccuracyNoise * gaussian(random));

  let seconds;
  let submitted;
  if (Number.isFinite(round.durationSeconds)) {
    seconds = round.durationSeconds;
    submitted = Math.max(0, Math.round(speed * seconds / 60));
  } else {
    const finish = SIMULATION.passageSyllables * 60 / speed;
    if (finish > SIMULATION.passageCapSeconds) {
      seconds = SIMULATION.passageCapSeconds;
      submitted = Math.max(0, Math.floor(speed * seconds / 60));
    } else {
      seconds = finish;
      submitted = SIMULATION.passageSyllables;
    }
  }

  const correct = Math.min(submitted, Math.round(submitted * roundAccuracy));
  return {
    accountId,
    division,
    correct,
    submitted,
    seconds: Math.round(seconds * 10) / 10,
    accuracy: submitted > 0 ? correct / submitted : 0,
  };
}

/**
 * Build a fake field of `size` players over the three official rounds, ready
 * for normalizeRound/settleCompetition. `rng` is a () => [0, 1) function
 * (e.g. mulberry32(seed)) or a numeric seed. `profile` carries the speed
 * assumptions: { mobile } picks the phone or desktop defaults, and
 * baseCpm / cpmSpread / baseAccuracy / absentRate override them. Each player
 * gets one latent skill draw that drives both speed and accuracy, so faster
 * players are also more accurate, as in real fields.
 */
export function simulateField(rng, { size, profile = {} } = {}) {
  const random = typeof rng === "function" ? rng
    : Number.isFinite(rng) ? mulberry32(rng) : null;
  if (!random) throw new TypeError("A simulated field needs a random function or a numeric seed.");
  if (!Number.isInteger(size) || size <= 0) throw new TypeError("A simulated field needs a positive integer size.");
  if (profile === null || typeof profile !== "object") {
    throw new TypeError("A simulated field profile must be an object.");
  }

  const mobile = Boolean(profile.mobile);
  const division = mobile ? "mobile" : "desktop";
  const baseCpm = Number.isFinite(profile.baseCpm) && profile.baseCpm > 0
    ? profile.baseCpm : SIMULATION.baseCpm[division];
  const cpmSpread = Number.isFinite(profile.cpmSpread) && profile.cpmSpread >= 0
    ? profile.cpmSpread : SIMULATION.cpmSpread;
  const baseAccuracy = Number.isFinite(profile.baseAccuracy)
    ? clamp01(profile.baseAccuracy) : SIMULATION.baseAccuracy[division];
  const absentRate = clamp01(profile.absentRate ?? 0);

  const field = { single: [], words: [], passage: [] };
  const width = String(size).length;
  for (let position = 0; position < size; position++) {
    const accountId = `sim-${String(position + 1).padStart(width, "0")}`;
    const skill = gaussian(random);
    const cpm = baseCpm * Math.exp(cpmSpread * skill);
    const accuracy = clamp01(baseAccuracy + SIMULATION.accuracySlope * skill +
      SIMULATION.accuracyNoise * gaussian(random));
    for (const roundId of OFFICIAL_ROUND_ORDER) {
      if (absentRate > 0 && random() < absentRate) continue;
      field[roundId].push(simulateRound({ roundId, accountId, division, cpm, accuracy, random }));
    }
  }
  return field;
}
