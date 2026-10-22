import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import {
  OFFICIAL_CHAIN,
  createChainGame,
  finishByTime,
  getChainMetrics,
  recallSyllable,
  typeSyllable,
  validateBank,
} from "../demo/games/chain/chain.mjs";
import { CHAIN_BANK } from "../demo/games/chain/data.mjs";
import { comboMultiplier, formatClock, hashSeed, mulberry32, normalizeAnswer, shuffled } from "../demo/games/common.mjs";

// Two-syllable words keep the hand-computed arithmetic readable.
const bank = [
  { word: "香港", syllables: ["hoeng", "gong"] },
  { word: "唔該", syllables: ["m", "goi"] },
  { word: "飲茶", syllables: ["jam", "caa"] },
  { word: "落雨", syllables: ["lok", "jyu"] },
  { word: "開心", syllables: ["hoi", "sam"] },
  { word: "電話", syllables: ["din", "waa"] },
  { word: "老師", syllables: ["lou", "si"] },
  { word: "電腦", syllables: ["din", "nou"] },
];

// Twelve one-syllable words so every submission also closes a word.
const singleBank = [
  { word: "粥", syllables: ["zuk"] },
  { word: "湯", syllables: ["tong"] },
  { word: "橙", syllables: ["caang"] },
  { word: "梨", syllables: ["lei"] },
  { word: "桃", syllables: ["tou"] },
  { word: "梅", syllables: ["mui"] },
  { word: "杏", syllables: ["hang"] },
  { word: "柚", syllables: ["jau"] },
  { word: "蕉", syllables: ["ziu"] },
  { word: "菜", syllables: ["coi"] },
  { word: "肉", syllables: ["juk"] },
  { word: "糖", syllables: ["tong"] },
];

const close = (actual, expected, tolerance = 1e-9, message = null) => {
  assert.ok(Math.abs(actual - expected) < tolerance,
    message ?? `${actual} is not within ${tolerance} of ${expected}`);
};

const start = (options = {}) => createChainGame({ now: 0, seed: "chain", wordCount: 4, bank, ...options });

// Play the whole game, answering every syllable of the drawn sequence correctly.
function playAll(game, step = 5000) {
  let now = 0;
  for (const word of game.words) {
    for (const syllable of word.syllables) {
      now += step;
      game = typeSyllable(game, syllable, now);
    }
  }
  return { game, now };
}

test("the same seed draws the same word sequence through hashSeed, mulberry32 and shuffled", () => {
  const first = start({ seed: "canclid" });
  const second = start({ seed: "canclid" });
  assert.deepEqual(first.words, second.words);
  assert.equal(first.words.length, 4);
  assert.equal(first.seed, "canclid");
  assert.deepEqual(first.words, shuffled(bank, mulberry32(hashSeed("canclid"))).slice(0, 4));
  assert.notDeepEqual(start({ seed: "jyutping" }).words.map(word => word.word), first.words.map(word => word.word));
  const long = createChainGame({ now: 0, seed: "canclid", wordCount: 11, bank });
  assert.equal(long.words.length, 11, "a game longer than the bank draws extra shuffles");
  assert.deepEqual(createChainGame({ now: 0, seed: "canclid", wordCount: 11, bank }).words, long.words);
});

test("a chain game starts empty and rejects invalid configuration", () => {
  const game = start();
  assert.equal(game.status, "running");
  assert.equal(game.startedAt, 0);
  assert.equal(game.finishedAt, null);
  assert.equal(game.wordIndex, 0);
  assert.equal(game.syllableIndex, 0);
  assert.deepEqual(game.answers, []);
  assert.equal(game.combo, 0);
  assert.equal(game.score, 0);
  assert.throws(() => createChainGame({ now: NaN, seed: "s", bank }), TypeError);
  assert.throws(() => createChainGame({ now: 0, seed: "s", bank: [] }), TypeError);
  assert.throws(() => createChainGame({ now: 0, seed: "s", wordCount: 0, bank }), TypeError);
  assert.throws(() => createChainGame({ now: 0, seed: "s", bank: [{ word: "香港", syllables: ["hoeng"] }] }), TypeError);
});

