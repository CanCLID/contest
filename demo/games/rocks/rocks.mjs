// 粵拼落石純邏輯：唔會掂 DOM、window 或者 localStorage，node --test 可以直接 import。
// 掉落進度一律用注入嘅 now 計：目標出現時間 + fallDurationMs = 落地死線。
// 兩個模式：practice（預設，60 秒、3 條命）同 official（正式單字輪：90 秒、無命、
// 落地未擊破當一次提交錯誤，計分窗固定 T0——見 docs/INTEGRATION-PLAN.md §A2）。

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

// 正式單字輪（整合計劃 §A2）：固定 90 秒、無命。lives: null 代表唔計命，
// 等 official.mjs 可以直接 spread 呢個常數入 createRocksGame。
export const OFFICIAL_ROCKS = Object.freeze({
  mode: "official",
  durationSeconds: 90,
  lives: null,
});

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
  mode = "practice",
  durationSeconds,
  lives,
  bank = ROCK_QUESTIONS,
  fallDurationMs = FALL_DURATION_MS,
} = {}) {
  if (!Number.isFinite(now)) {
    throw new TypeError("開局要有一個有限嘅開始時間。");
  }
  if (mode !== "practice" && mode !== "official") {
    throw new TypeError("模式只可以係 practice 或者 official。");
  }
  const official = mode === "official";
  const roundSeconds = durationSeconds ?? (official ? OFFICIAL_ROCKS.durationSeconds : DEFAULT_DURATION_SECONDS);
  if (!Number.isFinite(roundSeconds) || roundSeconds <= 0) {
    throw new TypeError("回合長度要係正數秒。");
  }
  // 官方模式冇命：漏接唔會完場，lives 一律收埋。
  const roundLives = official ? null : (lives ?? DEFAULT_LIVES);
  if (!official && (!Number.isInteger(roundLives) || roundLives < 1)) {
    throw new TypeError("至少要有一條命。");
  }
  if (!Number.isFinite(fallDurationMs) || fallDurationMs <= 0) {
    throw new TypeError("掉落時長要係正數毫秒。");
  }
  validateBank(bank);

  const label = String(seed);
  const base = {
    status: "running",
    mode,
    seed: label,
    startedAt: now,
    updatedAt: now,
    durationSeconds: roundSeconds,
    endsAt: now + roundSeconds * 1000,
    fallDurationMs,
    lives: roundLives,
    livesLeft: roundLives,
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

// 目標落地（死線前未擊破）：一律斷連擊。練習模式扣命；官方模式冇命，
// 改為計入提交同錯誤，封死「跳過唔打保準確度」嘅漏洞（整合計劃 D-1）。
function recordMiss(state, missedAt) {
  const official = state.mode === "official";
  return {
    ...state,
    livesLeft: official ? state.livesLeft : state.livesLeft - 1,
    missed: state.missed + 1,
    submitted: official ? state.submitted + 1 : state.submitted,
    errors: official ? state.errors + 1 : state.errors,
    combo: 0,
    lastResult: "missed",
    lastAnswer: "",
    lastTarget: state.target,
    updatedAt: missedAt,
  };
}

export function tick(state, now) {
  if (!state || state.status !== "running") return state;
  if (!Number.isFinite(now) || now < state.startedAt) return state;
  const official = state.mode === "official";

  if (now >= state.endsAt) {
    // 官方模式：完場前落地嘅石頭一律照計漏接，唔可以靠一次過跳時間避開。
    let ended = state;
    if (official) {
      while (ended.target && ended.target.deadline < ended.endsAt) {
        const missedAt = ended.target.deadline;
        ended = spawnTarget(recordMiss(ended, missedAt), missedAt);
      }
    }
    return finish(ended, state.endsAt, "time");
  }

  let next = state;
  while (next.target && now >= next.target.deadline) {
    const missedAt = next.target.deadline;
    next = recordMiss(next, missedAt);
    if (!official && next.livesLeft <= 0) return finish(next, missedAt, "lives");
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
    mode: state.mode,
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
