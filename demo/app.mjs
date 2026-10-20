import { createRun, submitAnswer, undoAnswer, getMetrics } from "./engine.mjs";
import { ARTICLE, QUESTIONS, flattenQuestions } from "./questions.mjs";

const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const tokens = flattenQuestions();
const storageKey = "canclid-contest-demo-v2";
const groupNames = { desktop: "電腦組", mobile: "手機組" };
let group = matchMedia("(max-width: 760px)").matches ? "mobile" : "desktop";
let boardGroup = group;
let run = null;
let round = null;
let countdownEnds = null;
let ticker = null;
let resultSaved = false;
let composing = false;
let deleteKeyHandled = false;
let storageAvailable = true;
let records = readRecords();

function readRecords(fallback = []) {
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey) || "[]");
    if (!Array.isArray(saved)) return [];
    return saved.filter(item => item && item.rules === 2 && item.articleId === ARTICLE.id &&
      ["desktop", "mobile"].includes(item.group) &&
      typeof item.name === "string" && item.name.length <= 16 &&
      Number.isSafeInteger(item.correct) && item.correct >= 0 && item.correct <= tokens.length &&
      Number.isSafeInteger(item.errors) && item.errors >= 0 && item.correct + item.errors === tokens.length &&
      Number.isFinite(item.elapsedSeconds) && item.elapsedSeconds >= 0 &&
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
    item.id ?? JSON.stringify([item.at, item.name, item.group, item.articleId, item.correct, item.errors]),
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
      if (absoluteIndex < index) element.classList.add(run.answers[absoluteIndex].correct ? "correct" : "incorrect");
      if (absoluteIndex === index) element.classList.add("current");
      absoluteIndex++;
    }
    $("#passage").append(element);
  }
  $("#sentence-label").textContent = `第 ${String(sentenceIndex + 1).padStart(2, "0")} 句 / ${QUESTIONS.length}`;
  $("#next-sentence").textContent = QUESTIONS[sentenceIndex + 1]?.text ?? "最後一段，跟住你嘅節奏完成。";
  $("#passage").setAttribute("aria-label", `${question.text} 目前要打：${tokens[index]?.hanzi ?? "已完成全部題目"}`);
}

function formatTime(seconds) {
  const tenths = Math.floor(seconds * 10);
  return `${String(Math.floor(tenths / 600)).padStart(2, "0")}:${String(Math.floor(tenths / 10) % 60).padStart(2, "0")}.${tenths % 10}`;
}

function renderMetrics(now = Date.now()) {
  const metrics = run ? getMetrics(run, now) : {
    elapsedSeconds: 0, syllablesPerMinute: 0, accuracy: null, correct: 0, errors: 0, submitted: 0, progress: 0,
  };
  $("#time").textContent = formatTime(metrics.elapsedSeconds);
  $("#speed").textContent = String(Math.round(metrics.syllablesPerMinute));
  $("#accuracy").textContent = metrics.accuracy === null ? "—" : `${Math.round(metrics.accuracy)}%`;
  $("#attempts").textContent = metrics.correct + metrics.errors
    ? `${metrics.correct} 正確 / ${metrics.errors} 錯誤` : "未有提交";
  $("#completed-count").textContent = `${metrics.submitted} / ${tokens.length} 音節`;
  const fraction = metrics.progress * 100;
  $("#time-bar").style.width = `${fraction}%`;
  $(".time-track").setAttribute("aria-valuenow", String(Math.round(fraction)));
}

