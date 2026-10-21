// 聲韻解鎖塔：純邏輯，唔碰 DOM、window 或者 localStorage。
// 上層（tower-dom.mjs）負責畫畫面同寫入 storage；呢度只計狀態。
import { COMPONENTS, getComponentStats, splitJyutping } from "../../engine.mjs";
import { hashSeed, mulberry32, normalizeAnswer, roundMetrics, shuffled } from "../common.mjs";
import { BANK_WITH_COMPONENTS } from "./data.mjs";

export const ROUND_LENGTH = 10;
// 第 1 層目標 20 音節／分，之後每層加 2：層數越高、字越長，速度要求慢慢收緊。
export const BASE_CPM = 20;
export const CPM_STEP = 2;
export const ACCURACY_TARGET = 0.95;
const MAX_LOG = 500;
const MAX_ROUNDS = 100;

// 每層加嘅元件。全部加埋就係 COMPONENTS 嘅總和（19 聲母 + 11 韻腹 + 8 韻尾）。
// 順序：先聲母、再韻腹、最後韻尾；每層 3–5 個。
const STAGE_STEPS = [
  { initials: ["b", "p", "m", "f"], nuclei: ["aa", "i", "u"], codas: [] },
  { initials: ["d", "t", "n", "l"], nuclei: ["a"], codas: [] },
  { initials: ["g", "k", "ng", "h"], nuclei: ["e"], codas: [] },
  { initials: ["gw", "kw", "w"], nuclei: ["o", "oe"], codas: [] },
  { initials: ["z", "c", "s", "j"], nuclei: [], codas: [] },
  { initials: [], nuclei: ["eo", "yu", "m"], codas: ["i"] },
  { initials: [], nuclei: ["ng"], codas: ["u", "m", "n"] },
  { initials: [], nuclei: [], codas: ["ng", "p", "t", "k"] },
];

export const UNLOCK_STAGES = STAGE_STEPS.map((step, index) => ({ stage: index + 1, ...step }));
export const TOTAL_STAGES = UNLOCK_STAGES.length;

export function unlockedFor(stage) {
  const last = Math.min(Math.max(1, Math.trunc(Number(stage)) || 1), TOTAL_STAGES);
  const within = UNLOCK_STAGES.slice(0, last);
  return {
    unlockedInitials: within.flatMap(step => step.initials),
    unlockedNuclei: within.flatMap(step => step.nuclei),
    unlockedCodas: within.flatMap(step => step.codas),
  };
}

export function cpmTargetFor(stage) {
  const level = Math.min(Math.max(1, Math.trunc(Number(stage)) || 1), TOTAL_STAGES);
  return BASE_CPM + CPM_STEP * (level - 1);
}

function withComponents(entry) {
  return entry.initial !== undefined && entry.nucleus !== undefined && entry.coda !== undefined
    ? entry
    : { ...entry, ...splitJyutping(entry.answers[0]) };
}

function cap(items, limit) {
  return items.length > limit ? items.slice(-limit) : items;
}

function emptyRound(stage, accuracyTarget) {
  return {
    stage,
    questions: [],
    index: 0,
    answers: [],
    correct: 0,
    errors: 0,
    startedAt: null,
    updatedAt: null,
    finishedAt: null,
    metrics: null,
    outcome: null,
    cpmTarget: cpmTargetFor(stage),
    accuracyTarget,
  };
}

export function createTower({
  now = Date.now(),
  bank = BANK_WITH_COMPONENTS,
  saved = null,
  seed = null,
  accuracyTarget = ACCURACY_TARGET,
} = {}) {
  const restored = readProgress(saved);
  const status = restored.status;
  const stage = status === "completed" ? TOTAL_STAGES : restored.stage;
  const state = {
    status,
    stage,
    bank: bank.map(withComponents),
    ...unlockedFor(stage),
    accuracyTarget,
    startedAt: now,
    completedAt: restored.completedAt,
    log: restored.log,
    rounds: restored.rounds,
    round: emptyRound(stage, accuracyTarget),
  };
  if (status === "completed") return state;
  const nextSeed = seed === null ? hashSeed(`tower:${stage}:${state.rounds.length}:${now}`) : seed;
  return nextRound(state, nextSeed);
}

