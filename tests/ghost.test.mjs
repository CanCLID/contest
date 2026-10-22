import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import * as engine from "../demo/engine.mjs";
import * as questions from "../demo/questions.mjs";
import * as common from "../demo/games/common.mjs";
import * as flowApi from "../demo/games/flow.mjs";
import * as ghost from "../demo/games/ghost/ghost.mjs";
import { createRun, submitAnswer, getMetrics } from "../demo/engine.mjs";
import { flattenQuestions } from "../demo/questions.mjs";
import { OFFICIAL_THRESHOLDS, roundMetrics } from "../demo/games/common.mjs";
import {
  GHOST_CPM_PRESETS,
  GHOST_SEED,
  GHOST_STORAGE_KEY,
  builtInGhosts,
  createDemoGhost,
  createGhostRace,
  createTimeline,
  ghostProgressAt,
  raceResult,
  recordTimeline,
  recordTimelineFromTimes,
} from "../demo/games/ghost/ghost.mjs";

const domSource = readFileSync(new URL("../demo/games/ghost/ghost-dom.mjs", import.meta.url), "utf8");
const html = readFileSync(new URL("../demo/games/ghost/index.html", import.meta.url), "utf8");

const questionSet = [
  { hanzi: "你", answers: ["nei", "lei"], sentenceIndex: 0 },
  { hanzi: "好", answers: ["hou"], sentenceIndex: 0 },
  { hanzi: "我", answers: ["ngo"], sentenceIndex: 1 },
  { hanzi: "哋", answers: ["dei"], sentenceIndex: 1 },
];
const start = () => createRun({ now: 1000, questionSet });

test("a demo ghost finishes the article at roughly the requested speed", () => {
  for (const correctPerMinute of [55, 80, 42]) {
    const ghost = createDemoGhost({ correctPerMinute, total: 64, seed: 7 });
    assert.equal(ghost.timeline.length, 64, String(correctPerMinute));
    assert.equal(ghost.timeline.at(-1).index, 64);
    assert.equal(ghost.correctPerMinute, correctPerMinute);
    assert.deepEqual(ghost.timeline.map(entry => entry.index),
      Array.from({ length: 64 }, (_, index) => index + 1));
    const average = 64 / (ghost.timeline.at(-1).at / 60000);
    assert.ok(Math.abs(average - correctPerMinute) / correctPerMinute < 0.05,
      `${correctPerMinute} 音節／分：實測 ${average.toFixed(1)}`);
    const base = 60000 / correctPerMinute;
    let previousAt = 0;
    for (const entry of ghost.timeline) {
      const interval = entry.at - previousAt;
      assert.ok(Math.abs(interval - base) / base <= 0.2, `間隔 ${interval} 偏離 ${base}`);
      assert.ok(Number.isInteger(entry.at) && entry.at > previousAt, "時間戳要係遞增整數毫秒");
      previousAt = entry.at;
    }
  }
});

test("a demo ghost is reproducible from its seed and jitters between seeds", () => {
  const first = createDemoGhost({ correctPerMinute: 55, total: 20, seed: 99 });
  const repeat = createDemoGhost({ correctPerMinute: 55, total: 20, seed: 99 });
  const other = createDemoGhost({ correctPerMinute: 55, total: 20, seed: 100 });
  assert.deepEqual(first.timeline, repeat.timeline);
  assert.notDeepEqual(first.timeline, other.timeline);
  assert.deepEqual(createDemoGhost({ correctPerMinute: 55, total: 20 }).timeline,
    createDemoGhost({ correctPerMinute: 55, total: 20, seed: GHOST_SEED }).timeline);
  const fixed = 20 * 60000 / 55;
  assert.notDeepEqual(first.timeline.map(entry => entry.at),
    Array.from({ length: 20 }, (_, index) => Math.round(fixed / 20 * (index + 1))), "要有 jitter");
});

test("the built-in opponents are the 55 and 80 syllables-per-minute demo ghosts", () => {
  assert.deepEqual(GHOST_CPM_PRESETS, [55, 80]);
  const ghosts = builtInGhosts(60);
  assert.deepEqual(ghosts.map(ghost => ghost.correctPerMinute), GHOST_CPM_PRESETS);
  assert.equal(new Set(ghosts.map(ghost => ghost.id)).size, ghosts.length);
  for (const ghost of ghosts) {
    assert.equal(ghost.timeline.length, 60);
    assert.equal(ghost.timeline.at(-1).index, 60);
    assert.match(ghost.label, new RegExp(String(ghost.correctPerMinute)));
  }
});

