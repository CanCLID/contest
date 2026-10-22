// 官方三輪試玩流程（單字 → 詞組 → 篇章）嘅本機狀態同路由。純邏輯零 DOM，
// node --test 可以直接 import；三個遊戲頁同成績卡頁共用呢一個模組。
//
// 流程狀態存喺 sessionStorage（每個 tab 一次流程），完成紀錄存喺 localStorage。
// 狀態格式（version 1）：
//   {
//     version: 1,
//     startedAt: 1729580000000,   // 開流程嗰刻嘅 Date.now()
//     rounds: { single?: RoundResult, words?: RoundResult, passage?: RoundResult },
//     player: { name: "粵拼新星", group: "desktop" }   // 可選：主站帶入，成績卡顯示用
//   }
// RoundResult = { correct, submitted, seconds, accuracy, correctPerMinute,
//                 officialScore, meetsThreshold, threshold }
// `seconds`：定時輪（單字 90 秒／詞組 120 秒）＝固定計分窗；篇章＝實際完成用時。
// accuracy／correctPerMinute／officialScore／meetsThreshold 一律由 common.roundMetrics
// 按該輪門檻重新推導，所以寫入時點計都同正式計分方向一致。
//
// 完成紀錄（localStorage，key canclid-contest-official-flow-history，最多 20 條）：
//   { at, startedAt, rounds, totals } —— startedAt 用嚟認返係邊一次流程，唔會重複記錄。
//
// 路徑有三個起點，所以有三個 helper（全部由 FLOW_ROUTES 推導，唔會各寫一次）：
//   flowRoundPath(roundId)   相對 demo/games/（遊戲大廳）→ "./rocks/?flow=1"
//   flowHref(roundId)        相對 demo/（試玩賽場）→ "./games/rocks/?flow=1"
//   flowGameHref(roundId)    相對 demo/games/<game>/（遊戲頁）→ "../chain/?flow=1"
//
// 瀏覽器以外（node --test）冇 sessionStorage／localStorage：讀一律安全返回 null／[]，
// 寫一律返回 false，唔會 throw。測試可以暫時掛一個假 storage 上 globalThis。
import { registerStrings, t } from "../i18n.mjs";
import { roundMetrics } from "./common.mjs";
import { OFFICIAL_ROUND_ORDER, OFFICIAL_ROUNDS } from "./official.mjs";

// 簡體粵文譯文：輪次名同流程標籤喺度登記，三個遊戲頁同成績卡共用同一個 namespace。
registerStrings({
  hans: {
    "flow.round.single": "单字",
    "flow.round.words": "词组",
    "flow.round.passage": "篇章",
    "flow.roundLabel": "官方流程第 {index} 轮：{label}",
    "flow.nextRound": "前往第 {index} 轮：{label} →",
    "flow.nextSummary": "查看三轮成绩 →",
  },
});

export const FLOW_VERSION = 1;
export const FLOW_STORAGE_KEY = "canclid-contest-official-flow";
export const FLOW_HISTORY_KEY = "canclid-contest-official-flow-history";
export const FLOW_HISTORY_LIMIT = 20;

// 輪次序、標籤、時限同門檻全部由 official.mjs 推導，唔喺呢度再抄一次。
export const FLOW_ROUNDS = Object.freeze(OFFICIAL_ROUND_ORDER.map(id => Object.freeze({
  id,
  index: OFFICIAL_ROUND_ORDER.indexOf(id),
  label: OFFICIAL_ROUNDS[id].label,
  game: OFFICIAL_ROUNDS[id].game,
  durationSeconds: Number.isFinite(OFFICIAL_ROUNDS[id].durationSeconds)
    ? OFFICIAL_ROUNDS[id].durationSeconds
    : null,
  threshold: OFFICIAL_ROUNDS[id].threshold,
})));

export const FLOW_ROUTES = Object.freeze({
  single: "./rocks/?flow=1",
  words: "./chain/?flow=1",
  passage: "./ghost/?flow=1",
  summary: "./summary/",
});

function route(roundId, prefix) {
  const path = Object.hasOwn(FLOW_ROUTES, roundId) ? FLOW_ROUTES[roundId] : null;
  return path === null ? null : `${prefix}${path.slice(2)}`;
}

export function flowRoundPath(roundId) {
  return Object.hasOwn(FLOW_ROUTES, roundId) ? FLOW_ROUTES[roundId] : null;
}