test("each submitted syllable advances whether it is right or wrong", () => {
  const first = start();
  const word = first.words[0];
  const right = typeSyllable(first, ` ${word.syllables[0].toUpperCase()} `, 1000);
  assert.equal(right.syllableIndex, 1);
  assert.equal(right.wordIndex, 0);
  assert.equal(right.lastResult, "correct");
  assert.equal(right.lastAnswer, word.syllables[0]);
  assert.equal(right.correct, 1);
  assert.equal(right.errors, 0);
  assert.deepEqual(first.answers, [], "the original state is not mutated");

  const wrong = typeSyllable(right, "zzz", 2000);
  assert.equal(wrong.lastResult, "incorrect");
  assert.equal(wrong.wordIndex, 1, "the word closed, so the chain moved on");
  assert.equal(wrong.syllableIndex, 0);
  assert.equal(wrong.correct, 1);
  assert.equal(wrong.errors, 1);
  assert.deepEqual(wrong.answers.map(answer => answer.answer), [word.syllables[0], "zzz"]);
  assert.deepEqual(wrong.answers.map(answer => answer.correct), [true, false]);
  assert.deepEqual(wrong.answers.map(answer => answer.at), [1000, 2000]);

  assert.equal(typeSyllable(wrong, "   ", 3000), wrong, "an empty submission does not advance");
  assert.equal(typeSyllable(wrong, "zzz", -1), wrong, "a timestamp before the start is ignored");
  assert.equal(typeSyllable(wrong, "zzz", NaN), wrong, "a non-finite timestamp is ignored");
});

test("a fully correct word raises the combo and any error inside a word resets it", () => {
  let game = start();
  const [firstWord, secondWord] = game.words;
  for (const [index, syllable] of firstWord.syllables.entries()) {
    game = typeSyllable(game, syllable, 1000 * (index + 1));
    assert.equal(game.combo, index === firstWord.syllables.length - 1 ? 1 : 0,
      "the combo only moves when the word is judged");
  }
  assert.equal(game.wordResult, "correct");
  assert.equal(game.combo, 1);
  close(game.score, 2, 1e-12, "two syllables at x1.0");

  game = typeSyllable(game, "zzz", 3000);
  assert.equal(game.combo, 1, "a wrong syllable alone does not break the combo yet");
  close(game.score, 2);
  game = typeSyllable(game, secondWord.syllables[1], 4000);
  assert.equal(game.wordResult, "incorrect");
  assert.equal(game.combo, 0, "one error in the word resets the combo");
  close(game.score, 3.1, 1e-12, "the correct syllable still scored at x1.1");

  game = typeSyllable(game, game.words[2].syllables[0], 5000);
  close(game.score, 4.1, 1e-12, "after the reset the multiplier is back to x1.0");
});

test("the combo multiplier is capped at 1.5", () => {
  assert.equal(comboMultiplier(0), 1);
  assert.equal(comboMultiplier(1), 1.1);
  assert.equal(comboMultiplier(5), 1.5);
  assert.equal(comboMultiplier(50), 1.5);

  let game = createChainGame({ now: 0, seed: "cap", wordCount: 12, bank: singleBank });
  let previous = game.score;
  for (const [index, word] of game.words.entries()) {
    game = typeSyllable(game, word.syllables[0], 1000 * (index + 1));
    close(game.score - previous, comboMultiplier(index), 1e-12, `word ${index + 1} gain`);
    previous = game.score;
  }
  assert.equal(game.status, "finished");
  assert.equal(game.combo, 12);
  // 1 + 1.1 + 1.2 + 1.3 + 1.4 + 1.5 x 7
  close(game.score, 16.5);
  assert.equal(getChainMetrics(game, 12000).multiplier, 1.5);
});

test("recall drops the last syllable and rolls back its score and combo", () => {
  let game = start();
  const word = game.words[0];
  const empty = game;
  assert.equal(recallSyllable(empty), empty, "nothing to recall at the start");

  game = typeSyllable(game, word.syllables[0], 1000);
  const afterFirst = game;
  game = typeSyllable(game, word.syllables[1], 2000);
  assert.equal(game.combo, 1);
  assert.equal(game.score, 2);
  assert.equal(game.wordIndex, 1);

  const recalled = recallSyllable(game);
  assert.equal(recalled.wordIndex, 0);
  assert.equal(recalled.syllableIndex, 1, "the recalled syllable is the current one again");
  assert.equal(recalled.combo, 0, "the combo raised by the finished word rolls back");
  close(recalled.score, 1, 1e-12);
  assert.equal(recalled.correct, 1);
  assert.equal(recalled.errors, 0);
  assert.equal(recalled.lastResult, null);
  assert.equal(recalled.lastAnswer, word.syllables[1]);
  assert.deepEqual(recalled.answers, afterFirst.answers);
  assert.equal(game.answers.length, 2, "the recalled state is untouched");

  const retyped = typeSyllable(recalled, word.syllables[1], 3000);
  assert.equal(retyped.combo, 1);
  close(retyped.score, 2, 1e-12, "retyping the syllable restores the same score");
  assert.deepEqual(retyped.answers.map(answer => answer.answer), game.answers.map(answer => answer.answer));

  const wrongThenBack = recallSyllable(typeSyllable(recalled, "zzz", 3000));
  assert.equal(wrongThenBack.errors, 0);
  assert.equal(wrongThenBack.combo, 0);
  close(wrongThenBack.score, 1, 1e-12);
});