test("ghost progress starts at zero, follows the timeline and finishes past the last entry", () => {
  const timeline = [{ at: 1000, index: 2 }, { at: 3000, index: 6 }];
  const race = createGhostRace({ now: 5000, total: 8, timeline });
  assert.equal(ghostProgressAt(race, 5000), 0, "開賽一刻");
  assert.equal(ghostProgressAt(race, 4000), 0, "開賽前");
  assert.equal(ghostProgressAt(race, 5500), 0.125, "起點同第一項之間");
  assert.equal(ghostProgressAt(race, 6000), 0.25, "第一項");
  assert.equal(ghostProgressAt(race, 7000), 0.5, "兩項之間");
  assert.equal(ghostProgressAt(race, 8000), 0.75, "最後一項");
  assert.equal(ghostProgressAt(race, 20000), 1, "過咗最後一項");
  assert.deepEqual([6000, 6500, 7000, 7500, 8000].map(at => ghostProgressAt(race, at)),
    [0.25, 0.375, 0.5, 0.625, 0.75], "兩項之間要線性插值");
  assert.deepEqual([5000, 5250, 5500, 5750, 6000].map(at => ghostProgressAt(race, at)),
    [0, 0.0625, 0.125, 0.1875, 0.25], "起點到第一項之間亦要線性插值");
});

test("progress stays zero without a usable race and clamps to a single-entry timeline", () => {
  assert.equal(ghostProgressAt(createGhostRace({ now: 0, total: 8 }), 60000), 0);
  assert.equal(ghostProgressAt(undefined, 1000), 0);
  assert.equal(ghostProgressAt({}, 1000), 0);
  const late = createGhostRace({ now: 100, total: 4, timeline: [{ at: 500, index: 4 }] });
  assert.equal(ghostProgressAt(late, 100), 0, "開賽一刻");
  assert.equal(ghostProgressAt(late, 350), 0.5);
  assert.equal(ghostProgressAt(late, 600), 1);
  assert.equal(ghostProgressAt(late, 900), 1);
  const instant = createGhostRace({ now: 100, total: 4, timeline: [{ at: 0, index: 4 }] });
  assert.equal(ghostProgressAt(instant, 100), 1, "一開賽就衝線");
});

test("a ghost race rejects an invalid start, length or timeline", () => {
  assert.throws(() => createGhostRace({ now: NaN, total: 4 }), TypeError);
  assert.throws(() => createGhostRace({ now: 0, total: 0 }), TypeError);
  assert.throws(() => createGhostRace({ now: 0, total: 2.5 }), TypeError);
  assert.throws(() => createGhostRace({ now: 0, total: 4, timeline: "nope" }), TypeError);
  assert.throws(() => createGhostRace({ now: 0, total: 4, timeline: [{ at: 100, index: 5 }] }), TypeError);
  assert.throws(() => createGhostRace({ now: 0, total: 4, timeline: [{ at: 100, index: 0 }] }), TypeError);
  assert.throws(() => createGhostRace({ now: 0, total: 4, timeline: [{ at: -1, index: 1 }] }), TypeError);
  assert.throws(() => createGhostRace({ now: 0, total: 4, timeline: [{ at: 100, index: 1 }, { at: 50, index: 2 }] }), TypeError);
  assert.throws(() => createGhostRace({ now: 0, total: 4, timeline: [{ at: 100, index: 1 }, { at: 200, index: 1 }] }), TypeError);
  assert.throws(() => createDemoGhost({ correctPerMinute: 0, total: 4 }), TypeError);
  assert.throws(() => createDemoGhost({ correctPerMinute: 55, total: 0 }), TypeError);
  assert.deepEqual(createGhostRace({ now: 100, total: 4, timeline: [{ at: 10, index: 1 }] }),
    { startedAt: 100, total: 4, timeline: [{ at: 10, index: 1 }] });
});

