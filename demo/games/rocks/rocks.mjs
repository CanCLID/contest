// 粵拼落石純邏輯：唔會掂 DOM、window 或者 localStorage，node --test 可以直接 import。
// 掉落進度一律用注入嘅 now 計：目標出現時間 + fallDurationMs = 落地死線。

import {
  OFFICIAL_THRESHOLDS,
  comboMultiplier,
  hashSeed,
  mulberry32,
  normalizeAnswer,
  roundMetrics,
  shuffled,
} from "../common.mjs";
import { ROCK_QUESTIONS, validateBank } from "./data.mjs";

export const FALL_DURATION_MS = 6000;
export const DEFAULT_DURATION_SECONDS = 60;
export const DEFAULT_LIVES = 3;
export const ROCKS_STORAGE_KEY = "canclid-contest-games-rocks";

// 由洗好嘅題庫隊列抽下一個目標；隊列用完就用同一個 rng 再洗，保持同 seed 可重現。
function spawnTarget(state, spawnedAt) {
  const queue = state.queue.length > 0 ? state.queue : shuffled(state.bank, state.rng);
  const [token, ...rest] = queue;
  return {
    ...state,
    spawned: state.spawned + 1,
    queue: rest,
    target: {
      hanzi: token.hanzi,
      answers: [...token.answers],
      spawnedAt,
      deadline: spawnedAt + state.fallDurationMs,
    },
  };
}

function finish(state, at, reason) {
  return {
    ...state,
    status: "finished",
    finishedAt: at,
    finishedReason: reason,
    updatedAt: at,
  };
}

export function createRocksGame({
  now,
  seed = "rocks",
  durationSeconds = DEFAULT_DURATION_SECONDS,
  lives = DEFAULT_LIVES,
  bank = ROCK_QUESTIONS,
  fallDurationMs = FALL_DURATION_MS,
} = {}) {
  if (!Number.isFinite(now)) {
    throw new TypeError("開局要有一個有限嘅開始時間。");
  }
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    throw new TypeError("回合長度要係正數秒。");
  }
  if (!Number.isInteger(lives) || lives < 1) {
    throw new TypeError("至少要有一條命。");
  }
  if (!Number.isFinite(fallDurationMs) || fallDurationMs <= 0) {
    throw new TypeError("掉落時長要係正數毫秒。");
  }
  validateBank(bank);

  const label = String(seed);
  const base = {
    status: "running",
    seed: label,
    startedAt: now,
    updatedAt: now,
    durationSeconds,
    endsAt: now + durationSeconds * 1000,
    fallDurationMs,
    lives,
    livesLeft: lives,
    combo: 0,
    bestCombo: 0,
    spawned: 0,
    correct: 0,
    errors: 0,
    missed: 0,
    submitted: 0,
    lastResult: null,
    lastAnswer: "",
    lastTarget: null,
    finishedAt: null,
    finishedReason: null,
    bank,
    queue: [],
    rng: mulberry32(hashSeed(label)),
  };
  return spawnTarget(base, now);
}

export function tick(state, now) {
  if (!state || state.status !== "running") return state;
  if (!Number.isFinite(now) || now < state.startedAt) return state;
  if (now >= state.endsAt) return finish(state, state.endsAt, "time");

  let next = state;
  while (next.target && now >= next.target.deadline) {
    const missedAt = next.target.deadline;
    const livesLeft = next.livesLeft - 1;
    next = {
      ...next,
      livesLeft,
      missed: next.missed + 1,
      combo: 0,
      lastResult: "missed",
      lastAnswer: "",
      lastTarget: next.target,
      updatedAt: missedAt,
    };
    if (livesLeft <= 0) return finish(next, missedAt, "lives");
    next = spawnTarget(next, missedAt);
  }
  return { ...next, updatedAt: now };
}

export function typeSyllable(state, answer, now) {
  if (!state || state.status !== "running") return state;

  const ticked = tick(state, now);
  if (ticked.status !== "running") return ticked;
  // 石頭已經落地：遲到嘅輸入唔會當答錯，直接跟新目標重新開始。
  if (ticked.spawned !== state.spawned) return ticked;

  const normalized = normalizeAnswer(answer);
  if (!normalized) return ticked;

  const target = ticked.target;
  const correct = target.answers.includes(normalized);
  const combo = correct ? ticked.combo + 1 : 0;
  return spawnTarget({
    ...ticked,
    correct: ticked.correct + (correct ? 1 : 0),
    errors: ticked.errors + (correct ? 0 : 1),
    submitted: ticked.submitted + 1,
    combo,
    bestCombo: Math.max(ticked.bestCombo, combo),
    lastResult: correct ? "correct" : "incorrect",
    lastAnswer: normalized,
    lastTarget: target,
  }, now);
}

export function getFallProgress(state, now = state.updatedAt) {
  const target = state?.target;
  if (!target) return 0;
  const span = target.deadline - target.spawnedAt;
  if (!(span > 0)) return 1;
  return Math.min(1, Math.max(0, (now - target.spawnedAt) / span));
}

// 計分窗固定用回合長度（唔用實際已玩時間），免得提早用盡性命反而令 CPM 虛高。
// 連擊倍率只係場內氣氛，唔會入 officialScore，令成績同其他遊戲可以並排比較。
export function getRocksMetrics(state, now = state.updatedAt) {
  // 完場之後時間就凝住喺 finishedAt，之後再傳幾大嘅 now 都唔會影響結算。
  const effectiveNow = state.status === "finished" && Number.isFinite(state.finishedAt)
    ? state.finishedAt
    : Math.max(now, state.startedAt);
  const elapsedSeconds = Math.max(0, (effectiveNow - state.startedAt) / 1000);
  const scored = roundMetrics({
    correct: state.correct,
    submitted: state.submitted,
    seconds: state.durationSeconds,
  }, { threshold: OFFICIAL_THRESHOLDS.timed });

  return {
    ...scored,
    correct: state.correct,
    errors: state.errors,
    missed: state.missed,
    submitted: state.submitted,
    cleared: state.correct,
    combo: state.combo,
    bestCombo: state.bestCombo,
    multiplier: comboMultiplier(state.combo),
    livesLeft: state.livesLeft,
    lives: state.lives,
    elapsedSeconds,
    scoredSeconds: state.durationSeconds,
    remainingSeconds: Math.max(0, state.durationSeconds - elapsedSeconds),
    progress: Math.min(1, elapsedSeconds / state.durationSeconds),
    fallProgress: getFallProgress(state, effectiveNow),
    status: state.status,
    finishedReason: state.finishedReason,
    finishedAt: state.finishedAt,
  };
}
