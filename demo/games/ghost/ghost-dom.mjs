// Ghost Race — DOM layer for demo/games/ghost/.
// Renders the two-lane track, drives the shared engine (createRun /
// submitAnswer / undoAnswer / getMetrics) with the same input rules as
// demo/app.mjs, and keeps the player's best timeline in localStorage.
import { createRun, getMetrics, splitJyutping, submitAnswer, undoAnswer } from "../../engine.mjs";
import { ARTICLE, QUESTIONS, flattenQuestions } from "../../questions.mjs";
import { OFFICIAL_THRESHOLDS, formatClock, readJson, roundMetrics, writeJson } from "../common.mjs";
import { GHOST_STORAGE_KEY, builtInGhosts, createGhostRace, ghostProgressAt, raceResult, recordTimeline } from "./ghost.mjs";

export { GHOST_STORAGE_KEY };

const COUNTDOWN_MS = 3000;
const TICK_MS = 100;
const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];

const tokens = flattenQuestions();
const total = tokens.length;
const ghosts = builtInGhosts(total);

let run = null;
let race = null;
let opponent = null;
let selectedOpponentId = "best";
let countdownEnds = null;
let ticker = null;
let draft = "";
let composing = false;
let resultSaved = false;
let currentGlyph = null;
let currentReading = null;
let storageAvailable = true;
let best = readBest();

function announce(message) {
  $("#announcer").textContent = message;
}

function stopTicker() {
  clearInterval(ticker);
  ticker = null;
}

// A stored best run is only usable when it was recorded on the same article
// and its timeline still describes one submit per syllable.
function readBest() {
  const saved = readJson(GHOST_STORAGE_KEY, null);
  if (!saved || saved.total !== total) return null;
  if (!Number.isFinite(saved.elapsedSeconds) || saved.elapsedSeconds <= 0) return null;
  if (!Array.isArray(saved.timeline) || saved.timeline.length !== total) return null;
  const usable = saved.timeline.every((entry, position) =>
    entry && Number.isFinite(entry.at) && entry.index === position + 1);
  if (!usable) return null;
  return {
    version: saved.version ?? 1,
    total: saved.total,
    elapsedSeconds: saved.elapsedSeconds,
    correctPerMinute: Number(saved.correctPerMinute) || 0,
    accuracy: Number(saved.accuracy) || 0,
    officialScore: Number(saved.officialScore) || 0,
    timeline: saved.timeline.map(entry => ({ at: entry.at, index: entry.index })),
    at: Number(saved.at) || 0,
  };
}

function targetSeconds(ghost) {
  const last = ghost.timeline.at(-1);
  return last ? last.at / 1000 : 0;
}

function opponentOption({ id, label, detail, disabled = false }) {
  const option = document.createElement("label");
  option.className = "opponent-option";
  option.dataset.opponent = id;
  if (disabled) option.classList.add("disabled");
  if (id === selectedOpponentId && !disabled) option.classList.add("selected");
  const input = document.createElement("input");
  input.type = "radio";
  input.name = "opponent";
  input.value = id;
  input.disabled = disabled;
  input.checked = id === selectedOpponentId && !disabled;
  const text = document.createElement("span");
  text.className = "opponent-text";
  const name = document.createElement("strong");
  name.textContent = label;
  const note = document.createElement("small");
  note.textContent = detail;
  text.append(name, note);
  option.append(input, text);
  return option;
}

function renderOpponents() {
  if (!currentOpponent()) selectedOpponentId = ghosts[0].id;
  const options = [];
  if (best) {
    options.push(opponentOption({
      id: "best",
      label: "自己最佳",
      detail: `${formatClock(best.elapsedSeconds)} · ${Math.round(best.correctPerMinute)} 音節／分 · 本機紀錄`,
    }));
  } else {
    options.push(opponentOption({
      id: "best",
      label: "自己最佳",
      detail: "未有紀錄，完成一次競速就會出現",
      disabled: true,
    }));
  }
  for (const ghost of ghosts) {
    options.push(opponentOption({
      id: ghost.id,
      label: ghost.label,
      detail: `目標時間 ${formatClock(targetSeconds(ghost))} · ${total} 音節`,
    }));
  }
  $("#opponent-options").replaceChildren(...options);
}