test("recordTimeline rebuilds evenly spaced entries from a finished run", () => {
  let run = start();
  run = submitAnswer(run, "nei", 4000);
  run = submitAnswer(run, "hou", 7000);
  run = submitAnswer(run, "wrong", 10000);
  run = submitAnswer(run, "dei", 13000);
  assert.equal(run.status, "finished");
  const timeline = recordTimeline(run);
  assert.deepEqual(timeline, [
    { at: 3000, index: 1 },
    { at: 6000, index: 2 },
    { at: 9000, index: 3 },
    { at: 12000, index: 4 },
  ]);
  assert.equal(timeline.length, run.questionSet.length);
  assert.equal(timeline.at(-1).at, (run.finishedAt - run.startedAt));
  assert.deepEqual(recordTimeline(start()), [], "未提交過就冇時間線");
  const partial = recordTimeline(submitAnswer(start(), "nei", 6000), 6000);
  assert.deepEqual(partial, [{ at: 5000, index: 1 }]);
  const thirds = submitAnswer(submitAnswer(start(), "nei", 6000), "hou", 11000);
  assert.deepEqual(recordTimeline(thirds, 11000).map(entry => entry.at), [5000, 10000],
    "未完場就要傳入結束時間");
  assert.throws(() => recordTimeline(thirds), TypeError, "冇結束時間就唔可以亂估");
});

test("createTimeline validates and copies a recorded timeline", () => {
  const input = [{ at: 100, index: 1 }, { at: 900, index: 2 }];
  const timeline = createTimeline(input);
  assert.deepEqual(timeline, input);
  assert.notEqual(timeline, input);
  assert.notEqual(timeline[0], input[0], "要出返新 object");
  assert.deepEqual(createTimeline(), []);
  assert.deepEqual(createTimeline([]), []);
  assert.deepEqual(createTimeline([{ at: 10, index: 2 }]), [{ at: 10, index: 2 }],
    "同一格式只要求遞增，唔要求由 1 開始");
  assert.deepEqual(createTimeline([{ at: 10, index: 1 }, { at: 10, index: 2 }]).map(entry => entry.at),
    [10, 10], "同一毫秒都可以兩次提交");

  const race = createGhostRace({ now: 5000, total: 4, timeline: createTimeline(input) });
  assert.equal(ghostProgressAt(race, 5000), 0);
  assert.equal(ghostProgressAt(race, 5900), 0.5);

  assert.throws(() => createTimeline("nope"), TypeError);
  assert.throws(() => createTimeline([null]), TypeError);
  assert.throws(() => createTimeline([{ at: -1, index: 1 }]), TypeError);
  assert.throws(() => createTimeline([{ at: NaN, index: 1 }]), TypeError);
  assert.throws(() => createTimeline([{ at: 10, index: 0 }]), TypeError);
  assert.throws(() => createTimeline([{ at: 10, index: 1.5 }]), TypeError);
  assert.throws(() => createTimeline([{ at: 20, index: 1 }, { at: 10, index: 2 }]), TypeError, "時間唔可以倒退");
  assert.throws(() => createTimeline([{ at: 10, index: 2 }, { at: 20, index: 2 }]), TypeError, "音節數要遞增");
  assert.throws(() => createTimeline([{ at: 10, index: 2 }, { at: 20, index: 1 }]), TypeError);
});

test("recordTimelineFromTimes turns absolute submit times into a relative timeline", () => {
  assert.deepEqual(recordTimelineFromTimes(1000, [1500, 2400, 2400, 5100]), [
    { at: 500, index: 1 },
    { at: 1400, index: 2 },
    { at: 1400, index: 3 },
    { at: 4100, index: 4 },
  ]);
  assert.deepEqual(recordTimelineFromTimes(1000, []), []);
  assert.deepEqual(recordTimelineFromTimes(1000, [1000]), [{ at: 0, index: 1 }], "開賽一刻提交");
  assert.deepEqual(recordTimelineFromTimes(100.5, [200.9, 350.1]).map(entry => entry.at), [100, 250],
    "performance.now() 嘅小數要四捨五入做整數毫秒");
  assert.deepEqual(recordTimelineFromTimes(1000, [1500, 2400, 2400, 5100]).map(entry => entry.index), [1, 2, 3, 4]);

  assert.throws(() => recordTimelineFromTimes(NaN, [1500]), TypeError);
  assert.throws(() => recordTimelineFromTimes(1000, "nope"), TypeError);
  assert.throws(() => recordTimelineFromTimes(1000, [999]), TypeError, "唔可以早過開賽時間");
  assert.throws(() => recordTimelineFromTimes(1000, [1200, NaN]), TypeError);
  assert.throws(() => recordTimelineFromTimes(1000, [1200, 1100]), TypeError, "時間倒退就唔係真時間線");
});

