import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { webcrypto } from "node:crypto";
import vm from "node:vm";
import * as engine from "../demo/engine.mjs";
import * as questions from "../demo/questions.mjs";

const storageKey = "canclid-contest-demo-v1";
const source = readFileSync(new URL("../demo/app.mjs", import.meta.url), "utf8")
  .replace(/^import .*;\n/gm, "");

// Only model the DOM operations these persistence and view regressions use.
function element() {
  const listeners = new Map();
  return {
    value: "", textContent: "", innerHTML: "", hidden: false,
    children: [], dataset: {}, style: {},
    classList: { add() {}, remove() {}, toggle() {} },
    setAttribute() {}, removeAttribute() {}, focus() {}, select() {}, scrollIntoView() {},
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
  const elements = new Map();
  const get = selector => {
    if (!elements.has(selector)) elements.set(selector, element());
    return elements.get(selector);
  };
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
    confirm: () => true,
  });
  vm.runInContext(source, context, { filename: "demo/app.mjs" });
  const evaluate = expression => vm.runInContext(expression, context);
  return {
    get, evaluate,
    setTime(value) { now = value; },
    records: () => JSON.parse(evaluate("JSON.stringify(records)")),
    storageChanged() {
      window.fire("storage", { key: storageKey, newValue: store.get(storageKey) ?? null });
    },
  };
}

function beginRound(tab, name, at = 0) {
  tab.setTime(at);
  tab.get("#nickname").value = name;
  tab.evaluate("startRound()");
  tab.setTime(at + 3000);
  tab.evaluate("tick()");
  tab.get("#answer").value = questions.flattenQuestions()[0].answers[0];
  tab.evaluate("submit()");
}

function completeRound(tab, name, at = 0) {
  beginRound(tab, name, at);
  tab.setTime(at + 33000);
  tab.evaluate("tick()");
}

const names = records => records.map(record => record.name);
const persisted = store => JSON.parse(store.get(storageKey) || "[]");

test("finishing while the leaderboard is open immediately displays the new result", () => {
  const tab = openTab();
  beginRound(tab, "Alpha");
  tab.evaluate('showView("leaderboard")');
  assert.doesNotMatch(textOf(tab.get("#local-board")), /Alpha/);
  tab.setTime(33000);
  tab.evaluate("tick()");
  assert.match(textOf(tab.get("#local-board")), /Alpha/);
  assert.deepEqual(names(tab.records()), ["Alpha"]);
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
