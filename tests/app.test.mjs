import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { webcrypto } from "node:crypto";
import vm from "node:vm";
import * as engine from "../demo/engine.mjs";
import * as common from "../demo/games/common.mjs";
import * as flow from "../demo/games/flow.mjs";
import * as i18n from "../demo/i18n.mjs";
import * as questions from "../demo/questions.mjs";

const storageKey = "canclid-contest-demo-v2";
const flowStorageKey = "canclid-contest-official-flow";
const tokens = questions.flattenQuestions();
const source = readFileSync(new URL("../demo/app.mjs", import.meta.url), "utf8")
  .replace(/^import .*;\n/gm, "");

// 官方三輪流程會寫 sessionStorage（flow.mjs 喺呼叫嗰刻先讀 globalThis），
// 所以需要嘅測試暫時掛一個假 storage 上 globalThis。
function sessionStub() {
  const map = new Map();
  return {
    map,
    getItem: key => (map.has(key) ? map.get(key) : null),
    setItem(key, value) { map.set(key, String(value)); },
    removeItem(key) { map.delete(key); },
    read: key => (map.has(key) ? JSON.parse(map.get(key)) : null),
  };
}

function withSessionStorage(run) {
  const storage = sessionStub();
  const previous = Object.getOwnPropertyDescriptor(globalThis, "sessionStorage");
  Object.defineProperty(globalThis, "sessionStorage", { value: storage, configurable: true, writable: true });
  try {
    return run(storage);
  } finally {
    if (previous) Object.defineProperty(globalThis, "sessionStorage", previous);
    else delete globalThis.sessionStorage;
  }
}

// Model the DOM operations used by input, focus and persistence regressions.
function element(tagName = "div") {
  const listeners = new Map();
  const classes = new Set();
  const attributes = new Map();
  let value = "";
  let text = "";
  let textWrites = 0;
  return {
    tagName: tagName.toUpperCase(),
    get value() { return value; },
    set value(next) { value = next; this.selectionStart = this.selectionEnd = value.length; },
    get textContent() { return text; },
    set textContent(next) { textWrites += 1; text = String(next); },
    get textWrites() { return textWrites; },
    innerHTML: "", hidden: false, selectionStart: 0, selectionEnd: 0,
    children: [], dataset: {}, style: {}, scrollLeft: 0, scrollTop: 0,
    focusCalls: 0, scrollCalls: 0, measureCalls: 0,
    get className() { return [...classes].join(" "); },
    set className(value) { classes.clear(); value.split(/\s+/).filter(Boolean).forEach(name => classes.add(name)); },
    classList: {
      add(...names) { names.forEach(name => classes.add(name)); },
      remove(...names) { names.forEach(name => classes.delete(name)); },
      contains(name) { return classes.has(name); },
      toggle(name, selected) { if (selected ?? !classes.has(name)) classes.add(name); else classes.delete(name); },
    },
    setAttribute(name, value) { attributes.set(name, String(value)); },
    getAttribute(name) { return attributes.get(name) ?? null; },
    removeAttribute(name) { attributes.delete(name); },
    select() { this.setSelectionRange(0, this.value.length); },
    setSelectionRange(start, end) { this.selectionStart = start; this.selectionEnd = end; },
    focus() { this.focusCalls++; this.fire("focus"); },
    blur() { this.fire("blur"); },
    scrollIntoView() { this.scrollCalls++; },
    getBoundingClientRect() { this.measureCalls++; return { left: 0, top: 0, width: 52, height: 80 }; },
    addEventListener(type, listener) { listeners.set(type, listener); },
    fire(type, event = {}) {
      event.target ??= this;
      listeners.get(type)?.(event);
      if (["keydown", "keyup"].includes(type)) this.parentElement?.fire(type, event);
    },
    append(...children) { this.children.push(...children); },
    replaceChildren(...children) { this.children = children; },
  };
}

function textOf(node) {
  return (node.textContent || "") + (node.innerHTML || "") +
    (node.children || []).map(textOf).join("");
}

// i18n 實例可以換：語言偵測只喺模組第一次 call 之前讀 localStorage，
// 「記住咗簡體」嘅測試要用 query 參數拎一個全新實例。
function openTab(store = new Map(), failures = {}, { search = "", i18n: i18nModule = i18n } = {}) {
  let now = 0;
  const timeouts = [];
  const elements = new Map();
  const get = selector => {
    assert.ok(!["#submit-answer", ".answer-wrap", "#jyutping-hint"].includes(selector), `Removed control queried: ${selector}`);
    if (!elements.has(selector)) elements.set(selector, element());
    return elements.get(selector);
  };
  get("#answer").disabled = true;
  get("#answer").parentElement = get("#typing-surface");
  get("#race-card").hidden = true;
  for (const id of ["round-summary", "round-actions", "play-again", "edit-settings"]) get(`#${id}`).hidden = true;
  const views = ["arena", "leaderboard", "rules"].map(name => {
    const view = get(`#${name}-view`);
    view.id = `${name}-view`;
    view.hidden = name !== "arena";
    return view;
  });
  const window = element();
  const location = { href: "", search };
  class Clock extends Date {
    static now() { return now; }
  }
  const context = vm.createContext({
    ...engine, ...questions, ...common, ...flow, ...i18nModule, crypto: webcrypto, Date: Clock, window, location, URLSearchParams,
    document: {
      querySelector: get,
      querySelectorAll: selector => selector === ".view" ? views : [],
      createElement: element,
      createTextNode: textContent => ({ textContent }),
      addEventListener() {},
      body: element(),
    },
    matchMedia: () => ({ matches: false }),
    localStorage: {
      getItem(key) {
        if (failures.read) throw new Error("Storage access denied");
        return store.get(key) ?? null;
      },
      setItem(key, value) {
        if (failures.write) throw new Error("Storage quota exceeded");
        store.set(key, value);
      },
      removeItem(key) {
        if (failures.write) throw new Error("Storage access denied");
        store.delete(key);
      },
    },
    setInterval: () => 1,
    clearInterval() {},
    setTimeout(callback) { timeouts.push(callback); return timeouts.length; },
    confirm: () => true,
  });
  vm.runInContext(source, context, { filename: "demo/app.mjs" });
  const evaluate = expression => vm.runInContext(expression, context);
  return {
    get, evaluate, location, window,
    setTime(value) { now = value; },
    flushTimeouts() { timeouts.splice(0).forEach(callback => callback()); },
    records: () => JSON.parse(evaluate("JSON.stringify(records)")),
    storageChanged() {
      window.fire("storage", { key: storageKey, newValue: store.get(storageKey) ?? null });
    },
  };
}

// 主入口預設「官方三輪試玩」；單篇練習嘅測試要先撳「單篇自由練習」。
function choosePractice(tab) {
  tab.get("#flow-practice").fire("click");
}

function readyRound(tab, name, at = 0) {
  tab.setTime(at);
  tab.get("#nickname").value = name;
  tab.evaluate("startRound()");
  tab.setTime(at + 3000);
  tab.evaluate("tick()");
}

function beginRound(tab, name, at = 0) {
  readyRound(tab, name, at);
  tab.setTime(at + 4000);
  tab.evaluate(`setDraft(${JSON.stringify(tokens[0].answers[0])})`);
  tab.evaluate("submit()");
}

function finishRemaining(tab, at = 0) {
  for (let index = tab.evaluate("run.index"); index < tokens.length; index++) {
    tab.setTime(at + 3000 + (index + 1) * 1000);
    tab.evaluate(`setDraft(${JSON.stringify(tokens[index].answers[0])})`);
    tab.evaluate("submit()");
  }
}

function completeRound(tab, name, at = 0) {
  beginRound(tab, name, at);
  finishRemaining(tab, at);
}

const names = records => records.map(record => record.name);
const persisted = store => JSON.parse(store.get(storageKey) || "[]");
const glyphs = tab => tab.get("#passage").children.filter(node => node.classList.contains("glyph"));
const currentGlyph = tab => glyphs(tab).find(node => node.classList.contains("current"));
const readingOf = glyph => glyph?.children[0].children[1];
const draft = tab => readingOf(currentGlyph(tab))?.dataset.input;
const passageRubies = tab => glyphs(tab).map(glyph => glyph.children[0]);
const previewRubies = tab => tab.get("#next-sentence").children.filter(node => node.tagName === "RUBY");
const rubyReadings = tab => [...passageRubies(tab), ...previewRubies(tab)].map(ruby => ruby.children[1]);
const readingSegments = reading => reading.children.map(part => [part.className, part.textContent]);

