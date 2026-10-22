import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

import { COMBO_CAP, OFFICIAL_THRESHOLDS, comboMultiplier, formatClock, roundMetrics } from "../demo/games/common.mjs";
import * as flowApi from "../demo/games/flow.mjs";
import { getLocale, initI18n, registerStrings, setLocale, t } from "../demo/i18n.mjs";
import { ROCK_QUESTIONS, validateBank } from "../demo/games/rocks/data.mjs";
import {
  DEFAULT_DURATION_SECONDS,
  DEFAULT_LIVES,
  FALL_DURATION_MS,
  OFFICIAL_ROCKS,
  ROCKS_STORAGE_KEY,
  createRocksGame,
  getFallProgress,
  getRocksMetrics,
  tick,
  typeSyllable,
} from "../demo/games/rocks/rocks.mjs";

const T0 = 1_000;

function closeTo(actual, expected, message) {
  assert.ok(Math.abs(actual - expected) < 1e-9, `${message ?? ""}（實際 ${actual}，預期 ${expected}）`);
}

test("題庫：至少 60 個常用單字，格式全部合規", () => {
  assert.ok(ROCK_QUESTIONS.length >= 60, `題庫只有 ${ROCK_QUESTIONS.length} 個字`);
  assert.doesNotThrow(() => validateBank(ROCK_QUESTIONS));
  const seen = new Set();
  for (const token of ROCK_QUESTIONS) {
    assert.match(token.hanzi, /^\p{Script=Han}$/u, `${token.hanzi} 唔係單一漢字`);
    assert.ok(token.answers.length > 0, `${token.hanzi} 冇答案`);
    for (const answer of token.answers) {
      assert.match(answer, /^[a-z]+$/, `${token.hanzi} 嘅「${answer}」唔係小階無聲調粵拼`);
    }
    assert.ok(!seen.has(token.hanzi), `${token.hanzi} 重複`);
    seen.add(token.hanzi);
  }
});

test("題庫自我校驗會攔住壞資料", () => {
  assert.throws(() => validateBank([]), TypeError);
  assert.throws(() => validateBank("nope"), TypeError);
  assert.throws(() => validateBank([{ hanzi: "天", answers: ["tin"] }, { hanzi: "天", answers: ["tin"] }]), TypeError);
  assert.throws(() => validateBank([{ hanzi: "天空", answers: ["tin"] }]), TypeError);
  assert.throws(() => validateBank([{ hanzi: "A", answers: ["a"] }]), TypeError);
  assert.throws(() => validateBank([{ hanzi: "天", answers: [] }]), TypeError);
  assert.throws(() => validateBank([{ hanzi: "天", answers: ["Tin"] }]), TypeError);
  assert.throws(() => validateBank([{ hanzi: "天", answers: ["tin1"] }]), TypeError);
});

test("同一個 seed 出題一樣，唔同 seed 唔會完全一樣", () => {
  const first = seed => createRocksGame({ now: T0, seed }).target.hanzi;
  assert.equal(first("alpha"), first("alpha"));
  const seeds = ["alpha", "beta", "gamma", "delta", "epsilon", "zeta", "eta"];
  assert.ok(new Set(seeds.map(first)).size > 1, "唔同 seed 應該出唔同題目");

  const play = seed => {
    let state = createRocksGame({ now: T0, seed });
    const sequence = [state.target.hanzi];
    let time = T0;
    for (let i = 0; i < 12; i++) {
      time += 500;
      state = typeSyllable(state, state.target.answers[0], time);
      sequence.push(state.target.hanzi);
    }
    return sequence;
  };
  assert.deepEqual(play("repeat"), play("repeat"));
});

test("同一輪洗牌內唔會出重複嘅字", () => {
  let state = createRocksGame({ now: T0, seed: "distinct" });
  const hanzi = [state.target.hanzi];
  let time = T0;
  for (let i = 0; i < 40; i++) {
    time += 500;
    state = typeSyllable(state, state.target.answers[0], time);
    hanzi.push(state.target.hanzi);
  }
  assert.equal(new Set(hanzi).size, hanzi.length);
});

test("開局：第一塊石即刻出現，掉落時長由注入嘅 now 計", () => {
  const state = createRocksGame({ now: T0, seed: "start" });
  assert.equal(state.status, "running");
  assert.equal(state.startedAt, T0);
  assert.equal(state.endsAt, T0 + DEFAULT_DURATION_SECONDS * 1000);
  assert.equal(state.livesLeft, DEFAULT_LIVES);
  assert.equal(state.lives, DEFAULT_LIVES);
  assert.equal(state.combo, 0);
  assert.equal(state.spawned, 1);
  assert.equal(state.target.spawnedAt, T0);
  assert.equal(state.target.deadline, T0 + FALL_DURATION_MS);
  assert.ok(ROCK_QUESTIONS.some(token => token.hanzi === state.target.hanzi));
});

test("開局參數唔對會即刻 throw", () => {
  assert.throws(() => createRocksGame({}), TypeError);
  assert.throws(() => createRocksGame({ now: NaN }), TypeError);
  assert.throws(() => createRocksGame({ now: T0, lives: 0 }), TypeError);
  assert.throws(() => createRocksGame({ now: T0, lives: 1.5 }), TypeError);
  assert.throws(() => createRocksGame({ now: T0, durationSeconds: 0 }), TypeError);
  assert.throws(() => createRocksGame({ now: T0, fallDurationMs: -1 }), TypeError);
  assert.throws(() => createRocksGame({ now: T0, bank: [] }), TypeError);
});

test("打啱：combo 加一、計正確、即刻出下一題", () => {
  let state = createRocksGame({ now: T0, seed: "hit" });
  const first = state.target;
  state = typeSyllable(state, first.answers[0], T0 + 800);
  assert.equal(state.correct, 1);
  assert.equal(state.errors, 0);
  assert.equal(state.submitted, 1);
  assert.equal(state.combo, 1);
  assert.equal(state.bestCombo, 1);
  assert.equal(state.lastResult, "correct");
  assert.equal(state.lastAnswer, first.answers[0]);
  assert.equal(state.lastTarget.hanzi, first.hanzi);
  assert.equal(state.spawned, 2);
  assert.equal(state.target.spawnedAt, T0 + 800);
  assert.equal(state.target.deadline, T0 + 800 + FALL_DURATION_MS);
  assert.equal(state.livesLeft, DEFAULT_LIVES);
  assert.equal(state.status, "running");
});

test("提交會正規化：大階同聲調數字都當啱", () => {
  let state = createRocksGame({ now: T0, seed: "normalize" });
  const answer = state.target.answers[0];
  state = typeSyllable(state, ` ${answer.toUpperCase()}6 `, T0 + 500);
  assert.equal(state.correct, 1);
  assert.equal(state.lastAnswer, answer);
});

test("打錯：combo 歸零、計錯誤、照樣前進", () => {
  let state = createRocksGame({ now: T0, seed: "miss-hit" });
  const first = state.target;
  state = typeSyllable(state, first.answers[0], T0 + 400);
  assert.equal(state.combo, 1);
  const second = state.target;
  state = typeSyllable(state, "qqq", T0 + 900);
  assert.equal(state.errors, 1);
  assert.equal(state.correct, 1);
  assert.equal(state.submitted, 2);
  assert.equal(state.combo, 0);
  assert.equal(state.bestCombo, 1);
  assert.equal(state.lastResult, "incorrect");
  assert.equal(state.lastTarget.hanzi, second.hanzi);
  assert.equal(state.spawned, 3);
  assert.equal(state.livesLeft, DEFAULT_LIVES);
});