function startRound() {
  if (countdownEnds !== null || run?.status === "running") return;
  run = null;
  resultSaved = false;
  composing = false;
  round = { group, articleId: ARTICLE.id, name: $("#nickname").value.trim().slice(0, 16) || "粵拼新星", rules: 2 };
  countdownEnds = Date.now() + 3000;
  $("#setup-fields").disabled = true;
  $("#start").disabled = true;
  $("#start").textContent = "準備中…";
  $("#start-note").textContent = "倒數 3 秒開始";
  $("#cancel-run").hidden = false;
  $("#result").hidden = true;
  $("#typing-form").hidden = false;
  $("#race-status").textContent = "準備起跑";
  $("#race-group").textContent = `${groupNames[round.group]} · 全文 ${tokens.length} 音節`;
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
    run = createRun({ now: countdownEnds, questionSet: tokens });
    countdownEnds = null;
    $("#countdown-overlay").hidden = true;
    $("#answer").value = "";
    $("#answer").placeholder = "打粵拼，空白鍵確認";
    $("#submit-answer").disabled = false;
    $("#race-status").textContent = "試玩進行中";
    $("#status-dot").classList.add("live");
    $("#start").textContent = "進行中";
    $("#start-note").textContent = "最後一字提交即完場";
    $("#input-feedback").textContent = "開始喇！唔使打聲調數字。";
    if (!$("#arena-view").hidden) $("#answer").focus({ preventScroll: true });
    announce("開始！唔使打聲調數字。");
  }
  if (run) {
    renderMetrics(now);
    if (run.status === "finished") completeRound();
  }
}

function submit() {
  if (composing || !run || run.status !== "running") return;
  const value = $("#answer").value;
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
  $("#answer").value = "";
  if (run.lastResult === "correct") {
    $("#input-feedback").textContent = `下一字：${tokens[run.index].hanzi}`;
  } else {
    $("#input-feedback").textContent = "未啱；按 Backspace 可修改。";
  }
  renderPassage();
  renderMetrics();
}

function undoLast() {
  if (composing || !run || run.status !== "running" || run.index === 0) return;
  run = undoAnswer(run, Date.now());
  $("#answer").value = run.lastAnswer;
  $("#answer").focus({ preventScroll: true });
  $("#answer").select();
  $("#input-feedback").textContent = `修改「${tokens[run.index].hanzi}」後確認。`;
  renderPassage();
  renderMetrics();
}