function expectRubySentence(rubies, expected, visible) {
  assert.equal(rubies.length, expected.length);
  rubies.forEach((ruby, index) => {
    assert.equal(ruby.tagName, "RUBY");
    assert.equal(ruby.className, "glyph-ruby");
    assert.equal(ruby.children[0].className, "glyph-hanzi");
    assert.equal(ruby.children[0].textContent, expected[index].hanzi);
    const reading = ruby.children[1];
    assert.equal(reading.tagName, "RT");
    assert.equal(reading.className, "glyph-reading");
    const expectedText = reading.children.filter(part => part.className !== "reading-wrong").map(part => part.textContent).join("");
    if (reading.dataset.input) assert.ok(expected[index].answers.includes(expectedText), expectedText);
    else assert.equal(expectedText, expected[index].answers.join(" / "));
    assert.match(expectedText, /^[a-z]+(?: \/ [a-z]+)*$/, "ruby readings must be complete and toneless");
    assert.equal(reading.hidden, !visible);
  });
}

test("one reading line turns the hinted prefix black without rebuilding the glyph, ruby or rt", () => {
  const tab = openTab();
  readyRound(tab, "Alpha");
  const glyph = currentGlyph(tab);
  const ruby = glyph.children[0];
  const reading = readingOf(glyph);
  assert.equal(glyph.children.length, 1);
  assert.equal(reading.hidden, false, "the empty passage reading reserves its row");
  assert.deepEqual(readingSegments(reading), []);
  tab.get("#hint-toggle").fire("click");
  for (const [input, expected] of [
    ["", [["reading-hint", "gam"]]],
    ["g", [["reading-typed", "g"], ["reading-hint", "am"]]],
    ["ga", [["reading-typed", "ga"], ["reading-hint", "m"]]],
    ["gam", [["reading-typed", "gam"]]],
    ["gz", [["reading-typed", "g"], ["reading-correct", "a"], ["reading-wrong", "z"], ["reading-hint", "m"]]],
  ]) {
    tab.evaluate(`setDraft(${JSON.stringify(input)})`);
    assert.deepEqual(readingSegments(reading), expected);
    assert.equal(reading.dataset.input, input);
    assert.equal(currentGlyph(tab), glyph);
    assert.equal(glyph.children[0], ruby);
    assert.equal(readingOf(glyph), reading);
  }
  tab.get("#hint-toggle").fire("click");
  assert.deepEqual(readingSegments(reading), [["reading-typed", "gz"]]);
  assert.equal(readingOf(glyph), reading);
  assert.ok(previewRubies(tab).every(ruby => ruby.children[1].hidden));
  tab.evaluate('setDraft("")');
  assert.equal(reading.hidden, false);
  assert.deepEqual(readingSegments(reading), []);
});

test("submitted errors show initial and rime corrections even with hints off", () => {
  for (const [expected, input, segments] of [
    ["bui", "bei", [["reading-typed", "b"], ["reading-correct", "ui"], ["reading-wrong", "ei"]]],
    ["gam", "g", [["reading-typed", "g"], ["reading-correct", "am"]]],
    ["gam", "gamm", [["reading-typed", "g"], ["reading-correct", "am"], ["reading-wrong", "amm"]]],
    ["gam", "kam", [["reading-wrong", "k"], ["reading-correct", "g"], ["reading-typed", "am"]]],
    ["aa", "baa", [["reading-wrong", "b"], ["reading-typed", "aa"]]],
  ]) {
    const tab = openTab();
    tab.evaluate(`tokens[0] = { ...tokens[0], answers: [${JSON.stringify(expected)}] }`);
    readyRound(tab, "Alpha");
    tab.evaluate(`setDraft(${JSON.stringify(input)}); submit()`);
    const reading = readingOf(glyphs(tab)[0]);
    assert.deepEqual(readingSegments(reading), segments, `${expected} vs ${input}`);
    assert.equal(reading.dataset.input, input);
    assert.match(reading.getAttribute("aria-label"), new RegExp(`輸入 ${input}，正確讀法 ${expected}`));
    assert.ok(reading.children.filter(part => part.className === "reading-wrong").every(part => part.tagName === "DEL"));
    assert.equal(tab.evaluate("round.hintsUsed"), false, "post-submit correction does not count as a hint");
    tab.get("#hint-toggle").fire("click");
    tab.get("#hint-toggle").fire("click");
    assert.equal(readingOf(glyphs(tab)[0]), reading);
    assert.deepEqual(readingSegments(reading), segments);
  }
});

test("Backspace restores an incorrect answer for repair in the same reading line", () => {
  const tab = openTab();
  readyRound(tab, "Alpha");
  tab.get("#hint-toggle").fire("click");
  tab.evaluate('setDraft("gan"); submit()');
  const surface = tab.get("#typing-surface");
  const key = value => surface.fire("keydown", { key: value, preventDefault() {} });
  key("Backspace");
  const reading = readingOf(currentGlyph(tab));
  assert.equal(reading.dataset.input, "gan");
  assert.deepEqual(readingSegments(reading), [["reading-typed", "ga"], ["reading-correct", "m"], ["reading-wrong", "n"]]);
  key("g");
  assert.deepEqual(readingSegments(reading), [["reading-typed", "g"], ["reading-hint", "am"]]);
  key("a");
  key("m");
  assert.equal(readingOf(currentGlyph(tab)), reading);
  assert.deepEqual(readingSegments(reading), [["reading-typed", "gam"]]);
  key("Enter");
  assert.equal(tab.evaluate("run.errors"), 0);
  assert.deepEqual(readingSegments(readingOf(glyphs(tab)[0])), [["reading-typed", "gam"]]);
});

test("accepted variants select a valid prefix or exact reading, and long errors stay in a few segments", () => {
  const tab = openTab();
  tab.evaluate('tokens[0] = { ...tokens[0], answers: ["haang", "hang"] }');
  readyRound(tab, "Alpha");
  tab.get("#hint-toggle").fire("click");
  const reading = readingOf(currentGlyph(tab));
  assert.deepEqual(readingSegments(reading), [["reading-hint", "haang / hang"]]);
  tab.evaluate('setDraft("han")');
  assert.deepEqual(readingSegments(reading), [["reading-typed", "han"], ["reading-hint", "g"]]);
  tab.evaluate('setDraft("hang"); submit()');
  assert.equal(tab.evaluate("run.answers[0].correct"), true);
  assert.deepEqual(readingSegments(readingOf(glyphs(tab)[0])), [["reading-typed", "hang"]]);
  assert.equal(tab.evaluate('expectedReading(["gam", "kam"], "kaa")'), "kam");
  assert.equal(tab.evaluate('expectedReading(["gam", "gaam"], "gum")'), "gam", "ties retain answer order");
  tab.evaluate('setDraft("z".repeat(100000))');
  const longReading = readingOf(currentGlyph(tab));
  assert.equal(longReading.dataset.input.length, 100000);
  assert.ok(longReading.children.length <= 4, "a long typo must not allocate a node or diff matrix per letter");
  assert.equal(longReading.children.find(part => part.className === "reading-wrong").textContent.length, 100000);
  tab.evaluate("submit()");
  assert.ok(readingOf(glyphs(tab)[1]).children.length <= 4);
});

