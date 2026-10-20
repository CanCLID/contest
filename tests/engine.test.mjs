import test from "node:test";
import assert from "node:assert/strict";
import { COMPONENTS, splitJyutping, getComponentStats, createRun, submitAnswer, undoAnswer, finishRun, getMetrics } from "../demo/engine.mjs";
import { ARTICLE, QUESTIONS, flattenQuestions } from "../demo/questions.mjs";

const questionSet = [
  { hanzi: "你", answers: ["nei", "lei"], sentenceIndex: 0 },
  { hanzi: "好", answers: ["hou"], sentenceIndex: 0 },
  { hanzi: "我", answers: ["ngo"], sentenceIndex: 1 },
  { hanzi: "哋", answers: ["dei"], sentenceIndex: 1 },
];
const start = () => createRun({ now: 1000, questionSet });

const component = (stats, type, value) => stats[type].find(item => item.value === value);
function componentRun(expected, answers) {
  let run = createRun({ now: 0, questionSet: expected.map((accepted, sentenceIndex) => ({
    hanzi: "字", answers: Array.isArray(accepted) ? accepted : [accepted], sentenceIndex,
  })) });
  answers.forEach((answer, index) => { run = submitAnswer(run, answer, (index + 1) * 1000); });
  return run;
}

test("component splitting handles compound initials, nuclei, syllabic nasals and unknown remainders", () => {
  for (const [answer, initial, nucleus, coda] of [
    ["gwong", "gw", "o", "ng"], ["kwai", "kw", "a", "i"], ["ngoi", "ng", "o", "i"],
    ["aau", "", "aa", "u"], ["soeng", "s", "oe", "ng"], ["seoi", "s", "eo", "i"],
    ["jyut", "j", "yu", "t"], ["m", "", "m", ""], ["ng", "", "ng", ""],
    ["aa", "", "aa", ""], ["zi", "z", "i", ""], [" GWO2 ", "gw", "o", ""],
    ["b", "b", "", ""], ["zzz", "z", "zz", ""], ["xxaa", "", "xxaa", ""],
    ["gzz", "g", "zz", ""],
  ]) assert.deepEqual(splitJyutping(answer), { initial, nucleus, coda }, answer);
});

test("component accuracy counts expected parts separately and keeps partial matches on invalid input", () => {
  const run = componentRun(["gam", "gam", "gwo", "gam"], ["gim", "kam", "gzz", "zzz"]);
  const stats = getComponentStats(run);
  assert.deepEqual(component(stats, "initial", "g"), { value: "g", correct: 1, total: 3, accuracy: 1 / 3 * 100 });
  assert.deepEqual(component(stats, "initial", "gw"), { value: "gw", correct: 0, total: 1, accuracy: 0 });
  assert.deepEqual(component(stats, "nucleus", "a"), { value: "a", correct: 1, total: 3, accuracy: 1 / 3 * 100 });
  assert.deepEqual(component(stats, "coda", "m"), { value: "m", correct: 2, total: 3, accuracy: 2 / 3 * 100 });
  assert.equal(component(stats, "initial", "z").total, 0, "incorrect actual parts are not extra attempts");
  const partial = getComponentStats(componentRun(["gam"], ["gzz"]));
  assert.equal(component(partial, "initial", "g").accuracy, 100);
  assert.equal(component(partial, "nucleus", "a").accuracy, 0);
  assert.equal(component(partial, "coda", "m").accuracy, 0);
});

test("empty parts have no cells and syllabic nasals count only as nuclei", () => {
  const stats = getComponentStats(componentRun(["aa", "ng", "m"], ["baa", "m", "m"]));
  assert.equal(component(stats, "nucleus", "aa").accuracy, 100);
  assert.equal(component(stats, "nucleus", "ng").accuracy, 0);
  assert.equal(component(stats, "nucleus", "m").accuracy, 100);
  assert.ok(stats.initial.every(item => item.total === 0));
  assert.ok(stats.coda.every(item => item.total === 0));
});

