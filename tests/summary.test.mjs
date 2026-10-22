import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

import * as summaryApi from "../demo/games/summary/summary.mjs";
import {
  FLOW_HISTORY_KEY,
  FLOW_STORAGE_KEY,
  appendFlowHistory,
  clearFlow,
  flowTotals,
  readFlow,
  readFlowHistory,
  saveRoundResult,
  startFlow,
} from "../demo/games/flow.mjs";
import {
  SUMMARY_NOTE,
  formatCounts,
  formatPercent,
  formatScore,
  formatThreshold,
  formatWindow,
  historyRows,
  loadSummary,
  playerLine,
  roundRows,
  totalsLine,
} from "../demo/games/summary/summary.mjs";

const html = readFileSync(new URL("../demo/games/summary/index.html", import.meta.url), "utf8");
const domSource = readFileSync(new URL("../demo/games/summary/summary-dom.mjs", import.meta.url), "utf8");

function fakeStorage() {
  const map = new Map();
  return {
    map,
    getItem: key => (map.has(key) ? map.get(key) : null),
    setItem(key, value) { map.set(key, String(value)); },
    removeItem(key) { map.delete(key); },
    read: key => (map.has(key) ? JSON.parse(map.get(key)) : null),
  };
}

// flow.mjs 喺呼叫嗰刻先讀 globalThis 嘅 storage，所以測試可以暫時掛兩個假嘅上去。
function withStorages(run) {
  const session = fakeStorage();
  const local = fakeStorage();
  const previous = ["sessionStorage", "localStorage"].map(key =>
    [key, Object.getOwnPropertyDescriptor(globalThis, key)]);
  for (const [key, storage] of [["sessionStorage", session], ["localStorage", local]]) {
    Object.defineProperty(globalThis, key, { value: storage, configurable: true, writable: true });
  }
  try {
    return run({ session, local });
  } finally {
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  }
}

// 三個輪次都寫入嘅完成流程：單字 27/30、詞組 60/75、篇章 120/128。
function completedFlow() {
  startFlow(1000, { name: "阿甲", group: "mobile" });
  let flow = readFlow();
  flow = saveRoundResult(flow, "single", { correct: 27, submitted: 30, seconds: 90 });
  flow = saveRoundResult(flow, "words", { correct: 60, submitted: 75, seconds: 120 });
  flow = saveRoundResult(flow, "passage", { correct: 120, submitted: 128, seconds: 240 });
  return flow;
}

const rowOf = (rows, roundId) => rows.find(row => row.roundId === roundId);

test("roundRows：三輪齊全時逐輪有數，缺輪都會出一行", () => {
  const empty = roundRows(null);
  assert.deepEqual(empty.map(row => row.roundId), ["single", "words", "passage"]);
  assert.deepEqual(empty.map(row => row.label), ["第 1 輪 · 單字", "第 2 輪 · 詞組", "第 3 輪 · 篇章"]);
  assert.deepEqual(empty.map(row => row.done), [false, false, false]);
  assert.deepEqual(empty.map(row => row.threshold), [0.9, 0.9, 0.85]);
  assert.deepEqual(empty.map(row => row.timed), [true, true, false]);
  assert.deepEqual(empty.map(row => row.windowSeconds), [90, 120, null]);
  assert.equal(formatWindow(empty[0]), "未完成");
  assert.equal(formatScore(empty[0]), "未完成");
  assert.equal(formatThreshold(empty[0]), "—");
  assert.equal(formatCounts(empty[0]), "—");

  withStorages(() => {
    const rows = roundRows(completedFlow());
    assert.deepEqual(rows.map(row => row.done), [true, true, true]);
    const single = rowOf(rows, "single");
    assert.equal(single.correct, 27);
    assert.equal(single.submitted, 30);
    assert.equal(single.seconds, 90);
    assert.equal(single.officialScore, 16.2);
    assert.equal(single.meetsThreshold, true);
    assert.equal(formatWindow(single), "固定 90 秒計分窗");
    assert.equal(formatCounts(single), "27 / 30");
    assert.equal(formatPercent(single.accuracy), "90%");
    assert.equal(formatScore(single), "16.2");
    assert.equal(formatThreshold(single), "達標（90%）");

    const words = rowOf(rows, "words");
    assert.equal(formatWindow(words), "固定 120 秒計分窗");
    assert.equal(formatThreshold(words), "未達 90%");
    assert.equal(formatScore(words), "24.0");

    const passage = rowOf(rows, "passage");
    assert.equal(formatWindow(passage), "用時 04:00.0");
    assert.equal(formatPercent(passage.accuracy), "94%");
    assert.equal(formatThreshold(passage), "達標（85%）");
  });
});