test("ruby hints only toggle during a run and preserve draft, selection, clock, focus and composition", () => {
  const tab = openTab();
  const toggle = tab.get("#hint-toggle");
  assert.equal(toggle.disabled, true);
  assert.ok(rubyReadings(tab).every(reading => !reading.children.some(part => part.className === "reading-hint")));
  toggle.fire("click");
  assert.equal(tab.evaluate("round"), null);
  tab.evaluate('group = "mobile"');
  choosePractice(tab);
  tab.get("#start").fire("click");
  toggle.fire("click");
  assert.equal(toggle.disabled, true);
  assert.equal(tab.evaluate("round.hintsUsed"), false);
  tab.setTime(3000);
  tab.evaluate("tick()");
  assert.equal(toggle.disabled, false);
  assert.equal(toggle.getAttribute("aria-pressed"), "false");
  assert.ok(rubyReadings(tab).every(reading => !reading.children.some(part => part.className === "reading-hint")));

  tab.setTime(4250);
  tab.evaluate('setDraft("gamm", 1, 3); renderMetrics()');
  const answer = tab.get("#answer");
  const glyph = currentGlyph(tab);
  const hints = rubyReadings(tab);
  const run = tab.evaluate("run");
  const metrics = tab.evaluate("JSON.stringify(getMetrics(run, Date.now()))");
  const focusCalls = answer.focusCalls;
  let prevented = false;
  toggle.fire("pointerdown", { preventDefault() { prevented = true; } });
  toggle.fire("click");
  assert.equal(prevented, true);
  expectRubySentence(passageRubies(tab), tokens.filter(token => token.sentenceIndex === 0), true);
  expectRubySentence(previewRubies(tab), tokens.filter(token => token.sentenceIndex === 1), true);
  assert.equal(tab.get("#typing-surface").classList.contains("show-hints"), true);
  assert.equal(tab.get("#next-sentence").classList.contains("show-hints"), true);
  assert.equal(toggle.getAttribute("aria-pressed"), "true");
  assert.equal(tab.get("#hint-used").hidden, false);
  assert.equal(answer.focusCalls, focusCalls + 1);
  assert.equal(currentGlyph(tab), glyph, "toggling must not rebuild the passage");
  assert.equal(draft(tab), "gamm");
  assert.deepEqual([answer.selectionStart, answer.selectionEnd], [1, 3]);
  assert.equal(tab.evaluate("run"), run);
  assert.equal(tab.evaluate("JSON.stringify(getMetrics(run, Date.now()))"), metrics);
  assert.equal(tab.get("#time").textContent, "00:01.2");

  // Keyboard-generated clicks work without a preceding pointer event.
  toggle.fire("click", { detail: 0 });
  assert.equal(toggle.getAttribute("aria-pressed"), "false");
  assert.ok(hints.every(reading => !reading.children.some(part => part.className === "reading-hint")));
  assert.deepEqual(rubyReadings(tab), hints, "toggling retains the existing ruby nodes");
  assert.equal(tab.get("#typing-surface").classList.contains("show-hints"), false);
  assert.equal(tab.get("#next-sentence").classList.contains("show-hints"), false);
  assert.equal(tab.evaluate("round.hintsUsed"), true);
  assert.deepEqual([answer.selectionStart, answer.selectionEnd], [1, 3]);

  answer.fire("compositionstart");
  const composition = tab.evaluate("composition");
  toggle.fire("click");
  assert.equal(tab.evaluate("composing"), true);
  assert.equal(tab.evaluate("composition"), composition);
  assert.equal(draft(tab), "gamm");
  assert.deepEqual([answer.selectionStart, answer.selectionEnd], [1, 3]);
  answer.fire("compositionupdate", { data: "aa" });
  assert.equal(draft(tab), "gaam");
  answer.fire("compositionend", { data: "aa" });
  answer.fire("input", { inputType: "insertFromComposition", data: "aa" });
  assert.equal(draft(tab), "gaam");
  assert.equal(currentGlyph(tab), glyph);
  assert.equal(tab.evaluate("run.index"), 0);
});

test("ruby hints cover correct, wrong and upcoming characters across sentences, then reset for replay", () => {
  const tab = openTab();
  const variantIndex = tokens.findIndex(token => token.hanzi === "行");
  assert.ok(variantIndex > 0);
  const expectedTokens = tokens.map((token, index) => index === variantIndex ? { ...token, answers: ["haang", "hang"] } : token);
  tab.evaluate(`tokens[${variantIndex}] = { ...tokens[${variantIndex}], answers: ["haang", "hang"] }`);
  readyRound(tab, "Hinted");
  tab.get("#hint-toggle").fire("click");
  const sentenceStart = tokens.findIndex(token => token.sentenceIndex === 1);
  for (let index = 0; index < sentenceStart; index++) {
    tab.setTime(4000 + index * 1000);
    tab.evaluate(`setDraft(${JSON.stringify(index === 0 ? "zzz" : tokens[index].answers[0])}); submit()`);
    if (index === 1) {
      assert.equal(readingOf(glyphs(tab)[0]).dataset.input, "zzz");
      assert.equal(glyphs(tab)[0].classList.contains("incorrect"), true);
      assert.equal(glyphs(tab)[1].classList.contains("correct"), true);
      expectRubySentence(passageRubies(tab), tokens.filter(token => token.sentenceIndex === 0), true);
    }
  }
  expectRubySentence(passageRubies(tab), tokens.filter(token => token.sentenceIndex === 1), true);
  expectRubySentence(previewRubies(tab), expectedTokens.filter(token => token.sentenceIndex === 2), true);
  assert.ok(tab.get("#next-sentence").children.filter(node => node.tagName !== "RUBY")
    .every(node => !node.children && !/\p{Script=Han}/u.test(node.textContent)), "preview punctuation has no rt");
  tab.get("#typing-surface").fire("keydown", { key: "Backspace", preventDefault() {} });
  assert.equal(tab.evaluate("run.index"), sentenceStart - 1);
  expectRubySentence(passageRubies(tab), tokens.filter(token => token.sentenceIndex === 0), true);
  expectRubySentence(previewRubies(tab), tokens.filter(token => token.sentenceIndex === 1), true);
  assert.equal(tab.evaluate("round.hintsUsed"), true);
  for (let index = sentenceStart - 1; index < variantIndex; index++) {
    tab.setTime(5000 + index * 1000);
    tab.evaluate(`setDraft(${JSON.stringify(tokens[index].answers[0])}); submit()`);
  }
  expectRubySentence(passageRubies(tab), expectedTokens.filter(token => token.sentenceIndex === 2), true);
  assert.equal(textOf(readingOf(currentGlyph(tab))), "haang / hang");
  finishRemaining(tab);
  assert.ok(rubyReadings(tab).every(reading => !reading.children.some(part => part.className === "reading-hint")));
  assert.equal(tab.get("#typing-surface").classList.contains("show-hints"), false);
  assert.equal(tab.get("#hint-toggle").disabled, true);
  assert.equal(tab.get("#hint-toggle").getAttribute("aria-pressed"), "false");
  assert.equal(tab.records()[0].hintsUsed, true);
  assert.match(tab.get("#result-summary").textContent, /用過提示/);
  tab.get("#hint-toggle").fire("click");
  assert.ok(rubyReadings(tab).every(reading => !reading.children.some(part => part.className === "reading-hint")));

  tab.setTime(100000);
  tab.get("#play-again").fire("click");
  assert.equal(tab.evaluate("round.hintsUsed"), false);
  assert.equal(tab.get("#hint-used").hidden, true);
  assert.equal(tab.get("#hint-toggle").disabled, true);
  tab.setTime(103000);
  tab.evaluate("tick()");
  assert.ok(rubyReadings(tab).every(reading => !reading.children.some(part => part.className === "reading-hint")));
  finishRemaining(tab, 100000);
  assert.deepEqual(tab.records().map(record => record.hintsUsed), [true, false]);
  assert.doesNotMatch(tab.get("#result-summary").textContent, /用過提示/);
  tab.get("#edit-settings").fire("click");
  assert.ok(rubyReadings(tab).every(reading => !reading.children.some(part => part.className === "reading-hint")));
  assert.equal(tab.get("#hint-used").hidden, true);
  assert.equal(tab.get("#hint-toggle").disabled, true);
});

test("legacy and unhinted rounds rank separately from recent hinted rounds; invalid flags are rejected", () => {
  const valid = {
    rules: 2, articleId: questions.ARTICLE.id, group: "desktop",
    correct: tokens.length, errors: 0, elapsedSeconds: 60, at: 1000,
  };
  const store = new Map([[storageKey, JSON.stringify([
    { ...valid, id: "legacy", name: "Legacy", elapsedSeconds: 30 },
    { ...valid, id: "plain", name: "Plain", hintsUsed: false },
    { ...valid, id: "hint-old", name: "HintOld", hintsUsed: true, elapsedSeconds: 10 },
    { ...valid, id: "hint-new", name: "HintNew", hintsUsed: true, at: 2000 },
    { ...valid, id: "mobile", name: "MobileHint", hintsUsed: true, group: "mobile" },
    ...[null, "false", "true", 0, 1, {}].map((hintsUsed, index) =>
      ({ ...valid, id: `invalid-${index}`, name: "Invalid", hintsUsed })),
  ])]]);
  const tab = openTab(store);
  assert.deepEqual(names(tab.records()), ["Legacy", "Plain", "HintOld", "HintNew", "MobileHint"]);
  assert.equal(tab.records()[0].hintsUsed, false);
  const rows = selector => tab.get(selector).children[0].children[0].children;
  assert.deepEqual(rows("#local-board").map(row => row.children[1].children[0].textContent), ["Legacy", "Plain"]);
  assert.equal(rows("#local-board")[0].classList.contains("best"), true);
  assert.equal(tab.get("#hinted-board-card").hidden, false);
  assert.deepEqual(rows("#hinted-board").map(row => row.children[0].children[0].textContent), ["HintNew", "HintOld"]);
  assert.doesNotMatch(tab.get("#hinted-board").children[0].innerHTML, /名次/);
  for (const row of rows("#hinted-board")) {
    assert.equal(row.children.length, 3, "hinted results show name, score and accuracy without a rank");
    assert.equal(row.classList.contains("best"), false);
    assert.ok(Number(row.children[1].children[0].textContent) > 0);
    assert.equal(row.children[2].textContent, "100%");
  }
  tab.evaluate('boardGroup = "mobile"; renderBoards()');
  assert.doesNotMatch(textOf(tab.get("#local-board")), /MobileHint/);
  assert.deepEqual(rows("#hinted-board").map(row => row.children[0].children[0].textContent), ["MobileHint"]);
  tab.get("#clear-scores").fire("click");
  assert.deepEqual(tab.records(), []);
  assert.deepEqual(persisted(store), []);
  assert.equal(tab.get("#hinted-board-card").hidden, true);
  assert.equal(tab.get("#clear-scores").hidden, true);
});