// 由已解鎖元件篩字：聲母要已解鎖（零聲母當已解鎖）、韻腹要已解鎖、有韻尾就要韻尾都解鎖。
export function poolFor(state, bank = state.bank) {
  return bank.filter(entry =>
    (entry.initial === "" || state.unlockedInitials.includes(entry.initial)) &&
    state.unlockedNuclei.includes(entry.nucleus) &&
    (entry.coda === "" || state.unlockedCodas.includes(entry.coda)));
}

export function nextRound(state, seed = 0) {
  if (state.status === "completed") return state;
  const pool = poolFor(state);
  // 盡量唔好連續兩輪出同一批字；字池唔夠就先照用返成個池。
  const previous = new Set(state.round.questions.map(question => question.hanzi));
  const fresh = pool.filter(entry => !previous.has(entry.hanzi));
  const source = fresh.length >= ROUND_LENGTH ? fresh : pool;
  const questions = shuffled(source, mulberry32(seed >>> 0)).slice(0, ROUND_LENGTH);
  const round = { ...emptyRound(state.stage, state.accuracyTarget), questions };
  // 極端情況（例如自訂字池太細）冇字可出，用 outcome 講清楚，唔好等上層自己猜。
  if (questions.length === 0) round.outcome = "empty";
  return { ...state, round };
}

export function submitAnswer(state, answer, now) {
  const round = state.round;
  if (state.status !== "playing" || !round || round.outcome !== null) return state;
  if (!Number.isFinite(now)) return state;
  const normalized = normalizeAnswer(answer);
  if (!normalized) return state;
  const question = round.questions[round.index];
  if (!question) return state;
  const correct = question.answers.includes(normalized);
  // 本輪由第一次提交開始計時，等玩家有時間睇題。
  const startedAt = round.startedAt ?? now;
  const next = {
    ...state,
    log: cap([...state.log, {
      hanzi: question.hanzi,
      answers: question.answers,
      answer: normalized,
      correct,
    }], MAX_LOG),
    round: {
      ...round,
      index: round.index + 1,
      answers: [...round.answers, { answer: normalized, correct }],
      correct: round.correct + (correct ? 1 : 0),
      errors: round.errors + (correct ? 0 : 1),
      startedAt,
      updatedAt: now,
      lastResult: correct ? "correct" : "incorrect",
      lastAnswer: normalized,
    },
  };
  return next.round.index < next.round.questions.length ? next : finishRound(next, now);
}

function finishRound(state, now) {
  const round = state.round;
  const seconds = Math.max(0, now - (round.startedAt ?? now)) / 1000;
  const metrics = roundMetrics(
    { correct: round.correct, submitted: round.answers.length, seconds },
    { threshold: state.accuracyTarget },
  );
  const passed = metrics.meetsThreshold && metrics.correctPerMinute >= round.cpmTarget;
  const rounds = cap([...state.rounds, {
    stage: state.stage,
    correct: round.correct,
    errors: round.errors,
    submitted: round.answers.length,
    accuracy: metrics.accuracy,
    correctPerMinute: metrics.correctPerMinute,
    seconds,
    passed,
    at: now,
  }], MAX_ROUNDS);
  const finished = { ...round, finishedAt: now, metrics, outcome: passed ? "passed" : "retry" };
  if (!passed) return { ...state, rounds, round: finished };
  const stage = state.stage + 1;
  if (stage > TOTAL_STAGES) {
    return { ...state, status: "completed", completedAt: now, rounds, round: { ...finished, outcome: "completed" } };
  }
  return { ...state, stage, ...unlockedFor(stage), rounds, round: finished };
}

function roundSeconds(round, now) {
  if (!round?.startedAt) return 0;
  const end = round.finishedAt ?? now ?? round.updatedAt ?? round.startedAt;
  return Math.max(0, end - round.startedAt) / 1000;
}

