// DOM layer for 「粵拼詞鏈」. Input handling follows demo/app.mjs: ASCII
// event.key first with a KeyA–KeyZ fallback, letters only, a visually hidden
// native input so phone keyboards open, Space/Enter to submit and Backspace to
// delete a letter or to recall the previous syllable when the draft is empty.
import { OFFICIAL_CHAIN, createChainGame, finishByTime, getChainMetrics, recallSyllable, typeSyllable } from "./chain.mjs";
import { CHAIN_BANK } from "./data.mjs";
import { comboMultiplier, formatClock, normalizeAnswer, readJson, writeJson } from "../common.mjs";
import {
  flowNextHref,
  flowNextLabel,
  flowRoundLabel,
  flowRoundResult,
  readFlow,
  saveRoundResult,
  startFlow,
} from "../flow.mjs";
import { initI18n, registerStrings, t as i18nT } from "../../i18n.mjs";

// node --test 用 vm 跑呢個檔（import 會被剝走），嗰陣冇 i18n 全局：
// t() 直接出返繁體原文，其餘 i18n 呼叫一律要頂得住。
const t = typeof i18nT === "function" ? i18nT : (key, hantText) => hantText;

const STORAGE_KEY = "canclid-contest-games-chain";
const MODE_STORAGE_KEY = "canclid-contest-games-chain-mode";
const WORD_COUNT = 20;
const KEEP_PLAYS = 10;
const MODE_NOTES = {
  practice: `練習模式：打完 ${WORD_COUNT} 個詞完場，成績只存本機。`,
  official: "官方模式（正式詞組輪）：固定 120 秒連續題流，到點自動收卷。",
};