test("component accuracy follows retained submissions, undo, correction, reset and replay", () => {
  const tab = openTab();
  const types = ["initial", "nucleus", "coda"];
  const cell = (type, value) => {
    const found = tab.get(`#component-${type}`).children.find(node => node.dataset.value === value);
    assert.ok(found, `Missing ${type} cell: ${value}`);
    assert.equal(found.children[0].textContent, value);
    return found;
  };
  const expectRate = (type, value, rate, state) => {
    const node = cell(type, value);
    assert.equal(node.children[1].textContent, rate);
    for (const name of ["correct", "incorrect", "mixed"]) {
      assert.equal(node.classList.contains(name), name === state, `${type} ${value}: ${name}`);
    }
  };
  const expectUnsubmitted = () => {
    for (const type of types) {
      const cells = tab.get(`#component-${type}`).children;
      assert.ok(cells.length > 0, `${type} must render before any submission`);
      for (const node of cells) expectRate(type, node.dataset.value, "—");
    }
  };
  const key = value => tab.get("#typing-surface").fire("keydown", {
    key: value, code: value, preventDefault() {},
  });

  expectUnsubmitted();
  readyRound(tab, "Alpha");
  assert.equal(tokens[0].hanzi, "今");
  assert.ok(tokens[0].answers.includes("gam"));
  tab.evaluate('setDraft("gan")');
  expectUnsubmitted();
  key("Enter");
  expectRate("initial", "g", "100%", "correct");
  expectRate("nucleus", "a", "100%", "correct");
  expectRate("coda", "m", "0%", "incorrect");
  expectRate("coda", "n", "—");
  assert.equal(tab.evaluate("run.correct"), 0, "partial component credit must not change word scoring");
  assert.equal(tab.evaluate("run.errors"), 1);

  key("Backspace");
  assert.equal(draft(tab), "gan");
  expectUnsubmitted();
  tab.evaluate('setDraft("gam")');
  expectUnsubmitted();
  key("Enter");
  expectRate("initial", "g", "100%", "correct");
  expectRate("nucleus", "a", "100%", "correct");
  expectRate("coda", "m", "100%", "correct");
  expectRate("coda", "n", "—");

  tab.get("#cancel-run").fire("click");
  expectUnsubmitted();
  readyRound(tab, "Alpha", 10000);
  expectUnsubmitted();
  finishRemaining(tab, 10000);
  expectRate("initial", "g", "100%", "correct");
  tab.get("#play-again").fire("click");
  expectUnsubmitted();
});

test("round settings become a frozen summary, survive replay, and are editable only after returning to setup", () => {
  const tab = openTab();
  assert.equal(tab.get("#race-card").hidden, true);
  assert.equal(tab.get("#setup-card").hidden, false);
  assert.equal(tab.get("#round-summary").hidden, true);
  assert.equal(tab.get("#round-actions").hidden, true);
  assert.equal(tab.get("#typing-surface").measureCalls, 0);
  assert.equal(tab.get("#arena-view").classList.contains("has-race"), false);
  tab.get("#nickname").value = " <b>甲</b> ";
  tab.evaluate('group = "mobile"');
  choosePractice(tab);
  tab.get("#start").fire("click");
  assert.equal(tab.get("#race-card").hidden, false);
  assert.equal(tab.get("#setup-card").hidden, true);
  assert.equal(tab.get("#setup-fields").disabled, true);
  assert.equal(tab.get("#round-summary").hidden, false);
  assert.equal(tab.get("#round-name").textContent, "<b>甲</b>");
  assert.equal(tab.get("#round-name").innerHTML, "", "the nickname is assigned as text, not HTML");
  assert.equal(tab.get("#round-group").textContent, "手機組");
  assert.equal(tab.get("#round-article").textContent, questions.ARTICLE.title);
  assert.equal(tab.get("#round-length").textContent, `${tokens.length} 音節`);
  assert.equal(tab.get("#round-actions").hidden, false);
  assert.equal(tab.get("#cancel-run").hidden, false);
  assert.equal(tab.get("#play-again").hidden, true);
  assert.equal(tab.get("#edit-settings").hidden, true);
  assert.equal(tab.get("#arena-view").classList.contains("has-race"), true);
  // Changes outside the disabled form cannot alter this round or its replay.
  tab.get("#nickname").value = "Changed";
  tab.evaluate('group = "desktop"');
  tab.setTime(3000);
  tab.evaluate("tick()");
  finishRemaining(tab);
  assert.equal(tab.get("#race-card").hidden, false);
  assert.equal(tab.get("#result").hidden, false);
  assert.equal(tab.get("#setup-card").hidden, true);
  assert.equal(tab.get("#setup-fields").disabled, true);
  assert.equal(tab.get("#round-name").textContent, "<b>甲</b>");
  assert.equal(tab.get("#cancel-run").hidden, true);
  assert.equal(tab.get("#play-again").hidden, false);
  assert.equal(tab.get("#edit-settings").hidden, false);
  assert.equal(tab.get("#arena-view").classList.contains("has-race"), true);
  tab.setTime(100000);
  tab.get("#play-again").fire("click");
  assert.equal(tab.evaluate("round.name"), "<b>甲</b>");
  assert.equal(tab.evaluate("round.group"), "mobile");
  assert.equal(tab.get("#round-group").textContent, "手機組");
  assert.equal(tab.get("#play-again").hidden, true);
  assert.equal(tab.get("#cancel-run").hidden, false);
  tab.setTime(103000);
  tab.evaluate("tick()");
  finishRemaining(tab, 100000);
  tab.get("#edit-settings").fire("click");
  assert.equal(tab.get("#race-card").hidden, true);
  assert.equal(tab.get("#setup-card").hidden, false);
  assert.equal(tab.get("#setup-fields").disabled, false);
  assert.equal(tab.get("#round-summary").hidden, true);
  assert.equal(tab.get("#round-actions").hidden, true);
  assert.equal(tab.get("#nickname").value, "Changed");
  assert.equal(tab.evaluate("group"), "desktop");
  assert.equal(tab.get("#arena-view").classList.contains("has-race"), false);
  tab.get("#nickname").value = "Beta";
  choosePractice(tab);
  tab.get("#start").fire("click");
  assert.equal(tab.get("#round-name").textContent, "Beta");
  assert.equal(tab.get("#round-group").textContent, "電腦組");
  tab.get("#cancel-run").fire("click");
  assert.equal(tab.get("#setup-card").hidden, false);
  assert.equal(tab.get("#round-summary").hidden, true);
  assert.equal(tab.get("#round-actions").hidden, true);
  assert.equal(tab.get("#race-card").hidden, true);
  assert.deepEqual(names(tab.records()), ["<b>甲</b>", "<b>甲</b>"]);
});

test("desktop uses a noneditable focus target and handles Process/229 keys without duplicate IME text", () => {
  const tab = openTab();
  readyRound(tab, "Alpha");
  const surface = tab.get("#typing-surface");
  const answer = tab.get("#answer");
  assert.ok(surface.focusCalls > 0);
  assert.equal(answer.focusCalls, 0);
  let prevented = 0;
  surface.fire("keydown", { key: "Process", code: "KeyG", keyCode: 229, isComposing: true, preventDefault() { prevented++; } });
  assert.equal(draft(tab), "g");
  answer.fire("beforeinput", { inputType: "insertText", data: "g", preventDefault() { prevented++; } });
  answer.value = "gg";
  answer.fire("input", { inputType: "insertText", data: "g" });
  answer.fire("compositionstart");
  answer.fire("compositionupdate", { data: "今" });
  answer.value = "今";
  answer.fire("compositionend", { data: "今" });
  answer.fire("input", { inputType: "insertFromComposition", data: "今" });
  assert.equal(draft(tab), "g");
  assert.equal(answer.value, "g");
  assert.equal(prevented, 2);
  surface.fire("keydown", { key: "Q", code: "KeyA", preventDefault() {} });
  assert.equal(draft(tab), "gq", "ASCII key respects the keyboard layout before falling back to code");
  for (const modifier of ["ctrlKey", "metaKey", "altKey"]) {
    surface.fire("keydown", { key: "a", code: "KeyA", [modifier]: true, preventDefault() { assert.fail("shortcut intercepted"); } });
  }
  assert.equal(draft(tab), "gq");
});