export function flowHref(roundId) {
  return route(roundId, "./games/");
}

export function flowGameHref(roundId) {
  return route(roundId, "../");
}

export function flowRound(roundId) {
  return FLOW_ROUNDS.find(round => round.id === roundId) ?? null;
}

// 輪次名跟界面語言出（繁體單字／簡體单字），譯文缺咗就退回 official.mjs 嘅原文。
function roundLabel(round) {
  return t(`flow.round.${round.id}`, round.label);
}

// "官方流程第 2 輪：詞組"，遊戲頁鎖定官方模式時顯示。
export function flowRoundLabel(roundId) {
  const round = flowRound(roundId);
  if (!round) return "";
  return t("flow.roundLabel", "官方流程第 {index} 輪：{label}", {
    index: round.index + 1,
    label: roundLabel(round),
  });
}

// 下一輪係邊個；最後一輪之後係成績卡。
export function flowNextRound(roundId) {
  const round = flowRound(roundId);
  if (!round) return null;
  return FLOW_ROUNDS[round.index + 1]?.id ?? "summary";
}

// "前往第 3 輪：篇章 →" / "查看三輪成績 →"
export function flowNextLabel(roundId) {
  const next = flowNextRound(roundId);
  if (next === null) return "";
  if (next === "summary") return t("flow.nextSummary", "查看三輪成績 →");
  const round = flowRound(next);
  return t("flow.nextRound", "前往第 {index} 輪：{label} →", {
    index: round.index + 1,
    label: roundLabel(round),
  });
}

export function flowNextHref(roundId) {
  return flowGameHref(flowNextRound(roundId));
}

function browserStorage(kind) {
  try {
    const storage = globalThis[kind === "local" ? "localStorage" : "sessionStorage"];
    return storage && typeof storage.getItem === "function" && typeof storage.setItem === "function"
      ? storage
      : null;
  } catch {
    // 私隱模式下淨係讀取 storage 屬性都可能 throw。
    return null;
  }
}

function readJsonFrom(storage, key) {
  if (!storage) return null;
  try {
    const raw = storage.getItem(key);
    return raw === null ? null : JSON.parse(raw);
  } catch {
    return null;
  }
}