test("a finished game freezes its answers, score and metrics", () => {
  const played = playAll(start({ seed: "finish" }));
  const game = played.game;
  assert.equal(game.status, "finished");
  assert.equal(game.finishedAt, played.now);
  assert.equal(game.answers.length, 8);
  assert.equal(game.correct, 8);
  assert.equal(game.errors, 0);
  assert.equal(game.combo, 4);
  assert.equal(game.wordIndex, game.words.length);
  assert.equal(game.syllableIndex, 0);
  // 2 x 1.0 + 2 x 1.1 + 2 x 1.2 + 2 x 1.3
  close(game.score, 9.2);

  const metrics = getChainMetrics(game, played.now + 600000);
  assert.equal(metrics.elapsedSeconds, 40, "the finish time freezes the clock");
  assert.equal(metrics.correct, 8);
  assert.equal(metrics.submitted, 8);
  assert.equal(metrics.errors, 0);
  assert.equal(metrics.accuracy, 1);
  assert.equal(metrics.correctPerMinute, 12);
  assert.equal(metrics.officialScore, 12);
  assert.equal(metrics.threshold, 0.9);
  assert.equal(metrics.meetsThreshold, true);
  assert.equal(metrics.combo, 4);
  assert.equal(metrics.score, game.score);
  assert.equal(metrics.words, 4);
  assert.equal(metrics.completedWords, 4);
  assert.equal(metrics.wordNumber, 4);
  assert.equal(metrics.totalSyllables, 8);
  assert.equal(metrics.progress, 1);
  assert.equal(metrics.status, "finished");

  assert.equal(typeSyllable(game, "hoeng", played.now + 1), game, "no submissions after the finish");
  assert.equal(recallSyllable(game), game, "no recall after the finish");
});

test("a round below the accuracy threshold does not rank", () => {
  let game = start({ seed: "miss" });
  let now = 0;
  for (const [wordIndex, word] of game.words.entries()) {
    for (const syllable of word.syllables) {
      now += 5000;
      game = typeSyllable(game, wordIndex === 0 ? "zzz" : syllable, now);
    }
  }
  const metrics = getChainMetrics(game, now);
  assert.equal(metrics.correct, 6);
  assert.equal(metrics.submitted, 8);
  close(metrics.accuracy, 0.75);
  assert.equal(metrics.meetsThreshold, false, "75% is below the 90% threshold");
  close(metrics.officialScore, 6.75, 1e-9, "correct per minute x accuracy");
  assert.equal(metrics.combo, 3);
});

test("running metrics follow the answers and stay finite before the first submission", () => {
  let game = start({ seed: "live" });
  const empty = getChainMetrics(game, 10000);
  assert.equal(empty.accuracy, 0);
  assert.equal(empty.meetsThreshold, false);
  assert.equal(empty.correctPerMinute, 0);
  assert.equal(empty.officialScore, 0);
  assert.equal(empty.progress, 0);
  assert.equal(empty.wordNumber, 1);
  assert.equal(empty.syllablesInWord, game.words[0].syllables.length);
  assert.equal(empty.multiplier, 1);
  assert.equal(getChainMetrics(game, 0).elapsedSeconds, 0, "a zero timestamp is finite");
  assert.equal(getChainMetrics(game).elapsedSeconds, 0, "a missing timestamp falls back to the start");

  game = typeSyllable(game, game.words[0].syllables[0], 1000);
  const live = getChainMetrics(game, 30000);
  assert.equal(live.elapsedSeconds, 30);
  assert.equal(live.submitted, 1);
  assert.equal(live.correct, 1);
  assert.equal(live.accuracy, 1);
  assert.equal(live.correctPerMinute, 2);
  assert.equal(live.officialScore, 2);
  assert.equal(live.meetsThreshold, true);
  assert.equal(live.syllableIndex, 1);
  assert.equal(live.progress, 0.125);
  assert.equal(live.completedWords, 0);
});