test("mobile physical input rejects stale composition after submission then accepts new native Latin", () => {
  const tab = openTab();
  tab.evaluate('group = "mobile"');
  readyRound(tab, "Alpha");
  const answer = tab.get("#answer");
  assert.ok(answer.focusCalls > 0);
  answer.fire("compositionstart");
  for (const code of ["KeyG", "KeyA", "KeyM"]) {
    answer.fire("keydown", { key: "Process", code, keyCode: 229, isComposing: true, preventDefault() {} });
  }
  assert.equal(draft(tab), "gam");
  answer.fire("keydown", { key: "Process", code: "Space", isComposing: true, preventDefault() {} });
  assert.equal(tab.evaluate("run.index"), 1);
  answer.fire("compositionupdate", { data: "gam" });
  answer.fire("compositionend", { data: "gam" });
  answer.value = "gam";
  answer.fire("input", { inputType: "insertText", data: "gam" });
  assert.equal(draft(tab), "");
  tab.flushTimeouts();
  answer.value = "JAT";
  answer.fire("input", { inputType: "insertText", data: "JAT" });
  assert.equal(draft(tab), "jat");
  answer.fire("keydown", { key: "Process", code: "Enter", keyCode: 229, preventDefault() {} });
  assert.equal(tab.evaluate("run.index"), 2);
  assert.equal(tab.evaluate("run.correct"), 2);
});

test("Backspace edits letters and duplicate events preserve the selected answer for replacement", () => {
  const tab = openTab();
  tab.evaluate('group = "mobile"');
  readyRound(tab, "Alpha");
  const answer = tab.get("#answer");
  tab.evaluate('setDraft("gamm")');
  answer.fire("keydown", { key: "Backspace", code: "Backspace", preventDefault() {} });
  answer.fire("beforeinput", { inputType: "deleteContentBackward", preventDefault() {} });
  assert.equal(draft(tab), "gam");
  answer.fire("keydown", { key: "Enter", code: "Enter", preventDefault() {} });
  answer.fire("keydown", { key: "Backspace", code: "Backspace", preventDefault() {} });
  answer.fire("beforeinput", { inputType: "deleteContentBackward", preventDefault() {} });
  answer.value = "";
  answer.fire("input", { inputType: "deleteContentBackward" });
  assert.equal(draft(tab), "gam");
  assert.equal(answer.selectionStart, 0);
  assert.equal(answer.selectionEnd, 3);
  answer.fire("keydown", { key: "g", code: "KeyG", preventDefault() {} });
  assert.equal(draft(tab), "g");
});

test("mobile input accepts ASCII and sanitizes pasted text without transliterating Chinese", () => {
  const tab = openTab();
  tab.evaluate('group = "mobile"');
  readyRound(tab, "Alpha");
  const answer = tab.get("#answer");
  answer.value = "你";
  answer.fire("input", { inputType: "insertText", data: "你" });
  assert.equal(draft(tab), "");
  answer.value = "GA";
  answer.fire("input", { inputType: "insertText", data: "GA" });
  assert.equal(draft(tab), "ga");
  answer.value = "家";
  answer.fire("input", { inputType: "insertText", data: "家" });
  assert.equal(draft(tab), "ga");
  answer.value = "Ab中C1";
  answer.fire("input", { inputType: "insertFromPaste", data: "Ab中C1" });
  assert.equal(draft(tab), "abc");
  assert.equal(answer.value, "abc");
});

test("typing shows Jyutping above the current character without replacing or scrolling it", () => {
  const tab = openTab();
  tab.evaluate('group = "mobile"');
  readyRound(tab, "Alpha");
  const glyph = currentGlyph(tab);
  const scrollCalls = glyph.scrollCalls;
  assert.equal(glyph.children[0].children[0].textContent, tokens[0].hanzi);
  assert.equal(glyph.children[0].className, "glyph-ruby");
  assert.equal(readingOf(glyph).className, "glyph-reading");
  for (const value of ["g", "ga", tokens[0].answers[0]]) {
    tab.get("#answer").value = value;
    tab.get("#answer").fire("input", { inputType: "insertText" });
    assert.equal(draft(tab), value);
    assert.equal(currentGlyph(tab), glyph);
    assert.equal(glyph.scrollCalls, scrollCalls);
  }
  let prevented = false;
  tab.get("#answer").fire("keydown", { key: "Enter", preventDefault() { prevented = true; } });
  assert.equal(prevented, true);
  assert.equal(tab.evaluate("run.index"), 1);
  assert.equal(readingOf(glyphs(tab)[0]).dataset.input, tokens[0].answers[0]);
  assert.equal(glyphs(tab)[0].classList.contains("correct"), true);
  assert.equal(draft(tab), "");
});

test("mobile draft wrapping moves the capture input without scrolling, focusing or rebuilding", () => {
  const tab = openTab();
  tab.evaluate('group = "mobile"');
  readyRound(tab, "Alpha");
  tab.get("#hint-toggle").fire("click");
  const glyph = currentGlyph(tab);
  const reading = readingOf(glyph);
  const answer = tab.get("#answer");
  const surface = tab.get("#typing-surface");
  surface.scrollLeft = 3;
  surface.scrollTop = 7;
  surface.getBoundingClientRect = () => ({ left: 10, top: 80 });
  glyph.getBoundingClientRect = function () {
    this.measureCalls++;
    return reading.dataset.input.length > 3
      ? { left: 15, top: 180, width: 90 }
      : { left: 250, top: 100, width: 60 };
  };
  tab.evaluate('setDraft("ga")');
  assert.equal(answer.style.left, "273px");
  assert.equal(answer.style.top, "27px");
  const measurements = glyph.measureCalls;
  const scrolls = glyph.scrollCalls;
  const focuses = answer.focusCalls;
  tab.evaluate('setDraft("gamm", 1, 3)');
  assert.equal(answer.style.left, "53px");
  assert.equal(answer.style.top, "107px");
  assert.equal(glyph.measureCalls, measurements + 1);
  assert.equal(glyph.scrollCalls, scrolls);
  assert.equal(answer.focusCalls, focuses);
  assert.deepEqual([answer.selectionStart, answer.selectionEnd], [1, 3]);
  assert.equal(currentGlyph(tab), glyph);
  assert.equal(readingOf(glyph), reading);
  assert.equal(reading.dataset.input, "gamm");
});

test("empty submissions clear the displayed draft without advancing", () => {
  const tab = openTab();
  tab.evaluate('group = "mobile"');
  readyRound(tab, "Alpha");
  tab.get("#answer").value = "gam";
  tab.get("#answer").fire("input", {});
  assert.equal(draft(tab), "gam");
  tab.get("#answer").value = "";
  tab.get("#answer").fire("input", {});
  tab.get("#answer").fire("keydown", { key: "Enter", preventDefault() {} });
  assert.equal(tab.get("#answer").value, "");
  assert.equal(draft(tab), "");
  assert.equal(tab.evaluate("run.index"), 0);
});

test("composition updates the visible draft but does not submit on composition keys or commits", () => {
  const tab = openTab();
  tab.evaluate('group = "mobile"');
  readyRound(tab, "Alpha");
  const answer = tab.get("#answer");
  answer.fire("compositionstart");
  answer.value = "gam";
  answer.fire("compositionupdate", { data: "gam" });
  assert.equal(draft(tab), "gam");
  answer.fire("input", { isComposing: true, inputType: "insertCompositionText" });
  answer.fire("keydown", { key: " ", isComposing: true, preventDefault() {} });
  answer.fire("keydown", { key: "Enter", isComposing: true, preventDefault() {} });
  answer.fire("beforeinput", { inputType: "insertText", data: " ", isComposing: true, preventDefault() {} });
  assert.equal(tab.evaluate("run.index"), 0);
  answer.value = "今";
  answer.fire("compositionend", { data: "今" });
  answer.fire("input", { inputType: "insertCompositionText", data: "今", isComposing: false });
  assert.equal(draft(tab), "gam");
  assert.equal(tab.evaluate("run.index"), 0);
  tab.flushTimeouts();
  answer.fire("keydown", { key: "Enter", preventDefault() {} });
  assert.equal(tab.evaluate("run.index"), 1);
  assert.equal(tab.evaluate("run.answers[0].answer"), "gam");
});