// 全部動態文案嘅簡體譯文（繁體原文喺 t() 行內做 fallback）。
if (typeof registerStrings === "function") {
  registerStrings({ hans: {
    "chain.docTitle": "粤拼词链 · CanCLID",
    "chain.skipLink": "跳去主要内容",
    "chain.lobbyLink": "‹ 游戏大厅",
    "chain.badge": "小游戏",
    "chain.arenaLink": "试玩赛场",
    "chain.title": "粤拼词链",
    "chain.heroNote": "顺住词语逐个音节打。词语全对就连击 +1，倍率最高 ×1.5。",
    "chain.howTitle": "玩法",
    "chain.rule1a": "每次打一个音节，按",
    "chain.rule1b": "或",
    "chain.rule1c": "确认；啱同错都会去下一个音节。",
    "chain.rule2": "一个词全部音节都打啱 → 连击 +1；个词有任何一个错 → 连击即刻归零。",
    "chain.rule3": "每个打啱嘅音节得 1 分 × 当时倍率。倍率 = 1 + 0.1 × 连击，最高",
    "chain.rule4a": "未输入字母时按",
    "chain.rule4b": "可以退回上一个已提交音节重打，分数同连击一齐回滚。",
    "chain.rule5": "练习模式打完 20 个词即完场。成绩用「正确音节／分钟 × 准确度」，准确度未够 90% 唔达标。",
    "chain.rule6": "官方模式（正式词组轮）：固定 120 秒连续题流，到点自动收卷，计分窗照 120 秒计。",
    "chain.rule7": "成绩只存喺呢个浏览器，唔会上传。",
    "chain.startTitle": "开始",
    "chain.modeLabel": "模式",
    "chain.modePractice": "练习",
    "chain.modeOfficial": "官方",
    "chain.modeNote.practice": "练习模式：打完 20 个词完场，成绩只存本机。",
    "chain.modeNote.official": "官方模式（正式词组轮）：固定 120 秒连续题流，到点自动收卷。",
    "chain.seedLabel": "Seed（可以留空）",
    "chain.seedPlaceholder": "留空＝随机",
    "chain.seedNote": "同一个 seed 会出同一串词，可以同朋友用同一串词对赛。",
    "chain.start": "开始游戏",
    "chain.draftLabel": "输入",
    "chain.metricScore": "得分",
    "chain.metricCpm": "正确音节／分",
    "chain.metricAccuracy": "准确度",
    "chain.resultCpmLabel": "正确音节／分钟",
    "chain.resultAccuracyLabel": "准确度",
    "chain.resultScoreLabel": "正式分",
    "chain.resultThresholdLabel": "90% 门槛",
    "chain.resultBestLabel": "本地最佳",
    "chain.resultDetailLabel": "连击 · 得分",
    "chain.playAgain": "再玩一场",
    "chain.resultLobby": "返去游戏大厅",
    // 輪次名同「前往第 N 輪」由 flow.mjs 出譯文（flow.round.*／flow.nextRound），
    // 呢度只譯頁面自己嗰截。
    "chain.flowBanner": "{label} · 固定 120 秒连续题流 · 退出流程会丢弃三轮进度。",
    "chain.flowModeNote": "官方流程锁定官方规则：固定 120 秒连续题流，到点自动收卷；seed 每局随机，开局后显示。",
    "chain.exitFlow": "‹ 退出流程",
    "chain.exitFlowTitle": "退出会丢弃三轮流程进度",
    "chain.wordDone": "全部词语已完成",
    "chain.wordAria": "{word}，第 {syllable} 个音节",
    "chain.progressOfficial": "第 {n} 个词 · 官方轮",
    "chain.progressPractice": "第 {n} / {total} 个词",
    "chain.timeRemaining": "剩余时间",
    "chain.timeElapsed": "已用时间",
    "chain.combo": "连击 {n}",
    "chain.multiplier": "倍率 ×{value}",
    "chain.bestNote": "本地最佳：正式分 {score}（{when}，seed {seed}）",
    "chain.bestEmpty": "本地最佳：未有纪录。",
    "chain.seedFlow": "{label} · seed {seed}",
    "chain.seedOfficial": "官方轮 · seed {seed}",
    "chain.seedPlain": "seed {seed}",
    "chain.feedbackIdle": "打粤拼，Space 或 Enter 确认；未输入时按 Backspace 改上一个音节。",
    "chain.announceStartOfficial": "开始！官方轮固定 {seconds} 秒，seed {seed}。",
    "chain.announceStartPractice": "开始！本场 seed {seed}，共 {words} 个词。",
    "chain.feedbackWordCorrect": "「{word}」全对！连击 {combo}，下次倍率 ×{multiplier}。",
    "chain.feedbackWordIncorrect": "「{word}」有错，连击归零，重新储倍率。",
    "chain.feedbackCorrect": "啱！继续打下一个音节。",
    "chain.feedbackIncorrect": "唔啱，照样前进；未输入时按 Backspace 可以退回上一个音节。",
    "chain.feedbackBlank": "空白提交唔计分，打字母先。",
    "chain.recallFirst": "已经喺第一个音节，冇得再退。",
    "chain.recallDone": "已退回上一个音节，重新打过。",
    "chain.announceRecall": "退回上一个音节：{word}",
    "chain.resultTitleOfficial": "时间到，收卷！",
    "chain.resultTitleBest": "完成喇！新纪录！",
    "chain.resultTitleDone": "完成喇！",
    "chain.resultCpm": "{value} 音节／分",
    "chain.thresholdOfficialPass": "达 {threshold}% 门槛，计入正式赛排名",
    "chain.thresholdOfficialFail": "未达 {threshold}% 门槛，正式赛不计排名",
    "chain.thresholdPracticePass": "达标",
    "chain.thresholdPracticeFail": "未达标（要 {threshold}% 准确度）",
    "chain.windowNote": "官方模式：固定 {seconds} 秒计分窗。",
    "chain.resultBest": "正式分 {score}（{when}）",
    "chain.resultBestEmpty": "未有纪录",
    "chain.resultDetail": "连击 {combo} · 得分 {score}",
    "chain.resultSummary": "本场 seed {seed}：{words} 个词、{syllables} 个音节，用时 {clock}，啱 {correct}、错 {errors}。",
    "chain.announceFinish": "完成。正确音节每分钟 {cpm}，准确度 {accuracy}%。",
  } });
}

const $ = selector => document.querySelector(selector);

let state = null;
let draft = "";
let composing = false;
let physicalEdit = null;
let ticker = null;
let lastSeed = "";
let lastResult = null;
let mode = readJson(MODE_STORAGE_KEY, null) === "official" ? "official" : "practice";

