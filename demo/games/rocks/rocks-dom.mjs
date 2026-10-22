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
import { initI18n, registerStrings, t as i18nT } from "../../i18n.mjs";

// node --test 用 vm 跑呢個檔（import 會被剝走），嗰陣冇 i18n 全局：
// t() 直接出返繁體原文，其餘 i18n 呼叫一律要頂得住。
const t = typeof i18nT === "function" ? i18nT : (key, hantText) => hantText;

// 全部動態文案嘅簡體譯文（繁體原文喺 t() 行內做 fallback）。
if (typeof registerStrings === "function") {
  registerStrings({ hans: {
    "rocks.docTitle": "粤拼落石 · CanCLID",
    "rocks.skipLink": "跳去主要内容",
    "rocks.lobbyLink": "‹ 游戏大厅",
    "rocks.brand": "粤拼落石",
    "rocks.arenaLink": "试玩赛场 ↗",
    "rocks.eyebrow": "小游戏 · 60 秒",
    "rocks.title": "粤拼落石",
    "rocks.lead": "石头由上面跌落嚟，你要喺佢落地之前打出石上面嗰个字嘅粤拼。唔使打声调数字。",
    "rocks.how1a": "只打 A–Z 字母，打啱按",
    "rocks.how1b": "或",
    "rocks.how1c": "提交，",
    "rocks.how1d": "删一个字母。",
    "rocks.how2": "打啱：连击加一，倍率最多 ×1.5；打错或者漏接：连击即刻归零。",
    "rocks.how3": "漏接一次扣一条命。三条命用完，或者 60 秒倒数完，即刻结算。",
    "rocks.how4": "官方模式（正式单字轮）：固定 90 秒、无命；石头落地未击破，计一次提交错误。",
    "rocks.how5": "计分同试玩赛场一致：每分钟正确音节 × 准确度，准确度要达 90% 先计入排名。",
    "rocks.modeLabel": "模式",
    "rocks.modePractice": "练习",
    "rocks.modeOfficial": "官方",
    "rocks.modeNote.practice": "练习模式：60 秒、三条命，成绩只存本机。",
    "rocks.modeNote.official": "官方模式（正式单字轮）：固定 90 秒、无命，石头落地未击破当一次提交错误。",
    "rocks.start": "开始游戏",
    "rocks.footNote": "成绩只存喺呢个浏览器；题库未经人手校对，正式赛前须校对。",
    "rocks.hudLives": "剩命",
    "rocks.hudTime": "剩余时间",
    "rocks.hudSpeed": "速度",
    "rocks.hudCpmUnit": "音节 / 分钟",
    "rocks.hudAccuracy": "准确度",
    "rocks.hudCombo": "连击",
    "rocks.resultScoreLabel": "正式分",
    "rocks.resultScoreUnit": "每分钟正确音节 × 准确度",
    "rocks.playAgain": "再玩一次",
    "rocks.resultLobby": "返游戏大厅",
    // 輪次名同「前往第 N 輪」由 flow.mjs 出譯文（flow.round.*／flow.nextRound），
    // 呢度只譯頁面自己嗰截。
    "rocks.flowBanner": "{label} · 固定 90 秒、无命 · 退出流程会丢弃三轮进度。",
    "rocks.flowBannerSeed": "{label} · seed {seed} · 固定 90 秒、无命。",
    "rocks.flowModeNote": "官方流程锁定官方规则：固定 90 秒、无命；种子每局随机，开局后显示喺上面。",
    "rocks.flowEyebrow": "官方流程 · 单字轮 90 秒",
    "rocks.exitFlow": "‹ 退出流程",
    "rocks.exitFlowTitle": "退出会丢弃三轮流程进度",
    "rocks.bestEmpty": "本地最佳：未有纪录",
    "rocks.bestEmptyQualify": "本地最佳：未有纪录（要达门槛先会记录）",
    "rocks.bestNew": "新纪录！",
    "rocks.bestLabel": "本地最佳：",
    "rocks.bestDetail": "{score} 分 · {cpm} 音节/分 · 准确度 {accuracy}%",
    "rocks.bestPlays": "（玩过 {plays} 局）",
    "rocks.introBest": "本地最佳：{score} 分 · {cpm} 音节/分 · 准确度 {accuracy}%（玩过 {plays} 局）",
    "rocks.livesOfficial": "官方模式：无命",
    "rocks.livesLeft": "剩 {n} 条命",
    "rocks.comboCount": "{n} 连击",
    "rocks.cleared": "击破 {correct} · 打错 {errors} · 漏接 {missed}",
    "rocks.fieldAria": "落石区，目前目标：{hanzi}",
    "rocks.fieldAriaEmpty": "落石区",
    "rocks.feedbackCorrect": "啱！打咗 {answer}",
    "rocks.feedbackIncorrect": "唔啱：{hanzi} 应该系 {answers}",
    "rocks.feedbackMissed": "漏接：{hanzi} 系 {answers}",
    "rocks.feedbackIdle": "打粤拼，按 Space 或 Enter 提交（准确度要达 {threshold}% 先计排名）",
    "rocks.resultTitleLives": "三条命用完，游戏结束",
    "rocks.resultTitleTime": "时间到，游戏结束",
    "rocks.resultDetail": "击破 {correct} 个字 · 打错 {errors} 次 · 漏接 {missed} 次 · 最高连击 {bestCombo}",
    "rocks.thresholdOfficialPass": "达 {threshold}% 门槛，成绩计入正式赛排名。",
    "rocks.thresholdOfficialFail": "未达 {threshold}% 门槛，正式赛不计排名。",
    "rocks.thresholdPracticePass": "达 {threshold}% 门槛，成绩计入排名。",
    "rocks.thresholdPracticeFail": "未达门槛，唔计排名。",
    "rocks.windowNote": "官方模式：固定 {seconds} 秒计分窗，逾时未击破当错。",
  } });
}

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
let lastResult = null;
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
  const label = flowRoundLabel("single");
  $("#flow-banner").hidden = false;
  // 開咗局之後橫額要帶埋 seed，所以呢度跟 state 出（切語言都唔會漏咗）。
  $("#flow-banner").textContent = state
    ? t("rocks.flowBannerSeed", `${label} · seed ${state.seed} · 固定 90 秒、無命。`, { label, seed: state.seed })
    : t("rocks.flowBanner", `${label} · 固定 90 秒、無命 · 退出流程會丟棄三輪進度。`, { label });
  $("#lobby-link").textContent = t("rocks.exitFlow", "‹ 退出流程");
  $("#lobby-link").href = "../../index.html";
  $("#lobby-link").title = t("rocks.exitFlowTitle", "退出會丟棄三輪流程進度");
  $("#mode-picker").hidden = true;
  $("#mode-note").textContent = t("rocks.flowModeNote", "官方流程鎖定官方規則：固定 90 秒、無命；種子每局隨機，開局後顯示喺上面。");
  $("#intro-eyebrow").textContent = t("rocks.flowEyebrow", "官方流程 · 單字輪 90 秒");
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
    ? t("rocks.introBest",
      `本地最佳：${best.officialScore.toFixed(1)} 分 · ${Math.round(best.correctPerMinute)} 音節/分 · 準確度 ${Math.round(best.accuracy * 100)}%（玩過 ${plays} 局）`,
      {
        score: best.officialScore.toFixed(1),
        cpm: Math.round(best.correctPerMinute),
        accuracy: Math.round(best.accuracy * 100),
        plays,
      })
    : t("rocks.bestEmpty", "本地最佳：未有紀錄");
}