function renderBestCard() {
  const card = $("#best-card");
  card.hidden = !best;
  if (!best) return;
  $("#best-time").textContent = formatClock(best.elapsedSeconds);
  $("#best-speed").textContent = `${Math.round(best.correctPerMinute)} 音節／分`;
  $("#best-date").textContent = best.at ? new Date(best.at).toLocaleString("zh-HK", {
    month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit",
  }) : "—";
  $("#best-note").textContent = `準確度 ${Math.round(best.accuracy * 100)}%`;
}

function currentOpponent() {
  if (selectedOpponentId === "best") {
    return best ? {
      id: "best",
      label: "自己最佳",
      correctPerMinute: best.correctPerMinute,
      total: best.total,
      timeline: best.timeline,
    } : null;
  }
  return ghosts.find(ghost => ghost.id === selectedOpponentId) ?? null;
}

function readingParts(answer) {
  const { initial, nucleus, coda } = splitJyutping(answer);
  return [initial, nucleus + coda];
}

// Submitted answers keep the letters the player typed; a wrong syllable shows
// the expected part in green next to the typed part struck through.
function readingSegments(token, input, submitted) {
  if (!input) return [];
  if (!submitted || submitted.correct) return [{ type: "typed", text: input }];
  const actual = readingParts(input);
  const segments = [];
  readingParts(token.answers[0]).forEach((part, index) => {
    const typed = actual[index] ?? "";
    if (part === typed) {
      if (part) segments.push({ type: "typed", text: part });
      return;
    }
    if (index === 0 && typed) segments.push({ type: "wrong", text: typed });
    if (part) segments.push({ type: "correct", text: part });
    if (index === 1 && typed) segments.push({ type: "wrong", text: typed });
  });
  return segments;
}

function renderReading(reading, token, position) {
  const submitted = run?.answers[position];
  const input = submitted?.answer ?? (run?.status === "running" && run.index === position ? draft : "");
  const expected = submitted && !submitted.correct ? token.answers[0] : input;
  reading.replaceChildren(...readingSegments(token, input, submitted).map(({ type, text }) => {
    const element = document.createElement(type === "wrong" ? "del" : "span");
    element.className = `reading-${type}`;
    element.textContent = text;
    return element;
  }));
  reading.setAttribute("aria-label", input
    ? `${token.hanzi}：輸入 ${input}${submitted && !submitted.correct ? `，正確讀法 ${expected}` : ""}`
    : "");
}

function renderDraft() {
  if (currentReading && run?.status === "running") {
    renderReading(currentReading, tokens[run.index], run.index);
  }
}

function renderPassage() {
  const index = run?.index ?? 0;
  const glyphs = [];
  let position = 0;
  currentGlyph = null;
  currentReading = null;

  for (const character of ARTICLE.text) {
    if (!/\p{Script=Han}/u.test(character)) {
      const punctuation = document.createElement("span");
      punctuation.className = "punctuation";
      punctuation.textContent = character;
      const previous = glyphs.at(-1);
      if (previous) {
        previous.classList.add("punctuated");
        previous.append(punctuation);
        continue;
      }
      glyphs.push(punctuation);
      continue;
    }
    const token = tokens[position];
    const glyph = document.createElement("span");
    glyph.className = "glyph";
    const ruby = document.createElement("ruby");
    ruby.className = "glyph-ruby";
    const hanzi = document.createElement("span");
    hanzi.className = "glyph-hanzi";
    hanzi.textContent = character;
    const reading = document.createElement("rt");
    reading.className = "glyph-reading";
    ruby.append(hanzi, reading);
    glyph.append(ruby);
    const submitted = run?.answers[position];
    if (submitted) glyph.classList.add(submitted.correct ? "correct" : "incorrect");
    if (run?.status === "running" && position === index) {
      glyph.classList.add("current");
      currentGlyph = glyph;
      currentReading = reading;
    }
    renderReading(reading, token, position);
    glyphs.push(glyph);
    position++;
  }

  $("#passage").replaceChildren(...glyphs);
  $("#passage").setAttribute("aria-label", run?.status === "running"
    ? `目前要打：${tokens[index]?.hanzi ?? ""}`
    : `${ARTICLE.title}，全文 ${total} 音節`);
  const sentenceIndex = tokens[Math.min(index, total - 1)].sentenceIndex;
  $("#sentence-label").textContent = `第 ${String(sentenceIndex + 1).padStart(2, "0")} 句 / ${String(QUESTIONS.length).padStart(2, "0")} 句`;
  currentGlyph?.scrollIntoView({ block: "nearest", inline: "nearest" });
}

