// 粵拼落石 DOM 層：只負責畫面同輸入，遊戲規則全部交畀 rocks.mjs。

import {
  OFFICIAL_THRESHOLDS,
  comboMultiplier,
  formatClock,
  readJson,
  writeJson,
} from "../common.mjs";
import {
  flowNextHref,
  flowNextLabel,
  flowRoundLabel,
  flowRoundResult,
  readFlow,
  saveRoundResult,
  startFlow,
} from "../flow.mjs";
import { ROCK_QUESTIONS } from "./data.mjs";
import {
  OFFICIAL_ROCKS,
  ROCKS_STORAGE_KEY,
  createRocksGame,
  getFallProgress,
  getRocksMetrics,
  tick,
  typeSyllable,
} from "./rocks.mjs";

const $ = selector => document.querySelector(selector);
const capture = $("#capture");
const thresholdPercent = Math.round(OFFICIAL_THRESHOLDS.timed * 100);
const MODE_STORAGE_KEY = "canclid-contest-games-rocks-mode";
const MODE_NOTES = {
  practice: "練習模式：60 秒、三條命，成績只存本機。",
  official: "官方模式（正式單字輪）：固定 90 秒、無命，石頭落地未擊破當一次提交錯誤。",
};

let state = null;
let draft = "";
let frame = null;
let fallSpan = 0;
let roundSaved = false;
let composing = false;
let mode = readJson(MODE_STORAGE_KEY, null) === "official" ? "official" : "practice";

// 官方三輪流程（?flow=1）：鎖定官方單字輪，完場寫入 flow store 再接去詞組。
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
  $("#flow-banner").hidden = false;
  $("#flow-banner").textContent = `${flowRoundLabel("single")} · 固定 90 秒、無命 · 退出流程會丟棄三輪進度。`;
  $("#lobby-link").textContent = "‹ 退出流程";
  $("#lobby-link").href = "../../index.html";
  $("#lobby-link").title = "退出會丟棄三輪流程進度";
  $("#mode-picker").hidden = true;
  $("#mode-note").textContent = "官方流程鎖定官方規則：固定 90 秒、無命；種子每局隨機，開局後顯示喺上面。";
  $("#intro-eyebrow").textContent = "官方流程 · 單字輪 90 秒";
}

function showFlowNext() {
  const next = $("#flow-next");
  next.hidden = false;
  next.href = flowNextHref("single");
  next.textContent = flowNextLabel("single");
  $("#result-lobby").hidden = true;
}

function readRecord() {
  const saved = readJson(ROCKS_STORAGE_KEY, null);
  if (!saved || typeof saved !== "object") return { best: null, plays: 0 };
  const best = saved.best;
  const plays = Number.isSafeInteger(saved.plays) && saved.plays > 0 ? saved.plays : 0;
  if (!best || typeof best !== "object" || !Number.isFinite(best.officialScore)) return { best: null, plays };
  return { best, plays };
}

function measure() {
  // 石頭由頂部留白（10px）跌落地面條（12px）上面，剛好貼住地面。
  fallSpan = Math.max(0, $("#field").clientHeight - $("#rock").offsetHeight - 22);
}

function showCard(name) {
  for (const card of ["intro", "play", "result"]) {
    $(`#${card}-card`).hidden = card !== name;
  }
}

function renderRecord() {
  const { best, plays } = readRecord();
  $("#intro-best").textContent = best
    ? `本地最佳：${best.officialScore.toFixed(1)} 分 · ${Math.round(best.correctPerMinute)} 音節/分 · 準確度 ${Math.round(best.accuracy * 100)}%（玩過 ${plays} 局）`
    : "本地最佳：未有紀錄";
}

function renderMode() {
  const official = mode === "official";
  const practiceButton = $("#mode-practice");
  const officialButton = $("#mode-official");
  practiceButton.classList.toggle("selected", !official);
  practiceButton.setAttribute("aria-pressed", String(!official));
  officialButton.classList.toggle("selected", official);
  officialButton.setAttribute("aria-pressed", String(official));
  $("#mode-note").textContent = MODE_NOTES[mode];
}

function selectMode(next) {
  if (flowMode) return;
  mode = next === "official" ? "official" : "practice";
  writeJson(MODE_STORAGE_KEY, mode);
  renderMode();
}

