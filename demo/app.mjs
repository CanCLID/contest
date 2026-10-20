import { createRun, submitAnswer, finishRun, getMetrics } from "./engine.mjs";
import { QUESTIONS, flattenQuestions } from "./questions.mjs";

const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const tokens = flattenQuestions();
const storageKey = "canclid-contest-demo-v1";
const groupNames = { desktop: "電腦組", mobile: "手機組" };
let group = matchMedia("(max-width: 760px)").matches ? "mobile" : "desktop";
let duration = 30;
let boardGroup = group;
let boardDuration = duration;
let run = null;
let round = null;
let countdownEnds = null;
let ticker = null;
let resultSaved = false;
let composing = false;
let storageAvailable = true;
let records = readRecords();

function readRecords(fallback = []) {
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey) || "[]");
    if (!Array.isArray(saved)) return [];
    return saved.filter(item => item && item.rules === 1 &&
      ["desktop", "mobile"].includes(item.group) && [30, 60].includes(item.duration) &&
      typeof item.name === "string" && item.name.length <= 16 &&
      Number.isSafeInteger(item.correct) && item.correct >= 0 && item.correct <= tokens.length &&
      Number.isSafeInteger(item.errors) && item.errors >= 0 && item.errors <= 100000 &&
      Number.isFinite(item.at)).slice(-20);
  } catch {
    storageAvailable = false;
    return fallback;
  }
}

function writeRecords() {
  try {
    localStorage.setItem(storageKey, JSON.stringify(records));
    storageAvailable = true;
  } catch {
    storageAvailable = false;
  }
}

function mergeRecords(...sources) {
  const merged = new Map(sources.flat().map(item => [
    item.id ?? JSON.stringify([item.at, item.name, item.group, item.duration, item.correct, item.errors]),
    item,
  ]));
  return [...merged.values()].sort((a, b) => a.at - b.at).slice(-20);
}

function setPressed(selector, attribute, value) {
  $$(selector).forEach(button => {
    const selected = button.dataset[attribute] === String(value);
    button.classList.toggle("selected", selected);
    button.setAttribute("aria-pressed", String(selected));
  });
}

function announce(message) {
  $("#announcer").textContent = message;
}

function showView(view) {
  $$(".view").forEach(section => { section.hidden = section.id !== `${view}-view`; });
  $$(".nav-link").forEach(button => {
    const active = button.dataset.view === view;
    button.classList.toggle("active", active);
    if (active) button.setAttribute("aria-current", "page");
    else button.removeAttribute("aria-current");
  });
  if (view === "leaderboard") renderBoards();
}

function renderPassage() {
  const index = run?.index ?? 0;
  const sentenceIndex = tokens[Math.min(index, tokens.length - 1)].sentenceIndex;
  const question = QUESTIONS[sentenceIndex];
  let absoluteIndex = tokens.findIndex(token => token.sentenceIndex === sentenceIndex);
  $("#passage").replaceChildren();
  for (const character of question.text) {
    const element = document.createElement("span");
    element.textContent = character;
    if (/\p{Script=Han}/u.test(character)) {
      element.classList.add("glyph");
      if (absoluteIndex < index) element.classList.add("correct");
      if (absoluteIndex === index) {
        element.classList.add("current");
        if (run?.lastResult === "incorrect") element.classList.add("incorrect");
      }
      absoluteIndex++;
    }
    $("#passage").append(element);
  }
  $("#sentence-label").textContent = `第 ${String(sentenceIndex + 1).padStart(2, "0")} 句 / ${QUESTIONS.length}`;
  $("#next-sentence").textContent = QUESTIONS[sentenceIndex + 1]?.text ?? "最後一段，跟住你嘅節奏完成。";
  $("#passage").setAttribute("aria-label", `${question.text} 目前要打：${tokens[index]?.hanzi ?? "已完成全部題目"}`);
}