function renderMode() {
  const official = mode === "official";
  const practiceButton = $("#mode-practice");
  const officialButton = $("#mode-official");
  practiceButton.classList.toggle("selected", !official);
  practiceButton.setAttribute("aria-pressed", String(!official));
  officialButton.classList.toggle("selected", official);
  officialButton.setAttribute("aria-pressed", String(official));
  $("#mode-note").textContent = t(`rocks.modeNote.${mode}`, MODE_NOTES[mode]);
}

function selectMode(next) {
  if (flowMode) return;
  mode = next === "official" ? "official" : "practice";
  writeJson(MODE_STORAGE_KEY, mode);
  renderMode();
}

// 每個 rAF frame 都會行 render()，所以只喺值有變先寫 DOM，避免無謂重排。
function setText(selector, value) {
  const node = $(selector);
  if (node.textContent !== value) node.textContent = value;
}

function setAttr(selector, name, value) {
  const node = $(selector);
  if (node.getAttribute(name) !== value) node.setAttribute(name, value);
}

function setWidth(selector, percent) {
  const node = $(selector);
  const width = `${percent}%`;
  if (node.style.width !== width) node.style.width = width;
}

let lastTransform = "";

function render() {
  const time = Date.now();
  const metrics = getRocksMetrics(state, time);
  const progress = getFallProgress(state, time);

  const official = state.mode === "official";
  $("#hud").classList.toggle("official", official);
  if ($("#lives-item").hidden !== official) $("#lives-item").hidden = official;
  setText("#lives", official
    ? ""
    : `${"♥".repeat(metrics.livesLeft)}${"♡".repeat(metrics.lives - metrics.livesLeft)}`);
  setAttr("#lives", "aria-label", official
    ? t("rocks.livesOfficial", "官方模式：無命")
    : t("rocks.livesLeft", `剩 ${metrics.livesLeft} 條命`, { n: metrics.livesLeft }));
  setText("#clock", formatClock(metrics.remainingSeconds));
  setText("#cpm", String(Math.round(metrics.correctPerMinute)));
  setText("#accuracy", metrics.submitted ? `${Math.round(metrics.accuracy * 100)}%` : "—");
  setText("#combo", `×${comboMultiplier(state.combo).toFixed(1)}`);
  $("#combo").classList.toggle("hot", state.combo >= 5);
  setText("#combo-count", t("rocks.comboCount", `${state.combo} 連擊`, { n: state.combo }));
  setText("#cleared", t("rocks.cleared", `擊破 ${metrics.correct} · 打錯 ${metrics.errors} · 漏接 ${metrics.missed}`,
    { correct: metrics.correct, errors: metrics.errors, missed: metrics.missed }));
  setWidth("#time-bar", metrics.progress * 100);

  const rock = $("#rock");
  // 石頭用 transform 移動（唔影響排版）；像素值四捨五入到 0.1px 減少多餘寫入。
  const transform = `translate(-50%, ${Math.round(progress * fallSpan * 10) / 10}px)`;
  if (transform !== lastTransform) {
    rock.style.transform = transform;
    lastTransform = transform;
  }
  rock.classList.toggle("urgent", progress > 0.7 && state.status === "running");
  rock.classList.toggle("landed", state.status !== "running");
  setText("#rock-hanzi", state.target?.hanzi ?? "");
  setAttr("#field", "aria-label", state.target
    ? t("rocks.fieldAria", `落石區，目前目標：${state.target.hanzi}`, { hanzi: state.target.hanzi })
    : t("rocks.fieldAriaEmpty", "落石區"));

  setText("#draft", draft);
  $("#draft").classList.toggle("empty", draft === "");
  setText("#feedback", feedbackText(metrics));
  if (!composing && capture.value !== draft) capture.value = draft;
}