test("accepted readings use exact matches first, otherwise one best matching reading with stable ties", () => {
  const exact = getComponentStats(componentRun([["nei", "lei"]], ["lei"]));
  assert.equal(component(exact, "initial", "l").accuracy, 100);
  assert.equal(component(exact, "initial", "n").total, 0);
  const best = getComponentStats(componentRun([["maa", "gam"]], ["gim"]));
  assert.equal(component(best, "initial", "g").accuracy, 100);
  assert.equal(component(best, "initial", "m").total, 0);
  const tie = getComponentStats(componentRun([["gam", "git"]], ["gim"]));
  assert.equal(component(tie, "nucleus", "a").accuracy, 0);
  assert.equal(component(tie, "coda", "m").accuracy, 100);
  assert.equal(component(tie, "nucleus", "i").total, 0, "parts from another reading are not mixed in");
  const reversed = getComponentStats(componentRun([["git", "gam"]], ["gim"]));
  assert.equal(component(reversed, "nucleus", "i").accuracy, 100);
  assert.equal(component(reversed, "coda", "t").accuracy, 0);
});

test("component counts follow current answers through undo, correction and a fresh run", () => {
  const empty = getComponentStats();
  for (const type of Object.keys(COMPONENTS)) {
    assert.deepEqual(empty[type].map(item => item.value), COMPONENTS[type]);
    assert.ok(empty[type].every(item => item.total === 0 && item.correct === 0 && item.accuracy === null));
  }
  const original = componentRun(["gam", "jat"], ["gim"]);
  const before = getComponentStats(original);
  const undone = undoAnswer(original, 2000);
  assert.deepEqual(getComponentStats(undone), empty);
  const corrected = submitAnswer(undone, "gam", 3000);
  assert.equal(component(getComponentStats(corrected), "nucleus", "a").accuracy, 100);
  assert.equal(component(before, "nucleus", "a").accuracy, 0);
  assert.deepEqual(getComponentStats(componentRun(["gam", "jat"], [])), empty);
});

test("nonempty answers advance whether correct or incorrect, without mutating old states", () => {
  const original = start();
  const correct = submitAnswer(original, " LEI ", 1100);
  const incorrect = submitAnswer(correct, "hou2", 1200);
  assert.equal(correct.index, 1);
  assert.equal(correct.lastResult, "correct");
  assert.equal(correct.lastAnswer, "lei");
  assert.deepEqual(incorrect.answers, [
    { answer: "lei", correct: true },
    { answer: "hou2", correct: false },
  ]);
  assert.equal(incorrect.index, 2);
  assert.equal(incorrect.correct, 1);
  assert.equal(incorrect.errors, 1);
  assert.equal(incorrect.lastResult, "incorrect");
  assert.deepEqual(original.answers, []);
  assert.equal(original.index, 0);
  assert.equal(correct.answers.length, 1);
});

test("empty answers do not skip; invalid or early timestamps do not change the run", () => {
  const run = start();
  assert.equal(submitAnswer(run, " \t\n ", 1100), run);
  assert.equal(submitAnswer(run, "nei", 999), run);
  assert.equal(submitAnswer(run, "nei", NaN), run);
  assert.equal(undoAnswer(run, 1100), run);
  assert.equal(getMetrics(run, 1100).accuracy, null);
});

test("undo removes a wrong answer and correcting it removes its penalty but consumes time", () => {
  const wrong = submitAnswer(start(), "wrong", 2000);
  const editing = undoAnswer(wrong, 3000);
  assert.equal(editing.index, 0);
  assert.equal(editing.lastAnswer, "wrong");
  assert.equal(editing.lastResult, null);
  assert.deepEqual(editing.answers, []);
  assert.equal(editing.correct, 0);
  assert.equal(editing.errors, 0);
  assert.equal(wrong.errors, 1);
  assert.equal(wrong.answers.length, 1);
  const corrected = submitAnswer(editing, "nei", 4000);
  const metrics = getMetrics(corrected, 4000);
  assert.equal(metrics.submitted, 1);
  assert.equal(metrics.errors, 0);
  assert.equal(metrics.accuracy, 100);
  assert.equal(metrics.elapsedSeconds, 3);
  assert.equal(metrics.syllablesPerMinute, 20);
  assert.equal(metrics.score, 20);
});

