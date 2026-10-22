import { createRun, submitAnswer, undoAnswer, getMetrics, getComponentStats, splitJyutping } from "./engine.mjs?v=9";
import { OFFICIAL_THRESHOLDS } from "./games/common.mjs";
import { flowHref, startFlow } from "./games/flow.mjs";
import { ARTICLE, QUESTIONS, flattenQuestions } from "./questions.mjs?v=10";

const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const tokens = flattenQuestions();
const storageKey = "canclid-contest-demo-v2";
const groupNames = { desktop: "電腦組", mobile: "手機組" };
// 主入口預設「官方三輪試玩」（單字 → 詞組 → 篇章 → 成績卡）；單篇自由練習保留原本玩法。
// 遊戲大廳「單篇練習」卡會帶 ?practice=1 過嚟，預設揀返單篇自由練習。
const flowNotes = {
  official: "官方三輪：單字 90 秒 → 詞組 120 秒 → 篇章計時 → 三輪成績卡",
  practice: "單篇練習：由頭打到尾，可開粵拼提示，成績存本機榜",
};
const practiceRequested = (() => {
  try {
    return new URLSearchParams(location.search).get("practice") === "1";
  } catch {
    return false;
  }
})();
let flowChoice = practiceRequested ? "practice" : "official";
let group = matchMedia("(max-width: 760px)").matches ? "mobile" : "desktop";
let boardGroup = group;
let run = null;
let round = null;
let countdownEnds = null;
let ticker = null;
let resultSaved = false;
let hintsVisible = false;
let composing = false;
let draft = "";
let draftCursor = 0;
let draftSelectionEnd = 0;
let answerVersion = 0;
let physicalEdit = null;
let composition = null;
let committedComposition = null;
let currentGlyph = null;
let currentReading = null;
let readingElements = [];
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
      Number.isFinite(item.at) && (item.hintsUsed === undefined || typeof item.hintsUsed === "boolean"))
      .slice(-20).map(item => ({ ...item, hintsUsed: item.hintsUsed ?? false }));
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

// 高頻更新（100ms tick／rAF）只喺值有變先寫 DOM，避免重複寫入觸發無謂重排。
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
  if (currentReading) renderReading(currentReading);
  if (round?.group === "mobile" && run?.status === "running") positionAnswer(false);
}

function renderHint() {
  const running = run?.status === "running";
  if (!running) hintsVisible = false;
  $("#hint-toggle").disabled = !running;
  $("#hint-toggle").setAttribute("aria-pressed", String(hintsVisible));
  $("#typing-surface").classList.toggle("show-hints", hintsVisible);
  $("#next-sentence").classList.toggle("show-hints", hintsVisible);
  readingElements.forEach(renderReading);
  $("#hint-used").hidden = !round?.hintsUsed;
}

function readingParts(answer) {
  const { initial, nucleus, coda } = splitJyutping(answer);
  return [initial, nucleus + coda];
}

function expectedReading(answers, input) {
  const exact = answers.find(answer => answer === input);
  if (exact) return exact;
  const prefix = answers.find(answer => answer.startsWith(input));
  if (prefix) return prefix;
  const actual = readingParts(input);
  const matches = answer => readingParts(answer).filter((part, index) => part && part === actual[index]).length;
  return answers.reduce((best, answer) => matches(answer) > matches(best) ? answer : best);
}