test("空白或者冇字母嘅提交唔會計錯，亦唔會前進", () => {
  const state = createRocksGame({ now: T0, seed: "blank" });
  const blank = typeSyllable(state, "   ", T0 + 100);
  assert.equal(blank.submitted, 0);
  assert.equal(blank.errors, 0);
  assert.equal(blank.spawned, state.spawned);
  const digits = typeSyllable(state, "123", T0 + 100);
  assert.equal(digits.submitted, 0);
  assert.equal(digits.spawned, state.spawned);
});

test("超時未擊破：扣一條命、combo 歸零、由落地時間出下一題", () => {
  let state = createRocksGame({ now: T0, seed: "fall-through" });
  state = typeSyllable(state, state.target.answers[0], T0 + 500);
  assert.equal(state.combo, 1);
  const landedAt = state.target.deadline;

  state = tick(state, landedAt);
  assert.equal(state.missed, 1);
  assert.equal(state.livesLeft, DEFAULT_LIVES - 1);
  assert.equal(state.combo, 0);
  assert.equal(state.lastResult, "missed");
  assert.equal(state.submitted, 1);
  assert.equal(state.spawned, 3);
  assert.equal(state.target.spawnedAt, landedAt);
  assert.equal(state.target.deadline, landedAt + FALL_DURATION_MS);
  assert.equal(state.status, "running");

  state = tick(state, landedAt + 100);
  assert.equal(state.missed, 1, "未夠死線唔應該再扣命");
});

test("一次過跳好耐，會順住死線連續漏接", () => {
  const state = createRocksGame({ now: T0, seed: "chain" });
  const chained = tick(state, T0 + FALL_DURATION_MS * 3);
  assert.equal(chained.missed, 3);
  assert.equal(chained.livesLeft, 0);
  assert.equal(chained.spawned, 3);
  assert.equal(chained.status, "finished");
  assert.equal(chained.finishedReason, "lives");
  assert.equal(chained.finishedAt, T0 + FALL_DURATION_MS * 3);
});

test("命盡即完場，之後嘅輸入同 tick 都無效", () => {
  let state = createRocksGame({ now: T0, seed: "game-over", lives: 2 });
  state = tick(state, T0 + FALL_DURATION_MS * 2);
  assert.equal(state.status, "finished");
  assert.equal(state.finishedReason, "lives");
  assert.equal(state.livesLeft, 0);
  const after = typeSyllable(state, state.target.answers[0], T0 + FALL_DURATION_MS * 2 + 100);
  assert.equal(after, state);
  assert.equal(tick(state, T0 + FALL_DURATION_MS * 2 + 5000), state);
});

test("時間到即完場，finishedAt 係回合結束嗰刻", () => {
  let state = createRocksGame({ now: T0, seed: "timeout", lives: 90 });
  let time = T0;
  for (let i = 0; i < 59; i++) {
    time += 1000;
    state = typeSyllable(state, state.target.answers[0], time);
  }
  assert.equal(state.status, "running", "未夠鐘之前應該繼續玩");
  assert.equal(state.correct, 59);

  state = tick(state, T0 + DEFAULT_DURATION_SECONDS * 1000);
  assert.equal(state.status, "finished");
  assert.equal(state.finishedReason, "time");
  assert.equal(state.finishedAt, T0 + DEFAULT_DURATION_SECONDS * 1000);
  assert.equal(state.missed, 0, "未夠死線唔應該扣命");
  assert.equal(getRocksMetrics(state).elapsedSeconds, DEFAULT_DURATION_SECONDS);
  const late = typeSyllable(state, "tin", T0 + 61_000);
  assert.equal(late, state);
});

test("石頭落地一刻嘅遲到輸入唔會當答錯", () => {
  const state = createRocksGame({ now: T0, seed: "late-input" });
  const answer = state.target.answers[0];
  const after = typeSyllable(state, answer, T0 + FALL_DURATION_MS);
  assert.equal(after.missed, 1);
  assert.equal(after.submitted, 0, "遲到嘅輸入唔應該計提交");
  assert.equal(after.correct, 0);
  assert.equal(after.spawned, 2);
});

test("tick 唔會因為早過開始時間而改變狀態", () => {
  const state = createRocksGame({ now: T0, seed: "early" });
  assert.equal(tick(state, T0 - 1), state);
  assert.equal(tick(state, T0 - 5000), state);
  assert.equal(tick(state, NaN), state);
});

test("掉落進度按目標出現時間同掉落時長計，並且會夾喺 0 至 1", () => {
  const state = createRocksGame({ now: T0, seed: "progress" });
  const { spawnedAt } = state.target;
  assert.equal(getFallProgress(state, spawnedAt), 0);
  assert.equal(getFallProgress(state, spawnedAt + FALL_DURATION_MS / 2), 0.5);
  assert.equal(getFallProgress(state, spawnedAt + FALL_DURATION_MS), 1);
  assert.equal(getFallProgress(state, spawnedAt + FALL_DURATION_MS * 4), 1);
  assert.equal(getFallProgress(state, spawnedAt - 500), 0);
});

test("連擊倍率封頂 1.5", () => {
  assert.equal(comboMultiplier(0), 1);
  assert.equal(comboMultiplier(4), 1.4);
  assert.equal(comboMultiplier(5), 1.5);
  assert.equal(comboMultiplier(999), COMBO_CAP);
  assert.equal(COMBO_CAP, 1.5);

  let state = createRocksGame({ now: T0, seed: "combo" });
  let time = T0;
  for (let i = 0; i < 25; i++) {
    time += 1000;
    state = typeSyllable(state, state.target.answers[0], time);
  }
  assert.equal(state.combo, 25);
  assert.equal(state.bestCombo, 25);
  assert.equal(getRocksMetrics(state, time).multiplier, 1.5);
});

test("計分公式對照手算值：每分鐘正確音節 × 準確度，未達 90% 唔計排名", () => {
  let state = createRocksGame({ now: T0, seed: "score", lives: 5 });
  let time = T0;
  for (let i = 0; i < 8; i++) {
    time += 1000;
    state = typeSyllable(state, state.target.answers[0], time);
  }
  for (let i = 0; i < 2; i++) {
    time += 1000;
    state = typeSyllable(state, "qqq", time);
  }
  state = tick(state, T0 + 60_000);

  const metrics = getRocksMetrics(state, T0 + 60_000);
  assert.equal(metrics.submitted, 10);
  assert.equal(metrics.correct, 8);
  assert.equal(metrics.errors, 2);
  assert.equal(metrics.accuracy, 0.8);
  assert.equal(metrics.correctPerMinute, 8, "8 個正確音節 ÷ 1 分鐘");
  closeTo(metrics.officialScore, 6.4, "8 × 0.8");
  closeTo(metrics.demoScore, 6.4);
  assert.equal(metrics.threshold, OFFICIAL_THRESHOLDS.timed);
  assert.equal(metrics.meetsThreshold, false);
  assert.equal(metrics.status, "finished");
  assert.equal(metrics.finishedReason, "time");

  const reference = roundMetrics({ correct: 8, submitted: 10, seconds: 60 }, { threshold: 0.9 });
  for (const key of ["accuracy", "correctPerMinute", "grossPerMinute", "demoScore", "officialScore", "meetsThreshold"]) {
    assert.equal(metrics[key], reference[key], `${key} 應該同 common.roundMetrics 一致`);
  }
});