test("the shipped word bank is well formed and the validator rejects broken entries", () => {
  assert.ok(CHAIN_BANK.length >= 40, `expected at least 40 words, got ${CHAIN_BANK.length}`);
  for (const entry of CHAIN_BANK) {
    assert.match(entry.word, /^\p{Script=Han}+$/u);
    assert.equal([...entry.word].length, entry.syllables.length, entry.word);
    assert.ok(entry.syllables.every(syllable => /^[a-z]+$/.test(syllable)), entry.word);
  }
  assert.equal(new Set(CHAIN_BANK.map(entry => entry.word)).size, CHAIN_BANK.length, "no duplicate words");
  assert.ok(CHAIN_BANK.some(entry => entry.syllables.length === 3), "the bank includes three-character words");
  assert.deepEqual(validateBank(bank), bank, "a valid bank is returned unchanged");
  const shipped = createChainGame({ now: 0, seed: "bank", wordCount: 20, bank: CHAIN_BANK });
  assert.equal(shipped.words.length, 20);
  assert.ok(shipped.words.every(word => CHAIN_BANK.some(entry => entry.word === word.word)));

  assert.throws(() => validateBank(null), TypeError);
  assert.throws(() => validateBank([]), TypeError);
  assert.throws(() => validateBank([{ word: "香港", syllables: ["hoeng"] }]), TypeError, "character and syllable counts must match");
  assert.throws(() => validateBank([{ word: "香港", syllables: ["hoeng", "Gong"] }]), TypeError, "uppercase is rejected");
  assert.throws(() => validateBank([{ word: "香港", syllables: ["hoeng", "gong2"] }]), TypeError, "tone numbers are rejected");
  assert.throws(() => validateBank([{ word: "香港", syllables: [] }]), TypeError);
  assert.throws(() => validateBank([{ word: "", syllables: [""] }]), TypeError);
  assert.throws(() => validateBank([{ syllables: ["hoeng", "gong"] }]), TypeError);
});

test("頁面骨架：引用正確資源、有返大廳同賽場嘅連結", () => {
  const html = readFileSync(new URL("../demo/games/chain/index.html", import.meta.url), "utf8");
  assert.match(html, /<link rel="stylesheet" href="\.\/chain\.css">/);
  assert.match(html, /<script src="\.\/chain-dom\.mjs" type="module"><\/script>/);
  assert.match(html, /href="\.\.\/"/, "要連返遊戲大廳");
  assert.match(html, /href="\.\.\/\.\.\/index\.html"/, "要連返試玩賽場");
  assert.match(html, /id="seed"/, "要有 seed 輸入");
  const source = readFileSync(new URL("../demo/games/chain/chain-dom.mjs", import.meta.url), "utf8");
  const ids = [...source.matchAll(/\$\("#([a-z-]+)"\)/g)].map(match => match[1]);
  assert.ok(ids.length > 15, `只搵到 ${ids.length} 個 selector`);
  for (const id of new Set(ids)) assert.ok(html.includes(`id="${id}"`), `index.html 冇 id="${id}"`);
  assert.ok(html.indexOf('id="answer"') > html.indexOf('id="typing-surface"'),
    "隱藏 input 要喺輸入區入面，按鍵先會冒泡到輸入區嘅監聽器");
});

// 用 vm + 迷你 DOM 驅動真嘅 chain-dom.mjs，覆蓋開局、打字、退回重打、完場同寫本地紀錄。
const DOM_SOURCE = readFileSync(new URL("../demo/games/chain/chain-dom.mjs", import.meta.url), "utf8")
  .replace(/^import[\s\S]*?from\s+"[^"]+";\n/gm, "");