function feedbackText(metrics) {
  if (state.lastResult === "correct") {
    return t("rocks.feedbackCorrect", `啱！打咗 ${state.lastAnswer}`, { answer: state.lastAnswer });
  }
  if (state.lastResult === "incorrect") {
    return t("rocks.feedbackIncorrect",
      `唔啱：${state.lastTarget?.hanzi ?? ""} 應該係 ${state.lastTarget?.answers.join(" / ") ?? ""}`,
      { hanzi: state.lastTarget?.hanzi ?? "", answers: state.lastTarget?.answers.join(" / ") ?? "" });
  }
  if (state.lastResult === "missed") {
    return t("rocks.feedbackMissed",
      `漏接：${state.lastTarget?.hanzi ?? ""} 係 ${state.lastTarget?.answers.join(" / ") ?? ""}`,
      { hanzi: state.lastTarget?.hanzi ?? "", answers: state.lastTarget?.answers.join(" / ") ?? "" });
  }
  return t("rocks.feedbackIdle",
    `打粵拼，按 Space 或 Enter 提交（準確度要達 ${thresholdPercent}% 先計排名）`,
    { threshold: thresholdPercent });
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

  if (flowMode) {
    // 流程內：寫入單字輪結果，完場只可以接去第 2 輪，冇「再玩一次」。
    flow = saveRoundResult(flow, "single", flowRoundResult("single", metrics)) ?? flow;
    $("#play-again").hidden = true;
  }
  lastResult = { metrics, isBest };
  paintResult();
  showCard("result");
  $("#result-card").focus({ preventScroll: true });
}