test("準確度啱啱 90% 就達門檻", () => {
  let state = createRocksGame({ now: T0, seed: "threshold", lives: 5 });
  let time = T0;
  for (let i = 0; i < 9; i++) {
    time += 1000;
    state = typeSyllable(state, state.target.answers[0], time);
  }
  time += 1000;
  state = typeSyllable(state, "qqq", time);
  state = tick(state, T0 + 60_000);

  const metrics = getRocksMetrics(state, T0 + 60_000);
  assert.equal(metrics.accuracy, 0.9);
  assert.equal(metrics.correctPerMinute, 9);
  closeTo(metrics.officialScore, 8.1);
  assert.equal(metrics.meetsThreshold, true);
});

test("提早用盡性命：計分窗照用回合長度，唔會令 CPM 虛高", () => {
  let state = createRocksGame({ now: T0, seed: "early-death", lives: 3 });
  let time = T0;
  for (let i = 0; i < 4; i++) {
    time += 1000;
    state = typeSyllable(state, state.target.answers[0], time);
  }
  state = tick(state, T0 + 30_000);
  assert.equal(state.status, "finished");
  assert.equal(state.finishedReason, "lives");

  const metrics = getRocksMetrics(state, T0 + 30_000);
  assert.equal(metrics.correct, 4);
  assert.equal(metrics.scoredSeconds, 60);
  assert.equal(metrics.correctPerMinute, 4, "用 60 秒計分窗，唔係實際 22 秒");
  assert.equal(metrics.elapsedSeconds, 22);
  assert.equal(metrics.remainingSeconds, 38);
});

test("getRocksMetrics 帶埋連擊、性命、進度同剩餘時間", () => {
  let state = createRocksGame({ now: T0, seed: "metrics" });
  state = typeSyllable(state, state.target.answers[0], T0 + 1000);
  const half = getRocksMetrics(state, T0 + 4000);
  assert.equal(half.fallProgress, 0.5, "第二塊石喺 T0+1000 出現，T0+4000 應該跌咗一半");

  const metrics = getRocksMetrics(state, T0 + 30_000);
  assert.equal(metrics.combo, 1);
  closeTo(metrics.multiplier, 1.1);
  assert.equal(metrics.livesLeft, DEFAULT_LIVES);
  assert.equal(metrics.lives, DEFAULT_LIVES);
  assert.equal(metrics.progress, 0.5);
  assert.equal(metrics.remainingSeconds, 30);
  assert.equal(metrics.cleared, 1);
  assert.equal(metrics.missed, 0);
  assert.equal(metrics.fallProgress, 1, "跌到底就夾喺 1");
  assert.equal(metrics.status, "running");
  assert.equal(metrics.finishedReason, null);
});

test("可以注入自訂題庫，題目只會由嗰個題庫出", () => {
  const bank = [{ hanzi: "甲", answers: ["gaap"] }, { hanzi: "乙", answers: ["jyut"] }];
  let state = createRocksGame({ now: T0, seed: "custom", bank, lives: 5 });
  const seen = new Set();
  let time = T0;
  for (let i = 0; i < 6; i++) {
    seen.add(state.target.hanzi);
    time += 500;
    state = typeSyllable(state, state.target.answers[0], time);
  }
  assert.deepEqual([...seen].sort(), ["乙", "甲"].sort());
  assert.equal(state.correct, 6);
});

test("一個字有多個通行讀法時，任何一個都當啱", () => {
  const bank = [{ hanzi: "行", answers: ["haang", "hang"] }];
  let state = createRocksGame({ now: T0, seed: "poly", bank, lives: 5 });
  state = typeSyllable(state, "hang", T0 + 500);
  assert.equal(state.correct, 1);
  state = typeSyllable(state, "haang", T0 + 1000);
  assert.equal(state.correct, 2);
  assert.equal(state.combo, 2);
});

test("storage key 同約定一致", () => {
  assert.equal(ROCKS_STORAGE_KEY, "canclid-contest-games-rocks");
});

test("頁面骨架：引用正確資源、有返大廳同賽場嘅連結", () => {
  const html = readFileSync(new URL("../demo/games/rocks/index.html", import.meta.url), "utf8");
  assert.match(html, /<link rel="stylesheet" href="\.\/rocks\.css">/);
  assert.match(html, /<script src="\.\/rocks-dom\.mjs" type="module"><\/script>/);
  assert.match(html, /href="\.\.\/"/, "要連返遊戲大廳");
  assert.match(html, /href="\.\.\/\.\.\/index\.html"/, "要連返試玩賽場");

  const source = readFileSync(new URL("../demo/games/rocks/rocks-dom.mjs", import.meta.url), "utf8");
  const ids = [...source.matchAll(/\$\("#([a-z-]+)"\)/g)].map(match => match[1]);
  assert.ok(ids.length > 15, `只搵到 ${ids.length} 個 selector`);
  for (const id of new Set(ids)) {
    assert.ok(html.includes(`id="${id}"`), `index.html 冇 id="${id}"`);
  }
});

// 用 vm + 迷你 DOM 驅動真嘅 rocks-dom.mjs，覆蓋開局、打字、漏接、完場同寫紀錄。
const DOM_SOURCE = readFileSync(new URL("../demo/games/rocks/rocks-dom.mjs", import.meta.url), "utf8")
  .replace(/^import[\s\S]*?from\s+"[^"]+";\n/gm, "");