// 同主賽場一樣嘅計法：逐次提交用 splitJyutping 對返預期讀音嘅元件，
// 所以呢度直接叫 engine 嘅 getComponentStats，唔另寫一套。
function asRun(state) {
  return {
    questionSet: state.log.map(entry => ({ hanzi: entry.hanzi, answers: entry.answers })),
    answers: state.log.map(entry => ({ answer: entry.answer, correct: entry.correct })),
  };
}

export function getComponentAccuracy(state) {
  return getComponentStats(asRun(state));
}

export function getTowerStats(state, now = null) {
  const round = state.round;
  const metrics = round?.metrics ?? roundMetrics({
    correct: round?.correct ?? 0,
    submitted: round?.answers.length ?? 0,
    seconds: roundSeconds(round, now),
  }, { threshold: state.accuracyTarget });
  return {
    status: state.status,
    stage: state.stage,
    totalStages: TOTAL_STAGES,
    cpmTarget: round?.cpmTarget ?? cpmTargetFor(state.stage),
    accuracyTarget: round?.accuracyTarget ?? state.accuracyTarget,
    components: getComponentAccuracy(state),
    round: metrics,
    seconds: roundSeconds(round, now),
    index: round?.index ?? 0,
    total: round?.questions.length ?? 0,
    correct: round?.correct ?? 0,
    errors: round?.errors ?? 0,
    submitted: round?.answers.length ?? 0,
    outcome: round?.outcome ?? null,
    rounds: state.rounds.length,
    cleared: state.rounds.filter(item => item.passed).length,
    unlockedInitials: [...state.unlockedInitials],
    unlockedNuclei: [...state.unlockedNuclei],
    unlockedCodas: [...state.unlockedCodas],
    unlockedCount: state.unlockedInitials.length + state.unlockedNuclei.length + state.unlockedCodas.length,
    componentCount: Object.values(COMPONENTS).flat().length,
  };
}

// 弱項：已試過而且準確率低過門檻嘅元件（未解鎖嘅唔會計）。
export function getWeakComponents(state, { threshold = 80, minAttempts = 1 } = {}) {
  const stats = getComponentAccuracy(state);
  const weak = {};
  for (const [type, items] of Object.entries(stats)) {
    weak[type] = items
      .filter(item => item.total >= minAttempts && item.accuracy !== null && item.accuracy < threshold)
      .map(item => item.value);
  }
  return weak;
}

export function toSaved(state) {
  return {
    version: 1,
    stage: state.stage,
    status: state.status,
    completedAt: state.completedAt,
    rounds: cap(state.rounds, MAX_ROUNDS),
    log: cap(state.log, MAX_LOG),
  };
}

function readProgress(saved) {
  const blank = { stage: 1, status: "playing", completedAt: null, rounds: [], log: [] };
  if (!saved || typeof saved !== "object") return blank;
  const status = saved.status === "completed" ? "completed" : "playing";
  const stage = Number.isSafeInteger(saved.stage) && saved.stage >= 1 && saved.stage <= TOTAL_STAGES
    ? saved.stage : 1;
  return {
    stage,
    status,
    completedAt: Number.isFinite(saved.completedAt) ? saved.completedAt : null,
    rounds: Array.isArray(saved.rounds) ? cap(saved.rounds.filter(isRoundRecord), MAX_ROUNDS) : [],
    log: Array.isArray(saved.log) ? cap(saved.log.filter(isLogEntry), MAX_LOG) : [],
  };
}

function isRoundRecord(item) {
  return item && typeof item === "object" &&
    Number.isSafeInteger(item.stage) && item.stage >= 1 && item.stage <= TOTAL_STAGES &&
    Number.isSafeInteger(item.correct) && item.correct >= 0 &&
    Number.isFinite(item.accuracy) && Number.isFinite(item.correctPerMinute) &&
    typeof item.passed === "boolean";
}

function isLogEntry(item) {
  return item && typeof item === "object" &&
    typeof item.hanzi === "string" && typeof item.answer === "string" &&
    typeof item.correct === "boolean" &&
    Array.isArray(item.answers) && item.answers.length > 0 &&
    item.answers.every(answer => typeof answer === "string" && /^[a-z]+$/.test(answer));
}
