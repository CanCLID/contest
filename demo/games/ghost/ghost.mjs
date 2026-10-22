// Ghost Race — pure race logic for demo/games/ghost/.
// Browser globals stay out of this file on purpose: the race state, the ghost
// timeline and the result shape are all testable with node:test. Rendering and
// persistence live in ghost-dom.mjs.
import { mulberry32 } from "../common.mjs";

// Two built-in opponents, in syllables per minute.
export const GHOST_CPM_PRESETS = [55, 80];
// Key for this game's best timeline in browser storage; ghost-dom.mjs owns it.
export const GHOST_STORAGE_KEY = "canclid-contest-games-ghost";
// Per-syllable speed wobble, so a demo ghost does not read like a metronome.
export const GHOST_JITTER = 0.12;
export const GHOST_SEED = 20261022;

function positiveInteger(value, label) {
  if (!Number.isInteger(value) || value <= 0) {
    throw new TypeError(`${label} must be a positive integer.`);
  }
  return value;
}

function clamp01(value) {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

// timeline: [{ at: ms after the start, index: syllables finished }], ordered by
// increasing time and syllable count. A recorded run ends on `total`.
export function createGhostRace({ now, total, timeline = [] } = {}) {
  if (!Number.isFinite(now)) throw new TypeError("A ghost race needs a finite start time.");
  positiveInteger(total, "The race length");
  if (!Array.isArray(timeline)) throw new TypeError("A ghost race needs a timeline array.");

  let previousAt = -1;
  let previousIndex = 0;
  const checked = timeline.map((entry, position) => {
    const at = Number(entry?.at);
    const index = Number(entry?.index);
    if (!Number.isFinite(at) || at < 0) {
      throw new TypeError(`Timeline entry ${position} needs a finite, non-negative "at".`);
    }
    if (!Number.isInteger(index) || index < 1 || index > total) {
      throw new TypeError(`Timeline entry ${position} needs an integer "index" between 1 and ${total}.`);
    }
    if (at < previousAt || index <= previousIndex) {
      throw new TypeError("Timeline entries must advance in both time and syllable count.");
    }
    previousAt = at;
    previousIndex = index;
    return { at, index };
  });

  return { startedAt: now, total, timeline: checked };
}

// Share of the race the ghost has finished at `now` (0–1). Progress is
// interpolated linearly between timeline entries, starting from 0 at the gun.
// Past the last entry the ghost is treated as having crossed the line: demo
// ghosts and recorded best runs both end on `total`.
export function ghostProgressAt(race, now) {
  const total = Number(race?.total);
  const timeline = race?.timeline ?? [];
  if (!Number.isInteger(total) || total <= 0 || !timeline.length) return 0;
  const startedAt = Number.isFinite(race?.startedAt) ? race.startedAt : 0;
  const elapsed = Math.max(0, (Number.isFinite(now) ? now : startedAt) - startedAt);

  let previousAt = 0;
  let previousProgress = 0;
  for (const entry of timeline) {
    const progress = entry.index / total;
    if (elapsed <= entry.at) {
      const span = entry.at - previousAt;
      if (span <= 0) return clamp01(progress);
      return clamp01(previousProgress + (progress - previousProgress) * ((elapsed - previousAt) / span));
    }
    previousAt = entry.at;
    previousProgress = progress;
  }
  return 1;
}

// A demo opponent finishing one syllable every 60000 / correctPerMinute ms,
// with a small per-syllable wobble driven by mulberry32(seed) so the same seed
// always replays the same race.
export function createDemoGhost({ correctPerMinute, total, seed = GHOST_SEED } = {}) {
  if (!Number.isFinite(correctPerMinute) || correctPerMinute <= 0) {
    throw new TypeError("A demo ghost needs a positive speed in syllables per minute.");
  }
  positiveInteger(total, "The race length");

  const random = mulberry32(Number.isFinite(seed) ? seed >>> 0 : GHOST_SEED);
  const interval = 60000 / correctPerMinute;
  const timeline = [];
  let at = 0;
  for (let index = 1; index <= total; index++) {
    at += interval * (1 + (random() * 2 - 1) * GHOST_JITTER);
    timeline.push({ at: Math.round(at), index });
  }

  return {
    id: `demo-${correctPerMinute}`,
    label: `示範幽靈 · ${correctPerMinute} 音節／分`,
    correctPerMinute,
    total,
    timeline,
  };
}

export function builtInGhosts(total, seed = GHOST_SEED) {
  positiveInteger(total, "The race length");
  return GHOST_CPM_PRESETS.map((correctPerMinute, position) =>
    createDemoGhost({ correctPerMinute, total, seed: seed + position }));
}

// Validate and copy a timeline: [{ at: ms after the start, index: syllables
// finished }]. Entries must advance in syllable count and never move backwards
// in time, so the result can be stored and handed straight back to
// createGhostRace.
export function createTimeline(submissions = []) {
  if (!Array.isArray(submissions)) {
    throw new TypeError("A timeline needs an array of { at, index } submissions.");
  }
  let previousAt = -1;
  let previousIndex = 0;
  return submissions.map((entry, position) => {
    const at = Number(entry?.at);
    const index = Number(entry?.index);
    if (!Number.isFinite(at) || at < 0) {
      throw new TypeError(`Timeline entry ${position} needs a finite, non-negative "at".`);
    }
    if (!Number.isInteger(index) || index < 1) {
      throw new TypeError(`Timeline entry ${position} needs an integer "index" of at least 1.`);
    }
    if (at < previousAt || index <= previousIndex) {
      throw new TypeError("Timeline entries must advance in both time and syllable count.");
    }
    previousAt = at;
    previousIndex = index;
    return { at, index };
  });
}

// The real recording path: pass the absolute timestamp of every accepted
// submitAnswer call (Date.now() or performance.now(), in submission order) and
// get the stored timeline shape back, with `at` relative to the gun. A caller
// that lets the player undo drops the tail of its own times list, so an
// abandoned attempt never reaches the ghost.
export function recordTimelineFromTimes(startedAt, times = []) {
  if (!Number.isFinite(startedAt)) {
    throw new TypeError("A recorded timeline needs a finite start time.");
  }
  if (!Array.isArray(times)) {
    throw new TypeError("A recorded timeline needs an array of submit times.");
  }
  return createTimeline(times.map((time, position) => {
    if (!Number.isFinite(time) || time < startedAt) {
      throw new TypeError(`Submit time ${position} must be finite and no earlier than the start time.`);
    }
    return { at: Math.round(time - startedAt), index: position + 1 };
  }));
}

// @deprecated Demo stand-in only: the demo engine keeps just the final
// timestamp, so submit times are reconstructed as evenly spaced from the
// average interval, entry i landing at (i + 1) x averageInterval. The real
// game records every submit time as it happens and calls
// recordTimelineFromTimes() instead — this reconstruction is not a
// measurement and will be removed once nothing replays a demo-era run.
export function recordTimeline(run, now) {
  const answers = run?.answers ?? [];
  if (!answers.length) return [];

  const startedAt = Number.isFinite(run?.startedAt) ? run.startedAt : 0;
  const finishedAt = Number.isFinite(now) ? now
    : Number.isFinite(run?.finishedAt) ? run.finishedAt : null;
  if (finishedAt === null) {
    throw new TypeError("A timeline needs a finished run or an explicit end time.");
  }
  const interval = Math.max(0, finishedAt - startedAt) / answers.length;
  return answers.map((_, position) => ({
    at: Math.round(interval * (position + 1)),
    index: position + 1,
  }));
}

// End-of-race summary. `playerMetrics` matches roundMetrics() in games/common.mjs
// (accuracy as a 0–1 ratio) plus the run's own counters, so the official score
// keeps the passage threshold it was computed with.
export function raceResult({ playerMetrics, ghostProgress = 0, finishedFirst = false } = {}) {
  if (!playerMetrics) throw new TypeError("A race result needs player metrics.");

  const progress = clamp01(ghostProgress);
  const playerProgress = clamp01(playerMetrics.progress ?? 1);
  const total = Number.isFinite(playerMetrics.total) ? playerMetrics.total : null;
  const submitted = Number(playerMetrics.submitted) || 0;
  const correct = Number(playerMetrics.correct) || 0;
  const accuracy = submitted > 0 ? correct / submitted
    : Number.isFinite(playerMetrics.accuracy) ? clamp01(playerMetrics.accuracy) : 0;
  const lead = playerProgress - progress;
  // `finishedFirst` is the race outcome: a ghost on a full timeline reads as
  // finished the moment the player's own finish time is past its last entry.
  const verdict = !finishedFirst ? "幽靈快過你"
    : Math.abs(lead) < 0.02 ? "同幽靈幾乎同時衝線" : "你贏咗幽靈";

  return {
    finishedFirst: Boolean(finishedFirst),
    verdict,
    ghostProgress: progress,
    playerProgress,
    ghostRemaining: 1 - progress,
    lead,
    leadSyllables: total ? Math.round(lead * total) : null,
    total,
    submitted,
    correct,
    errors: Number(playerMetrics.errors) || 0,
    elapsedSeconds: Number(playerMetrics.elapsedSeconds) || 0,
    correctPerMinute: Number(playerMetrics.correctPerMinute) || 0,
    accuracy,
    accuracyPercent: accuracy * 100,
    officialScore: Number(playerMetrics.officialScore) || 0,
    meetsThreshold: Boolean(playerMetrics.meetsThreshold),
    threshold: Number.isFinite(playerMetrics.threshold) ? playerMetrics.threshold : null,
  };
}
