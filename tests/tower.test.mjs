import test from "node:test";
import assert from "node:assert/strict";
import { COMPONENTS, splitJyutping } from "../demo/engine.mjs";
import { hashSeed } from "../demo/games/common.mjs";
import { BANK, BANK_WITH_COMPONENTS, validateBank } from "../demo/games/tower/data.mjs";
import {
  ACCURACY_TARGET, ROUND_LENGTH, TOTAL_STAGES, UNLOCK_STAGES,
  createTower, cpmTargetFor, getTowerStats, getWeakComponents,
  nextRound, poolFor, submitAnswer, toSaved, unlockedFor,
} from "../demo/games/tower/tower.mjs";

const component = (stats, type, value) => stats[type].find(item => item.value === value);

// 自製字池：全部係第 1 層已經解鎖嘅元件（b/p/m/f + aa/i/u，無韻尾）。
function startingBank() {
  return [
    { hanzi: "爸", answers: ["baa"] },
    { hanzi: "巴", answers: ["baa"] },
    { hanzi: "把", answers: ["baa"] },
    { hanzi: "霸", answers: ["baa"] },
    { hanzi: "怕", answers: ["paa"] },
    { hanzi: "爬", answers: ["paa"] },
    { hanzi: "趴", answers: ["paa"] },
    { hanzi: "媽", answers: ["maa"] },
    { hanzi: "麻", answers: ["maa"] },
    { hanzi: "馬", answers: ["maa"] },
  ].map(entry => ({ ...entry, ...splitJyutping(entry.answers[0]) }));
}

// 每個字都用同一個答案提交，方便手算元件準確率。
function answerEveryQuestion(state, answer, { seconds = 1.5 } = {}) {
  let clock = 0;
  let result = state;
  while (result.round.outcome === null && result.round.index < result.round.questions.length) {
    clock += seconds * 1000;
    result = submitAnswer(result, answer, clock);
  }
  return result;
}

function playRound(state, { seconds = 1.5, wrongAt = -1 } = {}) {
  let clock = state.round.updatedAt ?? 0;
  let result = state;
  let answered = 0;
  while (result.round.outcome === null && result.round.index < result.round.questions.length) {
    const question = result.round.questions[result.round.index];
    clock += seconds * 1000;
    result = submitAnswer(result, answered === wrongAt ? "zzz" : question.answers[0], clock);
    answered++;
  }
  return result;
}

test("題庫自我校驗：單一漢字、非空讀音、元件全部屬於 COMPONENTS", () => {
  assert.ok(BANK.length >= 80, `題庫得 ${BANK.length} 個字`);
  assert.deepEqual(validateBank(), []);
  assert.equal(BANK_WITH_COMPONENTS.length, BANK.length);
  for (const entry of BANK_WITH_COMPONENTS) {
    assert.match(entry.hanzi, /^\p{Script=Han}$/u, entry.hanzi);
    assert.ok(entry.answers.length > 0, entry.hanzi);
    for (const answer of entry.answers) assert.match(answer, /^[a-z]+$/, `${entry.hanzi} ${answer}`);
    assert.deepEqual(
      { initial: entry.initial, nucleus: entry.nucleus, coda: entry.coda },
      splitJyutping(entry.answers[0]),
      entry.hanzi,
    );
    assert.ok(entry.initial === "" || COMPONENTS.initial.includes(entry.initial), entry.hanzi);
    assert.ok(COMPONENTS.nucleus.includes(entry.nucleus), entry.hanzi);
    assert.ok(entry.coda === "" || COMPONENTS.coda.includes(entry.coda), entry.hanzi);
  }
  // 每個元件都要有字可以練，否則解鎖完都無題出。
  for (const [type, values] of Object.entries(COMPONENTS)) {
    const used = new Set(BANK_WITH_COMPONENTS.map(entry => entry[type]).filter(Boolean));
    for (const value of values) assert.ok(used.has(value), `${type} ${value} 冇題目`);
  }
});