function writeJsonTo(storage, key, value) {
  if (!storage) return false;
  try {
    storage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

function count(value) {
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 ? number : null;
}

function duration(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function normalizePlayer(player) {
  if (!player || typeof player !== "object") return null;
  const name = typeof player.name === "string" && player.name.trim() !== ""
    ? player.name.trim().slice(0, 16)
    : null;
  const group = player.group === "mobile" || player.group === "desktop" ? player.group : null;
  return name === null && group === null ? null : { name: name ?? "粵拼新星", group: group ?? "desktop" };
}

// 一個輪次結果：驗證 correct／submitted／seconds，其餘欄位一律按該輪門檻重算。
export function normalizeRoundResult(roundId, value) {
  const round = flowRound(roundId);
  if (!round) throw new TypeError(`未知嘅流程輪次：${roundId}`);
  if (!value || typeof value !== "object") return null;
  const correct = count(value.correct);
  const submitted = count(value.submitted);
  const seconds = duration(value.seconds);
  if (correct === null || submitted === null || seconds === null) return null;
  const scored = roundMetrics({ correct, submitted, seconds }, { threshold: round.threshold });
  return {
    correct,
    submitted,
    seconds,
    accuracy: scored.accuracy,
    correctPerMinute: scored.correctPerMinute,
    officialScore: scored.officialScore,
    meetsThreshold: scored.meetsThreshold,
    threshold: round.threshold,
  };
}

// 由遊戲 metrics 砌出 RoundResult：定時輪用固定計分窗（scoredSeconds），篇章用實際用時。
export function flowRoundResult(roundId, metrics = {}) {
  const round = flowRound(roundId);
  if (!round) throw new TypeError(`未知嘅流程輪次：${roundId}`);
  const timed = Number.isFinite(round.durationSeconds);
  const scoredSeconds = duration(metrics.scoredSeconds);
  const elapsed = duration(metrics.elapsedSeconds) ?? duration(metrics.seconds);
  const seconds = timed ? scoredSeconds ?? round.durationSeconds : elapsed ?? 0;
  return normalizeRoundResult(roundId, {
    correct: metrics.correct,
    submitted: metrics.submitted,
    seconds,
  });
}

// 讀 sessionStorage 入面嘅流程；冇、壞咗或者版本唔啱都返回 null。
export function readFlow() {
  return normalizeFlow(readJsonFrom(browserStorage("session"), FLOW_STORAGE_KEY));
}

// 任何來源嘅流程物件都收斂成同一個形狀：冇效輪次會剔走，數值一律重算。
function normalizeFlow(value) {
  if (!value || typeof value !== "object" || value.version !== FLOW_VERSION) return null;
  if (!Number.isFinite(value.startedAt)) return null;
  const rounds = {};
  for (const round of FLOW_ROUNDS) {
    const result = normalizeRoundResult(round.id, value.rounds?.[round.id]);
    if (result) rounds[round.id] = result;
  }
  const player = normalizePlayer(value.player);
  return player
    ? { version: FLOW_VERSION, startedAt: value.startedAt, rounds, player }
    : { version: FLOW_VERSION, startedAt: value.startedAt, rounds };
}

// 開一個新流程（覆蓋舊嘅），順便記低暱稱同組別畀成績卡顯示。
export function startFlow(now = Date.now(), player = null) {
  const flow = { version: FLOW_VERSION, startedAt: Number.isFinite(now) ? now : Date.now(), rounds: {} };
  const normalized = normalizePlayer(player);
  if (normalized) flow.player = normalized;
  writeJsonTo(browserStorage("session"), FLOW_STORAGE_KEY, flow);
  return flow;
}

// 寫入一輪結果。`store` 係 readFlow() 讀到嘅流程物件（冇流程就返回 null，唔會無中生有）。
export function saveRoundResult(store, roundId, result) {
  const flow = normalizeFlow(store);
  if (!flow) return null;
  const normalized = normalizeRoundResult(roundId, result);
  if (!normalized) return null;
  const next = { ...flow, rounds: { ...flow.rounds, [roundId]: normalized } };
  writeJsonTo(browserStorage("session"), FLOW_STORAGE_KEY, next);
  return next;
}

export function clearFlow() {
  const storage = browserStorage("session");
  if (!storage) return false;
  try {
    storage.removeItem(FLOW_STORAGE_KEY);
    return true;
  } catch {
    return false;
  }
}

// 三輪加埋嘅本機數字（唔係正式結算：正式排名要組內中位數標準化）。
export function flowTotals(source = {}) {
  const rounds = source?.rounds && typeof source.rounds === "object" ? source.rounds : source ?? {};
  const done = FLOW_ROUNDS.map(round => round.id).filter(id => rounds[id]);
  const sum = key => done.reduce((total, id) => total + (Number(rounds[id][key]) || 0), 0);
  return {
    rounds: done.length,
    complete: done.length === FLOW_ROUNDS.length,
    correct: sum("correct"),
    submitted: sum("submitted"),
    officialScore: sum("officialScore"),
    meetsAllThresholds: done.length > 0 && done.every(id => rounds[id].meetsThreshold === true),
  };
}

function normalizeHistoryEntry(entry) {
  if (!entry || typeof entry !== "object" || !Number.isFinite(entry.at)) return null;
  const rounds = normalizeFlow({ ...entry, version: FLOW_VERSION, startedAt: entry.at })?.rounds ?? {};
  const startedAt = Number.isFinite(entry.startedAt) ? entry.startedAt : entry.at;
  return { at: entry.at, startedAt, rounds, totals: flowTotals(rounds) };
}

export function readFlowHistory() {
  const saved = readJsonFrom(browserStorage("local"), FLOW_HISTORY_KEY);
  if (!Array.isArray(saved)) return [];
  return saved.map(normalizeHistoryEntry).filter(Boolean).slice(-FLOW_HISTORY_LIMIT);
}

// 記低一次流程：同一個 startedAt 唔會重複寫，最多保留最近 FLOW_HISTORY_LIMIT 條。
export function appendFlowHistory(flow, totals = null) {
  const normalized = normalizeFlow(flow);
  if (!normalized) return readFlowHistory();
  const entry = {
    at: Date.now(),
    startedAt: normalized.startedAt,
    rounds: normalized.rounds,
    totals: totals ?? flowTotals(normalized.rounds),
  };
  const kept = readFlowHistory().filter(item => item.startedAt !== normalized.startedAt);
  const next = [...kept, entry].slice(-FLOW_HISTORY_LIMIT);
  writeJsonTo(browserStorage("local"), FLOW_HISTORY_KEY, next);
  return next;
}