function chainTab() {
  let now = 0;
  const store = new Map();
  const elements = new Map();
  const documentListeners = new Map();

  const makeElement = (tagName = "div", parent = null) => {
    const classes = new Set();
    const attributes = new Map();
    const listeners = new Map();
    const children = [];
    let text = "";
    const node = {
      tagName, children, hidden: false, disabled: false, value: "", id: "", style: {}, clientHeight: 300,
      classList: {
        add: (...names) => names.forEach(name => classes.add(name)),
        remove: (...names) => names.forEach(name => classes.delete(name)),
        contains: name => classes.has(name),
        toggle(name, on) { if (on ?? !classes.has(name)) classes.add(name); else classes.delete(name); },
      },
      get className() { return [...classes].join(" "); },
      set className(value) {
        classes.clear();
        String(value).split(/\s+/).filter(Boolean).forEach(name => classes.add(name));
      },
      get textContent() { return text + children.map(child => child.textContent).join(""); },
      set textContent(value) { text = String(value); children.length = 0; },
      setAttribute: (name, value) => attributes.set(name, String(value)),
      getAttribute: name => attributes.get(name) ?? null,
      addEventListener(type, listener) {
        if (!listeners.has(type)) listeners.set(type, []);
        listeners.get(type).push(listener);
      },
      fire(type, event = {}) {
        event.target ??= node;
        event.preventDefault ??= () => {};
        (listeners.get(type) ?? []).forEach(listener => listener(event));
        parent?.fire(type, event);
      },
      append: (...nodes) => { children.push(...nodes); },
      replaceChildren(...nodes) { children.length = 0; children.push(...nodes); },
      focus() {}, blur() {},
    };
    return node;
  };

  // The hidden input sits inside the typing surface in index.html, so keydown
  // reaches the surface listener by bubbling — the harness mirrors that.
  const parents = new Map([["#answer", "#typing-surface"], ["#word", "#typing-surface"]]);
  const get = selector => {
    if (!elements.has(selector)) {
      const parent = parents.has(selector) ? get(parents.get(selector)) : null;
      const element = makeElement(selector === "#answer" ? "input" : "div", parent);
      if (selector.startsWith("#")) element.id = selector.slice(1);
      elements.set(selector, element);
    }
    return elements.get(selector);
  };
  const views = ["#setup-view", "#play-view", "#result-view"].map(get);
  const body = makeElement("body");

  class Clock extends Date {
    static now() { return now; }
  }

  vm.runInContext(DOM_SOURCE, vm.createContext({
    Date: Clock,
    CHAIN_BANK, comboMultiplier, createChainGame, formatClock, getChainMetrics, normalizeAnswer,
    recallSyllable, typeSyllable,
    readJson: (key, fallback = null) => store.has(key) ? JSON.parse(store.get(key)) : fallback,
    writeJson: (key, value) => { store.set(key, JSON.stringify(value)); return true; },
    setInterval: () => 1,
    clearInterval: () => {},
    setTimeout: () => 1,
    document: {
      body,
      querySelector: get,
      querySelectorAll: () => views,
      createElement: makeElement,
      addEventListener(type, listener) { documentListeners.set(type, listener); },
    },
  }), { filename: "demo/games/chain/chain-dom.mjs" });

  let time = 0;
  return {
    get,
    views,
    store,
    record: () => JSON.parse(store.get("canclid-contest-games-chain") ?? "null"),
    setTime: value => { now = value; },
    tick: seconds => { time += seconds * 1000; now = time; return now; },
    key: (key, code = key) => get("#answer").fire("keydown", { key, code }),
    type(text) { for (const letter of text) this.key(letter, `Key${letter.toUpperCase()}`); },
    submit() { this.key(" ", "Space"); },
  };
}

