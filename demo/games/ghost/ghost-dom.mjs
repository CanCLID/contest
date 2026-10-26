// Ghost Race — DOM layer for demo/games/ghost/.
// Renders the track (two lanes, or just the player's own lane in 「淨計時」
// mode), drives the shared engine (createRun / submitAnswer / undoAnswer /
// getMetrics) after explicit free-length confirmation, and keeps the
// player's best timeline in localStorage. With ?flow=1 it locks the built-in
// 55 syllables-per-minute demo ghost as company (atmosphere only, never part
// of the score) and writes the passage round into the official flow store.
import { createRun, getMetrics, splitJyutping, submitAnswer, undoAnswer } from "../../engine.mjs";
import { ARTICLE, QUESTIONS, flattenQuestions } from "../../questions.mjs";
import { OFFICIAL_THRESHOLDS, formatClock, readJson, roundMetrics, writeJson } from "../common.mjs";
import {
  flowNextHref,
  flowNextLabel,
  flowRoundLabel,
  flowRoundResult,
  readFlow,
  saveRoundResult,
  startFlow,
} from "../flow.mjs";
import { GHOST_CPM_PRESETS, GHOST_STORAGE_KEY, builtInGhosts, createGhostRace, ghostProgressAt, raceResult, recordTimelineFromTimes } from "./ghost.mjs";
import { initI18n, registerStrings, t } from "../../i18n.mjs";
import { FREE_INPUT_RULE_VERSION, MAX_FREE_INPUT, loadFreeInput, createFreeTrace, recordFreeEvent } from "../free-input.mjs";

export { GHOST_STORAGE_KEY };

const COUNTDOWN_MS = 3000;
const TICK_MS = 100;
const BEST_STORAGE_KEY = `${GHOST_STORAGE_KEY}:${FREE_INPUT_RULE_VERSION}`;
const TRACE_STORAGE_KEY = `${GHOST_STORAGE_KEY}:traces:${FREE_INPUT_RULE_VERSION}`;
const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];

// node vm 測試會剝走 import 直接跑呢個檔案，嗰陣冇 i18n 模組：照出繁體原文，
// 行為同未接 i18n 一樣。
const hasI18n = typeof t === "function";
const fill = (template, vars) => (vars
  ? template.replace(/\{(\w+)\}/g, (match, name) => (vars[name] != null ? String(vars[name]) : match))
  : template);
const tr = (key, hant, vars) => (hasI18n ? t(key, hant, vars) : fill(hant, vars));

if (typeof registerStrings === "function") {
  registerStrings({
    hans: {
      // index.html 嘅 data-i18n 靜態文案
      "ghost.skipLink": "跳去主要内容",
      "ghost.engineLoading": "正在准备输入…",
      "ghost.engineError": "输入模组未能载入，请重试。",
      "ghost.retryEngine": "重新载入",
      "ghost.exportTrace": "汇出本轮输入纪录（JSON）",
      "ghost.draftLabel": "待确认输入",
      "ghost.feedbackConfirmed": "已上屏 {count} 个字：{correct} 正确，{errors} 错误。",
      "ghost.feedbackInvalid": "只接受无声调粤拼字母，原本输入已保留。",
      "ghost.feedbackLimit": "输入超过 {limit} 个字母，原本输入已保留。",
      "ghost.feedbackEngine": "暂时未能处理，输入已保留，请再试一次。",
      "ghost.traceWarning": "本机纪录未能保存，仍可汇出本轮 JSON。",
      "ghost.traceTruncated": "输入纪录已达上限，汇出会标示缺失事件。",
      "ghost.brand": "粤拼竞速",
      "ghost.navArena": "试玩赛场",
      "ghost.badge": "幽灵竞速",
      "ghost.title": "幽灵竞速",
      "ghost.opponentHeading": "拣对手",
      "ghost.articleLabel": "今次嘅文章",
      "ghost.start": "开始竞速",
      "ghost.demoNote": "本机试玩，输入过程及幽灵时间线只存喺呢个浏览器，完场可以汇出。",
      "ghost.bestTime": "本机最佳时间",
      "ghost.bestSpeed": "速度",
      "ghost.bestDate": "纪录时间",
      "ghost.laneYou": "你",
      "ghost.laneGhost": "幽灵",
      "ghost.metricTime": "已用时间",
      "ghost.metricTimeUnit": "打完全文即结算",
      "ghost.metricSpeed": "正确音节／分钟",
      "ghost.metricSpeedUnit": "计啱嘅音节",
      "ghost.metricAccuracy": "准确度",
      "ghost.passageNote": "全文一次过打完，唔会分句停顿",
      "ghost.focusHint": "点一下文字继续输入",
      "ghost.hintConfirm": "确认；未输入时按",
      "ghost.hintUndo": "改上次提交",
      "ghost.storageNote": "未能保存本机最佳，关页后新纪录会遗失。",
      "ghost.countdownLabel": "准备起跑",
      "ghost.giveUp": "放弃本轮",
      "ghost.playAgain": "再玩一场",
      "ghost.editSettings": "拣过对手",
      // -dom.mjs 動態文案
      "ghost.lobbyBack": "‹ 游戏大厅",
      "ghost.lobbyBackTitle": "返游戏大厅",
      "ghost.lobbyExit": "‹ 退出流程",
      "ghost.lobbyExitTitle": "退出会丢弃三轮流程进度",
      "ghost.tagline": "拣一个幽灵对手，同佢斗快打完全篇粤文。幽灵照住固定节奏跑，你嘅成绩会即时同佢比较。",
      "ghost.startNote": "倒数 3 秒开始。逐字或者连打都得，按 Space／Enter 确认；可以跨句输入。",
      "ghost.flowBanner": "官方流程第 3 轮：篇章 · 示范幽灵陪跑，不影响计分 · 退出流程会丢弃三轮进度。",
      "ghost.flowTagline": "官方流程第 3 轮：篇章有内建 55 音节／分示范幽灵陪跑，纯粹气氛，成绩同对手无关。",
      "ghost.flowStartNote": "官方流程第 3 轮：篇章 · 内建 55 音节／分示范幽灵陪跑，不影响计分，倒数 3 秒开始。",
      "ghost.flowNext": "查看三轮成绩 →",
      "ghost.articleDetail": "示范粤文 · {total} 音节 · 同试玩赛场同一篇",
      "ghost.opponentSoloLabel": "净计时（唔设对手）",
      "ghost.opponentSoloDetail": "赛道只显示自己，专心计自己嘅时间同分数",
      "ghost.opponentBestLabel": "自己最佳",
      "ghost.opponentBestDetail": "{time} · {cpm} 音节／分 · 本机纪录",
      "ghost.opponentBestEmpty": "未有纪录，完成一次竞速就会出现",
      "ghost.opponentDemoLabel": "示范幽灵 · {cpm} 音节／分",
      "ghost.opponentDemoDetail": "目标时间 {time} · {total} 音节",
      "ghost.bestNote": "准确度 {percent}%",
      "ghost.speedValue": "{value} 音节／分",
      "ghost.sentenceLabel": "第 {index} 句 / {total} 句",
      "ghost.laneValue": "{done} / {total} 音节",
      "ghost.attemptsCount": "{correct} 正确 / {errors} 错误",
      "ghost.attemptsNone": "未有提交",
      "ghost.resultTitle": "完成喇！",
      "ghost.verdictWin": "你赢咗幽灵",
      "ghost.verdictLose": "幽灵快过你",
      "ghost.verdictTie": "同幽灵几乎同时冲线",
      "ghost.resultSummary": "{opponent} · 全文 {total} 音节",
      "ghost.resultSummaryFlow": "{opponent}（示范陪跑，不影响计分） · 全文 {total} 音节",
      "ghost.resultRowTime": "完成时间",
      "ghost.resultRowSpeed": "正确音节／分钟",
      "ghost.resultRowAccuracy": "答案准确度",
      "ghost.resultRowScore": "正式分",
      "ghost.resultRowGhost": "幽灵进度",
      "ghost.scorePass": "{score}（准确度门槛 {percent}%，达标）",
      "ghost.scoreFail": "{score}（准确度门槛 {percent}%，未达标）",
      "ghost.ghostLineFinished": "幽灵已经冲线，你落后 {n} 个音节",
      "ghost.ghostLineFinishedTie": "幽灵同你几乎同时冲线",
      "ghost.ghostLineAhead": "幽灵完成咗 {percent}%，你领先 {n} 个音节",
      "ghost.ghostLineClose": "幽灵完成咗 {percent}%，差距少于一个音节",
      "ghost.resultBestImproved": "已更新本机最佳：{time}，下次可以用「自己最佳」做对手。",
      "ghost.resultBestKept": "今次未快过本机最佳（{time}）。",
      "ghost.statusIdle": "赛道准备好",
      "ghost.statusReady": "准备起跑",
      "ghost.statusRunning": "竞速进行中",
      "ghost.statusFinished": "本轮已完成",
      "ghost.raceOpponentIdle": "本机试玩 · 无需登入",
      "ghost.raceOpponentSolo": "{opponent} · 全文 {total} 音节",
      "ghost.raceOpponentTimed": "{opponent} · 目标时间 {time}",
      "ghost.feedbackIdle": "拣好对手，按「开始竞速」。",
      "ghost.feedbackNext": "下一字：{hanzi}",
      "ghost.feedbackWrong": "未啱；按 Backspace 可以改返。",
      "ghost.feedbackUndo": "已恢复上次提交嘅 {count} 个字，修改后再确认。",
      "ghost.feedbackStart": "逐字或者连打都得，按 Space／Enter 确认；唔使打声调数字。",
      "ghost.feedbackReady": "准备好，倒数之后先开始输入。",
      "ghost.feedbackGivenUp": "本轮已放弃，唔会记录成绩。",
      "ghost.placeholderIdle": "准备好就开始",
      "ghost.placeholderCountdown": "倒数后输入粤拼",
      "ghost.placeholderRunning": "打粤拼，空白键确认",
      "ghost.announceStart": "开始！唔使打声调数字。",
      "ghost.announceResult": "{verdict}。完成时间 {time}，准确度 {percent}%。",
    },
  });
}

