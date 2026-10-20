import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { webcrypto } from "node:crypto";
import vm from "node:vm";
import * as engine from "../demo/engine.mjs";
import * as questions from "../demo/questions.mjs";

const storageKey = "canclid-contest-demo-v2";
const tokens = questions.flattenQuestions();
const source = readFileSync(new URL("../demo/app.mjs", import.meta.url), "utf8")
  .replace(/^import .*;\n/gm, "");

// Model the DOM operations used by input, focus and persistence regressions.
function element() {
  const listeners = new Map();
  const classes = new Set();
  return {
    value: "", textContent: "", innerHTML: "", hidden: false,
    children: [], dataset: {}, style: {}, scrollLeft: 0, scrollTop: 0,
    focusCalls: 0, scrollCalls: 0,
    get className() { return [...classes].join(" "); },
    set className(value) { classes.clear(); value.split(/\s+/).filter(Boolean).forEach(name => classes.add(name)); },
    classList: {
      add(...names) { names.forEach(name => classes.add(name)); },
      remove(...names) { names.forEach(name => classes.delete(name)); },
      contains(name) { return classes.has(name); },
      toggle(name, selected) { if (selected ?? !classes.has(name)) classes.add(name); else classes.delete(name); },
    },
    setAttribute() {}, removeAttribute() {}, select() {},
    focus() { this.focusCalls++; this.fire("focus"); },
    blur() { this.fire("blur"); },
    scrollIntoView() { this.scrollCalls++; },
    getBoundingClientRect() { return { left: 0, top: 0, width: 52, height: 80 }; },
    addEventListener(type, listener) { listeners.set(type, listener); },
    fire(type, event = {}) { listeners.get(type)?.(event); },
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
    assert.ok(!["#submit-answer", ".answer-wrap"].includes(selector), `Removed control queried: ${selector}`);
    if (!elements.has(selector)) elements.set(selector, element());
    return elements.get(selector);
  };
  get("#answer").disabled = true;
  const views = ["arena", "leaderboard", "rules"].map(name => {
    const view = get(`#${name}-view`);
    view.id = `${name}-view`;
    view.hidden = name !== "arena";
    return view;
  });
  const window = element();
  class Clock extends Date {
    static now() { return now; }
  }
  const context = vm.createContext({
    ...engine, ...questions, crypto: webcrypto, Date: Clock, window,
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
    get, evaluate,
    setTime(value) { now = value; },
    flushTimeouts() { timeouts.splice(0).forEach(callback => callback()); },
    records: () => JSON.parse(evaluate("JSON.stringify(records)")),
    storageChanged() {
      window.fire("storage", { key: storageKey, newValue: store.get(storageKey) ?? null });
    },
  };
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
  tab.get("#answer").value = tokens[0].answers[0];
  tab.evaluate("submit()");
}

function finishRemaining(tab, at = 0) {
  for (let index = tab.evaluate("run.index"); index < tokens.length; index++) {
    tab.setTime(at + 3000 + (index + 1) * 1000);
    tab.get("#answer").value = tokens[index].answers[0];
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
const draft = tab => currentGlyph(tab)?.children[0].textContent;

test("typing shows Jyutping above the current character without replacing or scrolling it", () => {
  const tab = openTab();
  readyRound(tab, "Alpha");
  const glyph = currentGlyph(tab);
  const scrollCalls = glyph.scrollCalls;
  assert.equal(glyph.children[1].textContent, tokens[0].hanzi);
  assert.equal(glyph.children[0].className, "glyph-answer");
  assert.equal(glyph.children[1].className, "glyph-hanzi");
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
  assert.equal(glyphs(tab)[0].children[0].textContent, tokens[0].answers[0]);
  assert.equal(glyphs(tab)[0].classList.contains("correct"), true);
  assert.equal(draft(tab), "");
});

test("empty submissions clear the displayed draft without advancing", () => {
  const tab = openTab();
  readyRound(tab, "Alpha");
  tab.get("#answer").value = "gam";
  tab.get("#answer").fire("input", {});
  assert.equal(draft(tab), "gam");
  tab.get("#answer").value = "  ";
  tab.get("#answer").fire("keydown", { key: "Enter", preventDefault() {} });
  assert.equal(tab.get("#answer").value, "");
  assert.equal(draft(tab), "");
  assert.equal(tab.evaluate("run.index"), 0);
});

test("composition updates the visible draft but does not submit on composition keys or commits", () => {
  const tab = openTab();
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
  answer.value = "gam ";
  answer.fire("compositionend");
  answer.fire("input", { inputType: "insertCompositionText", isComposing: false });
  assert.equal(draft(tab), "gam ");
  assert.equal(tab.evaluate("run.index"), 0);
  answer.fire("keydown", { key: "Enter", preventDefault() {} });
  assert.equal(tab.evaluate("run.index"), 1);
  assert.equal(tab.evaluate("run.answers[0].answer"), "gam");
});

test("mobile spaces submit through beforeinput or the uncancelable input fallback", () => {
  const tab = openTab();
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
  answer.fire("beforeinput", { inputType: "insertText", data: " ", cancelable: false, preventDefault() { assert.fail("uncancelable"); } });
  assert.equal(tab.evaluate("run.index"), 1);
  answer.value += " ";
  answer.fire("input", { inputType: "insertText", data: " " });
  assert.equal(tab.evaluate("run.index"), 2);
  assert.equal(answer.value, "");
  assert.equal(glyphs(tab)[1].children[0].textContent, tokens[1].answers[0]);
});

test("clicking the passage or returning to the arena restores focus without intercepting Tab", () => {
  const tab = openTab();
  const answer = tab.get("#answer");
  const surface = tab.get("#typing-surface");
  surface.fire("click");
  assert.equal(answer.focusCalls, 0);
  readyRound(tab, "Alpha");
  assert.equal(surface.classList.contains("focused"), true);
  answer.blur();
  assert.equal(surface.classList.contains("focused"), false);
  surface.fire("click");
  assert.equal(surface.classList.contains("focused"), true);
  assert.ok(Number.isFinite(parseFloat(answer.style.left)));
  assert.ok(Number.isFinite(parseFloat(answer.style.top)));
  tab.evaluate('showView("rules")');
  answer.blur();
  const previousFocus = answer.focusCalls;
  tab.evaluate('showView("arena")');
  assert.equal(answer.focusCalls, previousFocus + 1);
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
  tab.get("#answer").value = "zzz";
  tab.evaluate("submit()");
  assert.equal(tab.evaluate("run.index"), 1);
  assert.equal(tab.get("#answer").value, "");
  assert.equal(tab.evaluate("getMetrics(run, Date.now()).correct"), 0);
  assert.equal(tab.evaluate("getMetrics(run, Date.now()).errors"), 1);
  assert.equal(glyphs(tab)[0].children[0].textContent, "zzz");
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
    tab.get("#answer").value = index === sentenceEnd ? "zzz" : tokens[index].answers[0];
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
  tab.get("#answer").value = tokens[sentenceEnd].answers[0];
  tab.evaluate("submit()");
  assert.equal(tab.evaluate("run.index"), sentenceEnd + 1);
  assert.equal(tab.evaluate("getMetrics(run, Date.now()).correct"), sentenceEnd + 1);
  assert.equal(tab.evaluate("getMetrics(run, Date.now()).accuracy"), 100);
});

test("a mobile beforeinput-only Backspace restores the previous answer from an empty field", () => {
  const tab = openTab();
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