// 完場卡：lastResult 記住嗰局嘅數字，切語言嗰陣可以原樣重畫。
function paintResult() {
  const { metrics, isBest } = lastResult;
  const official = state.mode === "official";
  const qualifies = metrics.meetsThreshold;
  $("#result-title").textContent = state.finishedReason === "lives"
    ? t("rocks.resultTitleLives", "三條命用完，遊戲結束")
    : t("rocks.resultTitleTime", "時間到，遊戲結束");
  $("#result-cpm").textContent = String(Math.round(metrics.correctPerMinute));
  $("#result-accuracy").textContent = `${Math.round(metrics.accuracy * 100)}%`;
  $("#result-score").textContent = metrics.officialScore.toFixed(1);
  $("#result-detail").textContent = t("rocks.resultDetail",
    `擊破 ${metrics.correct} 個字 · 打錯 ${metrics.errors} 次 · 漏接 ${metrics.missed} 次 · 最高連擊 ${metrics.bestCombo}`,
    { correct: metrics.correct, errors: metrics.errors, missed: metrics.missed, bestCombo: metrics.bestCombo });
  $("#threshold-note").textContent = official
    ? (qualifies
      ? t("rocks.thresholdOfficialPass", `達 ${thresholdPercent}% 門檻，成績計入正式賽排名。`, { threshold: thresholdPercent })
      : t("rocks.thresholdOfficialFail", `未達 ${thresholdPercent}% 門檻，正式賽不計排名。`, { threshold: thresholdPercent }))
    : (qualifies
      ? t("rocks.thresholdPracticePass", `達 ${thresholdPercent}% 門檻，成績計入排名。`, { threshold: thresholdPercent })
      : t("rocks.thresholdPracticeFail", "未達門檻，唔計排名。"));
  $("#threshold-note").classList.toggle("miss", !qualifies);
  $("#window-note").hidden = !official;
  if (official) {
    $("#window-note").textContent = t("rocks.windowNote",
      `官方模式：固定 ${metrics.scoredSeconds} 秒計分窗，逾時未擊破當錯。`, { seconds: metrics.scoredSeconds });
  }
  const { best, plays } = readRecord();
  $("#best-note").textContent = best
    ? `${isBest ? t("rocks.bestNew", "新紀錄！") : t("rocks.bestLabel", "本地最佳：")}${t("rocks.bestDetail",
      `${best.officialScore.toFixed(1)} 分 · ${Math.round(best.correctPerMinute)} 音節/分 · 準確度 ${Math.round(best.accuracy * 100)}%`,
      { score: best.officialScore.toFixed(1), cpm: Math.round(best.correctPerMinute), accuracy: Math.round(best.accuracy * 100) })}${isBest ? t("rocks.bestPlays", `（玩過 ${plays} 局）`, { plays }) : ""}`
    : t("rocks.bestEmptyQualify", "本地最佳：未有紀錄（要達門檻先會記錄）");
  if (flowMode) showFlowNext();
}

function startRound() {
  const now = Date.now();
  const seed = `rocks-${now}`;
  state = mode === "official"
    ? createRocksGame({ ...OFFICIAL_ROCKS, now, seed, bank: ROCK_QUESTIONS })
    : createRocksGame({ now, seed });
  draft = "";
  roundSaved = false;
  lastResult = null;
  showCard("play");
  // 流程橫額（連 seed）由 renderFlow 出，開局之後再畫一次。
  if (flowMode) renderFlow();
  measure();
  render();
  if (frame === null) frame = requestAnimationFrame(frameStep);
  capture.focus({ preventScroll: true });
}

// 切語言：靜態文案由 i18n 套用，動態文案（橫額、HUD、完場卡）喺呢度重畫。
// 未有 state（仲喺介紹卡）嗰陣一樣要行得通。
function relayout() {
  renderMode();
  renderFlow();
  renderRecord();
  if (lastResult) paintResult();
  if (state) render();
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
window.addEventListener("canclid-locale", relayout);

// 先套靜態翻譯，之後嘅 render 先寫動態文案（?flow=1 嘅介紹卡文案會蓋過靜態原文）。
if (typeof initI18n === "function") initI18n();
renderMode();
renderFlow();
renderRecord();
showCard("intro");