test("validateBank 捉到壞資料，但接受零聲母", () => {
  assert.deepEqual(validateBank([{ hanzi: "天", answers: ["tin"] }]), []);
  assert.deepEqual(validateBank([{ hanzi: "呀", answers: ["aa"] }]), []);
  assert.deepEqual(validateBank([{ hanzi: "五", answers: ["ng"] }]), []);
  assert.equal(validateBank([{ hanzi: "天", answers: [] }]).length, 1);
  assert.equal(validateBank([{ hanzi: "天天", answers: ["tin"] }]).length, 1);
  assert.equal(validateBank([{ hanzi: "天", answers: ["tin5"] }]).length, 1);
  assert.equal(validateBank([{ hanzi: "天", answers: ["zzz"] }]).length, 1);
  assert.equal(validateBank([{ hanzi: "天", answers: ["gz"] }]).length, 1, "韻腹唔係 COMPONENTS 嘅值");
  assert.equal(validateBank([
    { hanzi: "天", answers: ["tin"] },
    { hanzi: "天", answers: ["tin"] },
  ]).length, 1, "同一個漢字唔應該出現兩次");
});

test("解鎖順序最終覆蓋全部 COMPONENTS，逐層加而且唔重複", () => {
  const final = unlockedFor(TOTAL_STAGES);
  assert.deepEqual([...final.unlockedInitials].sort(), [...COMPONENTS.initial].sort());
  assert.deepEqual([...final.unlockedNuclei].sort(), [...COMPONENTS.nucleus].sort());
  assert.deepEqual([...final.unlockedCodas].sort(), [...COMPONENTS.coda].sort());

  // 第 1 層跟設計：b、p、m、f 加 aa、i、u。
  assert.deepEqual(UNLOCK_STAGES[0].initials, ["b", "p", "m", "f"]);
  assert.deepEqual(UNLOCK_STAGES[0].nuclei, ["aa", "i", "u"]);
  assert.deepEqual(UNLOCK_STAGES[0].codas, []);

  const seen = { initials: new Set(), nuclei: new Set(), codas: new Set() };
  for (const [index, stage] of UNLOCK_STAGES.entries()) {
    assert.equal(stage.stage, index + 1);
    const added = stage.initials.length + stage.nuclei.length + stage.codas.length;
    if (index > 0) assert.ok(added >= 3 && added <= 5, `第 ${stage.stage} 層加咗 ${added} 個元件`);
    for (const [key, allowed] of [["initials", COMPONENTS.initial], ["nuclei", COMPONENTS.nucleus], ["codas", COMPONENTS.coda]]) {
      for (const value of stage[key]) {
        assert.ok(allowed.includes(value), `${value} 唔屬於 ${key}`);
        assert.ok(!seen[key].has(value), `${value} 重複解鎖`);
        seen[key].add(value);
      }
    }
  }
  // 先聲母、後韻腹、最後韻尾：最後一層全部係韻尾，韻尾未出之前唔會出新聲母。
  assert.ok(UNLOCK_STAGES.at(-1).codas.length > 0);
  assert.deepEqual(UNLOCK_STAGES.at(-1).initials, []);
  assert.deepEqual(UNLOCK_STAGES.at(-1).nuclei, []);
  const lastInitialStage = UNLOCK_STAGES.findLastIndex(stage => stage.initials.length > 0);
  const firstCodaStage = UNLOCK_STAGES.findIndex(stage => stage.codas.length > 0);
  assert.ok(lastInitialStage < firstCodaStage, "韻尾唔應該早過聲母出現");
  assert.equal(cpmTargetFor(1), 20);
  assert.ok(cpmTargetFor(TOTAL_STAGES) > cpmTargetFor(1), "目標要跟層數加");
});

test("每層字池都夠抽 10 題，而且 nextRound 只出已解鎖元件嘅字", () => {
  for (const stage of UNLOCK_STAGES) {
    const state = {
      status: "playing",
      stage: stage.stage,
      bank: BANK_WITH_COMPONENTS,
      ...unlockedFor(stage.stage),
      accuracyTarget: ACCURACY_TARGET,
      round: { questions: [] },
    };
    assert.ok(poolFor(state).length >= ROUND_LENGTH, `第 ${stage.stage} 層字池唔夠`);
    const dealt = nextRound(state, hashSeed(`stage-${stage.stage}`));
    assert.equal(dealt.round.questions.length, ROUND_LENGTH);
    assert.equal(new Set(dealt.round.questions.map(question => question.hanzi)).size, ROUND_LENGTH);
    for (const question of dealt.round.questions) {
      assert.ok(question.initial === "" || state.unlockedInitials.includes(question.initial), question.hanzi);
      assert.ok(state.unlockedNuclei.includes(question.nucleus), question.hanzi);
      assert.ok(question.coda === "" || state.unlockedCodas.includes(question.coda), question.hanzi);
    }
    // 同一個種子出同一批題；唔同種子多數唔同。
    assert.deepEqual(nextRound(state, 7).round.questions, nextRound(state, 7).round.questions);
    assert.equal(poolFor(state).length, poolFor({ ...state }).length);
  }
});