function handleDelete(event) {
  if (event.isComposing || composing || $("#answer").value !== "" ||
      !run || run.status !== "running" || run.index === 0) return;
  event.preventDefault();
  undoLast();
  return true;
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
  $("#start-note").textContent = "";
  $("#race-status").textContent = "本輪已完成";
  $("#status-dot").classList.remove("live");
  $("#result-title").textContent = `全文完成 · 試算綜合分 ${metrics.score.toFixed(1)}`;
  $("#result-summary").textContent = `${round.name} · ${formatTime(metrics.elapsedSeconds)} · ${metrics.correct} 啱／${metrics.errors} 錯`;
  if (!resultSaved) {
    const result = { ...round, id: crypto.randomUUID(), correct: metrics.correct, errors: metrics.errors, elapsedSeconds: metrics.elapsedSeconds, at: Date.now() };
    // Merge persisted rounds with this tab's rounds, including failed writes.
    records = mergeRecords(readRecords(records), records, [result]);
    writeRecords();
    resultSaved = true;
    if (!$("#leaderboard-view").hidden) renderBoards();
    announce(`全文完成。綜合分 ${metrics.score.toFixed(1)}，答案準確度 ${Math.round(metrics.accuracy)}%。`);
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
  $("#start-note").textContent = "倒數 3 秒開始";
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
  return items.map(item => {
    const submitted = item.correct + item.errors;
    const accuracy = submitted ? item.correct / submitted * 100 : 0;
    const speed = item.elapsedSeconds > 0 ? submitted / item.elapsedSeconds * 60 : 0;
    return { ...item, speed, accuracy, score: speed * (accuracy / 100) ** 2 };
  }).sort((a, b) => b.score - a.score || b.accuracy - a.accuracy ||
    a.elapsedSeconds - b.elapsedSeconds || a.at - b.at);
}

function renderTable(container, items, sample = false) {
  container.replaceChildren();
  if (!items.length) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.innerHTML = "未有紀錄。<p>完成全文後會顯示喺呢度。</p>";
    container.append(empty);
    return;
  }
  const table = document.createElement("table");
  table.className = "score-table";
  table.innerHTML = "<thead><tr><th scope='col'>名次</th><th scope='col'>暱稱 / 用時</th><th scope='col'>綜合分</th><th scope='col'>準確度</th></tr></thead>";
  const tbody = document.createElement("tbody");
  let rank = 0;
  let last = null;
  for (const [index, item] of rankRecords(items).entries()) {
    if (!last || item.score !== last.score || item.accuracy !== last.accuracy || item.elapsedSeconds !== last.elapsedSeconds) rank = index + 1;
    last = item;
    const row = document.createElement("tr");
    if (rank === 1 && item.correct > 0) row.className = "best";
    const rankCell = document.createElement("td");
    rankCell.textContent = item.correct ? String(rank).padStart(2, "0") : "—";
    const nameCell = document.createElement("td");
    nameCell.className = "score-name";
    nameCell.append(document.createTextNode(item.name));
    const source = document.createElement("small");
    source.textContent = `${formatTime(item.elapsedSeconds)} · ${Math.round(item.speed)} 音節/分`;
    nameCell.append(source);
    const origin = document.createElement("small");
    origin.textContent = sample ? "虛構示範人物" : `${new Date(item.at).toLocaleString("zh-HK", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })} · 本機`;
    nameCell.append(origin);
    const speedCell = document.createElement("td");
    const speedText = document.createElement("strong");
    speedText.textContent = item.score.toFixed(1);
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
  renderTable($("#local-board"), records.filter(item => item.group === boardGroup && item.articleId === ARTICLE.id && item.rules === 2));
  const baseTime = boardGroup === "mobile" ? 105 : 65;
  const sample = ["打字阿晴", "粵拼小隊長", "慢慢嚟都得"].map((name, index) => ({
    name, elapsedSeconds: baseTime + index * 12, correct: tokens.length - (index + 1) * 2,
    errors: (index + 1) * 2, at: index,
  }));
  renderTable($("#sample-board"), sample, true);
  $("#storage-note").textContent = storageAvailable ? "" : "未能保存紀錄，關頁後新成績會遺失。";
  $("#clear-scores").hidden = records.length === 0;
}

$$("[data-view]").forEach(button => button.addEventListener("click", () => showView(button.dataset.view)));
$$("[data-group]").forEach(button => button.addEventListener("click", () => {
  group = button.dataset.group;
  setPressed("[data-group]", "group", group);
}));
$$("[data-board-group]").forEach(button => button.addEventListener("click", () => {
  boardGroup = button.dataset.boardGroup;
  renderBoards();
}));
$("#start").addEventListener("click", startRound);
$("#cancel-run").addEventListener("click", resetRound);
$("#typing-form").addEventListener("submit", event => { event.preventDefault(); submit(); });
$("#answer").addEventListener("compositionstart", () => { composing = true; });
$("#answer").addEventListener("compositionend", () => { composing = false; });
$("#answer").addEventListener("keydown", event => {
  deleteKeyHandled = false;
  if (event.isComposing || composing || event.keyCode === 229) {
    if (event.key === "Enter") event.preventDefault();
    return;
  }
  if (event.key === " ") { event.preventDefault(); submit(); }
  if (event.key === "Backspace" && handleDelete(event)) {
    deleteKeyHandled = true;
    setTimeout(() => { deleteKeyHandled = false; }, 0);
  }
});
$("#answer").addEventListener("beforeinput", event => {
  if (event.inputType !== "deleteContentBackward") return;
  if (deleteKeyHandled) {
    event.preventDefault();
    deleteKeyHandled = false;
  } else handleDelete(event);
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
  showView("leaderboard");
});
$("#clear-scores").addEventListener("click", () => {
  if (!confirm("清除呢部裝置目前文章、兩個組別嘅試玩紀錄？")) return;
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
$("#article-title").textContent = ARTICLE.title;
$("#article-detail").textContent = `示範粵文 · ${tokens.length} 音節`;
$("#board-article").textContent = `同篇比較：${ARTICLE.title}`;
renderPassage();
renderMetrics();
renderBoards();
