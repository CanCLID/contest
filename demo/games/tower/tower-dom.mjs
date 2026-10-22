// 聲韻解鎖塔嘅畫面層：唯一會碰 DOM、localStorage 嘅檔案。
// 遊戲規則全部喺 tower.mjs，呢度只負責畫嘢同收鍵盤輸入。
import { COMPONENTS } from "../../engine.mjs";
import { formatClock, hashSeed, readJson, writeJson } from "../common.mjs";
import {
  TOTAL_STAGES, createTower, getTowerStats, getWeakComponents,
  nextRound, poolFor, submitAnswer, toSaved,
} from "./tower.mjs";
import { initI18n, registerStrings, t } from "../../i18n.mjs";

const STORAGE_KEY = "canclid-contest-games-tower";
const LABELS = { initial: "聲母", nucleus: "韻腹", coda: "韻尾" };
const LABEL_KEYS = { initial: "tower.componentInitial", nucleus: "tower.componentNucleus", coda: "tower.componentCoda" };
const TYPES = Object.keys(COMPONENTS);
const $ = selector => document.querySelector(selector);

function componentLabel(type) {
  return t(LABEL_KEYS[type], LABELS[type]);
}

registerStrings({
  hans: {
    // index.html 嘅 data-i18n 靜態文案
    "tower.skipLink": "跳去主要内容",
    "tower.brand": "粤拼小游戏",
    "tower.navLobby": "‹ 游戏大厅",
    "tower.navArena": "试玩赛场",
    "tower.badge": "练习模式，不设排名",
    "tower.title": "声韵解锁塔",
    "tower.tagline": "由最简单的声母开始，一层一层解锁粤拼嘅 19 个声母、11 个韵腹同 8 个韵尾。",
    "tower.stageOrdinal": "第",
    "tower.stageUnit": "层",
    "tower.stageTotalPrefix": "共",
    "tower.factUnlocked": "已解锁",
    "tower.factPool": "本层字池",
    "tower.factGoalSpeed": "层数目标",
    "tower.factGoalAccuracy": "准确度要求",
    "tower.componentsHeading": "元件解锁图",
    "tower.legendLocked": "未解锁",
    "tower.legendUnlocked": "已解锁",
    "tower.legendWeak": "弱项",
    "tower.componentInitial": "声母",
    "tower.componentNucleus": "韵腹",
    "tower.componentCoda": "韵尾",
    "tower.practice": "本层练习",
    "tower.metricTime": "已用时间",
    "tower.metricTimeUnit": "由第一次提交开始计",
    "tower.metricSpeed": "本轮速度",
    "tower.metricAccuracy": "本轮准确度",
    "tower.focusHint": "点一下呢度继续输入",
    "tower.hintConfirm": "确认",
    "tower.hintDelete": "删一个字母",
    "tower.progressHeading": "进度同纪录",
    "tower.progressNoteLead": "进度自动存喺呢个浏览器（",
    "tower.progressNoteTail": "），唔会有排名、亦唔会上传。题库未经人手校对，正式赛前须校对。",
    "tower.reset": "重设进度",
    // -dom.mjs 動態文案
    "tower.factUnlockedCount": "{unlocked} / {total} 个元件",
    "tower.factPoolSize": "{count} 个字",
    "tower.factGoalSpeedValue": "{cpm} 音节／分",
    "tower.factGoalAccuracyValue": "≥{percent}%（10 题要全中）",
    "tower.stageNoteGoal": "本层目标：准确度 ≥{percent}%、速度 ≥{cpm} 音节／分",
    "tower.stageNoteDone": "全部元件已解锁",
    "tower.speedUnit": "目标 {cpm} 音节／分",
    "tower.attemptsCount": "{correct} 正确 / {errors} 错误",
    "tower.attemptsNone": "未有提交",
    "tower.roundProgress": "已答 {index} / {total} 题",
    "tower.unlockNote": "新解锁：{parts}",
    "tower.cellLocked": "未解锁",
    "tower.cellTitleUnlocked": "{type} {value}：已解锁，{correct} / {total} 正确，准确率 {rate}",
    "tower.cellTitleUntried": "{type} {value}：已解锁，未练过",
    "tower.cellTitleLocked": "{type} {value}：未解锁",
    "tower.resultTitle": "本轮结果",
    "tower.resultSummary": "{correct} / {submitted} 题啱 · 准确度 {accuracy} · 速度 {cpm} 音节／分",
    "tower.resultDoneTitle": "全部 {count} 个元件解锁完成！",
    "tower.resultDoneSummary": "总共打咗 {rounds} 轮。想再玩就按下面「重设进度」。",
    "tower.resultPassedTitle": "第 {stage} 层完成，上一层解锁咗！",
    "tower.resultPassedContinue": "开始第 {stage} 层",
    "tower.resultEmptyTitle": "呢一层冇可用嘅字",
    "tower.resultEmptySummary": "字池夹唔到已解锁嘅元件，请按下面「重设进度」由第 1 层再开始。",
    "tower.resultRetryTitle": "未达标，留返喺第 {stage} 层",
    "tower.resultRetryContinue": "再嚟一轮",
    "tower.feedbackCorrect": "啱！下一个字：{hanzi}",
    "tower.feedbackWrong": "未啱，{hanzi} 应该係「{answers}」。下一个字：{next}",
    "tower.feedbackIdle": "打粤拼，唔使声调，按空白键或者 Enter 确认。",
    "tower.feedbackRoundEnd": "本轮完咗，睇下面嘅结果。",
    "tower.feedbackDone": "全部元件都解锁晒，可以按下面「重设进度」再玩。",
    "tower.storageUnavailable": "未能写入浏览器储存空间，进度净係喺呢一页有效。",
    "tower.resetConfirm": "重设声韵解锁塔嘅进度？已解锁嘅元件会还原到第 1 层。",
    "tower.announceDone": "全部 {count} 个元件解锁完成。",
    "tower.announceRound": "{outcome}：准确度 {accuracy}、速度 {cpm} 音节／分。",
    "tower.outcomePassed": "过关",
    "tower.outcomeRetry": "未达标",
  },
});