test("playerLine／totalsLine／formatPercent：缺資料一律顯示 —，唔會出 NaN", () => {
  assert.equal(playerLine(null), "");
  assert.equal(formatPercent(null), "—");
  assert.equal(formatPercent(undefined), "—");
  assert.equal(formatPercent(0), "0%");
  assert.equal(totalsLine(null), "三輪都未開始。");
  assert.equal(totalsLine(flowTotals({})), "三輪都未開始。");

  withStorages(() => {
    const flow = completedFlow();
    assert.match(playerLine(flow), /阿甲 · 手機組 · 開始 /);
    assert.doesNotMatch(playerLine(flow), /NaN/);
    assert.equal(playerLine({ version: 1, startedAt: 1000, rounds: {} }), `開始 ${summaryApi.formatWhen(1000)}`);
    assert.equal(playerLine({ version: 1, startedAt: "x", rounds: {} }), "開始 —");

    const totals = flowTotals(flow.rounds);
    assert.equal(totals.rounds, 3);
    assert.equal(totals.complete, true);
    assert.equal(totals.correct, 207);
    assert.equal(totals.submitted, 233);
    assert.ok(Math.abs(totals.officialScore - (16.2 + 24 + 28.125)) < 1e-9);
    const line = totalsLine(totals);
    assert.match(line, /正式分 68\.3/);
    assert.match(line, /正確 207 \/ 已交 233/);
    assert.match(line, /三輪齊全/);
    assert.match(line, /唔係正式結算/);

    const partial = flowTotals({ single: flow.rounds.single });
    assert.match(totalsLine(partial), /仲有 2 輪未完成/);
  });
});

test("historyRows：最近一條行先，逐輪列正式分，缺輪用 —", () => {
  assert.deepEqual(historyRows(), []);
  const rows = historyRows([
    { at: 1000, startedAt: 1, rounds: { single: { officialScore: 12.34, threshold: 0.9 } }, totals: { complete: false } },
    { at: 2000, startedAt: 2, rounds: { single: { officialScore: 20 }, words: { officialScore: 30 }, passage: { officialScore: 40 } }, totals: { complete: true } },
  ]);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].at, 2000, "最近一條排最前");
  assert.equal(rows[0].complete, true);
  assert.equal(rows[0].scores, "單字 20.0 · 詞組 30.0 · 篇章 40.0");
  assert.equal(rows[1].scores, "單字 12.3 · 詞組 — · 篇章 —");
  assert.equal(rows[1].complete, false);
  assert.equal(rows[1].when, summaryApi.formatWhen(1000));
});

test("loadSummary：完成嘅流程寫入歷史一次，未完成唔寫，壞資料唔爆", () => {
  withStorages(({ session, local }) => {
    const empty = loadSummary();
    assert.equal(empty.flow, null);
    assert.equal(empty.totals.rounds, 0);
    assert.deepEqual(empty.history, []);
    assert.equal(local.map.has(FLOW_HISTORY_KEY), false);

    // 未完成（得兩輪）：唔會寫歷史
    startFlow(1000);
    let flow = readFlow();
    flow = saveRoundResult(flow, "single", { correct: 27, submitted: 30, seconds: 90 });
    saveRoundResult(flow, "words", { correct: 60, submitted: 75, seconds: 120 });
    const partial = loadSummary();
    assert.equal(partial.totals.complete, false);
    assert.equal(partial.rows.filter(row => row.done).length, 2);
    assert.equal(local.map.has(FLOW_HISTORY_KEY), false, "未完成唔入歷史");

    // 完成之後：寫入歷史，而且再開都唔會重複
    saveRoundResult(readFlow(), "passage", { correct: 120, submitted: 128, seconds: 240 });
    const done = loadSummary();
    assert.equal(done.totals.complete, true);
    assert.equal(done.history.length, 1);
    assert.match(done.history[0].scores, /^單字 16\.2 · 詞組 24\.0 · 篇章 28\.1$/);
    assert.equal(readFlowHistory().length, 1);
    loadSummary();
    loadSummary({ record: false });
    assert.equal(readFlowHistory().length, 1, "同一次流程唔會重複記錄");

    session.setItem(FLOW_STORAGE_KEY, "{ not json");
    const broken = loadSummary();
    assert.equal(broken.flow, null);
    assert.equal(broken.history.length, 1, "歷史唔會因為流程壞咗而消失");
  });
});

