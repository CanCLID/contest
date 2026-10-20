import test from "node:test";
import assert from "node:assert/strict";
import { createRun, submitAnswer, undoAnswer, finishRun, getMetrics } from "../demo/engine.mjs";
import { ARTICLE, QUESTIONS, flattenQuestions } from "../demo/questions.mjs";

const questionSet = [
  { hanzi: "你", answers: ["nei", "lei"], sentenceIndex: 0 },
  { hanzi: "好", answers: ["hou"], sentenceIndex: 0 },
  { hanzi: "我", answers: ["ngo"], sentenceIndex: 1 },
  { hanzi: "哋", answers: ["dei"], sentenceIndex: 1 },
];
const start = () => createRun({ now: 1000, questionSet });

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
