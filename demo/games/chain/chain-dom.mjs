// DOM layer for 「粵拼詞鏈」. Input handling follows demo/app.mjs: ASCII
// event.key first with a KeyA–KeyZ fallback, letters only, a visually hidden
// native input so phone keyboards open, Space/Enter to submit and Backspace to
// delete a letter or to recall the previous syllable when the draft is empty.
import { createChainGame, getChainMetrics, recallSyllable, typeSyllable } from "./chain.mjs";
import { CHAIN_BANK } from "./data.mjs";
import { comboMultiplier, formatClock, normalizeAnswer, readJson, writeJson } from "../common.mjs";

const STORAGE_KEY = "canclid-contest-games-chain";
const WORD_COUNT = 20;
const KEEP_PLAYS = 10;

const $ = selector => document.querySelector(selector);

let state = null;
let draft = "";
let composing = false;
let physicalEdit = null;
let ticker = null;
let lastSeed = "";

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
    row.setAttribute("aria-label", "全部詞語已完成");
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
  row.setAttribute("aria-label",
    `${word.word}，第 ${Math.min(state.syllableIndex + 1, word.syllables.length)} 個音節`);
}

function renderMetrics(now = Date.now()) {
  if (!state) return;
  const metrics = getChainMetrics(state, now);
  $("#progress-label").textContent = `第 ${metrics.wordNumber} / ${metrics.words} 個詞`;
  $("#score").textContent = metrics.score.toFixed(1);
  $("#cpm").textContent = String(Math.round(metrics.correctPerMinute));
  $("#accuracy").textContent = metrics.submitted ? `${Math.round(metrics.accuracy * 100)}%` : "—";
  $("#time").textContent = formatClock(metrics.elapsedSeconds);
  $("#combo").textContent = `連擊 ${metrics.combo}`;
  $("#multiplier").textContent = `倍率 ×${metrics.multiplier.toFixed(1)}`;
  $("#multiplier").classList.toggle("capped", metrics.multiplier >= 1.5);
  const fraction = Math.round(metrics.progress * 100);
  $("#time-bar").style.width = `${fraction}%`;
  $("#time-track").setAttribute("aria-valuenow", String(fraction));
}

function render() {
  if (!state) return;
  renderWord();
  $("#draft").textContent = draft || "—";
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
    ? `本地最佳：officialScore ${best.officialScore.toFixed(1)}（${formatWhen(best.at)}，seed ${best.seed}）`
    : "本地最佳：未有紀錄。";
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
  const raw = $("#seed").value.trim();
  lastSeed = raw || String(Math.floor(Math.random() * 1000000)).padStart(6, "0");
  state = createChainGame({ now: Date.now(), seed: lastSeed, wordCount: WORD_COUNT, bank: CHAIN_BANK });
  draft = "";
  composing = false;
  physicalEdit = null;
  $("#answer").value = "";
  $("#answer").disabled = false;
  $("#seed-label").textContent = `seed ${lastSeed}`;
  $("#feedback").textContent = "打粵拼，Space 或 Enter 確認；未輸入時按 Backspace 改上一個音節。";
  showView("play");
  render();
  focusTyping();
  clearInterval(ticker);
  ticker = setInterval(tick, 100);
  announce(`開始！本場 seed ${lastSeed}，共 ${WORD_COUNT} 個詞。`);
}

function tick() {
  if (!isRunning()) return;
  renderMetrics(Date.now());
}

function feedbackFor(previous, next) {
  const word = previous.words[previous.wordIndex].word;
  if (next.wordResult === "correct") {
    return `「${word}」全對！連擊 ${next.combo}，下次倍率 ×${comboMultiplier(next.combo).toFixed(1)}。`;
  }
  if (next.wordResult === "incorrect") {
    return `「${word}」有錯，連擊歸零，重新儲倍率。`;
  }
  return next.lastResult === "correct"
    ? "啱！繼續打下一個音節。"
    : "唔啱，照樣前進；未輸入時按 Backspace 可以退回上一個音節。";
}

function submit() {
  if (!isRunning()) return;
  const value = draft;
  draft = "";
  $("#answer").value = "";
  const previous = state;
  state = typeSyllable(state, value, Date.now());
  if (state === previous) {
    $("#feedback").textContent = "空白提交唔計分，打字母先。";
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
    $("#feedback").textContent = "已經喺第一個音節，冇得再退。";
    return;
  }
  draft = "";
  $("#answer").value = "";
  render();
  $("#feedback").textContent = "已退回上一個音節，重新打過。";
  announce(`退回上一個音節：${state.words[state.wordIndex].word}`);
}

function finish() {
  clearInterval(ticker);
  ticker = null;
  const metrics = getChainMetrics(state, Date.now());
  const { best, isBest } = saveResult(metrics);
  $("#result-title").textContent = isBest ? "完成喇！新紀錄！" : "完成喇！";
  $("#result-cpm").textContent = `${metrics.correctPerMinute.toFixed(1)} 音節／分`;
  $("#result-accuracy").textContent = `${(metrics.accuracy * 100).toFixed(1)}%`;
  $("#result-score").textContent = metrics.officialScore.toFixed(1);
  $("#result-threshold").textContent = metrics.meetsThreshold ? "達標" : "未達標（要 90% 準確度）";
  $("#result-best").textContent = best
    ? `officialScore ${best.officialScore.toFixed(1)}（${formatWhen(best.at)}）`
    : "未有紀錄";
  $("#result-detail").textContent = `連擊 ${metrics.combo} · 得分 ${metrics.score.toFixed(1)}`;
  $("#result-summary").textContent =
    `本場 seed ${state.seed}：${metrics.words} 個詞、${metrics.totalSyllables} 個音節，` +
    `用時 ${formatClock(metrics.elapsedSeconds)}，啱 ${metrics.correct}、錯 ${metrics.errors}。`;
  showView("result");
  announce(`完成。正確音節每分鐘 ${metrics.correctPerMinute.toFixed(1)}，準確度 ${(metrics.accuracy * 100).toFixed(1)}%。`);
}

function playAgain() {
  $("#seed").value = lastSeed;
  showView("setup");
  $("#start").focus({ preventScroll: true });
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
  $("#setup-form").addEventListener("submit", event => { event.preventDefault(); start(); });
  $("#play-again").addEventListener("click", playAgain);
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
  renderBest(readStore().best);
  showView("setup");
}

if (typeof document !== "undefined" && $("#setup-view")) mount();
