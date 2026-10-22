import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  FLOW_HISTORY_KEY,
  FLOW_HISTORY_LIMIT,
  FLOW_ROUNDS,
  FLOW_ROUTES,
  FLOW_STORAGE_KEY,
  FLOW_VERSION,
  appendFlowHistory,
  clearFlow,
  flowGameHref,
  flowHref,
  flowNextHref,
  flowNextLabel,
  flowNextRound,
  flowRoundLabel,
  flowRoundPath,
  flowRoundResult,
  flowTotals,
  normalizeRoundResult,
  readFlow,
  readFlowHistory,
  saveRoundResult,
  startFlow,
} from "../demo/games/flow.mjs";
import { OFFICIAL_ROUND_ORDER, OFFICIAL_ROUNDS } from "../demo/games/official.mjs";
import { getLocale, setLocale } from "../demo/i18n.mjs";

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
function withStorage(run) {
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

const round = (correct, submitted, seconds) => ({ correct, submitted, seconds });

test("流程輪次由 official.mjs 推導：次序、標籤、時限同門檻", () => {
  assert.deepEqual(FLOW_ROUNDS.map(item => item.id), ["single", "words", "passage"]);
  assert.deepEqual(FLOW_ROUNDS.map(item => item.id), OFFICIAL_ROUND_ORDER);
  assert.deepEqual(FLOW_ROUNDS.map(item => item.label), ["單字", "詞組", "篇章"]);
  assert.deepEqual(FLOW_ROUNDS.map(item => item.game), ["rocks", "chain", "ghost"]);
  assert.deepEqual(FLOW_ROUNDS.map(item => item.durationSeconds), [90, 120, null]);
  assert.deepEqual(FLOW_ROUNDS.map(item => item.threshold), [0.9, 0.9, 0.85]);
  assert.deepEqual(FLOW_ROUNDS.map(item => item.index), [0, 1, 2]);
  for (const item of FLOW_ROUNDS) {
    assert.equal(item.threshold, OFFICIAL_ROUNDS[item.id].threshold);
  }
  assert.equal(FLOW_VERSION, 1);
  assert.equal(FLOW_STORAGE_KEY, "canclid-contest-official-flow");
  assert.equal(FLOW_HISTORY_KEY, "canclid-contest-official-flow-history");
  assert.equal(FLOW_HISTORY_LIMIT, 20);
});

test("路由：三個起點各自啱用，未知輪次返回 null", () => {
  assert.deepEqual(FLOW_ROUTES, {
    single: "./rocks/?flow=1",
    words: "./chain/?flow=1",
    passage: "./ghost/?flow=1",
    summary: "./summary/",
  });
  assert.equal(flowRoundPath("single"), "./rocks/?flow=1");
  assert.equal(flowRoundPath("summary"), "./summary/");
  assert.equal(flowHref("single"), "./games/rocks/?flow=1");
  assert.equal(flowHref("summary"), "./games/summary/");
  assert.equal(flowGameHref("words"), "../chain/?flow=1");
  assert.equal(flowGameHref("summary"), "../summary/");
  for (const helper of [flowRoundPath, flowHref, flowGameHref]) {
    assert.equal(helper("bogus"), null);
    assert.equal(helper(undefined), null);
    assert.equal(helper("toString"), null, "唔可以撞到 Object.prototype 嘅屬性");
  }
  assert.equal(flowNextRound("single"), "words");
  assert.equal(flowNextRound("words"), "passage");
  assert.equal(flowNextRound("passage"), "summary");
  assert.equal(flowNextRound("bogus"), null);
  assert.equal(flowNextHref("single"), "../chain/?flow=1");
  assert.equal(flowNextHref("words"), "../ghost/?flow=1");
  assert.equal(flowNextHref("passage"), "../summary/");
  assert.equal(flowNextLabel("single"), "前往第 2 輪：詞組 →");
  assert.equal(flowNextLabel("words"), "前往第 3 輪：篇章 →");
  assert.equal(flowNextLabel("passage"), "查看三輪成績 →");
  assert.equal(flowNextLabel("bogus"), "");
  assert.equal(flowRoundLabel("words"), "官方流程第 2 輪：詞組");
  assert.equal(flowRoundLabel("bogus"), "");
});

test("冇 storage 嘅環境讀寫都安全，唔會 throw", () => {
  assert.equal(readFlow(), null);
  assert.equal(readFlowHistory().length, 0);
  assert.equal(saveRoundResult(null, "single", round(1, 1, 90)), null);
  assert.equal(clearFlow(), false);
});

test("startFlow 開新流程、記低暱稱同組別，重開會覆蓋舊流程", () => {
  withStorage(({ session }) => {
    const started = startFlow(1000, { name: "  阿甲  ", group: "mobile" });
    assert.deepEqual(started, {
      version: 1, startedAt: 1000, rounds: {}, player: { name: "阿甲", group: "mobile" },
    });
    assert.deepEqual(session.read(FLOW_STORAGE_KEY), started);
    assert.deepEqual(readFlow(), started);

    assert.deepEqual(startFlow(2000), { version: 1, startedAt: 2000, rounds: {} });
    assert.deepEqual(readFlow(), { version: 1, startedAt: 2000, rounds: {} }, "重開覆蓋舊流程");

    assert.ok(Number.isFinite(startFlow(NaN).startedAt), "唔係有限數字就退回 Date.now()");
    assert.ok(Number.isFinite(readFlow().startedAt));
    assert.deepEqual(startFlow(3000, { name: "甲", group: "tablet" }).player, { name: "甲", group: "desktop" },
      "壞組別退回電腦組");
    assert.deepEqual(startFlow(3000, { name: "x".repeat(40) }).player.name.length, 16, "暱稱上限 16 字");
    assert.equal(startFlow(3000, { group: 7 }).player, undefined, "冇有效資料就唔寫 player");
    assert.equal(startFlow(3000, null).player, undefined);
  });
});

test("saveRoundResult 只認版本 1 嘅流程物件，冇流程就唔會無中生有", () => {
  withStorage(({ session }) => {
    assert.equal(saveRoundResult(null, "single", round(1, 1, 90)), null);
    assert.equal(saveRoundResult({ version: 2, startedAt: 1, rounds: {} }, "single", round(1, 1, 90)), null);
    assert.equal(saveRoundResult({ version: 1 }, "single", round(1, 1, 90)), null);
    assert.equal(saveRoundResult({ version: 1, startedAt: 1, rounds: {} }, "single", null), null);
    assert.equal(saveRoundResult({ version: 1, startedAt: 1, rounds: {} }, "single", round(1.5, 2, 90)), null,
      "非整數計數唔收");
    assert.equal(saveRoundResult({ version: 1, startedAt: 1, rounds: {} }, "single", round(1, 1, -1)), null);
    assert.equal(saveRoundResult({ version: 1, startedAt: 1, rounds: {} }, "single", round(1, 1, NaN)), null);
    assert.equal(session.map.size, 0, "全部唔合格嘅寫入都唔會留低垃圾");

    startFlow(1000);
    const saved = saveRoundResult(readFlow(), "single", round(27, 30, 90));
    assert.deepEqual(saved.rounds.single, {
      correct: 27,
      submitted: 30,
      seconds: 90,
      accuracy: 0.9,
      correctPerMinute: 18,
      officialScore: 16.2,
      meetsThreshold: true,
      threshold: 0.9,
    });
    assert.deepEqual(readFlow(), saved, "寫入之後即刻讀得返");

    const both = saveRoundResult(saved, "words", round(60, 75, 120));
    assert.deepEqual(Object.keys(both.rounds), ["single", "words"]);
    assert.equal(both.rounds.single.correct, 27, "舊輪次唔會被覆蓋");
    assert.equal(both.rounds.words.seconds, 120);
    assert.equal(both.rounds.words.threshold, 0.9);
    assert.equal(both.rounds.words.officialScore, 24, "30 × 0.8：每分鐘正確音節 × 準確度");
    assert.equal(both.rounds.words.meetsThreshold, false);

    const passage = saveRoundResult(both, "passage", round(120, 128, 240));
    assert.equal(passage.rounds.passage.threshold, 0.85);
    assert.equal(passage.rounds.passage.seconds, 240);
    assert.ok(passage.rounds.passage.meetsThreshold);

    assert.throws(() => saveRoundResult(passage, "bogus", round(1, 1, 1)), TypeError);
    assert.throws(() => normalizeRoundResult("bogus", round(1, 1, 1)), TypeError);
  });
});

test("saveRoundResult 保留 player，同時重算數值、剔除垃圾輪次", () => {
  withStorage(() => {
    startFlow(5000, { name: "阿甲", group: "desktop" });
    const tampered = {
      version: 1,
      startedAt: 5000,
      player: { name: "阿甲", group: "desktop" },
      rounds: {
        single: { correct: 10, submitted: 10, seconds: 90, officialScore: 99999, accuracy: 1, threshold: 0.1 },
        passage: { correct: "nope" },
      },
    };
    const saved = saveRoundResult(tampered, "single", round(10, 10, 90));
    assert.ok(Math.abs(saved.rounds.single.officialScore - 20 / 3) < 1e-9,
      `officialScore 由 correct／submitted／seconds 重算（實際 ${saved.rounds.single.officialScore}）`);
    assert.equal(saved.rounds.single.threshold, 0.9, "門檻跟輪次，唔跟輸入");
    assert.equal(saved.rounds.passage, undefined, "壞輪次唔會入 store");
    assert.deepEqual(saved.player, { name: "阿甲", group: "desktop" });
  });
});

test("readFlow 抵擋壞資料：版本、開始時間同輪次內容", () => {
  withStorage(({ session }) => {
    const write = value => session.setItem(FLOW_STORAGE_KEY, JSON.stringify(value));
    write({ version: 2, startedAt: 1, rounds: {} });
    assert.equal(readFlow(), null, "版本唔啱");
    write({ version: 1, startedAt: "yesterday", rounds: {} });
    assert.equal(readFlow(), null, "開始時間唔係數字");
    write({ version: 1, startedAt: 1, rounds: "nope" });
    assert.deepEqual(readFlow(), { version: 1, startedAt: 1, rounds: {} });
    write({
      version: 1,
      startedAt: 1,
      rounds: {
        single: { correct: 1, submitted: 2, seconds: 90 },
        words: { correct: -1, submitted: 2, seconds: 120 },
        passage: null,
      },
    });
    const flow = readFlow();
    assert.deepEqual(Object.keys(flow.rounds), ["single"]);
    assert.equal(flow.rounds.single.accuracy, 0.5);
    assert.equal(flow.rounds.single.meetsThreshold, false);

    session.setItem(FLOW_STORAGE_KEY, "{ not json");
    assert.equal(readFlow(), null, "壞 JSON 唔會 throw");
    session.setItem(FLOW_STORAGE_KEY, JSON.stringify([1, 2, 3]));
    assert.equal(readFlow(), null);
  });
});

test("clearFlow 清走流程，但唔會掂歷史紀錄", () => {
  withStorage(({ session, local }) => {
    startFlow(1000, { name: "阿甲", group: "mobile" });
    appendFlowHistory(readFlow());
    assert.equal(clearFlow(), true);
    assert.equal(readFlow(), null);
    assert.equal(session.map.has(FLOW_STORAGE_KEY), false);
    assert.equal(readFlowHistory().length, 1, "歷史留低");
    assert.ok(local.map.has(FLOW_HISTORY_KEY));
  });
});

test("flowRoundResult：定時輪用固定計分窗，篇章用實際完成用時", () => {
  const rocks = flowRoundResult("single", { correct: 27, submitted: 30, scoredSeconds: 90, elapsedSeconds: 88 });
  assert.equal(rocks.seconds, 90);
  assert.equal(rocks.correctPerMinute, 18);
  assert.equal(rocks.threshold, 0.9);
  assert.equal(rocks.meetsThreshold, true);

  const fallback = flowRoundResult("words", { correct: 12, submitted: 12, elapsedSeconds: 40 });
  assert.equal(fallback.seconds, 120, "定時輪冇 scoredSeconds 就用輪次時限");
  assert.equal(fallback.correctPerMinute, 6);
  assert.equal(fallback.officialScore, 6);

  const passage = flowRoundResult("passage", { correct: 120, submitted: 128, elapsedSeconds: 240, scoredSeconds: null });
  assert.equal(passage.seconds, 240);
  assert.equal(passage.threshold, 0.85);
  assert.equal(Math.round(passage.accuracy * 1000) / 1000, 0.938);
  assert.equal(passage.correctPerMinute, 30);
  assert.equal(passage.officialScore, 28.125);

  assert.equal(flowRoundResult("passage", { correct: 0, submitted: 0 }).seconds, 0, "冇用時就係 0");
  assert.equal(flowRoundResult("single", {}), null, "冇 counters 就唔砌結果");
  assert.throws(() => flowRoundResult("bogus", {}), TypeError);
});

test("flowTotals 加埋已完成嘅輪次，缺輪唔會當 0 分", () => {
  const single = normalizeRoundResult("single", round(27, 30, 90));
  const words = normalizeRoundResult("words", round(60, 75, 120));
  const passage = normalizeRoundResult("passage", round(120, 128, 240));
  assert.deepEqual(flowTotals({}), {
    rounds: 0, complete: false, correct: 0, submitted: 0, officialScore: 0, meetsAllThresholds: false,
  });
  const partial = flowTotals({ single, passage });
  assert.equal(partial.rounds, 2);
  assert.equal(partial.complete, false);
  assert.equal(partial.correct, 147);
  assert.equal(partial.submitted, 158);
  assert.equal(Math.round(partial.officialScore * 1000) / 1000, 44.325);
  assert.equal(partial.meetsAllThresholds, true);

  const all = flowTotals({ single, words, passage });
  assert.equal(all.complete, true);
  assert.equal(all.rounds, 3);
  assert.equal(all.meetsAllThresholds, false, "詞組未達 90% 門檻");
  assert.deepEqual(flowTotals({ single: { ...single, meetsThreshold: false } }).meetsAllThresholds, false);
});

test("appendFlowHistory 記低完成流程，同一次流程唔會重複記錄，最多 20 條", () => {
  withStorage(({ local }) => {
    const store = id => ({
      version: 1,
      startedAt: id,
      rounds: { single: normalizeRoundResult("single", round(27, 30, 90)) },
    });
    appendFlowHistory(store(1));
    appendFlowHistory(store(1));
    assert.equal(readFlowHistory().length, 1, "同一個 startedAt 唔會重複");
    appendFlowHistory(store(2));
    assert.equal(readFlowHistory().length, 2);
    assert.deepEqual(readFlowHistory().map(item => item.startedAt), [1, 2]);
    assert.deepEqual(readFlowHistory()[0].totals, {
      rounds: 1, complete: false, correct: 27, submitted: 30, officialScore: 16.2, meetsAllThresholds: true,
    });
    assert.ok(Number.isFinite(readFlowHistory()[0].at));

    for (let id = 3; id <= 30; id++) appendFlowHistory(store(id));
    const history = readFlowHistory();
    assert.equal(history.length, FLOW_HISTORY_LIMIT);
    assert.equal(history[0].startedAt, 11, "只留最近 20 條");
    assert.equal(history.at(-1).startedAt, 30);

    assert.deepEqual(appendFlowHistory(null), history, "冇流程就原封不動");
    assert.deepEqual(appendFlowHistory({ version: 9 }), history);

    const written = local.read(FLOW_HISTORY_KEY);
    assert.equal(written.length, FLOW_HISTORY_LIMIT);
    local.setItem(FLOW_HISTORY_KEY, JSON.stringify([null, "nope", { at: 2, rounds: {} }, { at: "yesterday" }]));
    assert.deepEqual(readFlowHistory().map(item => item.at), [2], "壞紀錄會剔走");
    local.setItem(FLOW_HISTORY_KEY, "{ not json");
    assert.deepEqual(readFlowHistory(), []);
  });
});

test("流程模組保持純邏輯：零 DOM、零 window／location、只用相對路徑", () => {
  const source = readFileSync(new URL("../demo/games/flow.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(source, /https?:\/\//, "唔可以有絕對網址");
  assert.match(source, /from "\.\/common\.mjs"/);
  assert.match(source, /from "\.\/official\.mjs"/);
  for (const banned of ["document", "window", "location"]) {
    assert.doesNotMatch(source, new RegExp(`\\b${banned}\\b`), `flow.mjs 唔應該用 ${banned}`);
  }
});

// --- i18n：流程標籤同遊戲大廳跟界面語言切換 ---------------------------------

const LOCALE_STORAGE_KEY = "canclid-contest-locale";

// 每條 i18n 測試尾都要還原 locale，順手清走 localStorage 入面嘅語言紀錄。
function restoreLocale() {
  setLocale("hant");
  try {
    globalThis.localStorage?.removeItem?.(LOCALE_STORAGE_KEY);
  } catch {}
}

test("流程標籤跟語言切換：hans 出簡體粵文，hant 還原繁體", () => {
  assert.equal(getLocale(), "hant", "node 環境預設繁體");
  assert.equal(flowRoundLabel("single"), "官方流程第 1 輪：單字");
  try {
    setLocale("hans");
    assert.equal(flowRoundLabel("single"), "官方流程第 1 轮：单字");
    assert.equal(flowRoundLabel("words"), "官方流程第 2 轮：词组");
    assert.equal(flowRoundLabel("passage"), "官方流程第 3 轮：篇章");
    assert.equal(flowNextLabel("single"), "前往第 2 轮：词组 →");
    assert.equal(flowNextLabel("words"), "前往第 3 轮：篇章 →");
    assert.equal(flowNextLabel("passage"), "查看三轮成绩 →");
    assert.equal(flowRoundLabel("bogus"), "", "未知輪次照樣係空字串");
    assert.equal(flowNextLabel("bogus"), "");
  } finally {
    restoreLocale();
  }
  assert.equal(getLocale(), "hant");
  assert.equal(flowRoundLabel("words"), "官方流程第 2 輪：詞組", "還原繁體");
  assert.equal(flowNextLabel("passage"), "查看三輪成績 →");
});

test("遊戲大廳：語言切換掣、data-i18n 覆蓋同 i18n 啟動腳本", () => {
  const lobby = readFileSync(new URL("../demo/games/index.html", import.meta.url), "utf8");
  assert.match(lobby,
    /<button class="locale-toggle" data-locale-toggle type="button" aria-pressed="false">简<\/button>/);
  assert.match(lobby, /import \{ initI18n, registerStrings \} from "\.\.\/i18n\.mjs"/);
  assert.match(lobby, /initI18n\(\);/);

  const keys = [...lobby.matchAll(/data-i18n="(lobby\.[^"]+)"/g)].map(match => match[1]);
  assert.ok(keys.length >= 25, `大廳只搵到 ${keys.length} 個 data-i18n`);
  for (const key of new Set(keys)) {
    assert.ok(lobby.includes(`"${key}":`), `大廳 inline script 冇登記 ${key} 嘅簡體譯文`);
  }
  assert.match(lobby, /<h2 data-i18n="lobby\.rocksTitle">粵拼落石<\/h2>/, "繁體原文要留喺 HTML 度做 fallback");
});