function renderReading({ element, token, index, preview }) {
  const submitted = run?.answers[index];
  const input = submitted?.answer ?? (run?.status === "running" && run.index === index ? draft : "");
  const expected = expectedReading(token.answers, input);
  const segments = [];
  const add = (type, text) => { if (text) segments.push({ type, text }); };
  let correction = false;
  if (submitted && !submitted.correct) {
    const actualParts = readingParts(input);
    readingParts(expected).forEach((part, index) => {
      const actual = actualParts[index];
      if (part === actual) add("typed", actual);
      else {
        correction = true;
        // Match the source's initial (wrong first) and rime (expected first) corrections.
        if (index === 0) add("wrong", actual);
        add("correct", part);
        if (index === 1) add("wrong", actual);
      }
    });
  } else if (!submitted && hintsVisible) {
    if (!input) add("hint", token.answers.join(" / "));
    else if (expected.startsWith(input)) {
      add("typed", input);
      add("hint", expected.slice(input.length));
    } else {
      let prefix = 0;
      while (prefix < expected.length && expected[prefix] === input[prefix]) prefix++;
      const overlap = Math.min(input.length, expected.length);
      add("typed", input.slice(0, prefix));
      add("correct", expected.slice(prefix, overlap));
      add("wrong", input.slice(prefix));
      add("hint", expected.slice(overlap));
      correction = true;
    }
  } else add("typed", input);
  element.dataset.input = input;
  element.dataset.expected = expected;
  element.hidden = preview && !hintsVisible;
  element.setAttribute("aria-label", input
    ? `${token.hanzi}：輸入 ${input}${correction ? `，正確讀法 ${expected}` : ""}`
    : hintsVisible ? `${token.hanzi}：${token.answers.join(" / ")}` : "");
  element.replaceChildren(...segments.map(({ type, text }) => {
    const segment = document.createElement(type === "wrong" ? "del" : "span");
    segment.className = `reading-${type}`;
    segment.textContent = text;
    return segment;
  }));
}

