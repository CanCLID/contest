import { createRun, submitAnswer, undoAnswer, getMetrics, getComponentStats } from "./engine.mjs?v=9";
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
let draft = "";
let draftCursor = 0;
let draftSelectionEnd = 0;
let answerVersion = 0;
let physicalEdit = null;
let composition = null;
let committedComposition = null;
let currentGlyph = null;
let currentAnswer = null;
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
  if (view === "arena" && run?.status === "running") focusAnswer();
}

function positionAnswer(scroll = false) {
  if (!currentGlyph || $("#arena-view").hidden || $("#race-card").hidden) return;
  if (scroll) currentGlyph.scrollIntoView({ block: "nearest", inline: "nearest" });
  const glyphBounds = currentGlyph.getBoundingClientRect();
  const surface = $("#typing-surface");
  const surfaceBounds = surface.getBoundingClientRect();
  $("#answer").style.left = `${glyphBounds.left - surfaceBounds.left + surface.scrollLeft + glyphBounds.width / 2}px`;
  $("#answer").style.top = `${glyphBounds.top - surfaceBounds.top + surface.scrollTop}px`;
}

function focusAnswer() {
  if ($("#answer").disabled || $("#race-card").hidden) return;
  positionAnswer(true);
  const target = round?.group === "mobile" ? $("#answer") : $("#typing-surface");
  target.focus({ preventScroll: true });
}

function renderDraft() {
  if (currentAnswer) currentAnswer.textContent = run?.status === "running" ? draft : "";
}

function setDraft(value, start, end = start) {
  draft = value.replace(/[^a-z]/gi, "").toLowerCase();
  draftCursor = Math.min(start ?? draft.length, draft.length);
  draftSelectionEnd = Math.min(end ?? draftCursor, draft.length);
  $("#answer").value = draft;
  $("#answer").setSelectionRange(draftCursor, draftSelectionEnd);
  renderDraft();
}

function restoreDraft() {
  setDraft(draft, draftCursor, draftSelectionEnd);
}

function selection() {
  const input = $("#answer");
  return input.value === draft ? [input.selectionStart ?? draftCursor, input.selectionEnd ?? draftCursor] : [draftCursor, draftCursor];
}

function editDraft(letter = null) {
  let [start, end] = selection();
  if (letter === null && start === end) start = Math.max(0, start - 1);
  const replacement = letter ?? "";
  setDraft(draft.slice(0, start) + replacement + draft.slice(end), start + replacement.length);
}

function markPhysicalEdit() {
  const edit = {};
  physicalEdit = edit;
  if (composition) composition.physical = true;
  committedComposition = null;
  // A canceled keydown can still be followed by native input in the same event turn.
  setTimeout(() => { if (physicalEdit === edit) physicalEdit = null; }, 0);
}

function captureComposition(event) {
  if (composition?.version === answerVersion && !composition.physical && typeof event.data === "string" && /^[a-z]*$/i.test(event.data)) {
    const { base, start, end } = composition;
    const letters = (event.data ?? "").toLowerCase();
    setDraft(base.slice(0, start) + letters + base.slice(end), start + letters.length);
  } else restoreDraft();
}

function isCompositionCommit(event) {
  return /Composition/.test(event.inputType ?? "") ||
    (committedComposition && event.data === committedComposition.data);
}

function renderComponentStats() {
  const labels = { initial: "聲母", nucleus: "韻腹", coda: "韻尾" };
  for (const [part, items] of Object.entries(getComponentStats(run))) {
    const cells = items.map(({ value, correct, total, accuracy }) => {
      const cell = document.createElement("span");
      cell.className = "component-cell";
      cell.dataset.value = value;
      cell.setAttribute("role", "listitem");
      const rate = accuracy === null ? "—" : `${Math.round(accuracy)}%`;
      cell.title = total
        ? `${labels[part]} ${value}：${correct} / ${total} 正確，準確率 ${rate}，錯誤率 ${Math.round(100 - accuracy)}%`
        : `${labels[part]} ${value}：未輸入`;
      cell.setAttribute("aria-label", cell.title);
      if (total) cell.classList.add(correct === total ? "correct" : correct === 0 ? "incorrect" : "mixed");
      const sound = document.createElement("span");
      sound.className = "component-sound";
      sound.textContent = value;
      const percent = document.createElement("span");
      percent.className = "component-rate";
      percent.textContent = rate;
      cell.append(sound, percent);
      return cell;
    });
    $(`#component-${part}`).replaceChildren(...cells);
  }
}