test("成績卡頁面骨架：引用自己嘅資源、有返試玩賽場同開始流程嘅連結", () => {
  assert.match(html, /<link rel="icon" href="\.\.\/\.\.\/favicon\.svg" type="image\/svg\+xml">/);
  assert.match(html, /<script src="\.\/summary-dom\.mjs" type="module"><\/script>/);
  assert.match(html, /href="\.\.\/\.\.\/index\.html"/, "要連返試玩賽場");
  assert.match(html, /href="\.\.\/rocks\/\?flow=1"/, "要可以開始流程");
  assert.match(html, /官方三輪試玩 · 成績卡/);
  assert.match(html, /<p id="summary-note" class="note"><\/p>/, "底部註明由 summary.mjs 提供");

  const ids = [...domSource.matchAll(/\$\("#([a-z-]+)"\)/g)].map(match => match[1]);
  assert.ok(ids.length > 5, `只搵到 ${ids.length} 個 selector`);
  for (const id of new Set(ids)) assert.ok(html.includes(`id="${id}"`), `index.html 冇 id="${id}"`);
  for (const id of ["empty-card", "summary-card", "history-card", "round-rows", "history-list"]) {
    assert.ok(ids.includes(id), `summary-dom.mjs 冇用 #${id}`);
  }
});

// --- DOM 層：用 vm + 迷你 DOM 驅動真嘅 summary-dom.mjs ----------------------

const DOM_SOURCE = domSource.replace(/^import[\s\S]*?from\s+"[^"]+";\n/gm, "");

function summaryTab() {
  const elements = new Map();
  const listeners = new Map();

  const makeElement = (tagName = "div") => {
    const classes = new Set();
    const attributes = new Map();
    const own = new Map();
    const node = {
      tagName, hidden: false, textContent: "", className: "", children: [],
      classList: {
        add: (...names) => names.forEach(name => classes.add(name)),
        remove: (...names) => names.forEach(name => classes.delete(name)),
        contains: name => classes.has(name),
        toggle(name, on) { if (on ?? !classes.has(name)) classes.add(name); else classes.delete(name); },
      },
      setAttribute: (name, value) => attributes.set(name, String(value)),
      getAttribute: name => attributes.get(name) ?? null,
      append(...items) { node.children.push(...items); },
      replaceChildren(...items) { node.children = items; },
      addEventListener(type, listener) {
        if (!own.has(type)) own.set(type, []);
        own.get(type).push(listener);
      },
      fire(type, event = {}) {
        event.target ??= node;
        (own.get(type) ?? []).forEach(listener => listener(event));
      },
    };
    return node;
  };

  const get = selector => {
    if (!elements.has(selector)) elements.set(selector, makeElement());
    return elements.get(selector);
  };
  // index.html 入面三張卡本來都係 hidden，迷你 DOM 照樣開場。
  for (const id of ["#empty-card", "#summary-card", "#history-card"]) get(id).hidden = true;

  vm.runInContext(DOM_SOURCE, vm.createContext({
    ...summaryApi, clearFlow,
    document: { querySelector: get, createElement: makeElement },
  }), { filename: "demo/games/summary/summary-dom.mjs" });

  return {
    get,
    text(selector) {
      const node = get(selector);
      return node.textContent + node.children.map(child => child.textContent).join("");
    },
  };
}

const rowCells = row => row.children.map(cell => cell.textContent);
const listItems = tab => tab.get("#history-list").children.map(item => item.children.map(cell => cell.textContent));

test("成績卡 DOM：冇流程就出空狀態，唔會出成績表", () => {
  withStorages(() => {
    const tab = summaryTab();
    assert.equal(tab.get("#empty-card").hidden, false);
    assert.equal(tab.get("#summary-card").hidden, true);
    assert.equal(tab.get("#history-card").hidden, true);
    assert.deepEqual(tab.get("#round-rows").children, []);
  });
});