test("10 題全中而且夠快就解鎖下一層", () => {
  const start = createTower({ now: 0, bank: startingBank(), seed: 11 });
  assert.equal(start.stage, 1);
  assert.equal(start.round.questions.length, ROUND_LENGTH);
  assert.deepEqual(start.unlockedInitials, ["b", "p", "m", "f"]);

  let now = 0;
  let state = start;
  for (const question of start.round.questions) {
    now += 1500;
    state = submitAnswer(state, question.answers[0], now);
  }
  assert.equal(state.round.outcome, "passed");
  assert.equal(state.round.metrics.accuracy, 1);
  // 第一次提交開始計時：10 題隔 1.5 秒 → 最後一題喺 13.5 秒 → 10 / (13.5 / 60)。
  assert.equal(state.round.metrics.correctPerMinute, 10 / (13.5 / 60));
  assert.equal(state.round.metrics.correctPerMinute > cpmTargetFor(1), true);
  assert.equal(state.stage, 2);
  assert.ok(state.unlockedInitials.includes("d") && state.unlockedInitials.includes("l"));
  assert.ok(state.unlockedNuclei.includes("a"));
  assert.equal(state.rounds.length, 1);
  assert.deepEqual(
    { stage: state.rounds[0].stage, correct: state.rounds[0].correct, passed: state.rounds[0].passed },
    { stage: 1, correct: 10, passed: true },
  );
  assert.equal(state.completedAt, null);
});

test("有一題錯就留喺原本層數重出", () => {
  const start = createTower({ now: 0, bank: startingBank(), seed: 11 });
  const state = playRound(start, { wrongAt: 3 });
  assert.equal(state.round.outcome, "retry");
  assert.equal(state.round.metrics.accuracy, 0.9);
  assert.ok(state.round.metrics.accuracy < ACCURACY_TARGET, "95% 目標下 9/10 唔算達標");
  assert.equal(state.stage, 1);
  assert.equal(state.rounds[0].passed, false);
  const again = nextRound(state, hashSeed("retry"));
  assert.equal(again.stage, 1);
  assert.equal(again.round.outcome, null);
  assert.equal(again.round.questions.length, ROUND_LENGTH);
  assert.equal(again.round.index, 0);
  assert.deepEqual(again.unlockedInitials, ["b", "p", "m", "f"]);
});

test("夠準但太慢都留層；剛剛好達到目標就過關", () => {
  const slow = playRound(createTower({ now: 0, bank: startingBank(), seed: 5 }), { seconds: 4 });
  assert.equal(slow.round.metrics.accuracy, 1);
  // 10 題隔 4 秒 → 36 秒打完 10 個 → 16.67 音節／分，慢過第 1 層目標。
  assert.equal(slow.round.metrics.correctPerMinute, 10 / (36 / 60));
  assert.ok(slow.round.metrics.correctPerMinute < cpmTargetFor(1));
  assert.equal(slow.round.outcome, "retry");
  assert.equal(slow.stage, 1);

  // 第一次提交開始計時：第一次 0 秒、最後一次 30 秒 → 30 秒打 10 個 = 20 音節／分，剛剛好達標。
  let now = 0;
  let exact = createTower({ now: 0, bank: startingBank(), seed: 5 });
  for (const [index, question] of exact.round.questions.entries()) {
    now = index * 30000 / 9;
    exact = submitAnswer(exact, question.answers[0], now);
  }
  assert.equal(exact.round.metrics.correctPerMinute, 20);
  assert.ok(exact.round.metrics.correctPerMinute >= cpmTargetFor(1));
  assert.equal(exact.round.outcome, "passed");
});