function setBar(barSelector, trackSelector, value) {
  const percent = Math.round(Math.min(1, Math.max(0, value)) * 100);
  $(barSelector).style.width = `${percent}%`;
  $(trackSelector).setAttribute("aria-valuenow", String(percent));
}

function renderRace(now = Date.now()) {
  if (!run) return;
  const metrics = getMetrics(run, now);
  const ghost = race ? ghostProgressAt(race, now) : 0;
  setBar("#player-bar", "#player-track", metrics.progress);
  setBar("#ghost-bar", "#ghost-track", ghost);
  $("#player-value").textContent = `${metrics.submitted} / ${total} 音節`;
  $("#ghost-value").textContent = `${Math.round(ghost * 100)}%`;
  $("#time").textContent = formatClock(metrics.elapsedSeconds);
  $("#speed").textContent = String(Math.round(metrics.correctPerMinute));
  $("#accuracy").textContent = metrics.accuracy === null ? "—" : `${Math.round(metrics.accuracy)}%`;
  $("#attempts").textContent = metrics.correct + metrics.errors
    ? `${metrics.correct} 正確 / ${metrics.errors} 錯誤` : "未有提交";
  $("#completed-count").textContent = `${metrics.submitted} / ${total} 音節`;
}

function focusAnswer() {
  if ($("#answer").disabled || $("#race-view").hidden) return;
  $("#typing-surface").focus({ preventScroll: true });
  $("#answer").focus({ preventScroll: true });
}

function setDraft(value, cursor = value.length) {
  draft = value.replace(/[^a-z]/gi, "").toLowerCase();
  const position = Math.min(Math.max(0, cursor ?? draft.length), draft.length);
  $("#answer").value = draft;
  $("#answer").setSelectionRange(position, position);
  renderDraft();
}

function editDraft(letter = null) {
  if (!run || run.status !== "running") return;
  if (letter === null) {
    if (draft) setDraft(draft.slice(0, -1));
    else undoLast();
    return;
  }
  setDraft(draft + letter);
}

function submit() {
  if (!run || run.status !== "running") return;
  const value = draft;
  run = submitAnswer(run, value, Date.now());
  setDraft("");
  if (run.status === "finished") {
    renderPassage();
    renderRace();
    finishRace(Date.now());
    return;
  }
  if (!value) {
    renderDraft();
    return;
  }
  $("#input-feedback").textContent = run.lastResult === "correct"
    ? `下一字：${tokens[run.index].hanzi}`
    : "未啱；按 Backspace 可以改返。";
  renderPassage();
  renderRace();
}

function undoLast() {
  if (!run || run.status !== "running" || run.index === 0) return;
  run = undoAnswer(run, Date.now());
  setDraft(run.lastAnswer);
  $("#input-feedback").textContent = `修改「${tokens[run.index].hanzi}」之後再確認。`;
  renderPassage();
  renderRace();
}

function ghostLine(summary) {
  const syllables = Math.abs(summary.leadSyllables ?? 0);
  const progressPercent = Math.round(summary.ghostProgress * 100);
  if (summary.ghostProgress >= 1) {
    return syllables === 0 ? "幽靈同你幾乎同時衝線" : `幽靈已經衝線，你落後 ${syllables} 個音節`;
  }
  return syllables === 0
    ? `幽靈完成咗 ${progressPercent}%，差距少於一個音節`
    : `幽靈完成咗 ${progressPercent}%，你領先 ${syllables} 個音節`;
}

function renderResult(summary, improved) {
  $("#result-title").textContent = summary.verdict;
  $("#result-summary").textContent = `${opponent.label} · 全文 ${total} 音節`;
  const rows = [
    ["完成時間", formatClock(summary.elapsedSeconds)],
    ["正確音節／分鐘", String(Math.round(summary.correctPerMinute))],
    ["答案準確度", `${Math.round(summary.accuracyPercent)}%`],
    ["正式分", `${summary.officialScore.toFixed(1)}（準確度門檻 ${Math.round((summary.threshold ?? 0) * 100)}%${summary.meetsThreshold ? "，達標" : "，未達標"}）`],
    ["幽靈進度", ghostLine(summary)],
  ];
  $("#result-details").replaceChildren(...rows.map(([term, value]) => {
    const row = document.createElement("div");
    const dt = document.createElement("dt");
    dt.textContent = term;
    const dd = document.createElement("dd");
    dd.textContent = value;
    row.append(dt, dd);
    return row;
  }));
  $("#result-best").textContent = improved
    ? `已更新本機最佳：${formatClock(best.elapsedSeconds)}，下次可以用「自己最佳」做對手。`
    : `今次未快過本機最佳（${formatClock(best.elapsedSeconds)}）。`;
}