// 官方三輪流程（?flow=1）：鎖定官方詞組輪，完場寫入 flow store 再接去篇章。
const flowMode = (() => {
  try {
    return new URLSearchParams(location.search).get("flow") === "1";
  } catch {
    return false;
  }
})();
let flow = flowMode ? readFlow() ?? startFlow() : null;
if (flowMode) mode = "official";

function renderFlow() {
  if (!flowMode) return;
  const label = flowRoundLabel("words");
  $("#flow-banner").hidden = false;
  $("#flow-banner").textContent = t("chain.flowBanner",
    `${label} · 固定 120 秒連續題流 · 退出流程會丟棄三輪進度。`, { label });
  $("#lobby-link").textContent = t("chain.exitFlow", "‹ 退出流程");
  $("#lobby-link").href = "../../index.html";
  $("#lobby-link").title = t("chain.exitFlowTitle", "退出會丟棄三輪流程進度");
  $("#mode-picker").hidden = true;
  $("#seed-field").hidden = true;
  $("#seed").hidden = true;
  $("#seed-note").hidden = true;
  $("#mode-note").textContent = t("chain.flowModeNote", "官方流程鎖定官方規則：固定 120 秒連續題流，到點自動收卷；seed 每局隨機，開局後顯示。");
}

function showFlowNext() {
  const next = $("#flow-next");
  next.hidden = false;
  next.href = flowNextHref("words");
  next.textContent = flowNextLabel("words");
  $("#result-lobby").hidden = true;
}

function announce(message) {
  $("#announcer").textContent = message;
}

function showView(view) {
  for (const section of document.querySelectorAll(".view")) {
    section.hidden = section.id !== `${view}-view`;
  }
  document.body.classList.toggle("playing", view === "play");
}

function focusTyping() {
  $("#answer").focus({ preventScroll: true });
}

function renderMode() {
  const official = mode === "official";
  const practiceButton = $("#mode-practice");
  const officialButton = $("#mode-official");
  practiceButton.classList.toggle("selected", !official);
  practiceButton.setAttribute("aria-pressed", String(!official));
  officialButton.classList.toggle("selected", official);
  officialButton.setAttribute("aria-pressed", String(official));
  $("#mode-note").textContent = t(`chain.modeNote.${mode}`, MODE_NOTES[mode]);
}

function selectMode(next) {
  if (flowMode) return;
  mode = next === "official" ? "official" : "practice";
  writeJson(MODE_STORAGE_KEY, mode);
  renderMode();
}

// --- rendering ------------------------------------------------------------

// Red struck-through wrong part plus the green correct part, like the arena.
function comparison(typed, expected) {
  const nodes = [];
  let prefix = 0;
  while (prefix < typed.length && prefix < expected.length && typed[prefix] === expected[prefix]) prefix++;
  const push = (tag, className, text) => {
    if (!text) return;
    const node = document.createElement(tag);
    node.className = className;
    node.textContent = text;
    nodes.push(node);
  };
  push("span", "cell-typed", typed.slice(0, prefix));
  push("del", "cell-wrong", typed.slice(prefix));
  push("span", "cell-correct", expected.slice(prefix));
  return nodes;
}

function caret() {
  const node = document.createElement("span");
  node.className = "caret";
  node.setAttribute("aria-hidden", "true");
  return node;
}