let state = createTower({ now: Date.now(), saved: readJson(STORAGE_KEY, null) });
let draft = "";
let composing = false;
let ticker = null;
let justUnlocked = { initial: [], nucleus: [], coda: [] };

function roundOpen() {
  return state.status === "playing" && state.round.outcome === null &&
    state.round.index < state.round.questions.length;
}

function save() {
  const ok = writeJson(STORAGE_KEY, toSaved(state));
  $("#storage-note").textContent = ok
    ? "" : t("tower.storageUnavailable", "未能寫入瀏覽器儲存空間，進度淨係喺呢一頁有效。");
}

function announce(message) {
  $("#announcer").textContent = message;
}

function percent(value) {
  return value === null || value === undefined ? "—" : `${Math.round(value * 100)}%`;
}

function unlockedDiff(before, next) {
  return {
    initial: next.unlockedInitials.filter(value => !before.initial.includes(value)),
    nucleus: next.unlockedNuclei.filter(value => !before.nucleus.includes(value)),
    coda: next.unlockedCodas.filter(value => !before.coda.includes(value)),
  };
}

function describeUnlock(diff) {
  const parts = TYPES
    .filter(type => diff[type].length > 0)
    .map(type => `${componentLabel(type)} ${diff[type].join("、")}`);
  return parts.length > 0 ? t("tower.unlockNote", "新解鎖：{parts}", { parts: parts.join("；") }) : "";
}

function setDraft(value) {
  draft = String(value ?? "").toLowerCase().replace(/[^a-z]/g, "");
  const input = $("#answer");
  if (input.value !== draft) input.value = draft;
  $("#reading").textContent = draft;
  $("#typing-surface").classList.toggle("typing", draft !== "");
}

// 200ms tick 會重複行 updateMetrics，只喺值有變先寫 DOM。
function setText(selector, value) {
  const node = $(selector);
  if (node.textContent !== value) node.textContent = value;
}

function updateMetrics(stats) {
  setText("#time", formatClock(stats.seconds));
  setText("#speed", String(Math.round(stats.round.correctPerMinute)));
  setText("#speed-unit", t("tower.speedUnit", "目標 {cpm} 音節／分", { cpm: stats.cpmTarget }));
  setText("#accuracy", stats.submitted ? percent(stats.round.accuracy) : "—");
  setText("#attempts", stats.submitted
    ? t("tower.attemptsCount", "{correct} 正確 / {errors} 錯誤", { correct: stats.correct, errors: stats.errors })
    : t("tower.attemptsNone", "未有提交"));
  setText("#round-progress", t("tower.roundProgress", "已答 {index} / {total} 題", { index: stats.index, total: stats.total }));
}