test("DOM 層：開局、逐個音節打出倍率、退回重打、完場同寫本地紀錄", () => {
  const tab = chainTab();
  assert.equal(tab.get("#setup-view").hidden, false);
  assert.equal(tab.get("#play-view").hidden, true);
  assert.match(tab.get("#best-note").textContent, /未有紀錄/);

  tab.get("#seed").value = "dom-seed";
  tab.get("#setup-form").fire("submit");
  assert.equal(tab.get("#setup-view").hidden, true);
  assert.equal(tab.get("#play-view").hidden, false);
  assert.equal(tab.get("#seed-label").textContent, "seed dom-seed");
  assert.equal(tab.get("#progress-label").textContent, "第 1 / 20 個詞");

  const plan = createChainGame({ now: 0, seed: "dom-seed", wordCount: 20, bank: CHAIN_BANK }).words;
  const totalSyllables = plan.reduce((sum, word) => sum + word.syllables.length, 0);

  // 一個錯音節：紅色刪線加綠色正確部分，然後空草稿按 Backspace 退回。
  tab.setTime(1000);
  tab.type("zzz");
  assert.equal(tab.get("#draft").textContent, "zzz");
  tab.submit();
  assert.equal(tab.get("#draft").textContent, "—");
  assert.equal(tab.get("#accuracy").textContent, "0%");
  const wrongCell = tab.get("#word").children[0];
  assert.ok(wrongCell.className.includes("incorrect"));
  const descendants = node => node.children.flatMap(child => [child, ...descendants(child)]);
  const parts = descendants(wrongCell);
  assert.ok(parts.some(child => child.tagName === "del" && child.className.includes("cell-wrong")),
    "錯嘅部分要用刪線標示");
  assert.ok(parts.some(child => child.className.includes("cell-correct")), "要顯示正確嘅音節");
  tab.key("Backspace", "Backspace");
  assert.equal(tab.get("#accuracy").textContent, "—", "退回之後錯誤唔再計");
  assert.equal(tab.get("#combo").textContent, "連擊 0");

  // 第一個詞全部打啱 → 連擊 +1、倍率 ×1.1。
  for (const syllable of plan[0].syllables) {
    tab.tick(1);
    tab.type(syllable);
    tab.submit();
  }
  assert.equal(tab.get("#combo").textContent, "連擊 1");
  assert.equal(tab.get("#multiplier").textContent, "倍率 ×1.1");
  assert.equal(tab.get("#progress-label").textContent, "第 2 / 20 個詞");
  assert.match(tab.get("#feedback").textContent, /全對/);

  for (const word of plan.slice(1)) {
    for (const syllable of word.syllables) {
      tab.tick(1);
      tab.type(syllable);
      tab.submit();
    }
  }

  assert.equal(tab.get("#play-view").hidden, true);
  assert.equal(tab.get("#result-view").hidden, false);
  assert.match(tab.get("#result-title").textContent, /新紀錄/);
  assert.equal(tab.get("#result-accuracy").textContent, "100.0%");
  assert.match(tab.get("#result-threshold").textContent, /達標/);
  assert.equal(tab.get("#result-detail").textContent.startsWith("連擊 20"), true, tab.get("#result-detail").textContent);
  assert.ok(Number(tab.get("#result-score").textContent) > 0);
  assert.match(tab.get("#result-summary").textContent, /42 個音節|個音節/);

  const record = tab.record();
  assert.equal(record.plays.length, 1);
  assert.equal(record.best.correct, totalSyllables);
  assert.equal(record.best.words, 20);
  assert.equal(record.best.seed, "dom-seed");
  assert.ok(record.best.officialScore > 0);
  assert.equal(record.best.meetsThreshold, true);
  assert.match(tab.get("#result-best").textContent, /正式分/);

  tab.get("#play-again").fire("click");
  assert.equal(tab.get("#seed").value, "dom-seed", "再玩一場保留同一個 seed");
  assert.equal(tab.get("#play-view").hidden, true);
  assert.match(tab.get("#best-note").textContent, /本地最佳：正式分/);
});

test("DOM 層：手機原生輸入、IME 拒絕同 Enter 提交", () => {
  const tab = chainTab();
  tab.get("#seed").value = "phone-seed";
  tab.get("#setup-form").fire("submit");
  const answer = tab.get("#answer");
  const input = (value, inputType = "insertText") => {
    answer.value = value;
    answer.fire("input", { inputType, data: value });
  };

  input("din");
  assert.equal(tab.get("#draft").textContent, "din");
  input("香港");
  assert.equal(tab.get("#draft").textContent, "din", "漢字提交唔會變成答案");
  input("zz!");
  assert.equal(tab.get("#draft").textContent, "din", "含非字母嘅提交整批拒絕，同主賽場一致");
  input("din ");
  assert.equal(tab.get("#draft").textContent, "—", "尾巴空白等於提交");
  assert.equal(tab.get("#word").children.filter(child => child.className.includes("correct") ||
    child.className.includes("incorrect")).length, 1);

  answer.fire("beforeinput", { inputType: "deleteContentBackward" });
  assert.match(tab.get("#feedback").textContent, /退回/, "空草稿嘅手機 Backspace 會退回");

  tab.key("d", "KeyD");
  tab.key("i", "KeyI");
  assert.equal(tab.get("#draft").textContent, "di");
  tab.key("Enter", "Enter");
  assert.equal(tab.get("#draft").textContent, "—");
  tab.key("Unidentified", "KeyW");
  assert.equal(tab.get("#draft").textContent, "w", "event.key 唔可用時用 KeyA–KeyZ 鍵碼");
  tab.key("ArrowLeft", "ArrowLeft");
  assert.equal(tab.get("#draft").textContent, "w", "其他按鍵唔會改變草稿");
});