test("real submit times survive the stored-best round-trip and replay as a ghost", () => {
  const tokens = flattenQuestions();
  let run = createRun({ now: 1000, questionSet: tokens });
  const times = [];
  let at = 1000;
  for (const [index, token] of tokens.entries()) {
    // Irregular gaps, like a real player: 300 / 470 / 640 / 810 / 980 ms, then repeat.
    at += 300 + (index % 5) * 170;
    run = submitAnswer(run, token.answers[0], at);
    times.push(at);
  }
  assert.equal(run.status, "finished");
  const timeline = recordTimelineFromTimes(run.startedAt, times);
  assert.equal(timeline.length, tokens.length);
  assert.deepEqual(timeline.slice(0, 6), [
    { at: 300, index: 1 },
    { at: 770, index: 2 },
    { at: 1410, index: 3 },
    { at: 2220, index: 4 },
    { at: 3200, index: 5 },
    { at: 3500, index: 6 },
  ]);
  assert.equal(timeline.at(-1).at, run.finishedAt - run.startedAt, "最後一項就係完成時間");
  assert.notDeepEqual(timeline.map(entry => entry.at), recordTimeline(run).map(entry => entry.at),
    "真時間線唔係平均間隔");

  // ghost-dom.mjs stores exactly this shape; only the timeline values changed.
  const saved = JSON.parse(JSON.stringify({
    version: 1,
    total: tokens.length,
    elapsedSeconds: (run.finishedAt - run.startedAt) / 1000,
    correctPerMinute: 60 * tokens.length / ((run.finishedAt - run.startedAt) / 1000),
    accuracy: 1,
    officialScore: 1,
    timeline,
    at: 1_700_000_000_000,
  }));
  assert.equal(saved.version, 1);
  assert.equal(saved.total, tokens.length);
  assert.equal(saved.timeline.length, tokens.length);
  assert.ok(saved.timeline.every((entry, position) =>
    Number.isFinite(entry.at) && entry.index === position + 1), "要過到 readBest 嘅檢查");

  const race = createGhostRace({ now: 1000, total: saved.total, timeline: saved.timeline });
  assert.equal(ghostProgressAt(race, 1000), 0);
  assert.equal(ghostProgressAt(race, 1000 + saved.elapsedSeconds * 1000), 1);
  const halfway = ghostProgressAt(race, 1000 + saved.elapsedSeconds * 500);
  assert.ok(halfway > 0.4 && halfway < 0.6, `中段進度 ${halfway}`);
  assert.ok(ghostProgressAt(race, 1000 + 3000) > ghostProgressAt(race, 1000 + 2000), "跟真時間線推進");
});

// Drive the real ghost-dom.mjs in a vm with a mini DOM and a controllable
// clock, the same way tests/rocks.test.mjs drives its DOM layer.
const DOM_SOURCE = readFileSync(new URL("../demo/games/ghost/ghost-dom.mjs", import.meta.url), "utf8")
  .replace(/^import[\s\S]*?from\s+"[^"]+";\n/gm, "")
  .replace(/^export \{[^}]*\};\n/gm, "");

// flow.mjs 喺呼叫嗰刻先讀 globalThis.sessionStorage；流程測試暫時掛一個假嘅上去。
function withFlowStorage(run) {
  const map = new Map();
  const storage = {
    map,
    getItem: key => (map.has(key) ? map.get(key) : null),
    setItem(key, value) { map.set(key, String(value)); },
    removeItem(key) { map.delete(key); },
    read: key => (map.has(key) ? JSON.parse(map.get(key)) : null),
  };
  const previous = Object.getOwnPropertyDescriptor(globalThis, "sessionStorage");
  Object.defineProperty(globalThis, "sessionStorage", { value: storage, configurable: true, writable: true });
  try {
    return run(storage);
  } finally {
    if (previous) Object.defineProperty(globalThis, "sessionStorage", previous);
    else delete globalThis.sessionStorage;
  }
}