const tokens = flattenQuestions();
const total = tokens.length;
const ghosts = builtInGhosts(total);

let run = null;
let race = null;
let opponent = null;
let selectedOpponentId = "best";
let countdownEnds = null;
let ticker = null;
let draft = "";
let composing = false;
let resultSaved = false;
let currentGlyph = null;
let currentReading = null;
let storageAvailable = true;
let inputEngine = null;
let enginePromise = null;
let engineState = "loading";
let trace = null;
let lastExport = null;
let commits = [];
let commitSequence = 0;
let physicalEdit = null;
let compositionBase = null;
let compositionCommit = null;
let feedbackMessage = null;
let tracePersisted = true;
let best = readBest();

// Real per-syllable finish times for this run: submitTimes[position] is the
// clock reading of the submit that completed syllable `position + 1`. Undoing
// a syllable drops its entry, so the saved best replays what really happened.
const submitTimes = [];

// 官方三輪流程（?flow=1）：鎖定內建 55 音節／分示範幽靈陪跑（純氣氛，唔影響計分），
// 完場寫入 flow store 再接去成績卡。
const flowMode = (() => {
  try {
    return new URLSearchParams(location.search).get("flow") === "1";
  } catch {
    return false;
  }
})();
let flow = flowMode ? readFlow() ?? startFlow() : null;
if (flowMode) {
  selectedOpponentId = ghosts.find(ghost => ghost.correctPerMinute === GHOST_CPM_PRESETS[0])?.id ?? ghosts[0].id;
}

// 最近一次賽果，語言一轉要重新出過。
let lastResult = null;

// 「淨計時」：冇幽靈時間線，賽道只顯示自己嗰條進度條。
function soloOpponent() {
  return { id: "none", label: "淨計時（唔設對手）", correctPerMinute: 0, total, timeline: [] };
}

// 對手名：示範幽靈個名由 ghost.mjs 出，喺呢度按 locale 翻譯。
function opponentName(opponent) {
  if (opponent.id === "none") return tr("ghost.opponentSoloLabel", "淨計時（唔設對手）");
  if (opponent.id === "best") return tr("ghost.opponentBestLabel", "自己最佳");
  return tr("ghost.opponentDemoLabel", "示範幽靈 · {cpm} 音節／分", { cpm: opponent.correctPerMinute });
}

// 設定頁嘅固定文案；?flow=1 由 renderFlow 蓋過。
function renderSetupTexts() {
  if (!flowMode) {
    $("#lobby-link").textContent = tr("ghost.lobbyBack", "‹ 遊戲大廳");
    $("#lobby-link").title = tr("ghost.lobbyBackTitle", "返遊戲大廳");
    $("#tagline").textContent = tr("ghost.tagline", "揀一個幽靈對手，同佢鬥快打完全篇粵文。幽靈照住固定節奏跑，你嘅成績會即時同佢比較。");
    $("#start-note").textContent = tr("ghost.startNote", "倒數 3 秒開始。逐字或者連打都得，按 Space／Enter 確認；可以跨句輸入。");
  }
  $("#article-detail").textContent = tr("ghost.articleDetail", "示範粵文 · {total} 音節 · 同試玩賽場同一篇", { total });
}