test("元件準確率逐個計：母音同韻腹分開，零韻尾唔會有格", () => {
  // 自製字池：4 個 baa、3 個 paa、3 個 maa，全部同一個韻腹 aa、無韻尾。
  const state = answerEveryQuestion(createTower({ now: 0, bank: startingBank(), seed: 3 }), "baa");
  assert.equal(state.round.outcome, "retry", "10 題得 4 題啱，留返第 1 層重出");
  assert.equal(state.stage, 1);
  const stats = getTowerStats(state);
  // 全部答 baa：b 聲母嘅 4 題啱，p 同 m 嘅 6 題錯；韻腹 aa 全中。
  assert.deepEqual(component(stats.components, "initial", "b"), { value: "b", correct: 4, total: 4, accuracy: 100 });
  assert.deepEqual(component(stats.components, "initial", "p"), { value: "p", correct: 0, total: 3, accuracy: 0 });
  assert.deepEqual(component(stats.components, "initial", "m"), { value: "m", correct: 0, total: 3, accuracy: 0 });
  assert.deepEqual(component(stats.components, "nucleus", "aa"), { value: "aa", correct: 10, total: 10, accuracy: 100 });
  assert.equal(component(stats.components, "nucleus", "i").total, 0);
  assert.ok(stats.components.coda.every(item => item.total === 0 && item.accuracy === null));
  assert.deepEqual(stats.correct, 4, "4 個 baa 字答啱");
  assert.deepEqual(stats.submitted, 10);
  assert.equal(stats.round.accuracy, 0.4, "4 / 10 題完全答啱");

  // 有一題答錯：冇變嘅元件照計。
  const mixed = createTower({ now: 0, bank: startingBank(), seed: 3 });
  const wrongAnswer = mixed.round.questions[0].answers[0] === "baa" ? "maa" : "baa";
  const answered = submitAnswer(mixed, wrongAnswer, 1000);
  const partial = getTowerStats(answered);
  assert.equal(partial.submitted, 1);
  assert.equal(partial.correct, 0);
  assert.equal(partial.round.accuracy, 0);
  assert.equal(component(partial.components, "initial", mixed.round.questions[0].initial).accuracy, 0);
});

test("有韻尾嘅字：韻尾單獨計一格，零韻尾嘅字唔會計入韻尾", () => {
  const bank = [
    { hanzi: "水", answers: ["seoi"] },
    { hanzi: "去", answers: ["heoi"] },
    { hanzi: "對", answers: ["deoi"] },
    { hanzi: "書", answers: ["syu"] },
    { hanzi: "雨", answers: ["jyu"] },
  ].map(entry => ({ ...entry, ...splitJyutping(entry.answers[0]) }));
  const start = createTower({ now: 0, bank, saved: { stage: 6 }, seed: 2 });
  assert.equal(start.round.questions.length, 5, "字池得 5 個字");
  const state = answerEveryQuestion(start, "seoi", { seconds: 1 });
  const stats = getTowerStats(state);
  assert.deepEqual(component(stats.components, "coda", "i"), { value: "i", correct: 3, total: 3, accuracy: 100 });
  assert.equal(component(stats.components, "coda", "n").total, 0);
  assert.deepEqual(component(stats.components, "nucleus", "eo"), { value: "eo", correct: 3, total: 3, accuracy: 100 });
  assert.deepEqual(component(stats.components, "nucleus", "yu"), { value: "yu", correct: 0, total: 2, accuracy: 0 });
  assert.deepEqual(component(stats.components, "initial", "s"), { value: "s", correct: 2, total: 2, accuracy: 100 });
  assert.deepEqual(component(stats.components, "initial", "h"), { value: "h", correct: 0, total: 1, accuracy: 0 });
  assert.deepEqual(getWeakComponents(state, { threshold: 50 }), {
    initial: ["d", "h", "j"], nucleus: ["yu"], coda: [],
  });
});