function ghostTab({ flowMode = false } = {}) {
  let now = 0;
  let tickerId = 0;
  const store = new Map();
  const elements = new Map();
  const tickers = new Map();

  const makeElement = () => {
    const classes = new Set();
    const attributes = new Map();
    const own = new Map();
    let text = "";
    let textWrites = 0;
    const node = {
      hidden: false, disabled: false, value: "", style: {},
      get textContent() { return text; },
      set textContent(next) { textWrites += 1; text = String(next); },
      get textWrites() { return textWrites; },
      dataset: {}, className: "", selectionStart: 0, children: [],
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
      scrollIntoView() {}, focus() {}, blur() {}, setSelectionRange() {},
      addEventListener(type, listener) {
        if (!own.has(type)) own.set(type, []);
        own.get(type).push(listener);
      },
      fire(type, event = {}) {
        event.target ??= node;
        event.preventDefault ??= () => {};
        (own.get(type) ?? []).forEach(listener => listener(event));
      },
    };
    return node;
  };

  const get = selector => {
    if (!elements.has(selector)) elements.set(selector, makeElement());
    return elements.get(selector);
  };
  // index.html 入面本來就 hidden 嘅元素，迷你 DOM 要照樣開場。
  for (const id of ["#flow-banner", "#flow-next"]) get(id).hidden = true;
  class Clock extends Date {
    static now() { return now; }
  }

  vm.runInContext(DOM_SOURCE, vm.createContext({
    ...engine, ...questions, ...common, ...ghost, ...flowApi,
    Date: Clock,
    location: { search: flowMode ? "?flow=1" : "", href: "" },
    URLSearchParams,
    document: {
      querySelector: get,
      querySelectorAll: () => [],
      createElement: makeElement,
      addEventListener() {},
      body: makeElement(),
    },
    readJson: (key, fallback = null) => store.has(key) ? JSON.parse(store.get(key)) : fallback,
    writeJson: (key, value) => { store.set(key, JSON.stringify(value)); return true; },
    setInterval(callback) { tickerId += 1; tickers.set(tickerId, callback); return tickerId; },
    clearInterval(id) { tickers.delete(id); },
  }), { filename: "demo/games/ghost/ghost-dom.mjs" });

  return {
    get,
    store,
    setTime(value) { now = value; },
    tick() { [...tickers.values()].forEach(callback => callback()); },
    saved: () => JSON.parse(store.get(GHOST_STORAGE_KEY) ?? "null"),
    start() { get("#start").fire("click"); },
    type(text, at) {
      now = at;
      const surface = get("#typing-surface");
      for (const letter of text) surface.fire("keydown", { key: letter, code: `Key${letter.toUpperCase()}` });
      surface.fire("keydown", { key: " ", code: "Space" });
    },
    backspace(times = 1) {
      const surface = get("#typing-surface");
      for (let press = 0; press < times; press++) surface.fire("keydown", { key: "Backspace", code: "Backspace" });
    },
  };
}

test("the DOM layer times every submit for real and saves a replayable best", () => {
  const tab = ghostTab();
  const tokens = flattenQuestions();
  const startedAt = 3000;
  // 400 / 570 / 740 / 910 / 1080 ms, then repeat: a player, not a metronome.
  const gap = index => 400 + (index % 5) * 170;
  const expected = [];

  tab.start();
  tab.setTime(startedAt);
  tab.tick();
  let clock = startedAt;
  for (const [index, token] of tokens.entries()) {
    clock += gap(index);
    tab.type(token.answers[0], clock);
    expected.push(clock - startedAt);
    if (index === 2) {
      // 撤回第 3 個音節再打過：時間線要記最後一次提交。
      tab.backspace();
      tab.backspace(tokens[index - 1].answers[0].length);
      clock += 900;
      tab.type(token.answers[0], clock);
      expected[expected.length - 1] = clock - startedAt;
    }
  }

  const saved = tab.saved();
  assert.ok(saved, "完場要寫入本機最佳");
  assert.equal(saved.version, 1, "存檔格式版本不變");
  assert.equal(saved.total, tokens.length);
  assert.equal(saved.timeline.length, tokens.length);
  assert.deepEqual(saved.timeline.map(entry => entry.index), tokens.map((_, index) => index + 1));
  assert.deepEqual(saved.timeline.map(entry => entry.at), expected, "at 要係每次提交嘅真時間");
  assert.notDeepEqual(expected,
    expected.map((_, index) => expected.at(-1) / expected.length * (index + 1)), "唔應該係平均間隔");
  assert.equal(Math.round(saved.elapsedSeconds * 1000), saved.timeline.at(-1).at, "最後一項就係完成時間");

  // The stored best still replays as an opponent.
  const race = createGhostRace({ now: 0, total: saved.total, timeline: saved.timeline });
  assert.equal(ghostProgressAt(race, 0), 0);
  assert.equal(ghostProgressAt(race, saved.timeline.at(-1).at), 1);
  const middle = ghostProgressAt(race, saved.timeline[tokens.length >> 1].at);
  assert.ok(middle > 0.4 && middle < 0.6, `中段進度 ${middle}`);
  assert.equal(tab.get("#result").hidden, false, "完場要顯示結果");
});