function raceStatusText() {
  if (countdownEnds !== null) return tr("ghost.statusReady", "準備起跑");
  if (run?.status === "running") return tr("ghost.statusRunning", "競速進行中");
  if (run?.status === "finished") return tr("ghost.statusFinished", "本輪已完成");
  return tr("ghost.statusIdle", "賽道準備好");
}

function opponentLine() {
  if (!opponent) return tr("ghost.raceOpponentIdle", "本機試玩 · 無需登入");
  const name = opponentName(opponent);
  return opponent.id === "none"
    ? tr("ghost.raceOpponentSolo", "{opponent} · 全文 {total} 音節", { opponent: name, total })
    : tr("ghost.raceOpponentTimed", "{opponent} · 目標時間 {time}", { opponent: name, time: formatClock(targetSeconds(opponent)) });
}

function placeholderText() {
  if (countdownEnds !== null) return tr("ghost.placeholderCountdown", "倒數後輸入粵拼");
  if (run?.status === "running") return tr("ghost.placeholderRunning", "打粵拼，空白鍵確認");
  return tr("ghost.placeholderIdle", "準備好就開始");
}

// 狀態列、對手行同輸入框提示：唔論邊個階段都要跟 locale 重畫。
function renderStatusTexts() {
  $("#race-status").textContent = raceStatusText();
  $("#race-opponent").textContent = opponentLine();
  $("#answer").placeholder = placeholderText();
}

// 未開局時嘅提示文字，語言一轉都要跟。
function renderIdleTexts() {
  if (run || countdownEnds !== null) return;
  setText("#completed-count", tr("ghost.laneValue", "0 / {total} 音節", { total }));
  setText("#attempts", tr("ghost.attemptsNone", "未有提交"));
  setFeedback("ghost.feedbackIdle", "揀好對手，按「開始競速」。");
  renderStatusTexts();
}

function renderFlow() {
  if (!flowMode) return;
  $("#flow-banner").hidden = false;
  $("#flow-banner").textContent = tr("ghost.flowBanner",
    `${flowRoundLabel("passage")} · 示範幽靈陪跑，唔影響計分 · 退出流程會丟棄三輪進度。`);
  $("#lobby-link").textContent = tr("ghost.lobbyExit", "‹ 退出流程");
  $("#lobby-link").href = "../../index.html";
  $("#lobby-link").title = tr("ghost.lobbyExitTitle", "退出會丟棄三輪流程進度");
  $("#opponent-heading").hidden = true;
  $("#opponent-options").hidden = true;
  $("#best-card").hidden = true;
  $("#start-note").textContent = tr("ghost.flowStartNote", "官方流程第 3 輪：篇章 · 內建 55 音節／分示範幽靈陪跑，唔影響計分，倒數 3 秒開始。");
  $("#tagline").textContent = tr("ghost.flowTagline", "官方流程第 3 輪：篇章有內建 55 音節／分示範幽靈陪跑，純粹氣氛，成績同對手無關。");
}

function showFlowNext() {
  const next = $("#flow-next");
  next.hidden = false;
  next.href = flowNextHref("passage");
  next.textContent = tr("ghost.flowNext", flowNextLabel("passage"));
  $("#play-again").hidden = true;
  $("#edit-settings").hidden = true;
}

function announce(message) {
  $("#announcer").textContent = message;
}

function stopTicker() {
  clearInterval(ticker);
  ticker = null;
}

// A stored best run is only usable when it was recorded on the same article
// and its timeline still describes one submit per syllable.
function readBest() {
  const saved = readJson(BEST_STORAGE_KEY, null);
  if (!saved || saved.rulesVersion !== FREE_INPUT_RULE_VERSION || saved.total !== total) return null;
  if (!Number.isFinite(saved.elapsedSeconds) || saved.elapsedSeconds <= 0) return null;
  if (!Array.isArray(saved.timeline) || saved.timeline.length !== total) return null;
  const usable = saved.timeline.every((entry, position) =>
    entry && Number.isFinite(entry.at) && entry.index === position + 1);
  if (!usable) return null;
  return {
    version: saved.version ?? 2,
    rulesVersion: saved.rulesVersion,
    total: saved.total,
    elapsedSeconds: saved.elapsedSeconds,
    correctPerMinute: Number(saved.correctPerMinute) || 0,
    accuracy: Number(saved.accuracy) || 0,
    officialScore: Number(saved.officialScore) || 0,
    timeline: saved.timeline.map(entry => ({ at: entry.at, index: entry.index })),
    at: Number(saved.at) || 0,
  };
}

function targetSeconds(ghost) {
  const last = ghost.timeline.at(-1);
  return last ? last.at / 1000 : 0;
}

function opponentOption({ id, label, detail, disabled = false }) {
  const option = document.createElement("label");
  option.className = "opponent-option";
  option.dataset.opponent = id;
  if (disabled) option.classList.add("disabled");
  if (id === selectedOpponentId && !disabled) option.classList.add("selected");
  const input = document.createElement("input");
  input.type = "radio";
  input.name = "opponent";
  input.value = id;
  input.disabled = disabled;
  input.checked = id === selectedOpponentId && !disabled;
  const text = document.createElement("span");
  text.className = "opponent-text";
  const name = document.createElement("strong");
  name.textContent = label;
  const note = document.createElement("small");
  note.textContent = detail;
  text.append(name, note);
  option.append(input, text);
  return option;
}

function renderOpponents() {
  if (!currentOpponent()) selectedOpponentId = ghosts[0].id;
  const options = [opponentOption({
    id: "none",
    label: tr("ghost.opponentSoloLabel", "淨計時（唔設對手）"),
    detail: tr("ghost.opponentSoloDetail", "賽道只顯示自己，專心計自己嘅時間同分數"),
  })];
  if (best) {
    options.push(opponentOption({
      id: "best",
      label: tr("ghost.opponentBestLabel", "自己最佳"),
      detail: tr("ghost.opponentBestDetail", "{time} · {cpm} 音節／分 · 本機紀錄", {
        time: formatClock(best.elapsedSeconds),
        cpm: Math.round(best.correctPerMinute),
      }),
    }));
  } else {
    options.push(opponentOption({
      id: "best",
      label: tr("ghost.opponentBestLabel", "自己最佳"),
      detail: tr("ghost.opponentBestEmpty", "未有紀錄，完成一次競速就會出現"),
      disabled: true,
    }));
  }
  for (const ghost of ghosts) {
    options.push(opponentOption({
      id: ghost.id,
      label: opponentName(ghost),
      detail: tr("ghost.opponentDemoDetail", "目標時間 {time} · {total} 音節", {
        time: formatClock(targetSeconds(ghost)),
        total,
      }),
    }));
  }
  $("#opponent-options").replaceChildren(...options);
}

