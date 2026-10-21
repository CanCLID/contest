import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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
  ghostProgressAt,
  raceResult,
  recordTimeline,
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