// --- 官方模式（正式詞組輪，docs/INTEGRATION-PLAN.md §A2） --------------------

test("官方模式：連續題流——打完一批唔完場，自動補下一批", () => {
  let game = createChainGame({ now: 0, seed: "official", mode: "official", wordCount: 4, bank });
  assert.equal(game.mode, "official");
  assert.equal(game.durationSeconds, 120);
  assert.equal(game.endsAt, 120_000);
  assert.equal(game.words.length, 4);
  const firstBatch = game.words.map(entry => entry.word);

  let now = 0;
  for (const word of game.words) {
    for (const syllable of word.syllables) {
      now += 1000;
      game = typeSyllable(game, syllable, now);
    }
  }
  assert.equal(game.status, "running", "官方模式唔會打完一批就完場");
  assert.equal(game.finishedAt, null);
  assert.equal(game.words.length, 8, "即場補下一批");
  assert.equal(game.batchCount, 2);
  assert.equal(game.wordIndex, 4, "游標直接入新一批");
  assert.equal(game.syllableIndex, 0);
  assert.deepEqual(game.words.slice(0, 4).map(entry => entry.word), firstBatch);
  assert.ok(game.words.slice(4).every(entry => bank.some(item => item.word === entry.word)));

  for (const word of game.words.slice(4)) {
    for (const syllable of word.syllables) {
      now += 1000;
      game = typeSyllable(game, syllable, now);
    }
  }
  assert.equal(game.words.length, 12, "第二批打完再補第三批");
  assert.equal(game.batchCount, 3);
  assert.equal(game.status, "running");
  assert.equal(game.correct, 16);
});

test("官方模式：同一 seed 嘅連續題流完全可重現", () => {
  const run = () => {
    let game = createChainGame({ now: 0, seed: "repeat", mode: "official", wordCount: 4, bank });
    let now = 0;
    for (let i = 0; i < 30; i++) {
      const word = game.words[game.wordIndex];
      now += 1000;
      game = typeSyllable(game, word.syllables[game.syllableIndex], now);
    }
    return game;
  };
  const first = run();
  const second = run();
  assert.equal(first.words.length, 16, "30 個音節＝15 個詞，跨咗三批");
  assert.deepEqual(first.words, second.words);
  assert.deepEqual(getChainMetrics(first, 30_000), getChainMetrics(second, 30_000));
});

test("官方模式：撤回跨批次邊界都準確回滾，重打出一模一樣嘅題流", () => {
  let game = createChainGame({ now: 0, seed: "recall", mode: "official", wordCount: 4, bank });
  let now = 0;
  for (let i = 0; i < 8; i++) {
    const word = game.words[game.wordIndex];
    now += 1000;
    game = typeSyllable(game, word.syllables[game.syllableIndex], now);
  }
  assert.equal(game.wordIndex, 4);
  assert.equal(game.words.length, 8);
  assert.equal(game.combo, 4);

  const recalled = recallSyllable(game);
  assert.equal(recalled.wordIndex, 3);
  assert.equal(recalled.syllableIndex, 1);
  assert.equal(recalled.combo, 3, "完成咗嘅詞帶起嘅連擊要回滾");
  close(recalled.score, game.score - comboMultiplier(3), 1e-12);

  const retyped = typeSyllable(recalled, recalled.words[3].syllables[1], now + 1000);
  assert.deepEqual(retyped.words, game.words, "重打唔會再補一批、題流一模一樣");
  assert.equal(retyped.batchCount, 2);
  assert.equal(retyped.wordIndex, 4);
  assert.equal(retyped.combo, 4);
  close(retyped.score, game.score, 1e-12);
});