function renderStage(stats) {
  const accuracyPercent = Math.round(stats.accuracyTarget * 100);
  $("#stage-number").textContent = String(stats.stage);
  $("#stage-total").textContent = String(TOTAL_STAGES);
  $("#unlocked-count").textContent = t("tower.factUnlockedCount", "{unlocked} / {total} 個元件", {
    unlocked: stats.unlockedCount,
    total: stats.componentCount,
  });
  $("#pool-size").textContent = t("tower.factPoolSize", "{count} 個字", { count: poolFor(state).length });
  $("#goal-speed").textContent = t("tower.factGoalSpeedValue", "{cpm} 音節／分", { cpm: stats.cpmTarget });
  $("#goal-accuracy").textContent = t("tower.factGoalAccuracyValue", "≥{percent}%（10 題要全中）", { percent: accuracyPercent });
  $("#stage-note").textContent = state.status === "completed"
    ? t("tower.stageNoteDone", "全部元件已解鎖")
    : t("tower.stageNoteGoal", "本層目標：準確度 ≥{percent}%、速度 ≥{cpm} 音節／分", {
      percent: accuracyPercent,
      cpm: stats.cpmTarget,
    });
  const fraction = stats.unlockedCount / stats.componentCount;
  $("#stage-bar").style.width = `${fraction * 100}%`;
  $("#stage-track").setAttribute("aria-valuemax", String(stats.componentCount));
  $("#stage-track").setAttribute("aria-valuenow", String(stats.unlockedCount));
}

function renderComponents(stats, weak) {
  const unlocked = {
    initial: stats.unlockedInitials,
    nucleus: stats.unlockedNuclei,
    coda: stats.unlockedCodas,
  };
  for (const type of TYPES) {
    const cells = COMPONENTS[type].map(value => {
      const isUnlocked = unlocked[type].includes(value);
      const stat = stats.components[type].find(item => item.value === value);
      const cell = document.createElement("span");
      cell.className = `component-cell ${isUnlocked ? "unlocked" : "locked"}`;
      if (isUnlocked && weak[type].includes(value)) cell.classList.add("weak");
      if (justUnlocked[type].includes(value)) cell.classList.add("pop");
      cell.dataset.value = value;
      cell.setAttribute("role", "listitem");
      const rate = stat && stat.accuracy !== null && stat.total > 0 ? `${Math.round(stat.accuracy)}%` : "—";
      cell.title = isUnlocked
        ? stat && stat.total > 0
          ? t("tower.cellTitleUnlocked", "{type} {value}：已解鎖，{correct} / {total} 正確，準確率 {rate}", {
            type: componentLabel(type), value, correct: stat.correct, total: stat.total, rate,
          })
          : t("tower.cellTitleUntried", "{type} {value}：已解鎖，未練過", { type: componentLabel(type), value })
        : t("tower.cellTitleLocked", "{type} {value}：未解鎖", { type: componentLabel(type), value });
      cell.setAttribute("aria-label", cell.title);
      const sound = document.createElement("span");
      sound.className = "component-sound";
      sound.textContent = value;
      const rateElement = document.createElement("span");
      rateElement.className = "component-rate";
      rateElement.textContent = isUnlocked ? rate : t("tower.cellLocked", "未解鎖");
      cell.append(sound, rateElement);
      return cell;
    });
    $(`#component-${type}`).replaceChildren(...cells);
  }
  $("#unlock-note").textContent = describeUnlock(justUnlocked);
}

function renderRound() {
  const open = roundOpen();
  const question = open ? state.round.questions[state.round.index] : null;
  $("#glyph").textContent = question ? question.hanzi
    : state.status === "completed" ? "完" : "休息";
  $("#glyph").classList.toggle("current", Boolean(question));
  $("#status-dot").classList.toggle("live", open);
  $("#answer").disabled = !open;
  if (!open) setDraft("");
}