function renderBestCard() {
  const card = $("#best-card");
  card.hidden = flowMode || !best;
  if (!best) return;
  $("#best-time").textContent = formatClock(best.elapsedSeconds);
  $("#best-speed").textContent = tr("ghost.speedValue", "{value} 音節／分", { value: Math.round(best.correctPerMinute) });
  $("#best-date").textContent = best.at ? new Date(best.at).toLocaleString("zh-HK", {
    month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit",
  }) : "—";
  $("#best-note").textContent = tr("ghost.bestNote", "準確度 {percent}%", { percent: Math.round(best.accuracy * 100) });
}

function currentOpponent() {
  if (selectedOpponentId === "none") return soloOpponent();
  if (selectedOpponentId === "best") {
    return best ? {
      id: "best",
      label: "自己最佳",
      correctPerMinute: best.correctPerMinute,
      total: best.total,
      timeline: best.timeline,
    } : null;
  }
  return ghosts.find(ghost => ghost.id === selectedOpponentId) ?? null;
}

function readingParts(answer) {
  const { initial, nucleus, coda } = splitJyutping(answer);
  return [initial, nucleus + coda];
}

// Keep the submitted letters visible, including mistakes and omitted syllables.
function readingSegments(token, input, submitted) {
  if (!submitted || submitted.correct) return input ? [{ type: "typed", text: input }] : [];
  if (!input) return [{ type: "correct", text: token.answers[0] }, { type: "wrong", text: "∅" }];
  const actual = readingParts(input);
  const segments = [];
  readingParts(token.answers[0]).forEach((part, index) => {
    const typed = actual[index] ?? "";
    if (part === typed) {
      if (part) segments.push({ type: "typed", text: part });
      return;
    }
    if (index === 0 && typed) segments.push({ type: "wrong", text: typed });
    if (part) segments.push({ type: "correct", text: part });
    if (index === 1 && typed) segments.push({ type: "wrong", text: typed });
  });
  return segments;
}

function renderReading(reading, token, position) {
  const submitted = run?.answers[position];
  const input = submitted?.answer ?? "";
  const expected = submitted && !submitted.correct ? token.answers[0] : input;
  reading.replaceChildren(...readingSegments(token, input, submitted).map(({ type, text }) => {
    const element = document.createElement(type === "wrong" ? "del" : "span");
    element.className = `reading-${type}`;
    element.textContent = text;
    return element;
  }));
  reading.setAttribute("aria-label", submitted
    ? `${token.hanzi}：輸入 ${input || "（漏字）"}${!submitted.correct ? `，正確讀法 ${expected}` : ""}`
    : "");
}

function renderDraft() {
  setText("#draft", draft || "—");
  const anchor = $("#draft-anchor");
  anchor.hidden = !draft || run?.status !== "running" || !currentGlyph;
  if (!anchor.hidden) positionDraft();
}

// One floating draft follows the active glyph. Its width never participates in
// the article's flex layout, so a long chunk cannot widen or move the glyphs.
function positionDraft() {
  if (!currentGlyph || $("#draft-anchor").hidden) return;
  const surface = $("#typing-surface").getBoundingClientRect?.();
  const glyph = currentGlyph.getBoundingClientRect?.();
  const reading = currentReading?.getBoundingClientRect?.();
  if (!surface || !glyph || !reading || !surface.width) return;
  const anchor = $("#draft-anchor");
  anchor.style.maxWidth = `${Math.min(420, surface.width)}px`;
  anchor.style.left = `${Math.max(0, Math.min(glyph.left - surface.left, surface.width - anchor.offsetWidth))}px`;
  anchor.style.top = `${reading.top - surface.top - 4}px`;
  // Keep the most recent letters visible for very long drafts. Scroll the page
  // only when the anchored buffer actually leaves the viewport.
  anchor.scrollTop = anchor.scrollHeight;
  const bounds = anchor.getBoundingClientRect();
  const viewport = typeof window !== "undefined" ? window.visualViewport : null;
  const top = viewport?.offsetTop ?? 0;
  const bottom = top + (viewport?.height ?? window.innerHeight);
  if (bounds.top < top + 8 || glyph.bottom > bottom - 120) {
    currentGlyph.scrollIntoView({ block: "center", inline: "nearest" });
  }
}

function setFeedback(key, hant, vars) {
  feedbackMessage = [key, hant, vars];
  $("#input-feedback").textContent = tr(...feedbackMessage);
}

function record(type, details = {}, at = Date.now()) {
  if (trace && run?.status === "running") recordFreeEvent(trace, type, { index: run.index, ...details }, at);
}

function renderEngine() {
  $("#start").disabled = engineState !== "ready";
  $("#play-again").disabled = engineState !== "ready";
  $("#engine-status").hidden = engineState === "ready";
  $("#engine-status").textContent = engineState === "error"
    ? tr("ghost.engineError", "輸入模組未能載入，請重試。")
    : tr("ghost.engineLoading", "正在準備輸入…");
  $("#retry-engine").hidden = engineState !== "error";
}

function ensureEngine() {
  if (inputEngine) return Promise.resolve(inputEngine);
  if (enginePromise) return enginePromise;
  engineState = "loading";
  renderEngine();
  enginePromise = Promise.resolve().then(() => loadFreeInput()).then(engine => {
    inputEngine = engine;
    engineState = "ready";
    return engine;
  }).catch(() => { engineState = "error"; return null; }).finally(() => {
    enginePromise = null;
    renderEngine();
  });
  return enginePromise;
}