test("官方模式：finishByTime 夠鐘先收卷，凍結答案同計時", () => {
  let game = createChainGame({ now: 0, seed: "time", mode: "official", wordCount: 4, bank });
  let now = 0;
  for (let i = 0; i < 10; i++) {
    const word = game.words[game.wordIndex];
    now += 1000;
    game = typeSyllable(game, word.syllables[game.syllableIndex], now);
  }
  assert.equal(finishByTime(game, 119_999), game, "未夠鐘唔會收卷");
  const finished = finishByTime(game, 120_000);
  assert.equal(finished.status, "finished");
  assert.equal(finished.finishedAt, 120_000, "凍結喺回合終點");
  assert.equal(finished.finishedReason, "time");
  assert.deepEqual(finished.answers, game.answers);
  assert.equal(finished.correct, game.correct);
  assert.equal(finished.score, game.score);
  assert.equal(finishByTime(finished, 130_000), finished, "收卷之後再叫都唔變");
  assert.equal(typeSyllable(finished, "hoeng", 121_000), finished, "完場後唔收提交");
  assert.equal(recallSyllable(finished), finished, "完場後唔可以撤回");
  const metrics = getChainMetrics(finished, 999_999);
  assert.equal(metrics.elapsedSeconds, 120, "計時凍結喺 T0");
  assert.equal(metrics.status, "finished");
  assert.equal(metrics.remainingSeconds, 0);
});

test("官方模式：計分窗固定 T0＝120 秒，唔用實際遊玩時間", () => {
  let game = createChainGame({ now: 0, seed: "window", mode: "official", wordCount: 4, bank });
  let now = 0;
  for (let i = 0; i < 10; i++) {
    const word = game.words[game.wordIndex];
    now += 1000;
    game = typeSyllable(game, word.syllables[game.syllableIndex], now);
  }
  const live = getChainMetrics(game, 10_000);
  assert.equal(live.elapsedSeconds, 10);
  assert.equal(live.scoredSeconds, 120, "計分窗係成個 T0");
  assert.equal(live.correctPerMinute, 5, "10 個 ÷ 2 分鐘，唔係 ÷ 10 秒");
  assert.equal(live.officialScore, 5);
  assert.equal(live.progress, 10 / 120, "官方模式進度跟時間行");

  const final = getChainMetrics(finishByTime(game, 120_000), 120_000);
  assert.equal(final.correctPerMinute, 5);
  assert.equal(final.officialScore, 5);
  assert.equal(final.accuracy, 1);
  assert.equal(final.meetsThreshold, true);
  assert.equal(final.threshold, 0.9);
  assert.equal(final.remainingSeconds, 0);
});

test("官方模式：提交時發現逾時即刻收卷，逾時提交唔入分", () => {
  let game = createChainGame({ now: 0, seed: "late", mode: "official", wordCount: 4, bank });
  game = typeSyllable(game, game.words[0].syllables[0], 1000);
  const before = game.answers.length;
  const late = typeSyllable(game, game.words[0].syllables[1], 120_000);
  assert.equal(late.status, "finished");
  assert.equal(late.finishedReason, "time");
  assert.equal(late.answers.length, before, "逾時提交唔會入答案");
  assert.equal(late.correct, 1);
  assert.equal(late.errors, 0);
  assert.equal(typeSyllable(late, "hoeng", 121_000), late);
});

test("官方模式：OFFICIAL_CHAIN 常數、參數校驗同練習模式唔受影響", () => {
  assert.deepEqual(OFFICIAL_CHAIN, { mode: "official", durationSeconds: 120 });
  const game = createChainGame({ now: 0, seed: "s", wordCount: 4, bank, ...OFFICIAL_CHAIN });
  assert.equal(game.mode, "official");
  assert.equal(game.durationSeconds, 120);
  assert.equal(game.endsAt, 120_000);
  const short = createChainGame({ now: 0, seed: "s", wordCount: 4, bank, mode: "official", durationSeconds: 30 });
  assert.equal(short.endsAt, 30_000);
  assert.throws(() => createChainGame({ now: 0, seed: "s", wordCount: 4, bank, mode: "ranked" }), TypeError);
  assert.throws(() => createChainGame({ now: 0, seed: "s", wordCount: 4, bank, mode: "official", durationSeconds: 0 }), TypeError);

  const practice = start();
  assert.equal(practice.mode, "practice");
  assert.equal(practice.endsAt, null);
  assert.equal(practice.durationSeconds, null);
  assert.equal(finishByTime(practice, 10 ** 9), practice, "練習模式冇定時收卷");
  assert.equal(getChainMetrics(practice, 0).mode, "practice");
});