function renderPassage() {
  const index = run?.index ?? 0;
  const sentenceIndex = tokens[Math.min(index, tokens.length - 1)].sentenceIndex;
  const question = QUESTIONS[sentenceIndex];
  let absoluteIndex = tokens.findIndex(token => token.sentenceIndex === sentenceIndex);
  let previousGlyph = null;
  currentGlyph = null;
  currentAnswer = null;
  $("#passage").replaceChildren();
  for (const character of question.text) {
    const element = document.createElement("span");
    if (/\p{Script=Han}/u.test(character)) {
      element.classList.add("glyph");
      const answer = document.createElement("span");
      answer.className = "glyph-answer";
      answer.setAttribute("aria-hidden", "true");
      answer.textContent = run?.answers[absoluteIndex]?.answer ?? "";
      const hanzi = document.createElement("span");
      hanzi.className = "glyph-hanzi";
      hanzi.textContent = character;
      element.append(answer, hanzi);
      previousGlyph = element;
      if (absoluteIndex < index) element.classList.add(run.answers[absoluteIndex].correct ? "correct" : "incorrect");
      if (absoluteIndex === index) {
        element.classList.add("current");
        currentGlyph = element;
        currentAnswer = answer;
      }
      absoluteIndex++;
    } else {
      element.classList.add("punctuation");
      element.textContent = character;
      if (previousGlyph) {
        previousGlyph.classList.add("punctuated");
        previousGlyph.append(element);
        continue;
      }
    }
    $("#passage").append(element);
  }
  $("#sentence-label").textContent = `第 ${String(sentenceIndex + 1).padStart(2, "0")} 句 / ${QUESTIONS.length}`;
  $("#next-sentence").textContent = QUESTIONS[sentenceIndex + 1]?.text ?? "最後一段，跟住你嘅節奏完成。";
  $("#passage").setAttribute("aria-label", `${question.text} 目前要打：${tokens[index]?.hanzi ?? "已完成全部題目"}`);
  renderDraft();
  renderComponentStats();
  positionAnswer();
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

function startRound(replay = false) {
  if (countdownEnds !== null || run?.status === "running" || (replay && !round)) return;
  run = null;
  resultSaved = false;
  composing = false;
  composition = null;
  committedComposition = null;
  physicalEdit = null;
  answerVersion++;
  round = replay ? { ...round }
    : { group, articleId: ARTICLE.id, name: $("#nickname").value.trim().slice(0, 16) || "粵拼新星", rules: 2 };
  countdownEnds = Date.now() + 3000;
  $("#setup-card").hidden = true;
  $("#round-summary").hidden = false;
  $("#round-name").textContent = round.name;
  $("#round-group").textContent = groupNames[round.group];
  $("#round-article").textContent = ARTICLE.title;
  $("#round-length").textContent = `${tokens.length} 音節`;
  $("#round-actions").hidden = false;
  $("#play-again").hidden = true;
  $("#edit-settings").hidden = true;
  $("#setup-fields").disabled = true;
  $("#start").disabled = true;
  $("#start").textContent = "準備中…";
  $("#start-note").textContent = "倒數 3 秒開始";
  $("#cancel-run").hidden = false;
  $("#result").hidden = true;
  $("#race-card").hidden = false;
  $("#arena-view").classList.add("has-race");
  $("#typing-form").hidden = false;
  $("#race-status").textContent = "準備起跑";
  $("#race-group").textContent = `${groupNames[round.group]} · 全文 ${tokens.length} 音節`;
  $("#countdown-overlay").hidden = false;
  $("#answer").disabled = false;
  setDraft("");
  $("#answer").placeholder = "倒數後，輸入粵拼";
  $("#input-feedback").textContent = "準備好，倒數後先開始輸入。";
  document.body.classList.add("running");
  showView("arena");
  renderPassage();
  renderMetrics();
  // Focus during the initiating tap so mobile browsers can open their keyboard.
  focusAnswer();
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
    answerVersion++;
    setDraft("");
    $("#answer").placeholder = "打粵拼，空白鍵確認";
    $("#race-status").textContent = "試玩進行中";
    $("#status-dot").classList.add("live");
    $("#start").textContent = "進行中";
    $("#start-note").textContent = "最後一字提交即完場";
    $("#input-feedback").textContent = "開始喇！唔使打聲調數字。";
    renderDraft();
    if (!$("#arena-view").hidden) focusAnswer();
    announce("開始！唔使打聲調數字。");
  }
  if (run) {
    renderMetrics(now);
    if (run.status === "finished") completeRound();
  }
}

function submit() {
  if ((composing && !composition?.physical) || !run || run.status !== "running") return;
  const value = draft;
  run = submitAnswer(run, value, Date.now());
  answerVersion++;
  setDraft("");
  if (run.status === "finished") {
    renderMetrics();
    renderPassage();
    completeRound();
    return;
  }
  if (!value.trim()) {
    renderDraft();
    return;
  }
  if (run.lastResult === "correct") {
    $("#input-feedback").textContent = `下一字：${tokens[run.index].hanzi}`;
  } else {
    $("#input-feedback").textContent = "未啱；按 Backspace 可修改。";
  }
  renderPassage();
  positionAnswer(true);
  renderMetrics();
}

function undoLast() {
  if ((composing && !composition?.physical) || !run || run.status !== "running" || run.index === 0) return;
  run = undoAnswer(run, Date.now());
  answerVersion++;
  setDraft(run.lastAnswer, 0, run.lastAnswer.length);
  $("#input-feedback").textContent = `修改「${tokens[run.index].hanzi}」後確認。`;
  renderPassage();
  focusAnswer();
  renderMetrics();
}