function renderWord() {
  const row = $("#word");
  const word = state?.words[state.wordIndex];
  if (!word) {
    row.replaceChildren();
    row.setAttribute("aria-label", t("chain.wordDone", "全部詞語已完成"));
    return;
  }
  const submitted = state.answers.filter(item => item.wordIndex === state.wordIndex);
  row.replaceChildren(...[...word.word].map((hanzi, index) => {
    const entry = submitted.find(item => item.syllableIndex === index);
    const cell = document.createElement("li");
    cell.className = "word-cell";
    const input = document.createElement("span");
    input.className = "cell-input";
    if (entry) {
      cell.classList.add(entry.correct ? "correct" : "incorrect");
      input.append(...comparison(entry.answer, entry.expected));
    } else if (index === state.syllableIndex && state.status === "running") {
      cell.classList.add("current");
      if (draft) {
        const typed = document.createElement("span");
        typed.className = "cell-typed";
        typed.textContent = draft;
        input.append(typed);
      }
      input.append(caret());
    } else {
      const pending = document.createElement("span");
      pending.className = "cell-pending";
      pending.textContent = "·";
      input.append(pending);
    }
    const glyph = document.createElement("span");
    glyph.className = "cell-hanzi";
    glyph.textContent = hanzi;
    cell.append(input, glyph);
    return cell;
  }));
  const syllable = Math.min(state.syllableIndex + 1, word.syllables.length);
  row.setAttribute("aria-label", t("chain.wordAria", `${word.word}，第 ${syllable} 個音節`, { word: word.word, syllable }));
}

// 100ms tick 會重複行 renderMetrics，只喺值有變先寫 DOM。
function setText(selector, value) {
  const node = $(selector);
  if (node.textContent !== value) node.textContent = value;
}

function renderMetrics(now = Date.now()) {
  if (!state) return;
  const metrics = getChainMetrics(state, now);
  const official = metrics.mode === "official";
  setText("#progress-label", official
    ? t("chain.progressOfficial", `第 ${metrics.wordNumber} 個詞 · 官方輪`, { n: metrics.wordNumber })
    : t("chain.progressPractice", `第 ${metrics.wordNumber} / ${metrics.words} 個詞`, { n: metrics.wordNumber, total: metrics.words }));
  setText("#score", metrics.score.toFixed(1));
  setText("#cpm", String(Math.round(metrics.correctPerMinute)));
  setText("#accuracy", metrics.submitted ? `${Math.round(metrics.accuracy * 100)}%` : "—");
  setText("#time-label", official ? t("chain.timeRemaining", "剩餘時間") : t("chain.timeElapsed", "已用時間"));
  setText("#time", formatClock(official ? metrics.remainingSeconds : metrics.elapsedSeconds));
  setText("#combo", t("chain.combo", `連擊 ${metrics.combo}`, { n: metrics.combo }));
  setText("#multiplier", t("chain.multiplier", `倍率 ×${metrics.multiplier.toFixed(1)}`, { value: metrics.multiplier.toFixed(1) }));
  $("#multiplier").classList.toggle("capped", metrics.multiplier >= 1.5);
  const fraction = Math.round(metrics.progress * 100);
  const width = `${fraction}%`;
  if ($("#time-bar").style.width !== width) $("#time-bar").style.width = width;
  const label = String(fraction);
  if ($("#time-track").getAttribute("aria-valuenow") !== label) $("#time-track").setAttribute("aria-valuenow", label);
}

function render() {
  if (!state) return;
  renderWord();
  setText("#draft", draft || "—");
  renderMetrics();
}

// --- storage --------------------------------------------------------------

function readStore() {
  const saved = readJson(STORAGE_KEY, null);
  const plays = Array.isArray(saved?.plays)
    ? saved.plays.filter(play => play && Number.isFinite(play.officialScore))
    : [];
  return { best: Number.isFinite(saved?.best?.officialScore) ? saved.best : null, plays };
}