test("mobile spaces submit through beforeinput or the uncancelable input fallback", () => {
  const tab = openTab();
  tab.evaluate('group = "mobile"');
  readyRound(tab, "Alpha");
  const answer = tab.get("#answer");
  answer.value = tokens[0].answers[0];
  answer.fire("input", { inputType: "insertText" });
  let prevented = false;
  answer.fire("beforeinput", { inputType: "insertText", data: " ", preventDefault() { prevented = true; } });
  assert.equal(prevented, true);
  assert.equal(tab.evaluate("run.index"), 1);
  assert.equal(answer.value, "");
  assert.equal(draft(tab), "");
  answer.value = tokens[1].answers[0];
  answer.fire("input", { inputType: "insertText" });
  answer.fire("beforeinput", { inputType: "insertText", data: " ", cancelable: false, preventDefault() { assert.fail("uncancelable"); } });
  assert.equal(tab.evaluate("run.index"), 1);
  answer.value += " ";
  answer.fire("input", { inputType: "insertText", data: " " });
  assert.equal(tab.evaluate("run.index"), 2);
  assert.equal(answer.value, "");
  assert.equal(readingOf(glyphs(tab)[1]).dataset.input, tokens[1].answers[0]);
});

test("clicking the passage or returning to the arena restores focus without intercepting Tab", () => {
  const tab = openTab();
  const answer = tab.get("#answer");
  const surface = tab.get("#typing-surface");
  surface.fire("click");
  assert.equal(answer.focusCalls, 0);
  readyRound(tab, "Alpha");
  assert.equal(surface.classList.contains("focused"), true);
  surface.blur();
  assert.equal(surface.classList.contains("focused"), false);
  surface.fire("click");
  assert.equal(surface.classList.contains("focused"), true);
  assert.ok(Number.isFinite(parseFloat(answer.style.left)));
  assert.ok(Number.isFinite(parseFloat(answer.style.top)));
  tab.evaluate('showView("rules")');
  surface.blur();
  const previousFocus = surface.focusCalls;
  tab.evaluate('showView("arena")');
  assert.equal(surface.focusCalls, previousFocus + 1);
  assert.equal(answer.focusCalls, 0);
  answer.fire("keydown", { key: "Tab", preventDefault() { assert.fail("Tab must retain native navigation"); } });
  assert.equal(tab.evaluate("run.index"), 0);
});

test("finishing while the leaderboard is open immediately displays the new result", () => {
  const tab = openTab();
  beginRound(tab, "Alpha");
  tab.evaluate('showView("leaderboard")');
  assert.doesNotMatch(textOf(tab.get("#local-board")), /Alpha/);
  finishRemaining(tab);
  assert.match(textOf(tab.get("#local-board")), /Alpha/);
  assert.deepEqual(names(tab.records()), ["Alpha"]);
  const [record] = tab.records();
  assert.equal(record.rules, 2);
  assert.equal(record.articleId, questions.ARTICLE.id);
  assert.equal(record.elapsedSeconds, tokens.length);
  assert.equal("duration" in record, false);
});

test("two already-open tabs finishing sequentially retain both results without duplicates", () => {
  const store = new Map();
  const first = openTab(store);
  const second = openTab(store);
  completeRound(first, "Alpha");
  completeRound(second, "Beta", 40000);
  assert.deepEqual(names(persisted(store)), ["Alpha", "Beta"]);
  completeRound(first, "Gamma", 80000);
  assert.deepEqual(names(persisted(store)), ["Alpha", "Beta", "Gamma"]);
});

test("denied storage reads and writes preserve successive results in this tab", () => {
  const store = new Map();
  const tab = openTab(store, { read: true, write: true });
  completeRound(tab, "Alpha");
  completeRound(tab, "Beta", 40000);
  assert.deepEqual(names(tab.records()), ["Alpha", "Beta"]);
  assert.deepEqual(persisted(store), []);
  assert.equal(tab.evaluate("storageAvailable"), false);
});

test("failed writes retain unsaved rounds even when reads succeed, then recover together", () => {
  const store = new Map();
  const failures = { write: true };
  const tab = openTab(store, failures);
  completeRound(tab, "Alpha");
  completeRound(tab, "Beta", 40000);
  assert.deepEqual(names(tab.records()), ["Alpha", "Beta"]);
  assert.deepEqual(persisted(store), []);
  tab.evaluate("readRecords(records)");
  assert.equal(tab.evaluate("storageAvailable"), false);
  failures.write = false;
  completeRound(tab, "Gamma", 80000);
  assert.deepEqual(names(persisted(store)), ["Alpha", "Beta", "Gamma"]);
  assert.equal(tab.evaluate("storageAvailable"), true);
});

test("external saves refresh an open board and clearing does not resurrect old results", () => {
  const store = new Map();
  const first = openTab(store);
  const second = openTab(store);
  second.evaluate('showView("leaderboard")');
  completeRound(first, "Alpha");
  second.storageChanged();
  assert.match(textOf(second.get("#local-board")), /Alpha/);
  first.get("#clear-scores").fire("click");
  second.storageChanged();
  assert.deepEqual(second.records(), []);
  assert.doesNotMatch(textOf(second.get("#local-board")), /Alpha/);
  completeRound(second, "Beta", 40000);
  assert.deepEqual(names(persisted(store)), ["Beta"]);
});

test("an incorrect submission advances to the next character and clears the input", () => {
  const tab = openTab();
  readyRound(tab, "Alpha");
  tab.setTime(4000);
  tab.evaluate('setDraft("zzz")');
  tab.evaluate("submit()");
  assert.equal(tab.evaluate("run.index"), 1);
  assert.equal(tab.get("#answer").value, "");
  assert.equal(tab.evaluate("getMetrics(run, Date.now()).correct"), 0);
  assert.equal(tab.evaluate("getMetrics(run, Date.now()).errors"), 1);
  assert.equal(readingOf(glyphs(tab)[0]).dataset.input, "zzz");
  assert.equal(glyphs(tab)[0].classList.contains("incorrect"), true);
  assert.equal(draft(tab), "");
  assert.deepEqual(tab.records(), []);
  finishRemaining(tab);
  assert.ok(Math.abs(
    tab.evaluate("rankRecords(records)[0].score") -
    tab.evaluate("getMetrics(run, Date.now()).score"),
  ) < 1e-10);
});

test("Backspace restores the previous answer once across keydown and beforeinput, then allows correction", () => {
  const tab = openTab();
  const sentenceEnd = tokens.findIndex(token => token.sentenceIndex === 1) - 1;
  assert.ok(sentenceEnd >= 0);
  readyRound(tab, "Alpha");
  for (let index = 0; index <= sentenceEnd; index++) {
    tab.setTime(4000 + index * 1000);
    tab.evaluate(`setDraft(${JSON.stringify(index === sentenceEnd ? "zzz" : tokens[index].answers[0])})`);
    tab.evaluate("submit()");
  }
  assert.equal(tab.evaluate("run.index"), sentenceEnd + 1);
  assert.equal(tab.get("#answer").value, "");

  let prevented = 0;
  tab.get("#answer").fire("keydown", {
    key: "Backspace", preventDefault() { prevented++; },
  });
  let beforeinputPrevented = false;
  tab.get("#answer").fire("beforeinput", {
    inputType: "deleteContentBackward",
    preventDefault() { prevented++; beforeinputPrevented = true; },
  });
  // A duplicate browser event must not delete from the restored answer.
  if (!beforeinputPrevented) {
    tab.get("#answer").value = tab.get("#answer").value.slice(0, -1);
  }
  assert.ok(prevented >= 1);
  assert.equal(tab.evaluate("run.index"), sentenceEnd);
  assert.equal(tab.get("#answer").value, "zzz");
  assert.equal(draft(tab), "zzz");
  assert.equal(currentGlyph(tab).classList.contains("incorrect"), false);
  assert.equal(tab.evaluate("getMetrics(run, Date.now()).errors"), 0);
  tab.flushTimeouts();

  tab.setTime(5000 + (sentenceEnd + 1) * 1000);
  tab.evaluate(`setDraft(${JSON.stringify(tokens[sentenceEnd].answers[0])})`);
  tab.evaluate("submit()");
  assert.equal(tab.evaluate("run.index"), sentenceEnd + 1);
  assert.equal(tab.evaluate("getMetrics(run, Date.now()).correct"), sentenceEnd + 1);
  assert.equal(tab.evaluate("getMetrics(run, Date.now()).accuracy"), 100);
});

test("a mobile beforeinput-only Backspace restores the previous answer from an empty field", () => {
  const tab = openTab();
  tab.evaluate('group = "mobile"');
  beginRound(tab, "Alpha");
  assert.equal(tab.get("#answer").value, "");
  let prevented = false;
  tab.get("#answer").fire("beforeinput", {
    inputType: "deleteContentBackward", preventDefault() { prevented = true; },
  });
  assert.equal(prevented, true);
  assert.equal(tab.evaluate("run.index"), 0);
  assert.equal(tab.get("#answer").value, tokens[0].answers[0]);
  assert.equal(tab.evaluate("getMetrics(run, Date.now()).submitted"), 0);
  assert.equal(tab.evaluate("getMetrics(run, Date.now()).correct"), 0);
});