function renderResult(stats) {
  const result = $("#result");
  if (roundOpen()) {
    result.hidden = true;
    return;
  }
  result.hidden = false;
  const summary = t("tower.resultSummary", "{correct} / {submitted} 題啱 · 準確度 {accuracy} · 速度 {cpm} 音節／分", {
    correct: stats.correct,
    submitted: stats.submitted,
    accuracy: percent(stats.round.accuracy),
    cpm: Math.round(stats.round.correctPerMinute),
  });
  const goal = t("tower.stageNoteGoal", "本層目標：準確度 ≥{percent}%、速度 ≥{cpm} 音節／分", {
    percent: Math.round(stats.accuracyTarget * 100),
    cpm: stats.cpmTarget,
  });
  $("#continue").hidden = false;
  if (state.status === "completed") {
    $("#result-title").textContent = t("tower.resultDoneTitle", "全部 {count} 個元件解鎖完成！", { count: stats.componentCount });
    $("#result-summary").textContent = t("tower.resultDoneSummary", "總共打咗 {rounds} 輪。想再玩就按下面「重設進度」。", { rounds: stats.rounds });
    $("#continue").hidden = true;
    return;
  }
  if (state.round.outcome === "passed") {
    $("#result-title").textContent = t("tower.resultPassedTitle", "第 {stage} 層完成，上一層解鎖咗！", { stage: state.stage - 1 });
    $("#result-summary").textContent = `${summary}。${goal}`;
    $("#continue").textContent = t("tower.resultPassedContinue", "開始第 {stage} 層", { stage: state.stage });
    return;
  }
  if (state.round.outcome === "empty") {
    $("#result-title").textContent = t("tower.resultEmptyTitle", "呢一層冇可用嘅字");
    $("#result-summary").textContent = t("tower.resultEmptySummary", "字池夾唔到已解鎖嘅元件，請按下面「重設進度」由第 1 層再開始。");
    $("#continue").hidden = true;
    return;
  }
  $("#result-title").textContent = t("tower.resultRetryTitle", "未達標，留返喺第 {stage} 層", { stage: state.stage });
  $("#result-summary").textContent = `${summary}。${goal}`;
  $("#continue").textContent = t("tower.resultRetryContinue", "再嚟一輪");
}

// 未開局或者本輪完結時嘅提示；開局中唔應該蓋住「下一個字」。
function renderFeedback() {
  if (roundOpen()) return;
  $("#feedback").textContent = state.status === "completed"
    ? t("tower.feedbackDone", "全部元件都解鎖晒，可以按下面「重設進度」再玩。")
    : state.round.outcome === null
      ? t("tower.feedbackIdle", "打粵拼，唔使聲調，按空白鍵或者 Enter 確認。")
      : t("tower.feedbackRoundEnd", "本輪完咗，睇下面嘅結果。");
}

function render() {
  const stats = getTowerStats(state, Date.now());
  const weak = getWeakComponents(state, { threshold: 80 });
  renderStage(stats);
  renderComponents(stats, weak);
  renderRound();
  renderResult(stats);
  updateMetrics(stats);
  if (roundOpen()) startTicker();
  else stopTicker();
}

function renderLive() {
  if (!roundOpen()) {
    stopTicker();
    return;
  }
  updateMetrics(getTowerStats(state, Date.now()));
}

function startTicker() {
  if (ticker === null) ticker = setInterval(renderLive, 200);
}

function stopTicker() {
  if (ticker !== null) {
    clearInterval(ticker);
    ticker = null;
  }
}

function focusAnswer() {
  if (!roundOpen()) return;
  $("#answer").focus({ preventScroll: true });
}

function editDraft(letter = null) {
  setDraft(letter === null ? draft.slice(0, -1) : draft + letter);
}

