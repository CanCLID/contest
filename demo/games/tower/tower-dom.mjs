// 聲韻解鎖塔嘅畫面層：唯一會碰 DOM、localStorage 嘅檔案。
// 遊戲規則全部喺 tower.mjs，呢度只負責畫嘢同收鍵盤輸入。
import { COMPONENTS } from "../../engine.mjs";
import { formatClock, hashSeed, readJson, writeJson } from "../common.mjs";
import {
  TOTAL_STAGES, createTower, getTowerStats, getWeakComponents,
  nextRound, poolFor, submitAnswer, toSaved,
} from "./tower.mjs";

const STORAGE_KEY = "canclid-contest-games-tower";
const LABELS = { initial: "聲母", nucleus: "韻腹", coda: "韻尾" };
const TYPES = Object.keys(COMPONENTS);
const $ = selector => document.querySelector(selector);

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
    ? "" : "未能寫入瀏覽器儲存空間，進度淨係喺呢一頁有效。";
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
    .map(type => `${LABELS[type]} ${diff[type].join("、")}`);
  return parts.length > 0 ? `新解鎖：${parts.join("；")}` : "";
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
  setText("#speed-unit", `目標 ${stats.cpmTarget} 音節／分`);
  setText("#accuracy", stats.submitted ? percent(stats.round.accuracy) : "—");
  setText("#attempts", stats.submitted
    ? `${stats.correct} 正確 / ${stats.errors} 錯誤` : "未有提交");
  setText("#round-progress", `已答 ${stats.index} / ${stats.total} 題`);
}

function renderStage(stats) {
  $("#stage-number").textContent = String(stats.stage);
  $("#stage-total").textContent = String(TOTAL_STAGES);
  $("#unlocked-count").textContent = `${stats.unlockedCount} / ${stats.componentCount} 個元件`;
  $("#pool-size").textContent = `${poolFor(state).length} 個字`;
  $("#goal-speed").textContent = `${stats.cpmTarget} 音節／分`;
  $("#goal-accuracy").textContent = `≥${Math.round(stats.accuracyTarget * 100)}%（10 題要全中）`;
  $("#stage-note").textContent = state.status === "completed"
    ? "全部元件已解鎖"
    : `本層目標：準確度 ≥${Math.round(stats.accuracyTarget * 100)}%、速度 ≥${stats.cpmTarget} 音節／分`;
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
        ? `${LABELS[type]} ${value}：已解鎖${stat && stat.total > 0
          ? `，${stat.correct} / ${stat.total} 正確，準確率 ${rate}` : "，未練過"}`
        : `${LABELS[type]} ${value}：未解鎖`;
      cell.setAttribute("aria-label", cell.title);
      const sound = document.createElement("span");
      sound.className = "component-sound";
      sound.textContent = value;
      const rateElement = document.createElement("span");
      rateElement.className = "component-rate";
      rateElement.textContent = isUnlocked ? rate : "未解鎖";
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
  const summary = `${stats.correct} / ${stats.submitted} 題啱 · 準確度 ${percent(stats.round.accuracy)}`
    + ` · 速度 ${Math.round(stats.round.correctPerMinute)} 音節／分`;
  const goal = `本層目標：準確度 ≥${Math.round(stats.accuracyTarget * 100)}%、速度 ≥${stats.cpmTarget} 音節／分`;
  $("#continue").hidden = false;
  if (state.status === "completed") {
    $("#result-title").textContent = `全部 ${stats.componentCount} 個元件解鎖完成！`;
    $("#result-summary").textContent = `總共打咗 ${stats.rounds} 輪。想再玩就按下面「重設進度」。`;
    $("#continue").hidden = true;
    return;
  }
  if (state.round.outcome === "passed") {
    $("#result-title").textContent = `第 ${state.stage - 1} 層完成，上一層解鎖咗！`;
    $("#result-summary").textContent = `${summary}。${goal}`;
    $("#continue").textContent = `開始第 ${state.stage} 層`;
    return;
  }
  if (state.round.outcome === "empty") {
    $("#result-title").textContent = "呢一層冇可用嘅字";
    $("#result-summary").textContent = "字池夾唔到已解鎖嘅元件，請按下面「重設進度」由第 1 層再開始。";
    $("#continue").hidden = true;
    return;
  }
  $("#result-title").textContent = `未達標，留返喺第 ${state.stage} 層`;
  $("#result-summary").textContent = `${summary}。${goal}`;
  $("#continue").textContent = "再嚟一輪";
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
      ? `啱！下一個字：${next.hanzi}`
      : `未啱，${previous.hanzi} 應該係「${previous.answers.join(" 或 ")}」。下一個字：${next.hanzi}`;
    announce($("#feedback").textContent);
    return;
  }
  const stats = getTowerStats(state, Date.now());
  $("#feedback").textContent = state.status === "completed"
    ? "全部元件都解鎖晒，可以按下面「重設進度」再玩。"
    : "本輪完咗，睇下面嘅結果。";
  announce(state.status === "completed"
    ? `全部 ${stats.componentCount} 個元件解鎖完成。`
    : `${state.round.outcome === "passed" ? "過關" : "未達標"}：準確度 ${percent(stats.round.accuracy)}、速度 ${Math.round(stats.round.correctPerMinute)} 音節／分。`);
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
  if (!confirm("重設聲韻解鎖塔嘅進度？已解鎖嘅元件會還原到第 1 層。")) return;
  state = createTower({ now: Date.now(), saved: null });
  justUnlocked = { initial: [], nucleus: [], coda: [] };
  save();
  render();
  focusAnswer();
});
document.addEventListener("visibilitychange", () => {
  if (!document.hidden && roundOpen()) renderLive();
});

save();
render();
setDraft("");
focusAnswer();