test("old rules and other articles are excluded from the current local leaderboard", () => {
  const store = new Map();
  const valid = {
    id: "valid", rules: 2, articleId: questions.ARTICLE.id, group: "desktop",
    name: "Current", correct: tokens.length, errors: 0, elapsedSeconds: 60, at: 1000,
  };
  const old = { ...valid, id: "old-rules", rules: 1, name: "OldRules", duration: 30 };
  store.set("canclid-contest-demo-v1", JSON.stringify([{ ...old, name: "OldKey" }]));
  store.set(storageKey, JSON.stringify([
    valid, old,
    { ...valid, id: "other-article", articleId: "different-article-v1", name: "OtherArticle" },
  ]));
  const tab = openTab(store);
  tab.evaluate('showView("leaderboard")');
  assert.deepEqual(names(tab.records()), ["Current"]);
  assert.match(textOf(tab.get("#local-board")), /Current/);
  assert.doesNotMatch(textOf(tab.get("#local-board")), /OldRules|OtherArticle|OldKey/);
});

test("主入口預設官方三輪試玩：撳開始會開流程再跳去第 1 輪落石", () => {
  withSessionStorage(storage => {
    const tab = openTab();
    assert.equal(tab.get("#flow-official").getAttribute("aria-pressed"), "true");
    assert.equal(tab.get("#flow-practice").getAttribute("aria-pressed"), "false");
    assert.ok(tab.get("#flow-official").classList.contains("selected"));
    assert.equal(tab.evaluate("flowChoice"), "official");
    assert.match(tab.get("#flow-note").textContent, /官方三輪/);

    tab.get("#nickname").value = "  阿甲  ";
    tab.evaluate('group = "mobile"');
    tab.get("#start").fire("click");

    assert.equal(tab.evaluate("run"), null, "官方流程唔會喺主站開單篇賽");
    const saved = storage.read(flowStorageKey);
    assert.equal(saved.version, 1);
    assert.deepEqual(saved.rounds, {});
    assert.deepEqual(saved.player, { name: "阿甲", group: "mobile" });
    assert.ok(Number.isFinite(saved.startedAt));
    assert.equal(tab.location.href, "./games/rocks/?flow=1");

    // 揀返「單篇自由練習」就照舊喺主站開單篇賽，唔會再寫流程。
    const practice = openTab();
    practice.get("#flow-practice").fire("click");
    assert.equal(practice.get("#flow-practice").getAttribute("aria-pressed"), "true");
    assert.equal(practice.get("#flow-official").getAttribute("aria-pressed"), "false");
    assert.equal(practice.evaluate("flowChoice"), "practice");
    assert.match(practice.get("#flow-note").textContent, /單篇練習/);
    practice.get("#start").fire("click");
    assert.equal(practice.get("#setup-card").hidden, true);
    assert.equal(practice.get("#round-name").textContent, "粵拼新星");
    assert.equal(storage.map.size, 1, "單篇練習唔會寫流程");
  });
});

test("arena 支援 ?practice=1：預設揀單篇自由練習，唔會開三輪流程", () => {
  withSessionStorage(storage => {
    const tab = openTab(new Map(), {}, { search: "?practice=1" });
    assert.equal(tab.evaluate("flowChoice"), "practice");
    assert.equal(tab.get("#flow-practice").getAttribute("aria-pressed"), "true");
    assert.equal(tab.get("#flow-official").getAttribute("aria-pressed"), "false");
    assert.ok(tab.get("#flow-practice").classList.contains("selected"));
    assert.match(tab.get("#flow-note").textContent, /單篇練習/);

    tab.get("#start").fire("click");
    tab.setTime(3000);
    tab.evaluate("tick()");
    assert.equal(tab.evaluate("run.status"), "running");
    assert.equal(tab.get("#setup-card").hidden, true);
    assert.equal(tab.location.href, "", "唔會跳去遊戲頁");
    assert.equal(storage.map.size, 0, "單篇練習唔會寫流程");
  });
});

test("設定卡「自由練習」捷徑：揀自由練習先展開面板，其餘連去遊戲大廳各模式", () => {
  const tab = openTab();
  tab.get("#flow-practice").fire("click");
  assert.equal(tab.evaluate("flowChoice"), "practice");
  assert.equal(tab.get("#flow-practice").getAttribute("aria-pressed"), "true");
  assert.match(tab.get("#flow-note").textContent, /單篇練習/);
  assert.equal(tab.get("#practice-panel").hidden, false, "揀自由練習先展開捷徑面板");

  const arena = readFileSync(new URL("../demo/index.html", import.meta.url), "utf8");
  for (const href of ["./games/rocks/", "./games/chain/", "./games/ghost/", "./games/tower/"]) {
    assert.ok(arena.includes(`class="practice-chip" href="${href}"`), `設定卡要有 ${href} 捷徑`);
  }
  assert.doesNotMatch(arena, /practice-chip[^>]*flow=1/, "自由練習捷徑唔帶 flow=1");

  const lobby = readFileSync(new URL("../demo/games/index.html", import.meta.url), "utf8");
  assert.match(lobby, /href="\.\.\/\.\.\/index\.html\?practice=1"/, "大廳要有單篇練習卡");
  assert.equal((lobby.match(/class="game-card"/g) ?? []).length, 5, "大廳係練習集中地，共 5 張卡");
  assert.match(lobby, /單篇練習/);
  assert.doesNotMatch(lobby, /game-card[^>]*flow=1/, "官方三輪流程唔係小遊戲，大廳唔准有 flow=1 卡");
  assert.match(lobby, /flow-pointer/, "大廳要有去試玩賽場開始官方流程嘅提示條");
});

test("設定卡玩法選項卡：預設官方三輪收埋練習面板，開始掣文字跟揀選變", () => {
  const tab = openTab();
  assert.equal(tab.get("#practice-panel").hidden, true, "預設官方三輪唔展開自由練習面板");
  assert.match(textOf(tab.get("#start")), /三輪/);

  tab.get("#flow-practice").fire("click");
  assert.equal(tab.get("#practice-panel").hidden, false);
  assert.match(textOf(tab.get("#start")), /單篇/);

  tab.get("#flow-official").fire("click");
  assert.equal(tab.get("#practice-panel").hidden, true);
  assert.match(textOf(tab.get("#start")), /三輪/);
});