function submit() {
  if (!roundOpen()) return;
  const before = {
    initial: [...state.unlockedInitials],
    nucleus: [...state.unlockedNuclei],
    coda: [...state.unlockedCodas],
  };
  const beforeStage = state.stage;
  state = submitAnswer(state, draft, Date.now());
  setDraft("");
  if (state.stage !== beforeStage) justUnlocked = unlockedDiff(before, state);
  save();
  render();
  if (roundOpen()) {
    const previous = state.round.questions[state.round.index - 1];
    const next = state.round.questions[state.round.index];
    $("#feedback").textContent = state.round.lastResult === "correct"
      ? t("tower.feedbackCorrect", "啱！下一個字：{hanzi}", { hanzi: next.hanzi })
      : t("tower.feedbackWrong", "未啱，{hanzi} 應該係「{answers}」。下一個字：{next}", {
        hanzi: previous.hanzi,
        answers: previous.answers.join(" 或 "),
        next: next.hanzi,
      });
    announce($("#feedback").textContent);
    return;
  }
  const stats = getTowerStats(state, Date.now());
  $("#feedback").textContent = state.status === "completed"
    ? t("tower.feedbackDone", "全部元件都解鎖晒，可以按下面「重設進度」再玩。")
    : t("tower.feedbackRoundEnd", "本輪完咗，睇下面嘅結果。");
  const outcome = state.round.outcome === "passed"
    ? t("tower.outcomePassed", "過關")
    : t("tower.outcomeRetry", "未達標");
  announce(state.status === "completed"
    ? t("tower.announceDone", "全部 {count} 個元件解鎖完成。", { count: stats.componentCount })
    : t("tower.announceRound", "{outcome}：準確度 {accuracy}、速度 {cpm} 音節／分。", {
      outcome,
      accuracy: percent(stats.round.accuracy),
      cpm: Math.round(stats.round.correctPerMinute),
    }));
}

$("#typing-surface").addEventListener("click", focusAnswer);
for (const selector of ["#answer", "#typing-surface"]) {
  $(selector).addEventListener("focus", () => $("#typing-surface").classList.add("focused"));
  $(selector).addEventListener("blur", () => $("#typing-surface").classList.remove("focused"));
}
$("#typing-surface").addEventListener("keydown", event => {
  if (event.ctrlKey || event.metaKey || event.altKey || event.key === "Tab") return;
  if (!roundOpen()) return;
  // 先用 ASCII event.key，唔得就退返 e.code（KeyA–KeyZ），同主賽場一致。
  const letter = /^[a-z]$/i.test(event.key ?? "") ? event.key.toLowerCase()
    : /^Key[A-Z]$/.test(event.code ?? "") ? event.code.slice(3).toLowerCase() : null;
  if (letter) {
    event.preventDefault();
    editDraft(letter);
    return;
  }
  const key = event.code === "Space" ? " " : event.code === "NumpadEnter" ? "Enter"
    : ["Enter", "Backspace"].includes(event.code) ? event.code : event.key;
  if (![" ", "Enter", "Backspace"].includes(key)) return;
  if (event.isComposing || composing) return;
  event.preventDefault();
  if (key === "Backspace" && draft === "") return;
  if (key === "Backspace") editDraft();
  else submit();
});
$("#answer").addEventListener("compositionstart", () => { composing = true; });
$("#answer").addEventListener("compositionend", () => {
  composing = false;
  setDraft(draft);
});
$("#answer").addEventListener("input", event => {
  if (event.isComposing || composing) return;
  const value = $("#answer").value;
  // 中文輸入法／貼上嘅內容一律唔收，只認 A–Z。
  if (/[^a-z\s]/i.test(value)) {
    setDraft(draft);
    return;
  }
  const pendingSubmit = /\s$/.test(value);
  setDraft(value);
  if (pendingSubmit) submit();
});
$("#continue").addEventListener("click", () => {
  state = nextRound(state, hashSeed(`tower:${state.stage}:${state.rounds.length}:${Date.now()}`));
  justUnlocked = { initial: [], nucleus: [], coda: [] };
  save();
  render();
  focusAnswer();
});
$("#reset").addEventListener("click", () => {
  if (!confirm(t("tower.resetConfirm", "重設聲韻解鎖塔嘅進度？已解鎖嘅元件會還原到第 1 層。"))) return;
  state = createTower({ now: Date.now(), saved: null });
  justUnlocked = { initial: [], nucleus: [], coda: [] };
  save();
  render();
  focusAnswer();
});
document.addEventListener("visibilitychange", () => {
  if (!document.hidden && roundOpen()) renderLive();
});

initI18n();
// 語言一轉就重畫動態介面（靜態文案由 i18n 運行庫自己換）。
window.addEventListener("canclid-locale", () => {
  render();
  renderFeedback();
});
save();
render();
$("#result-title").textContent = t("tower.resultTitle", "本輪結果");
$("#feedback").textContent = t("tower.feedbackIdle", "打粵拼，唔使聲調，按空白鍵或者 Enter 確認。");
setDraft("");
focusAnswer();