test("the DOM layer records real submit times and saves them in the old shape", () => {
  assert.match(domSource, /import \{[^}]*recordTimelineFromTimes[^}]*\} from "\.\/ghost\.mjs"/);
  assert.doesNotMatch(domSource, /\brecordTimeline\b/, "唔應該再用模擬時間線");
  assert.match(domSource, /const now = Date\.now\(\);/);
  assert.match(domSource, /submitTimes\[run\.index - 1\] = now/, "每次真提交要記時間");
  assert.match(domSource, /recordTimelineFromTimes\(run\.startedAt, submitTimes\)/);
  assert.match(domSource, /submitTimes\.length = run\.index/, "退回要剔走最後一個時間");
  assert.equal((domSource.match(/submitTimes\.length = 0/g) ?? []).length, 2, "開新一輪同重設都要清空");
  assert.match(domSource, /timeline: recordTimelineFromTimes/, "存檔欄位名不變");
  assert.match(domSource, /const usable = saved\.timeline\.every/);
});

test("a recorded run replays as a ghost that finishes with the player's own time", () => {
  const tokens = flattenQuestions();
  let run = createRun({ now: 0, questionSet: tokens });
  tokens.forEach((token, index) => { run = submitAnswer(run, token.answers[0], (index + 1) * 1000); });
  assert.equal(run.status, "finished");

  const timeline = recordTimeline(run);
  const race = createGhostRace({ now: 1000, total: tokens.length, timeline });
  assert.equal(ghostProgressAt(race, 1000), 0);
  assert.equal(ghostProgressAt(race, 1000 + run.finishedAt), 1);
  const halfway = ghostProgressAt(race, 1000 + run.finishedAt / 2);
  assert.ok(halfway > 0.4 && halfway < 0.6, `中段進度 ${halfway}`);

  const metrics = getMetrics(run, run.finishedAt);
  const summary = raceResult({
    playerMetrics: {
      ...roundMetrics({ correct: metrics.correct, submitted: metrics.submitted, seconds: metrics.elapsedSeconds },
        { threshold: OFFICIAL_THRESHOLDS.passage }),
      total: tokens.length,
      correct: metrics.correct,
      errors: metrics.errors,
      submitted: metrics.submitted,
      elapsedSeconds: metrics.elapsedSeconds,
    },
    ghostProgress: ghostProgressAt(race, 1000 + run.finishedAt),
    finishedFirst: false,
  });
  assert.equal(summary.meetsThreshold, true);
  assert.equal(summary.accuracy, 1);
  assert.equal(summary.threshold, 0.85);
  assert.equal(summary.officialScore, metrics.correctPerMinute);
  assert.equal(summary.leadSyllables, 0);
});

test("raceResult combines the official metrics with the ghost comparison", () => {
  const official = roundMetrics({ correct: 48, submitted: 60, seconds: 60 },
    { threshold: OFFICIAL_THRESHOLDS.passage });
  const base = {
    ...official,
    total: 60,
    correct: 48,
    errors: 12,
    submitted: 60,
    elapsedSeconds: 60,
    progress: 1,
  };

  const win = raceResult({ playerMetrics: base, ghostProgress: 0.8, finishedFirst: true });
  assert.equal(win.finishedFirst, true);
  assert.equal(win.verdict, "你贏咗幽靈");
  assert.equal(win.ghostProgress, 0.8);
  assert.equal(win.playerProgress, 1);
  assert.ok(Math.abs(win.ghostRemaining - 0.2) < 1e-9);
  assert.ok(Math.abs(win.lead - 0.2) < 1e-9);
  assert.equal(win.leadSyllables, 12);
  assert.equal(win.total, 60);
  assert.equal(win.submitted, 60);
  assert.equal(win.correct, 48);
  assert.equal(win.errors, 12);
  assert.equal(win.elapsedSeconds, 60);
  assert.equal(win.correctPerMinute, 48);
  assert.equal(win.accuracy, 0.8);
  assert.equal(Math.round(win.accuracyPercent), 80);
  assert.equal(win.officialScore, official.officialScore);
  assert.equal(win.meetsThreshold, false);
  assert.equal(win.threshold, 0.85);

  const loss = raceResult({ playerMetrics: base, ghostProgress: 1, finishedFirst: false });
  assert.equal(loss.verdict, "幽靈快過你");
  assert.equal(loss.leadSyllables, 0);
  const tie = raceResult({ playerMetrics: base, ghostProgress: 0.995, finishedFirst: true });
  assert.equal(tie.verdict, "同幽靈幾乎同時衝線");
  assert.equal(tie.leadSyllables, 0);
});