test("玩法頁六張卡：官方流程、計分方法、三個遊戲、練習工具、組別、本機示範", () => {
  const html = readFileSync(new URL("../demo/index.html", import.meta.url), "utf8");
  const rules = html.slice(html.indexOf('id="rules-view"'));
  assert.equal((rules.match(/class="rule-card/g) ?? []).length, 6, "玩法頁要有六張卡");
  for (const heading of ["官方三輪試玩", "計分方法", "三個計分遊戲", "練習工具", "手機組同電腦組", "本機示範"]) {
    assert.ok(rules.includes(`<h2>${heading}</h2>`), `玩法頁要有「${heading}」卡`);
  }
  assert.match(rules, /單字（落石）90 秒/);
  assert.match(rules, /詞組（詞鏈）120 秒/);
  assert.match(rules, /85%/);
  assert.match(rules, /正確音節／分鐘 × 準確度/);
  assert.match(rules, /中位數標準化/);
  assert.match(rules, /示範幽靈陪跑/);
  assert.match(rules, /解鎖塔/);
});

test("排行榜：正式分欄、85% 門檻標示、示範榜同步，排序以正式分為先", () => {
  const valid = { rules: 2, articleId: questions.ARTICLE.id, group: "desktop" };
  const slowCorrect = Math.round(tokens.length * 0.6);
  const store = new Map([[storageKey, JSON.stringify([
    { ...valid, name: "快而準", correct: tokens.length, errors: 0, elapsedSeconds: 60, at: 1000 },
    { ...valid, name: "亂打", correct: slowCorrect, errors: tokens.length - slowCorrect, elapsedSeconds: 30, at: 2000 },
  ])]]);
  const tab = openTab(store);
  tab.evaluate('showView("leaderboard")');
  const rows = selector => tab.get(selector).children[0].children[0].children;
  // 正式分 R ＝ 正確音節／分鐘 × 準確度（SPEC §5.5）。
  const official = (correct, elapsedSeconds) =>
    (correct / elapsedSeconds * 60 * (correct / tokens.length)).toFixed(1);

  const local = rows("#local-board");
  assert.equal(local.length, 2);
  assert.equal(local[0].children.length, 5, "本機榜要有名次、名、正式分、綜合分、準確度");
  assert.equal(local[0].children[1].children[0].textContent, "快而準", "正式分高嗰個排第一");
  assert.equal(local[0].children[2].children[0].textContent, official(tokens.length, 60));
  assert.equal(local[0].children[2].classList.contains("below-threshold"), false);
  assert.equal(local[1].children[1].children[0].textContent, "亂打");
  assert.equal(local[1].children[2].children[0].textContent, official(slowCorrect, 30));
  assert.equal(local[1].children[2].classList.contains("below-threshold"), true, "未達 85% 標灰");
  assert.match(local[1].children[2].children[1].textContent, /85%/);
  assert.equal(local[1].children[4].textContent, `${Math.round(slowCorrect / tokens.length * 100)}%`);

  const sample = rows("#sample-board");
  assert.equal(sample.length, 4);
  assert.equal(sample[0].children.length, 5, "示範榜同步加正式分欄");
  assert.ok(sample.some(row => row.children[2].classList.contains("below-threshold")), "示範數據包含未達門檻例子");

  const html = readFileSync(new URL("../demo/index.html", import.meta.url), "utf8");
  assert.match(html, /正式分 R ＝ 正確音節／分鐘 × 準確度/);
  assert.match(html, /85% 門檻/);
  assert.match(html, /玩法頁/);
});

test("高頻 tick 只喺數字有變先寫 DOM，唔會重複改同一節點", () => {
  const tab = openTab();
  choosePractice(tab);
  readyRound(tab, "Alpha");
  const time = tab.get("#time");
  const writes = time.textWrites;
  assert.ok(writes > 0, "開局之後要寫過時間");
  tab.evaluate("renderMetrics()");
  assert.equal(time.textWrites, writes, "同一時刻重複 render 唔應該再寫 #time");
  tab.setTime(4500);
  tab.evaluate("renderMetrics()");
  assert.equal(time.textWrites, writes + 1, "時間有變就寫一次");
  assert.equal(time.textContent, "00:01.5");
  const speed = tab.get("#speed");
  const speedWrites = speed.textWrites;
  tab.setTime(5000);
  tab.evaluate("renderMetrics()");
  assert.equal(speed.textWrites, speedWrites, "速度冇變就唔寫");
});

// ── 雙語界面：locale 掣、data-i18n 靜態文案、動態重繪 ──────────────────────
// i18n 運行庫（test realm）讀 globalThis 嘅 document／window／localStorage，
// 所以測試要暫時掛假 DOM；app.mjs 個 vm 注入返同一個 i18n 實例。
const localeStorageKey = "canclid-contest-locale";

function localeStorage(store = new Map()) {
  return {
    getItem: key => (store.has(key) ? store.get(key) : null),
    setItem(key, value) { store.set(key, String(value)); },
    removeItem(key) { store.delete(key); },
  };
}

function withGlobals(globals, run) {
  const previous = new Map(Object.keys(globals).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(globals)) {
    Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
  }
  try {
    return run();
  } finally {
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  }
}

// 迷你 DOM：運行庫只需要 querySelectorAll、documentElement 同 click 委派。
function localeNode(dataset = {}, textContent = "", placeholder = null) {
  const attributes = new Map();
  if (placeholder !== null) attributes.set("placeholder", placeholder);
  return {
    dataset,
    textContent,
    setAttribute(name, value) { attributes.set(name, String(value)); },
    getAttribute(name) { return attributes.get(name) ?? null; },
    closest(selector) { return selector === "[data-locale-toggle]" && "localeToggle" in dataset ? this : null; },
  };
}

function localeDom() {
  const toggle = localeNode({ localeToggle: "" }, "简");
  const nav = localeNode({ i18n: "site.nav.arena" }, "試玩賽場");
  const rulesNav = localeNode({ i18n: "site.nav.rules" }, "玩法");
  const nickname = localeNode({ i18nPlaceholder: "site.nickname.default" }, "", "粵拼新星");
  const nodes = [toggle, nav, rulesNav, nickname];
  const listeners = new Map();
  const documentElement = {
    lang: null,
    setAttribute(name, value) { if (name === "lang") this.lang = value; },
    getAttribute(name) { return name === "lang" ? this.lang : null; },
  };
  return {
    documentElement, toggle, nav, rulesNav, nickname,
    document: {
      documentElement,
      addEventListener(type, listener) {
        if (!listeners.has(type)) listeners.set(type, []);
        listeners.get(type).push(listener);
      },
      querySelectorAll(selector) {
        if (selector === "[data-i18n]") return nodes.filter(node => node.dataset.i18n);
        if (selector === "[data-i18n-placeholder]") return nodes.filter(node => node.dataset.i18nPlaceholder);
        if (selector === "[data-locale-toggle]") return nodes.filter(node => "localeToggle" in node.dataset);
        return [];
      },
    },
    click(target) { for (const listener of listeners.get("click") ?? []) listener({ target }); },
  };
}

// 開一個掛咗假 DOM 嘅 tab：i18n 用假 document／storage，app 個 vm 用注入嘅 i18n 實例，
// 而 window 係 app 自己嗰個，令 setLocale 派嘅 canclid-locale 真係傳到 app 嘅監聽器。
function withLocaleEnv({ store = new Map(), i18n: i18nModule = i18n } = {}, run) {
  const dom = localeDom();
  return withGlobals({ document: dom.document, localStorage: localeStorage(store) }, () => {
    const tab = openTab(new Map(), {}, { i18n: i18nModule });
    tab.window.CustomEvent = class CustomEvent {
      constructor(type, init) { this.type = type; Object.assign(this, init ?? {}); }
    };
    tab.window.dispatchEvent = event => { tab.window.fire(event.type, event); return true; };
    return withGlobals({ window: tab.window }, () => {
      try {
        return run(tab, dom);
      } finally {
        i18nModule.setLocale("yue-Hant");
      }
    });
  });
}

test("雙語界面：未設定過嘅話預設繁體，lang、靜態文案同切換掣都係繁體", () => {
  withLocaleEnv({}, (tab, dom) => {
    assert.equal(dom.documentElement.lang, "yue-Hant");
    assert.equal(dom.nav.textContent, "試玩賽場");
    assert.equal(dom.rulesNav.textContent, "玩法");
    assert.equal(dom.nickname.getAttribute("placeholder"), "粵拼新星");
    assert.equal(dom.toggle.textContent, "简");
    assert.equal(dom.toggle.getAttribute("aria-pressed"), "false");
    assert.equal(dom.toggle.getAttribute("aria-label"), "切換简体粤文界面");
    assert.match(tab.get("#flow-note").textContent, /官方三輪/);
    assert.match(tab.get("#start").innerHTML, /開始三輪試玩/);
    assert.match(tab.get("#board-article").textContent, /同篇比較/);
  });
});

test("雙語界面：撳 locale-toggle 轉簡體（靜態＋動態），再撳還原繁體", () => {
  withLocaleEnv({}, (tab, dom) => {
    dom.click(dom.toggle);
    assert.equal(dom.documentElement.lang, "yue-Hans");
    assert.equal(dom.nav.textContent, "试玩赛场");
    assert.equal(dom.rulesNav.textContent, "玩法", "同形字保持原樣");
    assert.equal(dom.nickname.getAttribute("placeholder"), "粤拼新星");
    assert.equal(dom.toggle.textContent, "繁");
    assert.equal(dom.toggle.getAttribute("aria-pressed"), "true");
    assert.equal(dom.toggle.getAttribute("aria-label"), "切換繁體粤語界面");
    // 動態文案：app.mjs 收到 canclid-locale 之後用新語言重畫
    assert.match(tab.get("#flow-note").textContent, /官方三轮/);
    assert.match(tab.get("#start").innerHTML, /开始三轮试玩/);
    assert.match(tab.get("#article-detail").textContent, /示范粤文/);
    assert.match(tab.get("#completed-count").textContent, /音节/);
    assert.match(tab.get("#board-article").textContent, /同篇比较/);

    dom.click(dom.toggle);
    assert.equal(dom.documentElement.lang, "yue-Hant");
    assert.equal(dom.nav.textContent, "試玩賽場");
    assert.equal(dom.nickname.getAttribute("placeholder"), "粵拼新星");
    assert.equal(dom.toggle.textContent, "简");
    assert.match(tab.get("#flow-note").textContent, /官方三輪/);
    assert.match(tab.get("#start").innerHTML, /開始三輪試玩/);
    assert.match(tab.get("#article-detail").textContent, /示範粵文/);
  });
});

test("雙語界面：localStorage 記住咗簡體，下次開站直接出簡體", async () => {
  const fresh = await import("../demo/i18n.mjs?case=app-stored-hans");
  withLocaleEnv({ store: new Map([[localeStorageKey, "yue-Hans"]]), i18n: fresh }, (tab, dom) => {
    assert.equal(dom.documentElement.lang, "yue-Hans");
    assert.equal(dom.nav.textContent, "试玩赛场");
    assert.equal(dom.toggle.textContent, "繁");
    assert.match(tab.get("#flow-note").textContent, /官方三轮/);
    assert.equal(tab.records().length, 0, "語言設定唔會影響本機紀錄");
  });
});