function render() {
  const time = Date.now();
  const metrics = getRocksMetrics(state, time);
  const progress = getFallProgress(state, time);

  const official = state.mode === "official";
  $("#hud").classList.toggle("official", official);
  $("#lives-item").hidden = official;
  $("#lives").textContent = official
    ? ""
    : `${"♥".repeat(metrics.livesLeft)}${"♡".repeat(metrics.lives - metrics.livesLeft)}`;
  $("#lives").setAttribute("aria-label", official ? "官方模式：無命" : `剩 ${metrics.livesLeft} 條命`);
  $("#clock").textContent = formatClock(metrics.remainingSeconds);
  $("#cpm").textContent = String(Math.round(metrics.correctPerMinute));
  $("#accuracy").textContent = metrics.submitted ? `${Math.round(metrics.accuracy * 100)}%` : "—";
  $("#combo").textContent = `×${comboMultiplier(state.combo).toFixed(1)}`;
  $("#combo").classList.toggle("hot", state.combo >= 5);
  $("#combo-count").textContent = `${state.combo} 連擊`;
  $("#cleared").textContent = `擊破 ${metrics.correct} · 打錯 ${metrics.errors} · 漏接 ${metrics.missed}`;
  $("#time-bar").style.width = `${metrics.progress * 100}%`;

  const rock = $("#rock");
  rock.style.transform = `translate(-50%, ${progress * fallSpan}px)`;
  rock.classList.toggle("urgent", progress > 0.7 && state.status === "running");
  rock.classList.toggle("landed", state.status !== "running");
  $("#rock-hanzi").textContent = state.target?.hanzi ?? "";
  $("#field").setAttribute("aria-label", state.target ? `落石區，目前目標：${state.target.hanzi}` : "落石區");

  $("#draft").textContent = draft;
  $("#draft").classList.toggle("empty", draft === "");
  $("#feedback").textContent = feedbackText(metrics);
  if (!composing && capture.value !== draft) capture.value = draft;
}

function feedbackText(metrics) {
  if (state.lastResult === "correct") return `啱！打咗 ${state.lastAnswer}`;
  if (state.lastResult === "incorrect") {
    return `唔啱：${state.lastTarget?.hanzi ?? ""} 應該係 ${state.lastTarget?.answers.join(" / ") ?? ""}`;
  }
  if (state.lastResult === "missed") {
    return `漏接：${state.lastTarget?.hanzi ?? ""} 係 ${state.lastTarget?.answers.join(" / ") ?? ""}`;
  }
  return `打粵拼，按 Space 或 Enter 提交（準確度要達 ${thresholdPercent}% 先計排名）`;
}

function frameStep() {
  frame = null;
  if (!state || state.status !== "running") return;
  const before = state.spawned;
  state = tick(state, Date.now());
  if (state.spawned !== before) {
    draft = "";
    $("#field").classList.add("shake");
    setTimeout(() => $("#field").classList.remove("shake"), 320);
  }
  render();
  if (state.status === "finished") {
    finishRound();
    return;
  }
  frame = requestAnimationFrame(frameStep);
}

function appendLetter(letter) {
  if (draft.length >= 24) return;
  draft += letter;
  render();
}

function backspace() {
  if (!draft) return;
  draft = draft.slice(0, -1);
  render();
}

function submitDraft() {
  if (!state || state.status !== "running") return;
  if (!draft) return;
  state = typeSyllable(state, draft, Date.now());
  draft = "";
  render();
  if (state.status === "finished") finishRound();
}

function finishRound() {
  if (frame !== null) {
    cancelAnimationFrame(frame);
    frame = null;
  }
  const metrics = getRocksMetrics(state, Date.now());
  const record = readRecord();
  const qualifies = metrics.meetsThreshold;
  const isBest = qualifies && (!record.best || metrics.officialScore > record.best.officialScore);

  if (!roundSaved) {
    const next = { best: record.best, plays: record.plays + 1 };
    if (isBest) {
      next.best = {
        officialScore: metrics.officialScore,
        correctPerMinute: metrics.correctPerMinute,
        accuracy: metrics.accuracy,
        bestCombo: metrics.bestCombo,
        at: Date.now(),
      };
    }
    writeJson(ROCKS_STORAGE_KEY, next);
    roundSaved = true;
  }

  $("#result-title").textContent = state.finishedReason === "lives"
    ? "三條命用完，遊戲結束"
    : "時間到，遊戲結束";
  $("#result-cpm").textContent = String(Math.round(metrics.correctPerMinute));
  $("#result-accuracy").textContent = `${Math.round(metrics.accuracy * 100)}%`;
  $("#result-score").textContent = metrics.officialScore.toFixed(1);
  $("#result-detail").textContent =
    `擊破 ${metrics.correct} 個字 · 打錯 ${metrics.errors} 次 · 漏接 ${metrics.missed} 次 · 最高連擊 ${metrics.bestCombo}`;
  const official = state.mode === "official";
  $("#threshold-note").textContent = official
    ? (qualifies
      ? `達 ${thresholdPercent}% 門檻，成績計入正式賽排名。`
      : `未達 ${thresholdPercent}% 門檻，正式賽不計排名。`)
    : (qualifies
      ? `達 ${thresholdPercent}% 門檻，成績計入排名。`
      : "未達門檻，唔計排名。");
  $("#threshold-note").classList.toggle("miss", !qualifies);
  $("#window-note").hidden = !official;
  if (official) {
    $("#window-note").textContent = `官方模式：固定 ${metrics.scoredSeconds} 秒計分窗，逾時未擊破當錯。`;
  }
  const { best, plays } = readRecord();
  $("#best-note").textContent = best
    ? `${isBest ? "新紀錄！" : "本地最佳："}${best.officialScore.toFixed(1)} 分 · ${Math.round(best.correctPerMinute)} 音節/分 · 準確度 ${Math.round(best.accuracy * 100)}%${isBest ? `（玩過 ${plays} 局）` : ""}`
    : "本地最佳：未有紀錄（要達門檻先會記錄）";
  if (flowMode) {
    // 流程內：寫入單字輪結果，完場只可以接去第 2 輪，冇「再玩一次」。
    flow = saveRoundResult(flow, "single", flowRoundResult("single", metrics)) ?? flow;
    $("#play-again").hidden = true;
    showFlowNext();
  }
  showCard("result");
  $("#result-card").focus({ preventScroll: true });
}