test("raceResult falls back to a metrics ratio and clamps stray ghost progress", () => {
  const ratioOnly = raceResult({
    playerMetrics: { accuracy: 0.9, progress: 1, total: 10, officialScore: 42, meetsThreshold: true, threshold: 0.85 },
    ghostProgress: 0.5,
    finishedFirst: true,
  });
  assert.equal(ratioOnly.accuracy, 0.9);
  assert.equal(Math.round(ratioOnly.accuracyPercent), 90);
  assert.equal(ratioOnly.officialScore, 42);
  assert.equal(ratioOnly.meetsThreshold, true);
  assert.equal(ratioOnly.leadSyllables, 5);
  assert.equal(raceResult({ playerMetrics: { accuracy: 0.5 }, ghostProgress: -3 }).ghostProgress, 0);
  assert.equal(raceResult({ playerMetrics: { accuracy: 0.5 }, ghostProgress: 4 }).ghostProgress, 1);
  assert.equal(raceResult({ playerMetrics: {} }).leadSyllables, null, "冇 total 就唔報音節差");
  assert.throws(() => raceResult({ ghostProgress: 0.5 }), TypeError);
});

test("the best-run storage key is agreed once in the pure module and reused by the DOM layer", () => {
  assert.equal(GHOST_STORAGE_KEY, "canclid-contest-games-ghost");
  assert.match(domSource, /GHOST_STORAGE_KEY/);
  assert.match(domSource, /import \{[^}]*GHOST_STORAGE_KEY[^}]*\} from "\.\/ghost\.mjs"/);
  assert.doesNotMatch(domSource, /"canclid-contest-games-ghost"/, "key 只喺 ghost.mjs 定義一次");
});

test("the page skeleton links the lobby, the arena and its own assets, and every queried id exists", () => {
  assert.match(html, /<link rel="stylesheet" href="\.\/ghost\.css">/);
  assert.match(html, /<script src="\.\/ghost-dom\.mjs" type="module"><\/script>/);
  assert.match(html, /href="\.\.\/"/, "要連返遊戲大廳");
  assert.match(html, /href="\.\.\/\.\.\/index\.html"/, "要連返試玩賽場");
  assert.match(html, /id="opponent-options"/, "要有揀對手嘅位");

  const ids = [...domSource.matchAll(/\$\("#([a-z-]+)"\)/g)].map(match => match[1]);
  assert.ok(ids.length > 15, `只搵到 ${ids.length} 個 selector`);
  for (const id of new Set(ids)) assert.ok(html.includes(`id="${id}"`), `index.html 冇 id="${id}"`);
});

test("the pure module stays free of DOM, window and storage access", () => {
  const source = readFileSync(new URL("../demo/games/ghost/ghost.mjs", import.meta.url), "utf8");
  for (const banned of ["document", "window", "localStorage", "sessionStorage"]) {
    assert.doesNotMatch(source, new RegExp(`\\b${banned}\\b`), `ghost.mjs 唔應該用 ${banned}`);
  }
  assert.match(source, /from "\.\.\/common\.mjs"/, "共用 jitter 要來自 games/common.mjs");
});

// --- 淨計時同官方三輪流程（?flow=1） ----------------------------------------

function finishPassage(tab, startAt = 3000) {
  const tokens = flattenQuestions();
  let clock = startAt;
  for (const token of tokens) {
    clock += 200;
    tab.type(token.answers[0], clock);
  }
  return clock;
}

function chooseSolo(tab) {
  tab.get("#opponent-options").fire("change", {
    target: { closest: () => ({ value: "none", disabled: false }) },
  });
}

test("淨計時：賽道冇幽靈條、賽果對手進度顯示 —，其餘計分同存檔不變", () => {
  const tab = ghostTab();
  const picker = tab.get("#opponent-options");
  assert.ok(picker.children.some(option => option.dataset.opponent === "none"),
    "對手選擇要有「淨計時」");

  chooseSolo(tab);
  tab.start();
  tab.setTime(3000);
  tab.tick();
  assert.equal(tab.get("#ghost-lane").hidden, true, "淨計時唔顯示幽靈條");
  assert.match(tab.get("#race-opponent").textContent, /淨計時/);
  assert.doesNotMatch(tab.get("#race-opponent").textContent, /目標時間/);
  assert.equal(tab.get("#player-track").getAttribute("aria-valuenow"), "0");

  finishPassage(tab);
  assert.equal(tab.get("#result").hidden, false);
  assert.equal(tab.get("#result-title").textContent, "完成喇！");
  const rows = tab.get("#result-details").children;
  assert.equal(rows.at(-1).children[0].textContent, "幽靈進度");
  assert.equal(rows.at(-1).children[1].textContent, "—");
  assert.match(tab.get("#result-summary").textContent, /淨計時（唔設對手）/);
  const saved = tab.saved();
  assert.ok(saved, "淨計時照樣寫本機最佳");
  assert.equal(saved.total, flattenQuestions().length);
  assert.equal(saved.accuracy, 1);
  assert.equal(tab.get("#flow-next").hidden, true, "流程外唔會出「下一輪」掣");
});