test("undo crosses a sentence boundary and updates counts for correct answers", () => {
  let run = submitAnswer(start(), "nei", 2000);
  run = submitAnswer(run, "hou", 3000);
  assert.equal(run.questionSet[run.index].sentenceIndex, 1);
  const previousSentence = undoAnswer(run, 4000);
  assert.equal(previousSentence.index, 1);
  assert.equal(previousSentence.questionSet[previousSentence.index].sentenceIndex, 0);
  assert.equal(previousSentence.lastAnswer, "hou");
  assert.equal(previousSentence.correct, 1);
  assert.equal(previousSentence.errors, 0);
  assert.equal(previousSentence.answers.length, 1);
});

test("there is no time limit; only the final submitted token finishes and freezes the run", () => {
  let run = start();
  assert.equal(finishRun(run, 100000), run);
  run = submitAnswer(run, "nei", 100000);
  run = submitAnswer(run, "wrong", 110000);
  run = submitAnswer(run, "ngo", 120000);
  assert.equal(run.status, "running");
  run = submitAnswer(run, "dei", 121000);
  assert.equal(run.status, "finished");
  assert.equal(run.finishedAt, 121000);
  assert.equal(run.index, questionSet.length);
  assert.equal(submitAnswer(run, "nei", 122000), run);
  assert.equal(undoAnswer(run, 122000), run);
  assert.equal(finishRun(run, 122000), run);
  assert.deepEqual(getMetrics(run, 122000), getMetrics(run, 500000));
});

test("metrics use elapsed time, current answers and the provisional squared-accuracy score", () => {
  let run = submitAnswer(start(), "nei", 2000);
  run = submitAnswer(run, "wrong", 3000);
  const metrics = getMetrics(run, 5000);
  assert.equal(metrics.submitted, 2);
  assert.equal(metrics.correct, 1);
  assert.equal(metrics.errors, 1);
  assert.equal(metrics.elapsedSeconds, 4);
  assert.equal(metrics.accuracy, 50);
  assert.equal(metrics.syllablesPerMinute, 30);
  assert.equal(metrics.correctPerMinute, 15);
  assert.equal(metrics.score, 7.5);
  assert.equal(metrics.progress, 0.5);
  assert.equal(metrics.total, 4);
  assert.equal(getMetrics(run, 9000).syllablesPerMinute, 15);
});

test("zero elapsed time has finite zero rates, while an empty run has no accuracy", () => {
  assert.equal(getMetrics(start(), 1000).accuracy, null);
  const run = submitAnswer(start(), "nei", 1000);
  const metrics = getMetrics(run, 1000);
  assert.equal(metrics.elapsedSeconds, 0);
  assert.equal(metrics.syllablesPerMinute, 0);
  assert.equal(metrics.correctPerMinute, 0);
  assert.equal(metrics.score, 0);
  assert.equal(getMetrics(run, 0).elapsedSeconds, 0);
});

test("configuration rejects an invalid start or invalid question data", () => {
  assert.throws(() => createRun({ now: NaN, questionSet }), TypeError);
  assert.throws(() => createRun({ now: 0, questionSet: [] }), TypeError);
  assert.throws(() => createRun({
    now: 0,
    questionSet: [{ hanzi: "你", answers: ["nei5"] }],
  }), TypeError);
});

test("the fixed demo article has 4–6 aligned sentences and 60–100 playable characters", () => {
  assert.ok(QUESTIONS.length >= 4 && QUESTIONS.length <= 6);
  const tokens = flattenQuestions();
  assert.ok(tokens.length >= 60 && tokens.length <= 100);
  assert.equal(ARTICLE.text, QUESTIONS.map(question => question.text).join(""));
  assert.ok(ARTICLE.id && ARTICLE.title);
  assert.equal(new Set(QUESTIONS.map(question => question.id)).size, QUESTIONS.length);
  for (const [sentenceIndex, question] of QUESTIONS.entries()) {
    assert.equal(question.tokens.map(token => token.hanzi).join(""),
      question.text.replace(/[，。]/gu, ""));
    const flattened = tokens.filter(token => token.sentenceIndex === sentenceIndex);
    assert.equal(flattened.map(token => token.hanzi).join(""),
      question.tokens.map(token => token.hanzi).join(""));
    for (const token of question.tokens) {
      assert.match(token.hanzi, /^\p{Script=Han}$/u);
      assert.ok(token.answers.length > 0);
      for (const answer of token.answers) assert.match(answer, /^[a-z]+$/);
    }
  }
});