function startRound() {
  const now = Date.now();
  const seed = `rocks-${now}`;
  state = mode === "official"
    ? createRocksGame({ ...OFFICIAL_ROCKS, now, seed, bank: ROCK_QUESTIONS })
    : createRocksGame({ now, seed });
  draft = "";
  roundSaved = false;
  showCard("play");
  if (flowMode) {
    $("#flow-banner").textContent = `${flowRoundLabel("single")} · seed ${seed} · 固定 90 秒、無命。`;
  }
  measure();
  render();
  if (frame === null) frame = requestAnimationFrame(frameStep);
  capture.focus({ preventScroll: true });
}

document.addEventListener("keydown", event => {
  if (!state || state.status !== "running") return;
  if (event.ctrlKey || event.metaKey || event.altKey || event.key === "Tab") return;
  const letter = /^[a-z]$/i.test(event.key ?? "") ? event.key.toLowerCase()
    : /^Key[A-Z]$/.test(event.code ?? "") ? event.code.slice(3).toLowerCase() : null;
  if (letter) {
    event.preventDefault();
    appendLetter(letter);
    return;
  }
  const key = event.code === "Space" ? " " : event.code === "NumpadEnter" ? "Enter"
    : ["Enter", "Backspace"].includes(event.code) ? event.code : event.key;
  if (![" ", "Enter", "Backspace"].includes(key)) return;
  event.preventDefault();
  if (key === "Backspace") backspace();
  else submitDraft();
});

// 手機：視覺隱藏嘅原生 input 收字，只留 A–Z，空白鍵提交。
capture.addEventListener("beforeinput", event => {
  if (!state || state.status !== "running") return;
  const submitType = event.inputType === "insertLineBreak" || event.inputType === "insertParagraph" ||
    (event.inputType === "insertText" && /^\s+$/.test(event.data ?? ""));
  if (submitType) {
    event.preventDefault();
    submitDraft();
  }
});

capture.addEventListener("input", event => {
  if (!state || state.status !== "running" || event.isComposing) return;
  const value = capture.value;
  if (event.inputType !== "insertFromPaste" && /[^a-z\s]/i.test(value)) {
    capture.value = draft;
    return;
  }
  const trimmed = value.replace(/\s+$/, "");
  const cleaned = trimmed.replace(/[^a-z]/gi, "").toLowerCase();
  draft = cleaned;
  if (/\s$/.test(value)) {
    submitDraft();
    return;
  }
  render();
});

capture.addEventListener("compositionstart", () => { composing = true; });
capture.addEventListener("compositionend", () => { composing = false; capture.value = draft; });
capture.addEventListener("blur", () => {
  if (state?.status === "running") setTimeout(() => capture.focus({ preventScroll: true }), 0);
});

$("#field").addEventListener("pointerdown", () => {
  if (state?.status === "running") capture.focus({ preventScroll: true });
});
$("#start-button").addEventListener("click", startRound);
$("#play-again").addEventListener("click", startRound);
$("#mode-practice").addEventListener("click", () => selectMode("practice"));
$("#mode-official").addEventListener("click", () => selectMode("official"));
window.addEventListener("resize", () => { measure(); if (state?.status === "running") render(); });

renderMode();
renderFlow();
renderRecord();
showCard("intro");