function renderMetrics(now = Date.now()) {
  const metrics = run ? getMetrics(run, now) : {
    remainingSeconds: duration, correctPerMinute: 0, accuracy: null, correct: 0, errors: 0,
  };
  const seconds = Math.ceil(metrics.remainingSeconds);
  $("#time").textContent = `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
  $("#speed").textContent = String(Math.round(metrics.correctPerMinute));
  $("#accuracy").textContent = metrics.accuracy === null ? "—" : `${Math.round(metrics.accuracy)}%`;
  $("#attempts").textContent = metrics.correct + metrics.errors
    ? `${metrics.correct} 正確 / ${metrics.errors} 錯誤` : "未有提交";
  $("#completed-count").textContent = `${metrics.correct} 個正確音節`;
  const fraction = metrics.remainingSeconds / (run?.durationSeconds ?? duration) * 100;
  $("#time-bar").style.width = `${fraction}%`;
  $(".time-track").setAttribute("aria-valuenow", String(Math.round(fraction)));
  $(".time-track").classList.toggle("urgent", seconds <= 10 && Boolean(run));
}

function startRound() {
  if (countdownEnds !== null || run?.status === "running") return;
  run = null;
  resultSaved = false;
  composing = false;
  round = { group, duration, name: $("#nickname").value.trim().slice(0, 16) || "粵拼新星", rules: 1 };
  countdownEnds = Date.now() + 3000;
  $("#setup-fields").disabled = true;
  $("#start").disabled = true;
  $("#start").textContent = "準備起跑…";
  $("#start-note").textContent = "組別同時限已鎖定，倒數後開始。";
  $("#cancel-run").hidden = false;
  $("#result").hidden = true;
  $("#typing-form").hidden = false;
  $("#race-status").textContent = "準備起跑";
  $("#race-group").textContent = `${groupNames[round.group]} · ${round.duration} 秒`;
  $("#countdown-overlay").hidden = false;
  $("#answer").disabled = false;
  $("#answer").value = "";
  $("#answer").placeholder = "倒數後，輸入粵拼";
  $("#input-feedback").textContent = "準備好，倒數後先開始輸入。";
  $(".answer-wrap").classList.remove("error");
  document.body.classList.add("running");
  showView("arena");
  renderPassage();
  renderMetrics();
  // Focus during the initiating tap so mobile browsers can open their keyboard.
  $("#answer").focus({ preventScroll: true });
  if (matchMedia("(max-width: 760px)").matches) $(".race-card").scrollIntoView({ block: "start" });
  tick();
  ticker = setInterval(tick, 100);
}

function tick() {
  const now = Date.now();
  if (countdownEnds !== null) {
    const remaining = Math.ceil((countdownEnds - now) / 1000);
    if (remaining > 0) {
      if ($("#countdown-number").textContent !== String(remaining)) announce(`倒數 ${remaining}`);
      $("#countdown-number").textContent = String(remaining);
      return;
    }
    run = createRun({ durationSeconds: round.duration, now: countdownEnds, questionSet: tokens });
    countdownEnds = null;
    $("#countdown-overlay").hidden = true;
    $("#answer").value = "";
    $("#answer").placeholder = "打粵拼，空白鍵確認";
    $("#submit-answer").disabled = false;
    $("#race-status").textContent = "試玩進行中";
    $("#status-dot").classList.add("live");
    $("#start").textContent = "跟住你嘅節奏打";
    $("#start-note").textContent = "固定時間計分 · 答錯留原字再試";
    $("#input-feedback").textContent = "開始喇！唔使打聲調數字。";
    if (!$("#arena-view").hidden) $("#answer").focus({ preventScroll: true });
    announce("開始！唔使打聲調數字。");
  }
  if (run) {
    run = finishRun(run, now);
    renderMetrics(now);
    if (run.status === "finished") completeRound();
  }
}

function submit() {
  if (composing || !run || run.status !== "running") return;
  const value = $("#answer").value;
  const previousIndex = run.index;
  run = submitAnswer(run, value, Date.now());
  if (run.status === "finished") {
    renderMetrics();
    renderPassage();
    completeRound();
    return;
  }
  if (!value.trim()) {
    $("#answer").value = "";
    return;
  }
  const correct = run.index > previousIndex;
  $(".answer-wrap").classList.toggle("error", !correct);
  if (correct) {
    $("#answer").value = "";
    $("#input-feedback").textContent = `啱喇！下一個字：「${tokens[run.index].hanzi}」。`;
  } else {
    $("#answer").value = value.trim();
    $("#answer").select();
    $("#input-feedback").textContent = "未啱，再試一次。呢次錯誤已計入準確度。";
  }
  renderPassage();
  renderMetrics();
}

function completeRound() {
  clearInterval(ticker);
  ticker = null;
  const metrics = getMetrics(run, Date.now());
  $("#answer").disabled = true;
  $("#submit-answer").disabled = true;
  $("#typing-form").hidden = true;
  $("#result").hidden = false;
  $("#cancel-run").hidden = true;
  $("#setup-fields").disabled = false;
  $("#start").disabled = false;
  $("#start").innerHTML = '再玩一場 <span aria-hidden="true">↗</span>';
  $("#start-note").textContent = "可以改組別同時間，再挑戰自己。";
  $("#race-status").textContent = "本輪已完成";
  $("#status-dot").classList.remove("live");
  $("#result-title").textContent = run.index === tokens.length ? "全部打完，犀利！" : "時間到，完成喇！";
  $("#result-summary").textContent = `${round.name}，你打啱咗 ${metrics.correct} 個音節，${metrics.errors} 次錯誤。${metrics.correct ? "再試一場，搵返自己嘅節奏。" : "熟習咗操作，下次再挑戰！"}`;
  if (!resultSaved) {
    const result = { ...round, id: crypto.randomUUID(), correct: metrics.correct, errors: metrics.errors, at: Date.now() };
    // Merge persisted rounds with this tab's rounds, including failed writes.
    records = mergeRecords(readRecords(records), records, [result]);
    writeRecords();
    resultSaved = true;
    if (!$("#leaderboard-view").hidden) renderBoards();
    announce(`完成。正確速度每分鐘 ${Math.round(metrics.correctPerMinute)} 個音節，提交準確度 ${metrics.accuracy === null ? "未有提交" : Math.round(metrics.accuracy) + "%"}。`);
  }
  document.body.classList.remove("running");
}

function resetRound() {
  clearInterval(ticker);
  ticker = null;
  countdownEnds = null;
  run = null;
  round = null;
  $("#countdown-overlay").hidden = true;
  $("#result").hidden = true;
  $("#typing-form").hidden = false;
  $("#answer").disabled = true;
  $("#answer").value = "";
  $("#answer").placeholder = "準備好就開始啦";
  $("#submit-answer").disabled = true;
  $("#setup-fields").disabled = false;
  $("#cancel-run").hidden = true;
  $("#start").disabled = false;
  $("#start").innerHTML = '開始試玩 <span aria-hidden="true">↗</span>';
  $("#start-note").textContent = "倒數 3 秒後開始 · 中途唔會暫停";
  $("#race-status").textContent = "賽道準備好";
  $("#race-group").textContent = "本機試玩 · 無需登入";
  $("#status-dot").classList.remove("live");
  $(".answer-wrap").classList.remove("error");
  $("#input-feedback").textContent = "本輪已放棄，唔會記錄成績。";
  document.body.classList.remove("running");
  renderPassage();
  renderMetrics();
  $("#start").focus({ preventScroll: true });
}

function rankRecords(items) {
  return items.map(item => ({
    ...item,
    speed: item.correct / (item.duration / 60),
    accuracy: item.correct + item.errors ? item.correct / (item.correct + item.errors) * 100 : null,
  })).sort((a, b) => b.speed - a.speed || (b.accuracy ?? -1) - (a.accuracy ?? -1) || a.at - b.at);
}

function renderTable(container, items, sample = false) {
  container.replaceChildren();
  if (!items.length) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.innerHTML = "<span aria-hidden='true'>↗</span>呢條賽道，等你留低第一個紀錄。<p>完成一輪相同組別同時限嘅試玩，成績就會出現喺呢度。</p>";
    container.append(empty);
    return;
  }
  const table = document.createElement("table");
  table.className = "score-table";
  table.innerHTML = "<thead><tr><th scope='col'>名次</th><th scope='col'>暱稱</th><th scope='col'>音節 / 分鐘</th><th scope='col'>提交準確度</th></tr></thead>";
  const tbody = document.createElement("tbody");
  let rank = 0;
  let last = null;
  for (const [index, item] of rankRecords(items).entries()) {
    if (!last || item.speed !== last.speed || item.accuracy !== last.accuracy) rank = index + 1;
    last = item;
    const row = document.createElement("tr");
    if (rank === 1 && item.correct > 0) row.className = "best";
    const rankCell = document.createElement("td");
    rankCell.textContent = item.correct ? String(rank).padStart(2, "0") : "—";
    const nameCell = document.createElement("td");
    nameCell.className = "score-name";
    nameCell.append(document.createTextNode(item.name));
    const source = document.createElement("small");
    source.textContent = sample ? "虛構示範人物" : `${new Date(item.at).toLocaleString("zh-HK", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })} · 本機`;
    nameCell.append(source);
    const speedCell = document.createElement("td");
    const speedText = document.createElement("strong");
    speedText.textContent = String(Math.round(item.speed));
    speedCell.append(speedText);
    const accuracyCell = document.createElement("td");
    accuracyCell.textContent = item.accuracy === null ? "—" : `${Math.round(item.accuracy)}%`;
    row.append(rankCell, nameCell, speedCell, accuracyCell);
    tbody.append(row);
  }
  table.append(tbody);
  container.append(table);
}

function renderBoards() {
  setPressed("[data-board-group]", "boardGroup", boardGroup);
  setPressed("[data-board-duration]", "boardDuration", boardDuration);
  renderTable($("#local-board"), records.filter(item => item.group === boardGroup && item.duration === boardDuration));
  const base = boardGroup === "mobile" ? 23 : 41;
  const sample = ["打字阿晴", "粵拼小隊長", "慢慢嚟都得"].map((name, index) => ({
    name, duration: boardDuration, correct: (base - index * 5) * boardDuration / 30,
    errors: index + 1, at: index,
  }));
  renderTable($("#sample-board"), sample, true);
  $("#storage-note").textContent = storageAvailable ? "" : "瀏覽器暫時唔容許保存紀錄；新成績只會喺今次開啟頁面期間保留。";
  $("#clear-scores").hidden = records.length === 0;
}

$$("[data-view]").forEach(button => button.addEventListener("click", () => showView(button.dataset.view)));
$$("[data-group]").forEach(button => button.addEventListener("click", () => {
  group = button.dataset.group;
  setPressed("[data-group]", "group", group);
}));
$$("[data-duration]").forEach(button => button.addEventListener("click", () => {
  duration = Number(button.dataset.duration);
  setPressed("[data-duration]", "duration", duration);
  if (!run) renderMetrics();
}));
$$("[data-board-group]").forEach(button => button.addEventListener("click", () => {
  boardGroup = button.dataset.boardGroup;
  renderBoards();
}));
$$("[data-board-duration]").forEach(button => button.addEventListener("click", () => {
  boardDuration = Number(button.dataset.boardDuration);
  renderBoards();
}));
$("#start").addEventListener("click", startRound);
$("#cancel-run").addEventListener("click", resetRound);
$("#typing-form").addEventListener("submit", event => { event.preventDefault(); submit(); });
$("#answer").addEventListener("compositionstart", () => { composing = true; });
$("#answer").addEventListener("compositionend", () => { composing = false; });
$("#answer").addEventListener("keydown", event => {
  if (event.isComposing || composing || event.keyCode === 229) {
    if (event.key === "Enter") event.preventDefault();
    return;
  }
  if (event.key === " ") { event.preventDefault(); submit(); }
});
$("#answer").addEventListener("input", event => {
  // Some screen keyboards insert a space without a keydown event.
  if (!event.isComposing && !composing && /\s$/.test($("#answer").value)) submit();
});
$("#submit-answer").addEventListener("click", () => {
  if (run?.status === "running") $("#answer").focus({ preventScroll: true });
});
$("#view-result-board").addEventListener("click", () => {
  boardGroup = round.group;
  boardDuration = round.duration;
  showView("leaderboard");
});
$("#clear-scores").addEventListener("click", () => {
  if (!confirm("清除呢部裝置全部組別同時限嘅試玩紀錄？")) return;
  records = [];
  writeRecords();
  renderBoards();
});
document.addEventListener("visibilitychange", () => {
  if (!document.hidden && (run?.status === "running" || countdownEnds !== null)) tick();
});
window.addEventListener("storage", event => {
  if (event.key === storageKey || event.key === null) {
    records = event.newValue === null || event.newValue === "[]" ? [] : mergeRecords(readRecords(records), records);
    if (!$("#leaderboard-view").hidden) renderBoards();
  }
});

setPressed("[data-group]", "group", group);
renderPassage();
renderMetrics();
renderBoards();