function renderPassage() {
  const index = run?.index ?? 0;
  const glyphs = [];
  let position = 0;
  currentGlyph = null;
  currentReading = null;

  for (const character of ARTICLE.text) {
    if (!/\p{Script=Han}/u.test(character)) {
      const punctuation = document.createElement("span");
      punctuation.className = "punctuation";
      punctuation.textContent = character;
      const previous = glyphs.at(-1);
      if (previous) {
        previous.classList.add("punctuated");
        previous.append(punctuation);
        continue;
      }
      glyphs.push(punctuation);
      continue;
    }
    const token = tokens[position];
    const glyph = document.createElement("span");
    glyph.className = "glyph";
    const ruby = document.createElement("ruby");
    ruby.className = "glyph-ruby";
    const hanzi = document.createElement("span");
    hanzi.className = "glyph-hanzi";
    hanzi.textContent = character;
    const reading = document.createElement("rt");
    reading.className = "glyph-reading";
    ruby.append(hanzi, reading);
    glyph.append(ruby);
    const submitted = run?.answers[position];
    if (submitted) glyph.classList.add(submitted.correct ? "correct" : "incorrect");
    if (run?.status === "running" && position === index) {
      glyph.classList.add("current");
      currentGlyph = glyph;
      currentReading = reading;
    }
    renderReading(reading, token, position);
    glyphs.push(glyph);
    position++;
  }

  $("#passage").replaceChildren(...glyphs);
  $("#passage").setAttribute("aria-label", run?.status === "running"
    ? `目前要打：${tokens[index]?.hanzi ?? ""}`
    : `${ARTICLE.title}，全文 ${total} 音節`);
  const sentenceIndex = tokens[Math.min(index, total - 1)].sentenceIndex;
  $("#sentence-label").textContent = tr("ghost.sentenceLabel", "第 {index} 句 / {total} 句", {
    index: String(sentenceIndex + 1).padStart(2, "0"),
    total: String(QUESTIONS.length).padStart(2, "0"),
  });
  currentGlyph?.scrollIntoView({ block: "nearest", inline: "nearest" });
  renderDraft();
}

// 高頻更新（100ms tick）只喺值有變先寫 DOM，避免重複寫入觸發無謂重排。
function setText(selector, value) {
  const node = $(selector);
  if (node.textContent !== value) node.textContent = value;
}

function setBar(barSelector, trackSelector, value) {
  const percent = Math.round(Math.min(1, Math.max(0, value)) * 100);
  const bar = $(barSelector);
  const width = `${percent}%`;
  if (bar.style.width !== width) bar.style.width = width;
  const track = $(trackSelector);
  const label = String(percent);
  if (track.getAttribute("aria-valuenow") !== label) track.setAttribute("aria-valuenow", label);
}

function renderRace(now = Date.now()) {
  if (!run) return;
  const metrics = getMetrics(run, now);
  const ghost = race ? ghostProgressAt(race, now) : 0;
  const solo = opponent?.id === "none";
  setBar("#player-bar", "#player-track", metrics.progress);
  setBar("#ghost-bar", "#ghost-track", ghost);
  if ($("#ghost-lane").hidden !== solo) $("#ghost-lane").hidden = solo;
  setText("#player-value", tr("ghost.laneValue", "{done} / {total} 音節", { done: metrics.submitted, total }));
  setText("#ghost-value", `${Math.round(ghost * 100)}%`);
  setText("#time", formatClock(metrics.elapsedSeconds));
  setText("#speed", String(Math.round(metrics.correctPerMinute)));
  setText("#accuracy", metrics.accuracy === null ? "—" : `${Math.round(metrics.accuracy)}%`);
  setText("#attempts", tr("ghost.attemptsCount", "{correct} 正確 / {errors} 錯誤", { correct: metrics.correct, errors: metrics.errors }));
  setText("#completed-count", tr("ghost.laneValue", "{done} / {total} 音節", { done: metrics.submitted, total }));
}

function focusAnswer() {
  if ($("#answer").disabled || $("#race-view").hidden) return;
  $("#typing-surface").focus({ preventScroll: true });
  $("#answer").focus({ preventScroll: true });
}

function restoreDraft() {
  $("#answer").value = draft;
  $("#answer").setSelectionRange(draft.length, draft.length);
  renderDraft();
}

// Programmatic restores do not count as edits and never submit automatically.
function setDraft(value, cursor = value.length, details = null) {
  const tooLong = typeof value === "string" && value.length > MAX_FREE_INPUT;
  if (typeof value !== "string" || !/^[a-z]*$/i.test(value) || tooLong) {
    record("rejected-input", { rawValue: value, reason: tooLong ? "length" : "non-latin", ...details });
    setFeedback(tooLong ? "ghost.feedbackLimit" : "ghost.feedbackInvalid",
      tooLong ? "輸入超過 {limit} 個字母，原本輸入已保留。" : "只接受無聲調粵拼字母，原本輸入已保留。", { limit: MAX_FREE_INPUT });
    restoreDraft();
    return false;
  }
  const before = draft;
  draft = value;
  const position = Math.min(Math.max(0, cursor ?? draft.length), draft.length);
  $("#answer").value = draft;
  $("#answer").setSelectionRange(position, position);
  if (details && before !== draft) record("edit", { before, after: draft, ...details });
  renderDraft();
  return true;
}

function inputSelection() {
  const input = $("#answer");
  const start = Number.isInteger(input.selectionStart) ? input.selectionStart : draft.length;
  const end = Number.isInteger(input.selectionEnd) ? input.selectionEnd : start;
  return { start: Math.max(0, Math.min(start, draft.length)), end: Math.max(0, Math.min(end, draft.length)) };
}

function editDraft(letter = null, details = {}) {
  if (!run || run.status !== "running") return;
  const selected = inputSelection();
  if (letter === null) {
    if (!draft) { undoLast(); return; }
    const start = selected.start === selected.end ? Math.max(0, selected.start - 1) : selected.start;
    setDraft(draft.slice(0, start) + draft.slice(selected.end), start,
      { source: "keydown", action: "delete", selection: selected, ...details });
  } else {
    setDraft(draft.slice(0, selected.start) + letter + draft.slice(selected.end), selected.start + letter.length,
      { source: "keydown", action: "insert", selection: selected, ...details });
  }
}

function submit() {
  if (!run || run.status !== "running" || composing || !inputEngine) return;
  const now = Date.now();
  const value = draft;
  record("submit-control", { raw: value }, now);
  if (!value) return;
  let plan;
  try { plan = inputEngine.grade(value, tokens.slice(run.index)); }
  catch {
    setFeedback("ghost.feedbackEngine", "暫時未能處理，輸入已保留，請再試一次。");
    return;
  }
  const startIndex = run.index;
  const commitId = plan.accepted.length ? `chunk-${++commitSequence}` : null;
  // Record the full observation before the final accepted token freezes run.
  record("submit", { commitId, raw: value, startIndex, plan }, now);
  for (const item of plan.accepted) {
    run = submitAnswer(run, item.answer, now, { allowEmpty: true });
    submitTimes[run.index - 1] = now;
  }
  submitTimes.length = run.index;
  if (run.index > startIndex) commits.push({ id: commitId, at: now, startIndex, endIndex: run.index,
    raw: value, attemptedRaw: value, remainder: "", accepted: plan.accepted });
  setDraft("");
  renderPassage();
  renderRace();
  if (run.status === "finished") { finishRace(now); return; }
  const correct = plan.accepted.filter(item => item.correct).length;
  setFeedback("ghost.feedbackConfirmed", "已上屏 {count} 個字：{correct} 正確，{errors} 錯誤。",
    { count: plan.accepted.length, correct, errors: plan.accepted.length - correct });
}