test("?flow=1：鎖定內建 55 音節／分示範幽靈陪跑，完場寫入篇章輪再接去成績卡", () => {
  withFlowStorage(storage => {
    const tab = ghostTab({ flowMode: true });
    assert.deepEqual(storage.read("canclid-contest-official-flow").rounds, {}, "一入 ?flow=1 就開流程");
    assert.match(tab.get("#flow-banner").textContent, /官方流程第 3 輪：篇章/);
    assert.match(tab.get("#flow-banner").textContent, /示範幽靈陪跑，唔影響計分/);
    assert.equal(tab.get("#opponent-options").hidden, true, "流程鎖定對手，唔畀揀");
    assert.equal(tab.get("#opponent-heading").hidden, true);
    assert.equal(tab.get("#best-card").hidden, true);
    assert.equal(tab.get("#lobby-link").textContent, "‹ 退出流程");
    assert.equal(tab.get("#lobby-link").href, "../../index.html");
    assert.match(tab.get("#start-note").textContent, /示範幽靈陪跑，唔影響計分/);
    assert.match(tab.get("#tagline").textContent, /55 音節／分示範幽靈陪跑/);
    assert.equal(tab.get("#flow-next").hidden, true, "未開局未出下一輪掣");

    tab.start();
    tab.setTime(3000);
    tab.tick();
    assert.equal(tab.get("#ghost-lane").hidden, false, "示範幽靈照樣顯示賽道條");
    assert.match(tab.get("#race-opponent").textContent, /示範幽靈 · 55 音節／分/);
    assert.match(tab.get("#race-opponent").textContent, /目標時間/);
    const early = Number.parseFloat(tab.get("#ghost-bar").style.width);
    tab.setTime(9000);
    tab.tick();
    assert.ok(Number.parseFloat(tab.get("#ghost-bar").style.width) > early, "幽靈條跟時間推進（純氣氛）");

    finishPassage(tab);
    assert.equal(tab.get("#result").hidden, false);
    const rows = tab.get("#result-details").children;
    assert.equal(rows.at(-1).children[0].textContent, "幽靈進度");
    assert.notEqual(rows.at(-1).children[1].textContent, "—", "示範幽靈有進度比較");
    assert.match(tab.get("#result-summary").textContent, /示範陪跑，唔影響計分/);
    const tokens = flattenQuestions();
    const saved = storage.read("canclid-contest-official-flow").rounds.passage;
    assert.equal(saved.correct, tokens.length);
    assert.equal(saved.submitted, tokens.length);
    assert.equal(saved.accuracy, 1);
    assert.equal(saved.threshold, 0.85);
    assert.equal(saved.meetsThreshold, true);
    assert.equal(Math.round(saved.seconds * 1000), tokens.length * 200, "篇章輪記實際完成用時");
    assert.ok(saved.correctPerMinute > 0);

    assert.equal(tab.get("#flow-next").hidden, false);
    assert.equal(tab.get("#flow-next").href, "../summary/");
    assert.equal(tab.get("#flow-next").textContent, "查看三輪成績 →");
    assert.equal(tab.get("#play-again").hidden, true, "流程內冇「再玩一場」");
    assert.equal(tab.get("#edit-settings").hidden, true, "流程內冇「揀過對手」");
  });
});

test("renderRace 只喺數字有變先寫 DOM，唔會每個 tick 重寫同一節點", () => {
  const tab = ghostTab();
  tab.start();
  tab.setTime(3000);
  tab.tick();
  const time = tab.get("#time");
  const writes = time.textWrites;
  assert.ok(writes > 0, "開局之後要寫過時間");
  tab.tick();
  assert.equal(time.textWrites, writes, "同一時刻重複 tick 唔應該再寫 #time");
  tab.setTime(3600);
  tab.tick();
  assert.equal(time.textWrites, writes + 1, "時間有變就寫一次");
  assert.equal(time.textContent, "00:00.6");
});