function handleDelete(event) {
  if (event.isComposing || composing || draft !== "" ||
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
  $("#typing-surface").classList.remove("focused");
  $("#typing-form").hidden = true;
  $("#result").hidden = false;
  $("#cancel-run").hidden = true;
  $("#setup-fields").disabled = true;
  $("#play-again").hidden = false;
  $("#edit-settings").hidden = false;
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
  composing = false;
  composition = null;
  committedComposition = null;
  physicalEdit = null;
  answerVersion++;
  $("#setup-card").hidden = false;
  $("#round-summary").hidden = true;
  $("#round-actions").hidden = true;
  $("#play-again").hidden = true;
  $("#edit-settings").hidden = true;
  $("#race-card").hidden = true;
  $("#arena-view").classList.remove("has-race");
  $("#countdown-overlay").hidden = true;
  $("#result").hidden = true;
  $("#typing-form").hidden = false;
  $("#answer").disabled = true;
  setDraft("");
  $("#answer").placeholder = "準備好就開始啦";
  $("#typing-surface").classList.remove("focused");
  $("#setup-fields").disabled = false;
  $("#cancel-run").hidden = true;
  $("#start").disabled = false;
  $("#start").innerHTML = '開始試玩 <span aria-hidden="true">↗</span>';
  $("#start-note").textContent = "倒數 3 秒開始";
  $("#race-status").textContent = "賽道準備好";
  $("#race-group").textContent = "本機試玩 · 無需登入";
  $("#status-dot").classList.remove("live");
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
$("#start").addEventListener("click", () => startRound());
$("#play-again").addEventListener("click", () => startRound(true));
$("#edit-settings").addEventListener("click", resetRound);
$("#cancel-run").addEventListener("click", resetRound);
$("#typing-form").addEventListener("submit", event => { event.preventDefault(); submit(); });
$("#answer").addEventListener("compositionstart", () => {
  if (round?.group !== "mobile") { restoreDraft(); return; }
  composing = true;
  const [start, end] = selection();
  composition = { version: answerVersion, base: draft, start, end, physical: !!physicalEdit };
});
$("#answer").addEventListener("compositionupdate", captureComposition);
$("#answer").addEventListener("compositionend", event => {
  captureComposition(event);
  const commit = { data: event.data };
  committedComposition = commit;
  setTimeout(() => { if (committedComposition === commit) committedComposition = null; }, 0);
  composing = false;
  composition = null;
});
for (const selector of ["#answer", "#typing-surface"]) {
  $(selector).addEventListener("focus", () => $("#typing-surface").classList.add("focused"));
  $(selector).addEventListener("blur", () => $("#typing-surface").classList.remove("focused"));
}
$("#typing-surface").addEventListener("click", focusAnswer);
$("#typing-surface").addEventListener("keydown", event => {
  if (event.ctrlKey || event.metaKey || event.altKey || event.key === "Tab") return;
  if (!run || run.status !== "running") return;
  const letter = /^[a-z]$/i.test(event.key ?? "") ? event.key.toLowerCase()
    : /^Key[A-Z]$/.test(event.code ?? "") ? event.code.slice(3).toLowerCase() : null;
  if (letter) {
    event.preventDefault();
    markPhysicalEdit();
    editDraft(letter);
    return;
  }
  const key = event.code === "Space" ? " " : event.code === "NumpadEnter" ? "Enter"
    : ["Enter", "Backspace"].includes(event.code) ? event.code : event.key;
  if (![" ", "Enter", "Backspace"].includes(key)) return;
  if ((event.isComposing || composing) && !event.code && !composition?.physical) return;
  event.preventDefault();
  markPhysicalEdit();
  if (key !== "Backspace") submit();
  else if (draft) editDraft();
  else undoLast();
});
$("#answer").addEventListener("beforeinput", event => {
  if (round?.group !== "mobile" || physicalEdit) {
    if (event.cancelable !== false) event.preventDefault();
    restoreDraft();
    return;
  }
  if (event.isComposing || composing) return;
  if (isCompositionCommit(event)) {
    if (event.cancelable !== false) event.preventDefault();
    restoreDraft();
    return;
  }
  committedComposition = null;
  if ((event.inputType === "insertText" && /^\s+$/u.test(event.data ?? "")) ||
      event.inputType === "insertLineBreak" || event.inputType === "insertParagraph") {
    if (event.cancelable !== false) { event.preventDefault(); submit(); }
    return;
  }
  if (event.inputType === "deleteContentBackward") handleDelete(event);
});
$("#answer").addEventListener("input", event => {
  if (event.isComposing || composing) { captureComposition(event); return; }
  if (round?.group !== "mobile" || physicalEdit || isCompositionCommit(event)) {
    restoreDraft();
    return;
  }
  committedComposition = null;
  const value = $("#answer").value;
  // Reject a non-Latin IME commit; never guess a pronunciation from its characters.
  if (event.inputType !== "insertFromPaste" && /[^a-z\s]/i.test(value)) {
    restoreDraft();
    return;
  }
  const cursor = $("#answer").selectionStart ?? value.length;
  setDraft(value, value.slice(0, cursor).replace(/[^a-z]/gi, "").length);
  if (/\s$/.test(value)) submit();
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