function undoLast() {
  if (!run || run.status !== "running" || draft || !commits.length) return;
  const commit = commits.at(-1);
  if (run.index !== commit.endIndex) return;
  const now = Date.now();
  record("undo", { commitId: commit.id, startIndex: commit.startIndex, endIndex: commit.endIndex, raw: commit.raw }, now);
  while (run.index > commit.startIndex) run = undoAnswer(run, now);
  commits.pop();
  submitTimes.length = run.index;
  setDraft(commit.raw);
  setFeedback("ghost.feedbackUndo", "已恢復上次提交嘅 {count} 個字，修改後再確認。", { count: commit.endIndex - commit.startIndex });
  renderPassage();
  renderRace();
}

function retainTrace(metrics, at) {
  recordFreeEvent(trace, "finish", { index: run.index, remainingRaw: draft, metrics }, at);
  lastExport = { ...trace, format: "canclid-free-input-trial-v1", segmenterVersion: inputEngine.version,
    prompts: tokens, finishedAt: at, finalCommits: commits, metrics,
    observation: "browser-text-edits; not a complete physical keystroke trace" };
  const saved = readJson(TRACE_STORAGE_KEY, []);
  let history = [...(Array.isArray(saved) ? saved : []), lastExport].slice(-10);
  tracePersisted = false;
  while (history.length) {
    if (writeJson(TRACE_STORAGE_KEY, history)) { tracePersisted = true; break; }
    history = history.slice(1);
  }
  $("#export-trace").hidden = false;
  renderTraceWarning();
}

function renderTraceWarning() {
  const notices = [];
  if (!tracePersisted) notices.push(tr("ghost.traceWarning", "本機紀錄未能保存，仍可匯出本輪 JSON。"));
  if (lastExport?.droppedEvents) notices.push(tr("ghost.traceTruncated", "輸入紀錄已達上限，匯出會標示缺失事件。"));
  $("#trace-warning").textContent = notices.join(" ");
  $("#trace-warning").hidden = !notices.length;
}