test("成績卡 DOM：三輪齊全時出三行同歷史，撳「返回試玩賽場」會清流程", () => {
  withStorages(({ local }) => {
    completedFlow();
    const tab = summaryTab();
    assert.equal(tab.get("#summary-card").hidden, false);
    assert.equal(tab.get("#empty-card").hidden, true);
    assert.match(tab.get("#player-line").textContent, /阿甲 · 手機組/);
    assert.equal(tab.get("#summary-note").textContent, SUMMARY_NOTE);
    assert.match(tab.get("#totals-line").textContent, /三輪齊全/);

    const rows = tab.get("#round-rows").children;
    assert.deepEqual(rows.map(rowCells), [
      ["第 1 輪 · 單字", "固定 90 秒計分窗", "27 / 30", "90%", "16.2", "達標（90%）"],
      ["第 2 輪 · 詞組", "固定 120 秒計分窗", "60 / 75", "80%", "24.0", "未達 90%"],
      ["第 3 輪 · 篇章", "用時 04:00.0", "120 / 128", "94%", "28.1", "達標（85%）"],
    ]);
    assert.deepEqual(rows.map(row => row.className), ["", "", ""]);

    assert.equal(tab.get("#history-card").hidden, false);
    const [entry] = local.read(FLOW_HISTORY_KEY);
    assert.deepEqual(listItems(tab), [[
      summaryApi.formatWhen(entry.at),
      "單字 16.2 · 詞組 24.0 · 篇章 28.1",
      "三輪齊全",
    ]]);

    // 再開一次：唔會重複記錄，亦唔會多一行。
    const again = summaryTab();
    assert.equal(again.get("#history-list").children.length, 1);
    assert.equal(local.read(FLOW_HISTORY_KEY).length, 1);

    tab.get("#back").fire("click");
    assert.equal(readFlow(), null, "返回試玩賽場會清流程");
    assert.equal(local.read(FLOW_HISTORY_KEY).length, 1, "歷史唔會被清");
  });
});

test("成績卡 DOM：缺輪照出一行「未完成」，撳「再玩一次流程」會清流程", () => {
  withStorages(({ session }) => {
    startFlow(1000);
    const flow = readFlow();
    saveRoundResult(flow, "single", { correct: 27, submitted: 30, seconds: 90 });
    const tab = summaryTab();
    assert.equal(tab.get("#summary-card").hidden, false);
    assert.equal(tab.get("#history-card").hidden, true, "未完成就唔會入歷史");
    assert.match(tab.get("#totals-line").textContent, /仲有 2 輪未完成/);

    const rows = tab.get("#round-rows").children;
    assert.equal(rows.length, 3);
    assert.deepEqual(rowCells(rows[0]), ["第 1 輪 · 單字", "固定 90 秒計分窗", "27 / 30", "90%", "16.2", "達標（90%）"]);
    assert.deepEqual(rowCells(rows[1]), ["第 2 輪 · 詞組", "未完成", "—", "—", "未完成", "—"]);
    assert.deepEqual(rowCells(rows[2]), ["第 3 輪 · 篇章", "未完成", "—", "—", "未完成", "—"]);
    assert.deepEqual(rows.map(row => row.className), ["", "missing", "missing"]);

    tab.get("#again").fire("click");
    assert.equal(readFlow(), null, "再玩一次流程會清流程");
    assert.equal(session.map.has(FLOW_STORAGE_KEY), false);
  });
});

test("成績卡 DOM：有歷史但冇流程（例如清咗流程之後）照樣列最近流程", () => {
  withStorages(() => {
    const flow = completedFlow();
    appendFlowHistory(flow);
    clearFlow();
    const tab = summaryTab();
    assert.equal(tab.get("#empty-card").hidden, false, "冇流程就出空狀態");
    assert.equal(tab.get("#history-card").hidden, false, "歷史照樣顯示");
    assert.equal(tab.get("#history-list").children.length, 1);
    assert.equal(tab.get("#history-list").children[0].children[1].textContent,
      "單字 16.2 · 詞組 24.0 · 篇章 28.1");
  });
});
