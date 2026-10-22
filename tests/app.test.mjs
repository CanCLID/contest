import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { webcrypto } from "node:crypto";
import vm from "node:vm";
import * as engine from "../demo/engine.mjs";
import * as flow from "../demo/games/flow.mjs";
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
  return {
    tagName: tagName.toUpperCase(),
    get value() { return value; },
    set value(next) { value = next; this.selectionStart = this.selectionEnd = value.length; },
    textContent: "", innerHTML: "", hidden: false, selectionStart: 0, selectionEnd: 0,
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

function openTab(store = new Map(), failures = {}) {
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
  const location = { href: "" };
  class Clock extends Date {
    static now() { return now; }
  }
  const context = vm.createContext({
    ...engine, ...questions, ...flow, crypto: webcrypto, Date: Clock, window, location,
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
    get, evaluate, location,
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