function exportTrace() {
  if (!lastExport) return;
  const url = URL.createObjectURL(new Blob([JSON.stringify(lastExport, null, 2)], { type: "application/json" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `jyutping-passage-${run.startedAt}.json`;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function ghostLine(summary) {
  const syllables = Math.abs(summary.leadSyllables ?? 0);
  const progressPercent = Math.round(summary.ghostProgress * 100);
  if (summary.ghostProgress >= 1) {
    return syllables === 0
      ? tr("ghost.ghostLineFinishedTie", "幽靈同你幾乎同時衝線")
      : tr("ghost.ghostLineFinished", "幽靈已經衝線，你落後 {n} 個音節", { n: syllables });
  }
  return syllables === 0
    ? tr("ghost.ghostLineClose", "幽靈完成咗 {percent}%，差距少於一個音節", { percent: progressPercent })
    : tr("ghost.ghostLineAhead", "幽靈完成咗 {percent}%，你領先 {n} 個音節", { percent: progressPercent, n: syllables });
}

// 判詞由 ghost.mjs（純邏輯）出，喺呢度按 locale 翻譯。
const VERDICT_KEYS = {
  "你贏咗幽靈": "ghost.verdictWin",
  "幽靈快過你": "ghost.verdictLose",
  "同幽靈幾乎同時衝線": "ghost.verdictTie",
};

function renderResult(summary, improved) {
  lastResult = { summary, improved };
  const solo = opponent?.id === "none";
  const name = opponentName(opponent);
  $("#result-title").textContent = solo
    ? tr("ghost.resultTitle", "完成喇！")
    : verdictText(summary.verdict);
  $("#result-summary").textContent = flowMode
    ? tr("ghost.resultSummaryFlow", "{opponent}（示範陪跑，唔影響計分） · 全文 {total} 音節", { opponent: name, total })
    : tr("ghost.resultSummary", "{opponent} · 全文 {total} 音節", { opponent: name, total });
  const thresholdPercent = Math.round(summary.threshold * 100);
  const score = summary.officialScore.toFixed(1);
  const rows = [
    [tr("ghost.resultRowTime", "完成時間"), formatClock(summary.elapsedSeconds)],
    [tr("ghost.resultRowSpeed", "正確音節／分鐘"), String(Math.round(summary.correctPerMinute))],
    [tr("ghost.resultRowAccuracy", "答案準確度"), `${Math.round(summary.accuracyPercent)}%`],
    [tr("ghost.resultRowScore", "正式分"), summary.meetsThreshold
      ? tr("ghost.scorePass", "{score}（準確度門檻 {percent}%，達標）", { score, percent: thresholdPercent })
      : tr("ghost.scoreFail", "{score}（準確度門檻 {percent}%，未達標）", { score, percent: thresholdPercent })],
    [tr("ghost.resultRowGhost", "幽靈進度"), solo ? "—" : ghostLine(summary)],
  ];
  $("#result-details").replaceChildren(...rows.map(([term, value]) => {
    const row = document.createElement("div");
    const dt = document.createElement("dt");
    dt.textContent = term;
    const dd = document.createElement("dd");
    dd.textContent = value;
    row.append(dt, dd);
    return row;
  }));
  $("#result-best").textContent = improved
    ? tr("ghost.resultBestImproved", "已更新本機最佳：{time}，下次可以用「自己最佳」做對手。", { time: formatClock(best.elapsedSeconds) })
    : tr("ghost.resultBestKept", "今次未快過本機最佳（{time}）。", { time: formatClock(best.elapsedSeconds) });
}

function verdictText(verdict) {
  return tr(VERDICT_KEYS[verdict] ?? "ghost.verdict", verdict);
}

function finishRace(now) {
  if (!run || run.status !== "finished" || resultSaved) return;
  resultSaved = true;
  stopTicker();

  const finishedAt = Number.isFinite(run.finishedAt) ? run.finishedAt : now;
  const metrics = getMetrics(run, finishedAt);
  const official = { ...roundMetrics(
    { correct: metrics.correct, submitted: metrics.submitted, seconds: metrics.elapsedSeconds },
    { threshold: OFFICIAL_THRESHOLDS.passage },
  ), rulesVersion: FREE_INPUT_RULE_VERSION };
  const ghost = race ? ghostProgressAt(race, finishedAt) : 0;
  const summary = raceResult({
    playerMetrics: {
      ...official,
      total,
      correct: metrics.correct,
      errors: metrics.errors,
      submitted: metrics.submitted,
      elapsedSeconds: metrics.elapsedSeconds,
      progress: 1,
    },
    ghostProgress: ghost,
    finishedFirst: ghost < 1,
  });

  const improved = !best || metrics.elapsedSeconds < best.elapsedSeconds;
  if (improved) {
    best = {
      version: 2,
      rulesVersion: FREE_INPUT_RULE_VERSION,
      total,
      elapsedSeconds: metrics.elapsedSeconds,
      correctPerMinute: official.correctPerMinute,
      accuracy: official.accuracy,
      officialScore: official.officialScore,
      // One recorded time per accepted submit, so the stored timeline is a
      // measurement rather than a reconstruction. Same shape as before.
      timeline: recordTimelineFromTimes(run.startedAt, submitTimes),
      at: Date.now(),
    };
    storageAvailable = writeJson(BEST_STORAGE_KEY, best);
  }

  retainTrace({ ...summary, rulesVersion: FREE_INPUT_RULE_VERSION }, finishedAt);
  renderResult(summary, improved);
  $("#storage-note").hidden = storageAvailable;
  $("#answer").disabled = true;
  $("#typing-surface").classList.remove("focused");
  $("#typing-form").hidden = true;
  $("#result").hidden = false;
  $("#give-up").hidden = true;
  if (flowMode) {
    // 流程內：寫入篇章輪結果，完場只可以睇三輪成績卡。
    flow = saveRoundResult(flow, "passage", flowRoundResult("passage", {
      correct: metrics.correct,
      submitted: metrics.submitted,
      elapsedSeconds: metrics.elapsedSeconds,
      rulesVersion: FREE_INPUT_RULE_VERSION,
    })) ?? flow;
    showFlowNext();
  } else {
    $("#play-again").hidden = false;
    $("#edit-settings").hidden = false;
  }
  $("#race-status").textContent = tr("ghost.statusFinished", "本輪已完成");
  $("#status-dot").classList.remove("live");
  document.body.classList.remove("running");
  announce(tr("ghost.announceResult", "{verdict}。完成時間 {time}，準確度 {percent}%。", {
    verdict: verdictText(summary.verdict),
    time: formatClock(summary.elapsedSeconds),
    percent: Math.round(summary.accuracyPercent),
  }));
}

function startRound() {
  if (countdownEnds !== null || run?.status === "running") return;
  if (!inputEngine) { void ensureEngine(); return; }
  const choice = currentOpponent();
  if (!choice) return;

  stopTicker();
  opponent = choice;
  run = null;
  race = null;
  draft = "";
  composing = false;
  resultSaved = false;
  lastExport = null;
  trace = null;
  tracePersisted = true;
  commits = [];
  commitSequence = 0;
  physicalEdit = null;
  compositionBase = null;
  compositionCommit = null;
  $("#export-trace").hidden = true;
  $("#trace-warning").hidden = true;
  submitTimes.length = 0;
  countdownEnds = Date.now() + COUNTDOWN_MS;

  document.body.classList.add("running");
  $("#setup-view").hidden = true;
  $("#race-view").hidden = false;
  $("#result").hidden = true;
  $("#typing-form").hidden = false;
  $("#play-again").hidden = true;
  $("#edit-settings").hidden = true;
  $("#give-up").hidden = false;
  $("#countdown-overlay").hidden = false;
  $("#countdown-number").textContent = String(Math.ceil(COUNTDOWN_MS / 1000));
  $("#status-dot").classList.remove("live");
  $("#answer").disabled = false;
  renderStatusTexts();
  setFeedback("ghost.feedbackReady", "準備好，倒數之後先開始輸入。");
  $("#player-value").textContent = tr("ghost.laneValue", "{done} / {total} 音節", { done: 0, total });
  setText("#attempts", tr("ghost.attemptsNone", "未有提交"));
  $("#ghost-value").textContent = "0%";
  setDraft("");
  renderPassage();
  renderRace();
  // Focus during the initiating tap so mobile browsers can open their keyboard.
  focusAnswer();
  tick();
  ticker = setInterval(tick, TICK_MS);
}

function tick() {
  const now = Date.now();
  if (countdownEnds !== null) {
    const remaining = Math.ceil((countdownEnds - now) / 1000);
    if (remaining > 0) {
      if ($("#countdown-number").textContent !== String(remaining)) {
        $("#countdown-number").textContent = String(remaining);
      }
      return;
    }
    run = createRun({ now: countdownEnds, questionSet: tokens });
    trace = createFreeTrace({ round: "passage", seed: ARTICLE.id ?? ARTICLE.title, startedAt: countdownEnds });
    record("start", { rulesVersion: FREE_INPUT_RULE_VERSION, opponent: opponent.id }, countdownEnds);
    race = opponent.id === "none" ? null : createGhostRace({ now: countdownEnds, total, timeline: opponent.timeline });
    countdownEnds = null;
    $("#countdown-overlay").hidden = true;
    $("#status-dot").classList.add("live");
    renderStatusTexts();
    setFeedback("ghost.feedbackStart", "逐字或者連打都得，按 Space／Enter 確認；唔使打聲調數字。");
    setDraft("");
    renderPassage();
    renderRace(now);
    if (!$("#race-view").hidden) focusAnswer();
    announce(tr("ghost.announceStart", "開始！唔使打聲調數字。"));
  }
  if (run) {
    renderRace(now);
    if (run.status === "finished") finishRace(now);
  }
}

function resetRound() {
  stopTicker();
  countdownEnds = null;
  run = null;
  race = null;
  opponent = null;
  draft = "";
  composing = false;
  resultSaved = false;
  lastResult = null;
  trace = null;
  lastExport = null;
  commits = [];
  feedbackMessage = null;
  submitTimes.length = 0;
  currentGlyph = null;
  currentReading = null;
  document.body.classList.remove("running");
  $("#setup-view").hidden = false;
  $("#race-view").hidden = true;
  $("#countdown-overlay").hidden = true;
  $("#typing-surface").classList.remove("focused");
  $("#answer").disabled = true;
  setDraft("");
  renderIdleTexts();
  renderOpponents();
  renderBestCard();
  $("#start").focus({ preventScroll: true });
}

function selectOpponent(id) {
  if (flowMode) return;
  selectedOpponentId = id;
  $$(".opponent-option").forEach(option => {
    option.classList.toggle("selected", option.dataset.opponent === id);
  });
}

$("#opponent-options").addEventListener("change", event => {
  const input = event.target.closest?.("input[name=opponent]");
  if (input && !input.disabled) selectOpponent(input.value);
});
$("#start").addEventListener("click", startRound);
$("#retry-engine").addEventListener("click", () => { void ensureEngine(); });
$("#export-trace").addEventListener("click", exportTrace);
$("#play-again").addEventListener("click", startRound);
$("#edit-settings").addEventListener("click", resetRound);
$("#give-up").addEventListener("click", () => {
  resetRound();
  const message = tr("ghost.feedbackGivenUp", "本輪已放棄，唔會記錄成績。");
  setFeedback("ghost.feedbackGivenUp", "本輪已放棄，唔會記錄成績。");
  announce(message);
});
$("#typing-form").addEventListener("submit", event => {
  event.preventDefault();
  submit();
});
$("#typing-surface").addEventListener("click", focusAnswer);
for (const selector of ["#answer", "#typing-surface"]) {
  $(selector).addEventListener("focus", () => $("#typing-surface").classList.add("focused"));
  $(selector).addEventListener("blur", () => $("#typing-surface").classList.remove("focused"));
}
function markPhysicalEdit(kind, data = null) {
  const token = { kind, data };
  physicalEdit = token;
  setTimeout(() => { if (physicalEdit === token) physicalEdit = null; }, 0);
}

function isPhysicalDuplicate(event) {
  if (!physicalEdit) return false;
  if (physicalEdit.kind === "delete") return event.inputType === "deleteContentBackward";
  if (physicalEdit.kind === "insert") return event.inputType === "insertText" &&
    typeof event.data === "string" && event.data.toLowerCase() === physicalEdit.data.toLowerCase();
  return event.inputType === "insertLineBreak" || event.inputType === "insertParagraph" ||
    (event.inputType === "insertText" && /^\s+$/u.test(event.data ?? ""));
}

$("#typing-surface").addEventListener("keydown", event => {
  if (event.ctrlKey || event.metaKey || event.altKey || event.key === "Tab") return;
  if (run?.status !== "running" || event.isComposing || composing) return;
  const letter = /^[a-z]$/i.test(event.key ?? "") ? event.key
    : /^Key[A-Z]$/.test(event.code ?? "") ? event.code.slice(3).toLowerCase() : null;
  if (letter) {
    event.preventDefault();
    markPhysicalEdit("insert", letter);
    editDraft(letter, { key: event.key, code: event.code, repeat: !!event.repeat });
    return;
  }
  const key = event.code === "Space" ? " " : event.code === "NumpadEnter" ? "Enter"
    : ["Enter", "Backspace"].includes(event.code) ? event.code : event.key;
  if (![" ", "Enter", "Backspace"].includes(key)) return;
  event.preventDefault();
  markPhysicalEdit(key === "Backspace" ? "delete" : "confirm");
  if (key !== "Backspace") submit();
  else editDraft();
});
$("#answer").addEventListener("compositionstart", () => {
  if (run?.status !== "running") return;
  physicalEdit = null;
  compositionBase = { draft, ...inputSelection() };
  composing = true;
  record("compositionstart", { buffer: draft, selection: inputSelection() });
});
$("#answer").addEventListener("compositionend", event => {
  if (run?.status !== "running") return;
  const base = compositionBase ?? { draft, start: draft.length, end: draft.length };
  composing = false;
  compositionBase = null;
  const data = event.data ?? "";
  record("compositionend", { data });
  if (!data) setDraft(base.draft, base.start);
  else setDraft(base.draft.slice(0, base.start) + data + base.draft.slice(base.end), base.start + data.length,
    { source: "composition", data, selection: { start: base.start, end: base.end } });
  compositionCommit = {};
  const token = compositionCommit;
  setTimeout(() => { if (compositionCommit === token) compositionCommit = null; }, 0);
});
$("#answer").addEventListener("beforeinput", event => {
  if (run?.status !== "running" || event.isComposing || composing) return;
  record("beforeinput", { inputType: event.inputType, data: event.data ?? null, selection: inputSelection() });
  if (isPhysicalDuplicate(event)) {
    if (event.cancelable !== false) event.preventDefault();
    return;
  }
  if ((event.inputType === "insertText" && /^\s+$/u.test(event.data ?? "")) ||
      event.inputType === "insertLineBreak" || event.inputType === "insertParagraph") {
    if (event.cancelable !== false) { event.preventDefault(); submit(); }
  } else if (event.inputType === "deleteContentBackward" && !draft) {
    if (event.cancelable !== false) event.preventDefault();
    undoLast();
  }
});
$("#answer").addEventListener("input", event => {
  if (run?.status !== "running") { restoreDraft(); return; }
  if (event.isComposing || composing) return;
  const value = $("#answer").value;
  if (compositionCommit && (/Composition/.test(event.inputType ?? "") || value === draft)) {
    compositionCommit = null;
    restoreDraft();
    return;
  }
  if (isPhysicalDuplicate(event)) { restoreDraft(); return; }
  physicalEdit = null;
  const confirm = /^[a-z]*\s+$/i.test(value);
  const text = confirm ? value.trimEnd() : value;
  const cursor = Math.min($("#answer").selectionStart ?? text.length, text.length);
  if (setDraft(text, cursor, { source: "input", inputType: event.inputType, data: event.data ?? null, rawValue: value }) && confirm) submit();
});
$("#answer").addEventListener("blur", () => { record("blur", { buffer: draft }); });
document.addEventListener("visibilitychange", () => {
  if (!document.hidden && (run?.status === "running" || countdownEnds !== null)) tick();
});

// 語言一轉就重畫動態介面（靜態文案由 i18n 運行庫自己換）。
if (typeof window !== "undefined") {
  window.addEventListener("resize", positionDraft);
  window.visualViewport?.addEventListener("resize", positionDraft);
  window.addEventListener("canclid-locale", () => {
    renderSetupTexts();
    renderIdleTexts();
    renderStatusTexts();
    renderOpponents();
    renderFlow();
    renderBestCard();
    renderPassage();
    renderRace();
    if (lastResult) renderResult(lastResult.summary, lastResult.improved);
    if (feedbackMessage) $("#input-feedback").textContent = tr(...feedbackMessage);
    renderEngine();
    renderTraceWarning();
    if (flowMode && resultSaved) showFlowNext();
  });
}

if (typeof initI18n === "function") initI18n();
$("#article-title").textContent = ARTICLE.title;
$("#answer").disabled = true;
renderSetupTexts();
renderIdleTexts();
renderOpponents();
renderFlow();
renderBestCard();
renderPassage();
renderRace();

$("#answer").setAttribute("maxlength", String(MAX_FREE_INPUT));
void ensureEngine();