function finishRace(now) {
  if (!run || run.status !== "finished" || resultSaved) return;
  resultSaved = true;
  stopTicker();

  const finishedAt = Number.isFinite(run.finishedAt) ? run.finishedAt : now;
  const metrics = getMetrics(run, finishedAt);
  const official = roundMetrics(
    { correct: metrics.correct, submitted: metrics.submitted, seconds: metrics.elapsedSeconds },
    { threshold: OFFICIAL_THRESHOLDS.passage },
  );
  const ghost = race ? ghostProgressAt(race, finishedAt) : 0;
  const summary = raceResult({
    playerMetrics: {
      ...official,
      total,
      correct: metrics.correct,
      errors: metrics.errors,
      submitted: metrics.submitted,
      elapsedSeconds: metrics.elapsedSeconds,
      progress: 1,
    },
    ghostProgress: ghost,
    finishedFirst: ghost < 1,
  });

  const improved = !best || metrics.elapsedSeconds < best.elapsedSeconds;
  if (improved) {
    best = {
      version: 1,
      total,
      elapsedSeconds: metrics.elapsedSeconds,
      correctPerMinute: official.correctPerMinute,
      accuracy: official.accuracy,
      officialScore: official.officialScore,
      timeline: recordTimeline(run),
      at: Date.now(),
    };
    storageAvailable = writeJson(GHOST_STORAGE_KEY, best);
  }

  renderResult(summary, improved);
  $("#storage-note").hidden = storageAvailable;
  $("#answer").disabled = true;
  $("#typing-surface").classList.remove("focused");
  $("#typing-form").hidden = true;
  $("#result").hidden = false;
  $("#give-up").hidden = true;
  $("#play-again").hidden = false;
  $("#edit-settings").hidden = false;
  $("#race-status").textContent = "本輪已完成";
  $("#status-dot").classList.remove("live");
  document.body.classList.remove("running");
  announce(`${summary.verdict}。完成時間 ${formatClock(summary.elapsedSeconds)}，準確度 ${Math.round(summary.accuracyPercent)}%。`);
}

function startRound() {
  if (countdownEnds !== null || run?.status === "running") return;
  const choice = currentOpponent();
  if (!choice) return;

  stopTicker();
  opponent = choice;
  run = null;
  race = null;
  draft = "";
  composing = false;
  resultSaved = false;
  countdownEnds = Date.now() + COUNTDOWN_MS;

  document.body.classList.add("running");
  $("#setup-view").hidden = true;
  $("#race-view").hidden = false;
  $("#result").hidden = true;
  $("#typing-form").hidden = false;
  $("#play-again").hidden = true;
  $("#edit-settings").hidden = true;
  $("#give-up").hidden = false;
  $("#countdown-overlay").hidden = false;
  $("#countdown-number").textContent = String(Math.ceil(COUNTDOWN_MS / 1000));
  $("#race-status").textContent = "準備起跑";
  $("#race-opponent").textContent = `${opponent.label} · 目標時間 ${formatClock(targetSeconds(opponent))}`;
  $("#status-dot").classList.remove("live");
  $("#answer").disabled = false;
  $("#answer").placeholder = "倒數後輸入粵拼";
  $("#input-feedback").textContent = "準備好，倒數之後先開始輸入。";
  $("#player-value").textContent = `0 / ${total} 音節`;
  $("#ghost-value").textContent = "0%";
  setDraft("");
  renderPassage();
  renderRace();
  // Focus during the initiating tap so mobile browsers can open their keyboard.
  focusAnswer();
  tick();
  ticker = setInterval(tick, TICK_MS);
}

function tick() {
  const now = Date.now();
  if (countdownEnds !== null) {
    const remaining = Math.ceil((countdownEnds - now) / 1000);
    if (remaining > 0) {
      $("#countdown-number").textContent = String(remaining);
      return;
    }
    run = createRun({ now: countdownEnds, questionSet: tokens });
    race = createGhostRace({ now: countdownEnds, total, timeline: opponent.timeline });
    countdownEnds = null;
    $("#countdown-overlay").hidden = true;
    $("#race-status").textContent = "競速進行中";
    $("#status-dot").classList.add("live");
    $("#answer").placeholder = "打粵拼，空白鍵確認";
    $("#input-feedback").textContent = "開始喇！唔使打聲調數字。";
    setDraft("");
    renderPassage();
    renderRace(now);
    if (!$("#race-view").hidden) focusAnswer();
    announce("開始！唔使打聲調數字。");
  }
  if (run) {
    renderRace(now);
    if (run.status === "finished") finishRace(now);
  }
}