function createRuby(token, index, preview = false) {
  const ruby = document.createElement("ruby");
  ruby.className = "glyph-ruby";
  const hanzi = document.createElement("span");
  hanzi.className = "glyph-hanzi";
  hanzi.textContent = token.hanzi;
  const reading = document.createElement("rt");
  reading.className = "glyph-reading";
  readingElements.push({ element: reading, token, index, preview });
  ruby.append(hanzi, reading);
  return ruby;
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
  currentReading = null;
  readingElements = [];
  $("#passage").replaceChildren();
  for (const character of question.text) {
    const element = document.createElement("span");
    if (/\p{Script=Han}/u.test(character)) {
      element.classList.add("glyph");
      element.append(createRuby(tokens[absoluteIndex], absoluteIndex));
      previousGlyph = element;
      if (absoluteIndex < index) element.classList.add(run.answers[absoluteIndex].correct ? "correct" : "incorrect");
      if (absoluteIndex === index) {
        element.classList.add("current");
        currentGlyph = element;
        currentReading = readingElements.at(-1);
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
  const next = $("#next-sentence");
  next.replaceChildren();
  const nextQuestion = QUESTIONS[sentenceIndex + 1];
  if (nextQuestion) {
    for (const character of nextQuestion.text) {
      if (/\p{Script=Han}/u.test(character)) {
        next.append(createRuby(tokens[absoluteIndex], absoluteIndex, true));
        absoluteIndex++;
      } else next.append(document.createTextNode(character));
    }
  } else next.append(document.createTextNode("最後一段，跟住你嘅節奏完成。"));
  $("#passage").setAttribute("aria-label", `${question.text} 目前要打：${tokens[index]?.hanzi ?? "已完成全部題目"}`);
  renderDraft();
  renderHint();
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
  setText("#time", formatTime(metrics.elapsedSeconds));
  setText("#speed", String(Math.round(metrics.syllablesPerMinute)));
  setText("#accuracy", metrics.accuracy === null ? "—" : `${Math.round(metrics.accuracy)}%`);
  setText("#attempts", metrics.correct + metrics.errors
    ? `${metrics.correct} 正確 / ${metrics.errors} 錯誤` : "未有提交");
  setText("#completed-count", `${metrics.submitted} / ${tokens.length} 音節`);
  const fraction = metrics.progress * 100;
  setWidth("#time-bar", fraction);
  setAttr(".time-track", "aria-valuenow", String(Math.round(fraction)));
}

function playerName() {
  return $("#nickname").value.trim().slice(0, 16) || "粵拼新星";
}

// 官方三輪試玩：記低開始時間同參加者資料，再交去第 1 輪（落石官方單字輪）。
function startOfficialFlow() {
  startFlow(Date.now(), { name: playerName(), group });
  location.href = flowHref("single");
}

// 開始掣文字跟玩法揀選變；resetRound 還原設定卡時用返同一段文字。
function renderStartLabel() {
  const official = flowChoice === "official";
  $("#start").innerHTML = official
    ? '開始三輪試玩 <span aria-hidden="true">↗</span>'
    : '開始單篇練習 <span aria-hidden="true">↗</span>';
}

function renderFlowChoice() {
  const official = flowChoice === "official";
  const officialButton = $("#flow-official");
  const practiceButton = $("#flow-practice");
  officialButton.classList.toggle("selected", official);
  officialButton.setAttribute("aria-pressed", String(official));
  practiceButton.classList.toggle("selected", !official);
  practiceButton.setAttribute("aria-pressed", String(!official));
  $("#flow-note").textContent = official ? flowNotes.official : flowNotes.practice;
  // 自由練習面板（單篇入口＋小遊戲 chips）跟玩法揀選展開／收埋。
  $("#practice-panel").hidden = official;
  renderStartLabel();
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
    : { group, articleId: ARTICLE.id, name: playerName(), rules: 2 };
  hintsVisible = false;
  round.hintsUsed = false;
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
      if ($("#countdown-number").textContent !== String(remaining)) {
        announce(`倒數 ${remaining}`);
        $("#countdown-number").textContent = String(remaining);
      }
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
    renderHint();
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
  $("#result-summary").textContent = `${round.name} · ${formatTime(metrics.elapsedSeconds)} · ${metrics.correct} 啱／${metrics.errors} 錯${round.hintsUsed ? " · 用過提示" : ""}`;
  renderHint();
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
  hintsVisible = false;
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
  renderStartLabel();
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

// 正式分 R ＝ 正確音節／分鐘 × 準確度（SPEC §5.5），本機榜以此排名；
// demo 試算綜合分（速度 × 準確度²）保留嚟同舊紀錄比較。
function rankRecords(items) {
  return items.map(item => {
    const submitted = item.correct + item.errors;
    const accuracy = submitted ? item.correct / submitted * 100 : 0;
    const speed = item.elapsedSeconds > 0 ? submitted / item.elapsedSeconds * 60 : 0;
    const officialScore = item.elapsedSeconds > 0 ? item.correct / item.elapsedSeconds * 60 * (accuracy / 100) : 0;
    return {
      ...item,
      speed,
      accuracy,
      officialScore,
      belowThreshold: accuracy < OFFICIAL_THRESHOLDS.passage * 100,
      score: speed * (accuracy / 100) ** 2,
    };
  }).sort((a, b) => b.officialScore - a.officialScore || b.accuracy - a.accuracy ||
    a.elapsedSeconds - b.elapsedSeconds || a.at - b.at);
}

function renderTable(container, items, sample = false, ranked = true) {
  container.replaceChildren();
  if (!items.length) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.innerHTML = "未有紀錄。<p>完成全文後會顯示喺呢度。</p>";
    container.append(empty);
    return;
  }
  const table = document.createElement("table");
  table.className = ranked ? "score-table ranked" : "score-table";
  table.innerHTML = `<thead><tr>${ranked ? "<th scope='col'>名次</th>" : ""}<th scope='col'>暱稱 / 用時</th>${ranked ? "<th scope='col'>正式分</th>" : ""}<th scope='col'>綜合分</th><th scope='col'>準確度</th></tr></thead>`;
  const tbody = document.createElement("tbody");
  let rank = 0;
  let last = null;
  const ordered = rankRecords(items);
  if (!ranked) ordered.sort((a, b) => b.at - a.at);
  for (const [index, item] of ordered.entries()) {
    if (!last || item.officialScore !== last.officialScore || item.accuracy !== last.accuracy ||
        item.elapsedSeconds !== last.elapsedSeconds) rank = index + 1;
    last = item;
    const row = document.createElement("tr");
    if (ranked) {
      if (rank === 1 && item.correct > 0) row.className = "best";
      const rankCell = document.createElement("td");
      rankCell.textContent = item.correct ? String(rank).padStart(2, "0") : "—";
      row.append(rankCell);
    }
    const nameCell = document.createElement("td");
    nameCell.className = "score-name";
    nameCell.append(document.createTextNode(item.name));
    const source = document.createElement("small");
    source.textContent = `${formatTime(item.elapsedSeconds)} · ${Math.round(item.speed)} 音節/分`;
    nameCell.append(source);
    const origin = document.createElement("small");
    origin.textContent = sample ? "虛構示範人物" : `${new Date(item.at).toLocaleString("zh-HK", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })} · 本機`;
    nameCell.append(origin);
    const demoCell = document.createElement("td");
    const demoText = ranked ? document.createElement("span") : document.createElement("strong");
    demoText.textContent = item.score.toFixed(1);
    demoCell.append(demoText);
    const accuracyCell = document.createElement("td");
    accuracyCell.textContent = item.accuracy === null ? "—" : `${Math.round(item.accuracy)}%`;
    if (ranked) {
      const officialCell = document.createElement("td");
      officialCell.className = "score-official";
      const officialText = document.createElement("strong");
      officialText.textContent = item.officialScore.toFixed(1);
      officialCell.append(officialText);
      if (item.belowThreshold) {
        officialCell.classList.add("below-threshold");
        const note = document.createElement("small");
        note.textContent = "未達 85% 門檻";
        officialCell.append(note);
      }
      row.append(nameCell, officialCell, demoCell, accuracyCell);
    } else {
      row.append(nameCell, demoCell, accuracyCell);
    }
    tbody.append(row);
  }
  table.append(tbody);
  container.append(table);
}

function renderBoards() {
  setPressed("[data-board-group]", "boardGroup", boardGroup);
  const groupRecords = records.filter(item => item.group === boardGroup && item.articleId === ARTICLE.id && item.rules === 2);
  renderTable($("#local-board"), groupRecords.filter(item => !item.hintsUsed));
  const hintedRecords = groupRecords.filter(item => item.hintsUsed);
  $("#hinted-board-card").hidden = hintedRecords.length === 0;
  renderTable($("#hinted-board"), hintedRecords, false, false);
  const baseTime = boardGroup === "mobile" ? 105 : 65;
  const sample = [
    { name: "打字阿晴", elapsedSeconds: baseTime, correct: tokens.length, errors: 0 },
    { name: "粵拼小隊長", elapsedSeconds: baseTime + 12, correct: tokens.length - 4, errors: 4 },
    { name: "慢慢嚟都得", elapsedSeconds: baseTime + 24, correct: tokens.length - 8, errors: 8 },
    { name: "邊學邊打", elapsedSeconds: baseTime + 30, correct: tokens.length - 18, errors: 18 },
  ].map((item, index) => ({ ...item, at: index }));
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
$("#start").addEventListener("click", () => {
  if (flowChoice === "official") {
    startOfficialFlow();
    return;
  }
  startRound();
});
$("#flow-official").addEventListener("click", () => {
  flowChoice = "official";
  renderFlowChoice();
});
$("#flow-practice").addEventListener("click", () => {
  flowChoice = "practice";
  renderFlowChoice();
});
$("#play-again").addEventListener("click", () => startRound(true));
$("#edit-settings").addEventListener("click", resetRound);
$("#cancel-run").addEventListener("click", resetRound);
$("#hint-toggle").addEventListener("pointerdown", event => {
  if (run?.status === "running") event.preventDefault();
});
$("#hint-toggle").addEventListener("click", () => {
  if (run?.status !== "running") return;
  const [start, end] = selection();
  hintsVisible = !hintsVisible;
  if (hintsVisible) round.hintsUsed = true;
  renderHint();
  focusAnswer();
  $("#answer").setSelectionRange(start, end);
});
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
renderFlowChoice();
$("#article-title").textContent = ARTICLE.title;
$("#article-detail").textContent = `示範粵文 · ${tokens.length} 音節`;
$("#board-article").textContent = `同篇比較：${ARTICLE.title}`;
renderPassage();
renderMetrics();
renderBoards();