function formatWhen(at) {
  return new Date(at).toLocaleString("zh-HK",
    { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function renderBest(best) {
  $("#best-note").textContent = best
    ? t("chain.bestNote", `本地最佳：正式分 ${best.officialScore.toFixed(1)}（${formatWhen(best.at)}，seed ${best.seed}）`,
      { score: best.officialScore.toFixed(1), when: formatWhen(best.at), seed: best.seed })
    : t("chain.bestEmpty", "本地最佳：未有紀錄。");
}

function saveResult(metrics) {
  const store = readStore();
  const play = {
    seed: state.seed,
    words: metrics.words,
    totalSyllables: metrics.totalSyllables,
    correct: metrics.correct,
    errors: metrics.errors,
    elapsedSeconds: metrics.elapsedSeconds,
    correctPerMinute: metrics.correctPerMinute,
    accuracy: metrics.accuracy,
    officialScore: metrics.officialScore,
    meetsThreshold: metrics.meetsThreshold,
    combo: metrics.combo,
    score: metrics.score,
    at: Date.now(),
  };
  const isBest = !store.best || play.officialScore > store.best.officialScore;
  const best = isBest ? play : store.best;
  writeJson(STORAGE_KEY, { best, plays: [...store.plays, play].slice(-KEEP_PLAYS) });
  renderBest(best);
  return { best, isBest };
}

// --- game flow ------------------------------------------------------------

function isRunning() {
  return state?.status === "running";
}

function start() {
  const raw = flowMode ? "" : $("#seed").value.trim();
  lastSeed = raw || String(Math.floor(Math.random() * 1000000)).padStart(6, "0");
  const now = Date.now();
  state = mode === "official"
    ? createChainGame({ ...OFFICIAL_CHAIN, now, seed: lastSeed, wordCount: WORD_COUNT, bank: CHAIN_BANK })
    : createChainGame({ now, seed: lastSeed, wordCount: WORD_COUNT, bank: CHAIN_BANK });
  draft = "";
  composing = false;
  physicalEdit = null;
  lastResult = null;
  $("#answer").value = "";
  $("#answer").disabled = false;
  $("#seed-label").textContent = flowMode
    ? t("chain.seedFlow", `${flowRoundLabel("words")} · seed ${lastSeed}`, { label: flowRoundLabel("words"), seed: lastSeed })
    : mode === "official"
      ? t("chain.seedOfficial", `官方輪 · seed ${lastSeed}`, { seed: lastSeed })
      : t("chain.seedPlain", `seed ${lastSeed}`, { seed: lastSeed });
  $("#feedback").textContent = t("chain.feedbackIdle", "打粵拼，Space 或 Enter 確認；未輸入時按 Backspace 改上一個音節。");
  showView("play");
  render();
  focusTyping();
  clearInterval(ticker);
  ticker = setInterval(tick, 100);
  announce(mode === "official"
    ? t("chain.announceStartOfficial", `開始！官方輪固定 ${state.durationSeconds} 秒，seed ${lastSeed}。`,
      { seconds: state.durationSeconds, seed: lastSeed })
    : t("chain.announceStartPractice", `開始！本場 seed ${lastSeed}，共 ${WORD_COUNT} 個詞。`,
      { seed: lastSeed, words: WORD_COUNT }));
}

function tick() {
  if (!isRunning()) return;
  if (state.mode === "official") state = finishByTime(state, Date.now());
  if (!isRunning()) {
    finish();
    return;
  }
  renderMetrics(Date.now());
}

function feedbackFor(previous, next) {
  const word = previous.words[previous.wordIndex].word;
  if (next.wordResult === "correct") {
    return t("chain.feedbackWordCorrect",
      `「${word}」全對！連擊 ${next.combo}，下次倍率 ×${comboMultiplier(next.combo).toFixed(1)}。`,
      { word, combo: next.combo, multiplier: comboMultiplier(next.combo).toFixed(1) });
  }
  if (next.wordResult === "incorrect") {
    return t("chain.feedbackWordIncorrect", `「${word}」有錯，連擊歸零，重新儲倍率。`, { word });
  }
  return next.lastResult === "correct"
    ? t("chain.feedbackCorrect", "啱！繼續打下一個音節。")
    : t("chain.feedbackIncorrect", "唔啱，照樣前進；未輸入時按 Backspace 可以退回上一個音節。");
}

function submit() {
  if (!isRunning()) return;
  const value = draft;
  draft = "";
  $("#answer").value = "";
  const previous = state;
  state = typeSyllable(state, value, Date.now());
  if (state.mode === "official" && isRunning()) state = finishByTime(state, Date.now());
  if (state === previous) {
    $("#feedback").textContent = t("chain.feedbackBlank", "空白提交唔計分，打字母先。");
    render();
    return;
  }
  render();
  if (state.status === "finished") {
    finish();
    return;
  }
  $("#feedback").textContent = feedbackFor(previous, state);
  announce($("#feedback").textContent);
}

function recall() {
  if (!isRunning()) return;
  const previous = state;
  state = recallSyllable(state);
  if (state === previous) {
    $("#feedback").textContent = t("chain.recallFirst", "已經喺第一個音節，冇得再退。");
    return;
  }
  draft = "";
  $("#answer").value = "";
  render();
  $("#feedback").textContent = t("chain.recallDone", "已退回上一個音節，重新打過。");
  announce(t("chain.announceRecall", `退回上一個音節：${state.words[state.wordIndex].word}`,
    { word: state.words[state.wordIndex].word }));
}

function finish() {
  clearInterval(ticker);
  ticker = null;
  const metrics = getChainMetrics(state, Date.now());
  const { best, isBest } = saveResult(metrics);
  if (flowMode) {
    // 流程內：寫入詞組輪結果，完場只可以接去第 3 輪，冇「再玩一場」。
    flow = saveRoundResult(flow, "words", flowRoundResult("words", metrics)) ?? flow;
    $("#play-again").hidden = true;
  }
  lastResult = { metrics, best, isBest };
  paintResult();
  showView("result");
  announce(t("chain.announceFinish", `完成。正確音節每分鐘 ${metrics.correctPerMinute.toFixed(1)}，準確度 ${(metrics.accuracy * 100).toFixed(1)}%。`,
    { cpm: metrics.correctPerMinute.toFixed(1), accuracy: (metrics.accuracy * 100).toFixed(1) }));
}

// 完場卡：lastResult 記住嗰局嘅數字，切語言嗰陣可以原樣重畫。
function paintResult() {
  const { metrics, best, isBest } = lastResult;
  const official = metrics.mode === "official";
  const threshold = Math.round(metrics.threshold * 100);
  $("#result-title").textContent = official
    ? t("chain.resultTitleOfficial", "時間到，收卷！")
    : isBest ? t("chain.resultTitleBest", "完成喇！新紀錄！") : t("chain.resultTitleDone", "完成喇！");
  $("#result-cpm").textContent = t("chain.resultCpm", `${metrics.correctPerMinute.toFixed(1)} 音節／分`,
    { value: metrics.correctPerMinute.toFixed(1) });
  $("#result-accuracy").textContent = `${(metrics.accuracy * 100).toFixed(1)}%`;
  $("#result-score").textContent = metrics.officialScore.toFixed(1);
  $("#result-threshold").textContent = official
    ? (metrics.meetsThreshold
      ? t("chain.thresholdOfficialPass", `達 ${threshold}% 門檻，計入正式賽排名`, { threshold })
      : t("chain.thresholdOfficialFail", `未達 ${threshold}% 門檻，正式賽不計排名`, { threshold }))
    : (metrics.meetsThreshold
      ? t("chain.thresholdPracticePass", "達標")
      : t("chain.thresholdPracticeFail", `未達標（要 ${threshold}% 準確度）`, { threshold }));
  $("#window-note").hidden = !official;
  if (official) {
    $("#window-note").textContent = t("chain.windowNote", `官方模式：固定 ${metrics.scoredSeconds} 秒計分窗。`,
      { seconds: metrics.scoredSeconds });
  }
  $("#result-best").textContent = best
    ? t("chain.resultBest", `正式分 ${best.officialScore.toFixed(1)}（${formatWhen(best.at)}）`,
      { score: best.officialScore.toFixed(1), when: formatWhen(best.at) })
    : t("chain.resultBestEmpty", "未有紀錄");
  $("#result-detail").textContent = t("chain.resultDetail", `連擊 ${metrics.combo} · 得分 ${metrics.score.toFixed(1)}`,
    { combo: metrics.combo, score: metrics.score.toFixed(1) });
  $("#result-summary").textContent = t("chain.resultSummary",
    `本場 seed ${state.seed}：${metrics.words} 個詞、${metrics.totalSyllables} 個音節，` +
    `用時 ${formatClock(metrics.elapsedSeconds)}，啱 ${metrics.correct}、錯 ${metrics.errors}。`,
    {
      seed: state.seed,
      words: metrics.words,
      syllables: metrics.totalSyllables,
      clock: formatClock(metrics.elapsedSeconds),
      correct: metrics.correct,
      errors: metrics.errors,
    });
  if (flowMode) showFlowNext();
}

function playAgain() {
  $("#seed").value = lastSeed;
  showView("setup");
  $("#start").focus({ preventScroll: true });
}

// 切語言：靜態文案由 i18n 套用，動態文案（橫額、HUD、完場卡）喺呢度重畫。
// 未有 state（仲喺設定畫面）嗰陣一樣要行得通。
function relayout() {
  renderMode();
  renderFlow();
  renderBest(readStore().best);
  if (lastResult) paintResult();
  if (state) render();
}

// --- input ----------------------------------------------------------------

function markPhysicalEdit() {
  const token = {};
  physicalEdit = token;
  // A canceled keydown can still be followed by native input in the same turn.
  setTimeout(() => { if (physicalEdit === token) physicalEdit = null; }, 0);
}

function setDraft(value) {
  draft = normalizeAnswer(value);
  $("#answer").value = draft;
  render();
}

function restore() {
  $("#answer").value = draft;
  render();
}

function onKeydown(event) {
  if (event.ctrlKey || event.metaKey || event.altKey || event.key === "Tab") return;
  if (!isRunning()) return;
  const letter = /^[a-z]$/i.test(event.key ?? "") ? event.key.toLowerCase()
    : /^Key[A-Z]$/.test(event.code ?? "") ? event.code.slice(3).toLowerCase() : null;
  if (letter) {
    event.preventDefault();
    markPhysicalEdit();
    setDraft(draft + letter);
    return;
  }
  const key = event.code === "Space" ? " " : event.code === "NumpadEnter" ? "Enter"
    : ["Enter", "Backspace"].includes(event.code) ? event.code : event.key;
  if (![" ", "Enter", "Backspace"].includes(key)) return;
  if (event.isComposing || composing) return;
  event.preventDefault();
  markPhysicalEdit();
  if (key === "Backspace") {
    if (draft) setDraft(draft.slice(0, -1));
    else recall();
  } else submit();
}

function mount() {
  // 先套靜態翻譯，之後嘅 render 先寫動態文案。
  if (typeof initI18n === "function") initI18n();
  if (typeof window !== "undefined") window.addEventListener("canclid-locale", relayout);
  $("#setup-form").addEventListener("submit", event => { event.preventDefault(); start(); });
  $("#play-again").addEventListener("click", playAgain);
  $("#mode-practice").addEventListener("click", () => selectMode("practice"));
  $("#mode-official").addEventListener("click", () => selectMode("official"));
  $("#typing-surface").addEventListener("click", focusTyping);
  // The hidden input sits inside the surface, so one listener covers both.
  $("#typing-surface").addEventListener("keydown", onKeydown);
  $("#answer").addEventListener("beforeinput", event => {
    if (event.isComposing || composing) return;
    if (event.inputType === "deleteContentBackward" && draft === "") {
      if (event.cancelable !== false) event.preventDefault();
      recall();
    }
  });
  $("#answer").addEventListener("input", event => {
    if (!isRunning() || event.isComposing || composing || physicalEdit) { restore(); return; }
    const value = $("#answer").value;
    // Reject a non-Latin IME commit; never guess a pronunciation from its characters.
    if (event.inputType !== "insertFromPaste" && /[^a-z\s]/i.test(value)) { restore(); return; }
    const submitting = /\s$/.test(value);
    setDraft(value);
    if (submitting) submit();
  });
  $("#answer").addEventListener("compositionstart", () => { composing = true; restore(); });
  $("#answer").addEventListener("compositionend", event => {
    composing = false;
    const data = event.data ?? "";
    if (/^[a-z]*$/i.test(data)) setDraft(draft + data);
    else restore();
  });
  $("#typing-surface").addEventListener("focus", () => $("#typing-surface").classList.add("focused"));
  $("#answer").addEventListener("focus", () => $("#typing-surface").classList.add("focused"));
  $("#answer").addEventListener("blur", () => $("#typing-surface").classList.remove("focused"));
  document.addEventListener("visibilitychange", () => { if (!document.hidden) tick(); });
  renderMode();
  renderFlow();
  renderBest(readStore().best);
  showView("setup");
}

if (typeof document !== "undefined" && $("#setup-view")) mount();