function resetRound() {
  stopTicker();
  countdownEnds = null;
  run = null;
  race = null;
  opponent = null;
  draft = "";
  composing = false;
  resultSaved = false;
  currentGlyph = null;
  currentReading = null;
  document.body.classList.remove("running");
  $("#setup-view").hidden = false;
  $("#race-view").hidden = true;
  $("#countdown-overlay").hidden = true;
  $("#typing-surface").classList.remove("focused");
  $("#answer").disabled = true;
  $("#answer").placeholder = "準備好就開始";
  setDraft("");
  renderOpponents();
  renderBestCard();
  $("#start").focus({ preventScroll: true });
}

function selectOpponent(id) {
  selectedOpponentId = id;
  $$(".opponent-option").forEach(option => {
    option.classList.toggle("selected", option.dataset.opponent === id);
  });
}

$("#opponent-options").addEventListener("change", event => {
  const input = event.target.closest?.("input[name=opponent]");
  if (input && !input.disabled) selectOpponent(input.value);
});
$("#start").addEventListener("click", startRound);
$("#play-again").addEventListener("click", startRound);
$("#edit-settings").addEventListener("click", resetRound);
$("#give-up").addEventListener("click", () => {
  resetRound();
  $("#input-feedback").textContent = "本輪已放棄，唔會記錄成績。";
  announce("本輪已放棄。");
});
$("#typing-form").addEventListener("submit", event => {
  event.preventDefault();
  submit();
});
$("#typing-surface").addEventListener("click", focusAnswer);
for (const selector of ["#answer", "#typing-surface"]) {
  $(selector).addEventListener("focus", () => $("#typing-surface").classList.add("focused"));
  $(selector).addEventListener("blur", () => $("#typing-surface").classList.remove("focused"));
}
$("#typing-surface").addEventListener("keydown", event => {
  if (event.ctrlKey || event.metaKey || event.altKey || event.key === "Tab") return;
  if (run?.status !== "running") return;
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
  if (key !== "Backspace") submit();
  else editDraft();
});
$("#answer").addEventListener("compositionstart", () => { composing = true; });
$("#answer").addEventListener("compositionend", () => {
  composing = false;
  $("#answer").value = draft;
  $("#answer").setSelectionRange(draft.length, draft.length);
});
$("#answer").addEventListener("beforeinput", event => {
  if (event.isComposing || composing) return;
  if (event.inputType === "insertText" && /^\s+$/u.test(event.data ?? "")) {
    event.preventDefault();
    submit();
    return;
  }
  if (event.inputType === "insertLineBreak" || event.inputType === "insertParagraph") {
    event.preventDefault();
    submit();
    return;
  }
  if (event.inputType === "deleteContentBackward" && !draft && run?.status === "running" && run.index > 0) {
    event.preventDefault();
    undoLast();
  }
});
$("#answer").addEventListener("input", event => {
  if (event.isComposing || composing) {
    $("#answer").value = draft;
    return;
  }
  const value = $("#answer").value;
  // Reject a non-Latin IME commit; never guess a pronunciation from its characters.
  if (event.inputType !== "insertFromPaste" && /[^a-z\s]/i.test(value)) {
    $("#answer").value = draft;
    $("#answer").setSelectionRange(draft.length, draft.length);
    return;
  }
  const cursor = $("#answer").selectionStart ?? value.length;
  setDraft(value, value.slice(0, cursor).replace(/[^a-z]/gi, "").length);
  if (/\s$/.test(value)) submit();
});
document.addEventListener("visibilitychange", () => {
  if (!document.hidden && (run?.status === "running" || countdownEnds !== null)) tick();
});

$("#article-title").textContent = ARTICLE.title;
$("#article-detail").textContent = `示範粵文 · ${total} 音節 · 同試玩賽場同一篇`;
$("#completed-count").textContent = `0 / ${total} 音節`;
$("#answer").disabled = true;
renderOpponents();
renderBestCard();
renderPassage();
renderRace();
