import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

import { COMBO_CAP, OFFICIAL_THRESHOLDS, comboMultiplier, formatClock, roundMetrics } from "../demo/games/common.mjs";
import { ROCK_QUESTIONS, validateBank } from "../demo/games/rocks/data.mjs";
import {
  DEFAULT_DURATION_SECONDS,
  DEFAULT_LIVES,
  FALL_DURATION_MS,
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