test("打完全部層數就 completed，之後唔會再轉層", () => {
  let state = createTower({ now: 0, seed: 21 });
  let clock = 0;
  for (let stage = 1; stage <= TOTAL_STAGES; stage++) {
    state = playRound(state, { seconds: 1.2 });
    clock = state.round.updatedAt;
    if (state.status === "playing") state = nextRound(state, hashSeed(`round-${stage}`));
  }
  assert.equal(state.status, "completed");
  assert.equal(state.stage, TOTAL_STAGES);
  assert.equal(state.rounds.length, TOTAL_STAGES);
  assert.ok(state.rounds.every(item => item.passed));
  assert.equal(Number.isFinite(state.completedAt), true);
  const final = unlockedFor(state.stage);
  assert.equal(final.unlockedInitials.length, COMPONENTS.initial.length);
  assert.equal(final.unlockedNuclei.length, COMPONENTS.nucleus.length);
  assert.equal(final.unlockedCodas.length, COMPONENTS.coda.length);

  const frozen = submitAnswer(state, "baa", clock + 1000);
  assert.equal(frozen, state, "完成後唔應該再改狀態");
  assert.equal(nextRound(state, 5), state, "完成後唔會再出題");
  const stats = getTowerStats(state);
  assert.equal(stats.status, "completed");
  assert.equal(stats.stage, TOTAL_STAGES);
  assert.equal(stats.rounds, TOTAL_STAGES);
  assert.equal(stats.cleared, TOTAL_STAGES);
  assert.equal(stats.componentCount, 38);
});

test("進度可以存低再還原，壞資料唔會爆", () => {
  const start = createTower({ now: 0, bank: startingBank(), seed: 8 });
  const played = playRound(start, { seconds: 1 });
  const saved = toSaved(played);
  const restored = createTower({ now: 5000, saved });
  assert.equal(restored.stage, played.stage);
  assert.equal(restored.status, played.status);
  assert.equal(restored.log.length, ROUND_LENGTH);
  assert.deepEqual(restored.unlockedInitials, played.unlockedInitials);
  assert.deepEqual(toSaved(restored).log, saved.log);
  assert.equal(getTowerStats(restored).rounds, 1, "新一輪未打，但上一輪嘅紀錄同累計準確率都保留");
  assert.equal(getTowerStats(restored).components.initial.find(item => item.value === "b").total > 0, true);

  for (const bad of [null, undefined, 42, "nope", {}, { stage: 99 }, { stage: "3", log: "x" },
    { stage: 3, status: "nope", rounds: [{ stage: 1 }], log: [{ hanzi: "天" }] }]) {
    const state = createTower({ now: 0, saved: bad });
    assert.equal(state.stage >= 1 && state.stage <= TOTAL_STAGES, true);
    assert.ok(["playing", "completed"].includes(state.status));
    assert.deepEqual(state.log, []);
    assert.deepEqual(state.rounds, []);
    assert.equal(state.round.questions.length, ROUND_LENGTH);
  }
});

test("未輸入、非有限時間同完成之後嘅提交都唔會改到狀態", () => {
  const state = createTower({ now: 0, bank: startingBank(), seed: 4 });
  assert.equal(submitAnswer(state, "   ", 1000), state);
  assert.equal(submitAnswer(state, "!!", 1000), state);
  assert.equal(submitAnswer(state, "baa", NaN), state);
  assert.equal(submitAnswer(state, "baa", Infinity), state);
  const answered = submitAnswer(state, " BAA ", 1000);
  assert.equal(answered.round.index, 1);
  assert.equal(answered.log[0].answer, "baa", "答案會先正規化");
  assert.equal(answered.round.answers[0].correct, true);
  assert.equal(state.round.index, 0, "原本嘅狀態唔會變");
});

test("字池夾唔到字嘅時候唔會出題，亦唔會爆", () => {
  const state = createTower({ now: 0, bank: [], seed: 1 });
  assert.equal(state.round.questions.length, 0);
  assert.equal(state.round.outcome, "empty");
  assert.equal(state.round.index, 0);
  assert.equal(submitAnswer(state, "baa", 1000), state);
  assert.equal(nextRound(state, 2).round.outcome, "empty");
  // 得 3 個字嘅字池：出得幾多得幾多，唔會補到 10 題。
  const thin = createTower({ now: 0, bank: startingBank().slice(0, 3), seed: 1 });
  assert.equal(thin.round.questions.length, 3);
  assert.equal(thin.round.outcome, null);
});