function rocksTab() {
  let now = 0;
  let frameId = 0;
  const store = new Map();
  const frames = new Map();
  const elements = new Map();
  const documentListeners = new Map();

  const makeElement = () => {
    const classes = new Set();
    const attributes = new Map();
    const own = new Map();
    const node = {
      hidden: false, textContent: "", value: "", style: {},
      clientHeight: 300, offsetHeight: 100,
      classList: {
        add: (...names) => names.forEach(name => classes.add(name)),
        remove: (...names) => names.forEach(name => classes.delete(name)),
        contains: name => classes.has(name),
        toggle(name, on) { if (on ?? !classes.has(name)) classes.add(name); else classes.delete(name); },
      },
      setAttribute: (name, value) => attributes.set(name, String(value)),
      getAttribute: name => attributes.get(name) ?? null,
      focus() {}, blur() {},
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
  const dispatchKey = (key, code) => {
    documentListeners.get("keydown")?.({ key, code, preventDefault() {} });
  };

  class Clock extends Date {
    static now() { return now; }
  }

  vm.runInContext(DOM_SOURCE, vm.createContext({
    Date: Clock,
    OFFICIAL_THRESHOLDS, comboMultiplier, formatClock, ROCKS_STORAGE_KEY,
    createRocksGame, getFallProgress, getRocksMetrics, tick, typeSyllable,
    readJson: (key, fallback = null) => store.has(key) ? JSON.parse(store.get(key)) : fallback,
    writeJson: (key, value) => { store.set(key, JSON.stringify(value)); return true; },
    window: { addEventListener(type, listener) { documentListeners.set(`window:${type}`, listener); } },
    document: {
      querySelector: get,
      addEventListener(type, listener) { documentListeners.set(type, listener); },
    },
    requestAnimationFrame(callback) { frameId += 1; frames.set(frameId, callback); return frameId; },
    cancelAnimationFrame(id) { frames.delete(id); },
    setTimeout: () => 1,
  }), { filename: "demo/games/rocks/rocks-dom.mjs" });

  return {
    get,
    store,
    records: () => JSON.parse(store.get(ROCKS_STORAGE_KEY) ?? "null"),
    setTime: value => { now = value; },
    flushFrames(limit = 8) {
      for (let i = 0; i < limit && frames.size > 0; i++) {
        const queued = [...frames.values()];
        frames.clear();
        queued.forEach(callback => callback());
      }
    },
    key: dispatchKey,
    type(text) {
      for (const character of text) dispatchKey(character, `Key${character.toUpperCase()}`);
    },
  };
}

test("DOM 層：開始、打啱、漏接、命盡完場同寫本地紀錄", () => {
  const tab = rocksTab();
  assert.equal(tab.get("#intro-card").hidden, false);
  assert.equal(tab.get("#play-card").hidden, true);
  assert.match(tab.get("#intro-best").textContent, /未有紀錄/);

  tab.get("#start-button").fire("click");
  assert.equal(tab.get("#intro-card").hidden, true);
  assert.equal(tab.get("#play-card").hidden, false);
  assert.equal(tab.get("#lives").textContent, "♥♥♥");
  assert.equal(tab.get("#clock").textContent, "01:00.0");

  const firstHanzi = tab.get("#rock-hanzi").textContent;
  const answer = ROCK_QUESTIONS.find(token => token.hanzi === firstHanzi)?.answers[0];
  assert.ok(answer, `石頭顯示咗題庫以外嘅字：${firstHanzi}`);

  tab.type(answer);
  assert.equal(tab.get("#draft").textContent, answer);
  tab.key("Backspace", "Backspace");
  assert.equal(tab.get("#draft").textContent, answer.slice(0, -1));
  tab.type(answer.at(-1));

  tab.setTime(500);
  tab.key("Enter", "Enter");
  assert.equal(tab.get("#draft").textContent, "");
  assert.equal(tab.get("#cpm").textContent, "1");
  assert.equal(tab.get("#accuracy").textContent, "100%");
  assert.equal(tab.get("#combo").textContent, "×1.1");
  assert.match(tab.get("#feedback").textContent, /啱/);
  assert.notEqual(tab.get("#rock-hanzi").textContent, firstHanzi, "答啱之後要出新題");

  // 石頭喺 6500ms 落地，之後每次漏接再扣命。
  tab.setTime(6_500);
  tab.flushFrames();
  assert.equal(tab.get("#lives").textContent, "♥♥♡");
  assert.match(tab.get("#feedback").textContent, /漏接/);
  assert.equal(tab.get("#draft").textContent, "");

  tab.setTime(12_500);
  tab.flushFrames();
  assert.equal(tab.get("#lives").textContent, "♥♡♡");
  tab.setTime(18_500);
  tab.flushFrames();

  assert.equal(tab.get("#play-card").hidden, true);
  assert.equal(tab.get("#result-card").hidden, false);
  assert.equal(tab.get("#result-title").textContent, "三條命用完，遊戲結束");
  assert.equal(tab.get("#result-cpm").textContent, "1");
  assert.equal(tab.get("#result-accuracy").textContent, "100%");
  assert.equal(tab.get("#result-score").textContent, "1.0");
  assert.match(tab.get("#threshold-note").textContent, /達 90% 門檻/);
  assert.match(tab.get("#best-note").textContent, /新紀錄/);

  const record = tab.records();
  assert.equal(record.plays, 1);
  closeTo(record.best.officialScore, 1);
  assert.equal(record.best.bestCombo, 1);
});

test("DOM 層：時間到完場，未達門檻唔會寫入最佳成績", () => {
  const tab = rocksTab();
  tab.get("#start-button").fire("click");
  tab.setTime(DEFAULT_DURATION_SECONDS * 1000);
  tab.flushFrames();

  assert.equal(tab.get("#result-card").hidden, false);
  assert.equal(tab.get("#result-title").textContent, "時間到，遊戲結束");
  assert.equal(tab.get("#result-cpm").textContent, "0");
  assert.equal(tab.get("#result-accuracy").textContent, "0%");
  assert.equal(tab.get("#threshold-note").textContent, "未達門檻，唔計排名。");
  assert.equal(tab.records().best, null);
  assert.equal(tab.records().plays, 1);
});

// --- 官方模式（正式單字輪，docs/INTEGRATION-PLAN.md §A2） --------------------

test("官方模式：OFFICIAL_ROCKS 預設 90 秒、無命，mode 欄位跟身", () => {
  assert.deepEqual(OFFICIAL_ROCKS, { mode: "official", durationSeconds: 90, lives: null });
  const state = createRocksGame({ now: T0, seed: "official", ...OFFICIAL_ROCKS });
  assert.equal(state.mode, "official");
  assert.equal(state.status, "running");
  assert.equal(state.durationSeconds, 90);
  assert.equal(state.endsAt, T0 + 90_000);
  assert.equal(state.lives, null);
  assert.equal(state.livesLeft, null);

  const bare = createRocksGame({ now: T0, seed: "official", mode: "official" });
  assert.equal(bare.durationSeconds, 90, "官方模式唔傳長度都係 90 秒");
  assert.equal(bare.lives, null, "官方模式冇命");

  const practice = createRocksGame({ now: T0, seed: "practice" });
  assert.equal(practice.mode, "practice");
  assert.equal(practice.durationSeconds, DEFAULT_DURATION_SECONDS);
  assert.equal(practice.lives, DEFAULT_LIVES);
  assert.equal(getRocksMetrics(state, T0).mode, "official");
  assert.equal(getRocksMetrics(practice, T0).mode, "practice");
  assert.throws(() => createRocksGame({ now: T0, mode: "ranked" }), TypeError);
});

test("官方模式冇命：連續漏接都唔會完場，但每次漏接計入提交同錯誤", () => {
  let state = createRocksGame({ now: T0, seed: "official-lives", mode: "official" });
  let time = T0;
  for (let i = 0; i < 5; i++) {
    time += FALL_DURATION_MS;
    state = tick(state, time);
  }
  assert.equal(state.status, "running", "冇命就唔會命盡完場");
  assert.equal(state.livesLeft, null);
  assert.equal(state.missed, 5);
  assert.equal(state.submitted, 5, "漏接計入 S");
  assert.equal(state.errors, 5, "漏接計入錯誤");
  assert.equal(state.correct, 0);
  assert.equal(state.combo, 0);
  assert.equal(state.lastResult, "missed");
  assert.equal(state.finishedReason, null);

  const late = tick(state, T0 + 89_999);
  assert.equal(late.status, "running");
  assert.equal(late.submitted, 14, "89.999 秒之前落地嘅石頭全部照計漏接");
});

test("官方模式：逾時未擊破當一次提交錯誤，跳時間同逐個死線 tick 結果一致", () => {
  const play = ticks => {
    let state = createRocksGame({ now: T0, seed: "official-miss-score", mode: "official" });
    let time = T0;
    for (let i = 0; i < 15; i++) {
      time += 1000;
      state = typeSyllable(state, state.target.answers[0], time);
    }
    for (const at of ticks) state = tick(state, at);
    return state;
  };
  const steadyTicks = [];
  for (let at = T0 + 21_000; at <= T0 + 87_000; at += FALL_DURATION_MS) steadyTicks.push(at);
  steadyTicks.push(T0 + 90_000);
  const steady = play(steadyTicks);
  const jumped = play([T0 + 90_000]);

  for (const [label, state] of [["逐個死線 tick", steady], ["一次過跳到完場", jumped]]) {
    assert.equal(state.status, "finished", label);
    assert.equal(state.finishedReason, "time", label);
    assert.equal(state.missed, 12, `${label}：15 個啱之後一路漏接到完場`);
    assert.equal(state.correct, 15, label);
    assert.equal(state.submitted, 27, `${label}：漏接全部計入 S`);
    assert.equal(state.errors, 12, label);
    const metrics = getRocksMetrics(state, T0 + 90_000);
    closeTo(metrics.accuracy, 15 / 27, `${label} 準確度`);
    assert.equal(metrics.correctPerMinute, 10, `${label}：15 ÷ 1.5 分鐘`);
    closeTo(metrics.officialScore, (15 / 27) * 10, `${label} 正式分`);
    assert.equal(metrics.meetsThreshold, false, `${label}：跳過唔打保唔到準確度`);
    assert.equal(metrics.mode, "official", label);
    assert.equal(metrics.scoredSeconds, 90, label);
    assert.equal(metrics.livesLeft, null, label);
  }
});

test("官方模式：逾時計錯之後準確度啱啱 90% 仍然達標，手算對照 roundMetrics", () => {
  let state = createRocksGame({ now: T0, seed: "official-threshold", mode: "official", durationSeconds: 51 });
  let time = T0;
  for (let i = 0; i < 27; i++) {
    time += 1000;
    state = typeSyllable(state, state.target.answers[0], time);
  }
  assert.equal(state.status, "running");
  // 27 秒之後停手：33／39／45 秒三次漏接，下一個死線（51 秒）啱啱好喺完場之後。
  state = tick(state, T0 + 51_000);
  assert.equal(state.status, "finished");
  assert.equal(state.finishedReason, "time");
  assert.equal(state.missed, 3);
  assert.equal(state.correct, 27);
  assert.equal(state.submitted, 30);

  const metrics = getRocksMetrics(state, T0 + 51_000);
  closeTo(metrics.accuracy, 0.9);
  closeTo(metrics.correctPerMinute, 27 / (51 / 60));
  closeTo(metrics.officialScore, (27 / (51 / 60)) * 0.9);
  assert.equal(metrics.meetsThreshold, true, "啱啱 90% 就達門檻");
  const reference = roundMetrics({ correct: 27, submitted: 30, seconds: 51 }, { threshold: OFFICIAL_THRESHOLDS.timed });
  for (const key of ["accuracy", "correctPerMinute", "grossPerMinute", "demoScore", "officialScore", "meetsThreshold"]) {
    assert.equal(metrics[key], reference[key], `${key} 應該同 common.roundMetrics 一致`);
  }
});

test("官方模式：計分窗固定 90 秒，早停嘅 CPM 唔會虛高", () => {
  let state = createRocksGame({ now: T0, seed: "official-window", mode: "official" });
  let time = T0;
  for (let i = 0; i < 15; i++) {
    time += 2000;
    state = typeSyllable(state, state.target.answers[0], time);
  }
  const live = getRocksMetrics(state, T0 + 30_000);
  assert.equal(live.elapsedSeconds, 30);
  assert.equal(live.scoredSeconds, 90, "計分窗係成個 T0");
  assert.equal(live.correctPerMinute, 10, "15 個 ÷ 1.5 分鐘，唔係 ÷ 0.5 分鐘");
  assert.equal(live.accuracy, 1);
  assert.equal(live.remainingSeconds, 60);

  // 之後停手：每 6 秒落地一次，全部計錯，直到 90 秒完場。
  state = tick(state, T0 + 90_000);
  assert.equal(state.status, "finished");
  assert.equal(state.missed, 9);
  const final = getRocksMetrics(state, T0 + 90_000);
  assert.equal(final.scoredSeconds, 90);
  assert.equal(final.correctPerMinute, 10);
  closeTo(final.accuracy, 15 / 24);
  assert.equal(final.meetsThreshold, false, "停手之後準確度跌穿門檻");
});

test("官方模式：死線一刻嘅遲到輸入跟漏接行，唔會額外多計一次", () => {
  const state = createRocksGame({ now: T0, seed: "official-late", mode: "official" });
  const answer = state.target.answers[0];
  const after = typeSyllable(state, answer, T0 + FALL_DURATION_MS);
  assert.equal(after.missed, 1);
  assert.equal(after.submitted, 1, "只計漏接嗰一次");
  assert.equal(after.errors, 1);
  assert.equal(after.correct, 0);
  assert.equal(after.spawned, 2);
  assert.equal(after.status, "running");
});

test("官方模式：時間到先完場，之後嘅輸入同 tick 都無效", () => {
  let state = createRocksGame({ now: T0, seed: "official-timeout", mode: "official" });
  state = typeSyllable(state, state.target.answers[0], T0 + 1000);
  assert.equal(state.correct, 1);
  const ended = tick(state, T0 + 90_000);
  assert.equal(ended.status, "finished");
  assert.equal(ended.finishedReason, "time");
  assert.equal(ended.finishedAt, T0 + 90_000);
  assert.equal(typeSyllable(ended, "tin", T0 + 91_000), ended);
  assert.equal(tick(ended, T0 + 120_000), ended);
  const metrics = getRocksMetrics(ended, T0 + 120_000);
  assert.equal(metrics.status, "finished");
  assert.equal(metrics.elapsedSeconds, 90);
  assert.equal(metrics.remainingSeconds, 0);
});

// --- 模式切換（練習／官方）同官方輪 DOM 行為 --------------------------------

const ROCKS_MODE_KEY = "canclid-contest-games-rocks-mode";

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

// 同 rocksTab 一樣嘅迷你 DOM，但補上官方模式要用嘅全局（OFFICIAL_ROCKS、
// ROCK_QUESTIONS），同埋記低每次 createRocksGame 收到嘅參數同開局 state。
function rocksModeTab({ store = new Map(), flowMode = false } = {}) {
  let now = 0;
  let frameId = 0;
  const frames = new Map();
  const elements = new Map();
  const documentListeners = new Map();
  const calls = [];

  const makeElement = () => {
    const classes = new Set();
    const attributes = new Map();
    const own = new Map();
    const node = {
      hidden: false, textContent: "", value: "", style: {},
      clientHeight: 300, offsetHeight: 100,
      classList: {
        add: (...names) => names.forEach(name => classes.add(name)),
        remove: (...names) => names.forEach(name => classes.delete(name)),
        contains: name => classes.has(name),
        toggle(name, on) { if (on ?? !classes.has(name)) classes.add(name); else classes.delete(name); },
      },
      setAttribute: (name, value) => attributes.set(name, String(value)),
      getAttribute: name => attributes.get(name) ?? null,
      focus() {}, blur() {},
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
  const dispatchKey = (key, code) => {
    documentListeners.get("keydown")?.({ key, code, preventDefault() {} });
  };

  class Clock extends Date {
    static now() { return now; }
  }

  vm.runInContext(DOM_SOURCE, vm.createContext({
    Date: Clock,
    OFFICIAL_THRESHOLDS, OFFICIAL_ROCKS, ROCK_QUESTIONS,
    comboMultiplier, formatClock, ROCKS_STORAGE_KEY,
    ...flowApi,
    location: { search: flowMode ? "?flow=1" : "", href: "" },
    URLSearchParams,
    createRocksGame: options => {
      const created = createRocksGame(options);
      calls.push({ options, state: created });
      return created;
    },
    getFallProgress, getRocksMetrics, tick, typeSyllable,
    readJson: (key, fallback = null) => store.has(key) ? JSON.parse(store.get(key)) : fallback,
    writeJson: (key, value) => { store.set(key, JSON.stringify(value)); return true; },
    window: { addEventListener(type, listener) { documentListeners.set(`window:${type}`, listener); } },
    document: {
      querySelector: get,
      addEventListener(type, listener) { documentListeners.set(type, listener); },
    },
    requestAnimationFrame(callback) { frameId += 1; frames.set(frameId, callback); return frameId; },
    cancelAnimationFrame(id) { frames.delete(id); },
    setTimeout: () => 1,
  }), { filename: "demo/games/rocks/rocks-dom.mjs" });

  return {
    get,
    store,
    calls,
    mode: () => JSON.parse(store.get(ROCKS_MODE_KEY) ?? "null"),
    records: () => JSON.parse(store.get(ROCKS_STORAGE_KEY) ?? "null"),
    setTime: value => { now = value; },
    flushFrames(limit = 8) {
      for (let i = 0; i < limit && frames.size > 0; i++) {
        const queued = [...frames.values()];
        frames.clear();
        queued.forEach(callback => callback());
      }
    },
    key: dispatchKey,
    type(text) {
      for (const character of text) dispatchKey(character, `Key${character.toUpperCase()}`);
    },
  };
}

test("DOM 層：模式切換預設練習、切官方寫入 localStorage，重開還原", () => {
  const tab = rocksModeTab();
  assert.equal(tab.get("#mode-practice").getAttribute("aria-pressed"), "true");
  assert.equal(tab.get("#mode-official").getAttribute("aria-pressed"), "false");
  assert.ok(tab.get("#mode-practice").classList.contains("selected"));
  assert.match(tab.get("#mode-note").textContent, /練習模式/);

  tab.get("#mode-official").fire("click");
  assert.equal(tab.mode(), "official");
  assert.equal(tab.get("#mode-official").getAttribute("aria-pressed"), "true");
  assert.ok(tab.get("#mode-official").classList.contains("selected"));
  assert.ok(!tab.get("#mode-practice").classList.contains("selected"));
  assert.match(tab.get("#mode-note").textContent, /90 秒/);

  tab.get("#mode-practice").fire("click");
  assert.equal(tab.mode(), "practice");

  const reopened = rocksModeTab({ store: new Map([[ROCKS_MODE_KEY, JSON.stringify("official")]]) });
  assert.equal(reopened.get("#mode-official").getAttribute("aria-pressed"), "true");
  assert.equal(reopened.get("#mode-practice").getAttribute("aria-pressed"), "false");
  assert.match(reopened.get("#mode-note").textContent, /90 秒/);

  const junk = rocksModeTab({ store: new Map([[ROCKS_MODE_KEY, JSON.stringify("ranked")]]) });
  assert.equal(junk.get("#mode-practice").getAttribute("aria-pressed"), "true", "壞值要退回練習");
});

test("DOM 層：官方模式開局用 OFFICIAL_ROCKS、隱藏命數、90 秒倒數，成績卡有門檻同計分窗文案", () => {
  const tab = rocksModeTab({ store: new Map([[ROCKS_MODE_KEY, JSON.stringify("official")]]) });
  tab.get("#start-button").fire("click");

  const started = tab.calls.at(-1);
  assert.equal(started.options.mode, "official");
  assert.equal(started.options.durationSeconds, 90);
  assert.equal(started.options.lives, null);
  assert.equal(started.options.bank, ROCK_QUESTIONS);
  assert.equal(started.state.mode, "official");
  assert.equal(started.state.endsAt, 90_000);
  assert.equal(tab.get("#lives-item").hidden, true, "官方模式要收埋命數");
  assert.equal(tab.get("#lives").textContent, "");
  assert.ok(tab.get("#hud").classList.contains("official"));
  assert.equal(tab.get("#clock").textContent, "01:30.0");

  tab.setTime(90_000);
  tab.flushFrames();
  assert.equal(tab.get("#result-card").hidden, false);
  assert.equal(tab.get("#result-title").textContent, "時間到，遊戲結束");
  assert.match(tab.get("#threshold-note").textContent, /未達 90% 門檻，正式賽不計排名/);
  assert.ok(tab.get("#threshold-note").classList.contains("miss"));
  assert.equal(tab.get("#window-note").hidden, false);
  assert.match(tab.get("#window-note").textContent, /固定 90 秒計分窗/);
});

test("DOM 層：官方模式打足全程達 90% 門檻，成績卡顯示達標同正式賽排名", () => {
  const tab = rocksModeTab({ store: new Map([[ROCKS_MODE_KEY, JSON.stringify("official")]]) });
  tab.get("#start-button").fire("click");

  let time = 0;
  for (let i = 0; i < 89; i++) {
    time += 1000;
    tab.setTime(time);
    const hanzi = tab.get("#rock-hanzi").textContent;
    const answer = ROCK_QUESTIONS.find(token => token.hanzi === hanzi)?.answers[0];
    assert.ok(answer, `石頭顯示咗題庫以外嘅字：${hanzi}`);
    tab.type(answer);
    tab.key("Enter", "Enter");
  }

  tab.setTime(90_000);
  tab.flushFrames();
  assert.equal(tab.get("#result-card").hidden, false);
  assert.match(tab.get("#threshold-note").textContent, /達 90% 門檻，成績計入正式賽排名/);
  assert.ok(!tab.get("#threshold-note").classList.contains("miss"));
  assert.match(tab.get("#window-note").textContent, /固定 90 秒計分窗/);
  assert.equal(tab.get("#result-cpm").textContent, "59", "89 個正確音節 ÷ 1.5 分鐘");
  assert.equal(tab.get("#result-accuracy").textContent, "100%");
});

test("DOM 層：練習模式維持原本行為——命數照顯示、成績卡冇官方文案", () => {
  const tab = rocksModeTab();
  assert.equal(tab.get("#flow-banner").hidden, true, "唔係流程就唔會出流程橫額");
  assert.equal(tab.get("#mode-picker").hidden, false);
  assert.equal(tab.get("#lobby-link").href, undefined, "唔係流程就唔會改「遊戲大廳」條 link");
  tab.get("#start-button").fire("click");

  const started = tab.calls.at(-1);
  assert.equal(started.state.mode, "practice");
  assert.equal(started.options.durationSeconds, undefined, "練習開局唔會傳官方參數");
  assert.equal(tab.get("#lives-item").hidden, false);
  assert.equal(tab.get("#lives").textContent, "♥♥♥");
  assert.equal(tab.get("#clock").textContent, "01:00.0");
  assert.ok(!tab.get("#hud").classList.contains("official"));

  tab.setTime(DEFAULT_DURATION_SECONDS * 1000);
  tab.flushFrames();
  assert.equal(tab.get("#result-title").textContent, "時間到，遊戲結束");
  assert.equal(tab.get("#threshold-note").textContent, "未達門檻，唔計排名。");
  assert.equal(tab.get("#window-note").hidden, true);
  assert.equal(tab.get("#flow-next").hidden, true, "流程外完場唔會出「下一輪」掣");
});

test("DOM 層：?flow=1 鎖定官方單字輪、顯示流程橫額，完場寫入流程再接去詞組", () => {
  withFlowStorage(storage => {
    const tab = rocksModeTab({ flowMode: true });
    assert.deepEqual(storage.read("canclid-contest-official-flow").rounds, {}, "一入 ?flow=1 就開流程");
    assert.match(tab.get("#flow-banner").textContent, /官方流程第 1 輪：單字/);
    assert.match(tab.get("#flow-banner").textContent, /退出流程會丟棄三輪進度/);
    assert.equal(tab.get("#mode-picker").hidden, true, "流程鎖定官方模式");
    assert.equal(tab.get("#mode-note").textContent.includes("官方流程鎖定官方規則"), true);
    assert.equal(tab.get("#intro-eyebrow").textContent, "官方流程 · 單字輪 90 秒", "介紹卡唔會再寫 60 秒");
    assert.equal(tab.get("#lobby-link").textContent, "‹ 退出流程");
    assert.equal(tab.get("#lobby-link").href, "../../index.html");
    assert.equal(tab.get("#flow-next").hidden, true, "未開局未出下一輪掣");

    // 流程唔理模式切換，亦唔會改寫使用者嘅模式偏好。
    tab.get("#mode-practice").fire("click");
    tab.get("#start-button").fire("click");
    const started = tab.calls.at(-1);
    assert.equal(started.options.mode, "official");
    assert.equal(started.options.durationSeconds, 90);
    assert.equal(started.options.lives, null);
    assert.equal(started.options.bank, ROCK_QUESTIONS);
    assert.match(tab.get("#flow-banner").textContent, /seed rocks-0/, "開局要喺頁面顯示隨機 seed");
    assert.equal(tab.mode(), null, "流程唔會寫入模式偏好");
    assert.equal(tab.get("#lives-item").hidden, true);

    tab.setTime(90_000);
    tab.flushFrames();
    assert.equal(tab.get("#result-card").hidden, false);
    const saved = storage.read("canclid-contest-official-flow").rounds.single;
    assert.equal(saved.seconds, 90, "定時輪記固定計分窗");
    assert.equal(saved.correct, 0);
    assert.equal(saved.submitted, 14, "官方單字輪：90 秒內落地嘅 14 塊石全部計提交錯誤");
    assert.equal(saved.accuracy, 0);
    assert.equal(saved.threshold, 0.9);
    assert.equal(saved.meetsThreshold, false);
    assert.equal(saved.officialScore, 0);

    assert.equal(tab.get("#flow-next").hidden, false);
    assert.equal(tab.get("#flow-next").href, "../chain/?flow=1");
    assert.equal(tab.get("#flow-next").textContent, "前往第 2 輪：詞組 →");
    assert.equal(tab.get("#play-again").hidden, true, "流程內冇「再玩一次」");
    assert.equal(tab.get("#result-lobby").hidden, true);
  });
});


// --- i18n：繁體粵語（預設）／簡體粵文（demo/i18n.mjs） ------------------------

const ROCKS_HTML = readFileSync(new URL("../demo/games/rocks/index.html", import.meta.url), "utf8");
const LOCALE_STORAGE_KEY = "canclid-contest-locale";

// 由 index.html 直接抽 data-i18n 元素：key → 繁體原文（同頁面開場嗰陣一樣）。
function i18nEntries(html, attribute = "data-i18n") {
  const pattern = new RegExp(`${attribute}="([^"]+)"[^>]*>([^<]*)<`, "g");
  return [...html.matchAll(pattern)].map(match => ({ key: match[1], hant: match[2] }));
}

// i18n 運行庫喺瀏覽器度讀全局 document／window／localStorage；node 冇，測試暫時掛
// 假嘅上去，令真嘅 demo/i18n.mjs 同 vm 入面嘅頁面模組共用同一個假 DOM。
function withI18nGlobals(values) {
  const saved = new Map();
  for (const [name, value] of Object.entries(values)) {
    saved.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
  }
  return () => {
    for (const [name, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
  };
}

// 同 rocksModeTab 一樣嘅迷你 DOM，但補上 i18n 要用嘅嘢：dataset（靜態文案快取）、
// document.querySelectorAll（data-i18n／data-i18n-placeholder／data-locale-toggle）、
// 假 localStorage，同埋真嘅 i18n 運行庫。
function rocksI18nTab({ flowMode = false } = {}) {
  let now = 0;
  let frameId = 0;
  const frames = new Map();
  const elements = new Map();
  const documentListeners = new Map();
  const storage = new Map();
  const windowListeners = new Map();

  const makeElement = () => {
    const classes = new Set();
    const attributes = new Map();
    const own = new Map();
    const node = {
      hidden: false, textContent: "", value: "", style: {}, dataset: {},
      clientHeight: 300, offsetHeight: 100,
      classList: {
        add: (...names) => names.forEach(name => classes.add(name)),
        remove: (...names) => names.forEach(name => classes.delete(name)),
        contains: name => classes.has(name),
        toggle(name, on) { if (on ?? !classes.has(name)) classes.add(name); else classes.delete(name); },
      },
      setAttribute: (name, value) => attributes.set(name, String(value)),
      getAttribute: name => attributes.get(name) ?? null,
      focus() {}, blur() {},
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

  const staticNodes = i18nEntries(ROCKS_HTML).map(({ key, hant }) => {
    const node = makeElement();
    node.textContent = hant;
    // 真 DOM 會將 data-i18n 屬性反映去 dataset；i18n 運行庫靠 el.dataset.i18n 攞 key。
    node.dataset.i18n = key;
    return { key, node };
  });
  const toggle = makeElement();

  const document = {
    documentElement: makeElement(),
    querySelector: get,
    querySelectorAll(selector) {
      if (selector === "[data-i18n]") return staticNodes.map(entry => entry.node);
      if (selector === "[data-locale-toggle]") return [toggle];
      return [];
    },
    addEventListener(type, listener) { documentListeners.set(type, listener); },
  };
  const window = {
    CustomEvent: class {
      constructor(type, options) { this.type = type; this.detail = options?.detail; }
    },
    addEventListener(type, listener) {
      if (!windowListeners.has(type)) windowListeners.set(type, []);
      windowListeners.get(type).push(listener);
    },
    dispatchEvent(event) { for (const listener of windowListeners.get(event.type) ?? []) listener(event); },
  };
  const localStorage = {
    getItem: key => (storage.has(key) ? storage.get(key) : null),
    setItem: (key, value) => { storage.set(key, String(value)); },
    removeItem: key => { storage.delete(key); },
  };
  const restoreGlobals = withI18nGlobals({ document, window, localStorage, CustomEvent: window.CustomEvent });

  class Clock extends Date {
    static now() { return now; }
  }

  vm.runInContext(DOM_SOURCE, vm.createContext({
    Date: Clock,
    OFFICIAL_THRESHOLDS, OFFICIAL_ROCKS, ROCK_QUESTIONS,
    comboMultiplier, formatClock, ROCKS_STORAGE_KEY,
    ...flowApi,
    location: { search: flowMode ? "?flow=1" : "", href: "" },
    URLSearchParams,
    createRocksGame, getFallProgress, getRocksMetrics, tick, typeSyllable,
    readJson: (key, fallback = null) => storage.has(key) ? JSON.parse(storage.get(key)) : fallback,
    writeJson: (key, value) => { storage.set(key, JSON.stringify(value)); return true; },
    // 頁面模組 import { t as i18nT }：import 被剝走之後，i18nT 由呢度嚟。
    i18nT: t, initI18n, registerStrings, setLocale, getLocale,
    document, window, localStorage,
    requestAnimationFrame(callback) { frameId += 1; frames.set(frameId, callback); return frameId; },
    cancelAnimationFrame(id) { frames.delete(id); },
    setTimeout: () => 1,
  }), { filename: "demo/games/rocks/rocks-dom.mjs" });

  return {
    get,
    static: key => staticNodes.find(entry => entry.key === key)?.node ?? null,
    toggle,
    setTime: value => { now = value; },
    flushFrames(limit = 8) {
      for (let i = 0; i < limit && frames.size > 0; i++) {
        const queued = [...frames.values()];
        frames.clear();
        queued.forEach(callback => callback());
      }
    },
    // 還原語言同清走呢個測試寫入嘅 storage，唔好影響其他測試。
    cleanup() {
      setLocale("yue-Hant");
      storage.clear();
      restoreGlobals();
    },
  };
}

test("i18n：切去簡體粵文，靜態文案、動態文案同切換掣一齊變，切返繁體還原", () => {
  const tab = rocksI18nTab();
  try {
    assert.equal(getLocale(), "yue-Hant", "node 冇 navigator，預設一定係繁體");
    assert.equal(tab.static("rocks.title").textContent, "粵拼落石");
    assert.equal(tab.static("rocks.how3").textContent, "漏接一次扣一條命。三條命用完，或者 60 秒倒數完，即刻結算。");
    assert.equal(tab.toggle.textContent, "简");
    assert.equal(tab.get("#mode-note").textContent, "練習模式：60 秒、三條命，成績只存本機。");

    setLocale("yue-Hans");
    assert.equal(localStorage.getItem(LOCALE_STORAGE_KEY), "yue-Hans");

    // 靜態文案（index.html 嘅 data-i18n）
    assert.equal(tab.static("rocks.title").textContent, "粤拼落石");
    assert.equal(tab.static("rocks.how3").textContent, "漏接一次扣一条命。三条命用完，或者 60 秒倒数完，即刻结算。");
    assert.equal(tab.static("rocks.modePractice").textContent, "练习");
    assert.equal(tab.static("rocks.start").textContent, "开始游戏");
    // 切換掣：簡體界面顯示「繁」
    assert.equal(tab.toggle.textContent, "繁");
    assert.equal(tab.toggle.getAttribute("aria-pressed"), "true");

    // 動態文案（模組 t() 畫出嚟）
    assert.equal(tab.get("#mode-note").textContent, "练习模式：60 秒、三条命，成绩只存本机。");
    tab.get("#start-button").fire("click");
    assert.equal(tab.get("#feedback").textContent, "打粤拼，按 Space 或 Enter 提交（准确度要达 90% 先计排名）");

    tab.setTime(DEFAULT_DURATION_SECONDS * 1000);
    tab.flushFrames();
    assert.equal(tab.get("#result-title").textContent, "时间到，游戏结束");
    assert.equal(tab.get("#threshold-note").textContent, "未达门槛，唔计排名。");
    assert.equal(tab.get("#result-detail").textContent, "击破 0 个字 · 打错 0 次 · 漏接 0 次 · 最高连击 0");
    assert.equal(tab.get("#best-note").textContent, "本地最佳：未有纪录（要达门槛先会记录）");

    // 切返繁體：靜態、動態同切換掣全部還原
    setLocale("yue-Hant");
    assert.equal(localStorage.getItem(LOCALE_STORAGE_KEY), "yue-Hant");
    assert.equal(tab.static("rocks.title").textContent, "粵拼落石");
    assert.equal(tab.static("rocks.start").textContent, "開始遊戲");
    assert.equal(tab.toggle.textContent, "简");
    assert.equal(tab.toggle.getAttribute("aria-pressed"), "false");
    assert.equal(tab.get("#mode-note").textContent, "練習模式：60 秒、三條命，成績只存本機。");
    assert.equal(tab.get("#feedback").textContent, "打粵拼，按 Space 或 Enter 提交（準確度要達 90% 先計排名）");
    assert.equal(tab.get("#result-title").textContent, "時間到，遊戲結束");
    assert.equal(tab.get("#threshold-note").textContent, "未達門檻，唔計排名。");
  } finally {
    tab.cleanup();
  }
});

test("i18n：?flow=1 流程橫額、介紹卡文案同「前往第 N 輪」掣跟語言變", () => {
  withFlowStorage(() => {
    const tab = rocksI18nTab({ flowMode: true });
    try {
      assert.match(tab.get("#flow-banner").textContent, /官方流程第 1 輪：單字 · 固定 90 秒、無命/);
      assert.equal(tab.get("#intro-eyebrow").textContent, "官方流程 · 單字輪 90 秒");

      setLocale("yue-Hans");
      assert.equal(tab.get("#flow-banner").textContent,
        "官方流程第 1 轮：单字 · 固定 90 秒、无命 · 退出流程会丢弃三轮进度。");
      assert.equal(tab.get("#intro-eyebrow").textContent, "官方流程 · 单字轮 90 秒");
      assert.equal(tab.get("#lobby-link").textContent, "‹ 退出流程");

      // 開局之後橫額要帶 seed，完場之後「下一輪」掣都要跟語言。
      tab.get("#start-button").fire("click");
      assert.match(tab.get("#flow-banner").textContent, /^官方流程第 1 轮：单字 · seed rocks-0 · 固定 90 秒、无命。$/);
      tab.setTime(90_000);
      tab.flushFrames();
      assert.equal(tab.get("#flow-next").textContent, "前往第 2 轮：词组 →");

      setLocale("yue-Hant");
      assert.equal(tab.get("#flow-next").textContent, "前往第 2 輪：詞組 →");
      assert.match(tab.get("#flow-banner").textContent, /^官方流程第 1 輪：單字 · seed rocks-0 · 固定 90 秒、無命。$/);
      assert.equal(tab.get("#intro-eyebrow").textContent, "官方流程 · 單字輪 90 秒");
      assert.equal(tab.get("#lobby-link").textContent, "‹ 退出流程");
    } finally {
      tab.cleanup();
    }
  });
});
