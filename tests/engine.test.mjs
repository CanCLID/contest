import test from "node:test";
import assert from "node:assert/strict";
import { createRun, submitAnswer, finishRun, getMetrics } from "../demo/engine.mjs";
import { QUESTIONS, flattenQuestions } from "../demo/questions.mjs";

const questionSet = [
  { hanzi: "你", answers: ["nei", "lei"], sentenceIndex: 0 },
  { hanzi: "好", answers: ["hou"], sentenceIndex: 0 },
  { hanzi: "嗎", answers: ["maa"], sentenceIndex: 0 },
];
const start = (durationSeconds = 60) =>
  createRun({ durationSeconds, now: 1000, questionSet });

test("correct answers normalize whitespace/case and accept listed readings", () => {
  const original = start();
  const next = submitAnswer(original, " LEI ", 1100);
  assert.equal(next.index, 1);
  assert.equal(next.correct, 1);
  assert.equal(next.errors, 0);
  assert.equal(next.lastResult, "correct");
  assert.equal(next.lastAnswer, "lei");
  assert.equal(original.index, 0);
  assert.equal(original.lastResult, null);
});

test("incorrect retries stay on the current token and each count once", () => {
  let run = start();
  run = submitAnswer(run, "nei5", 1100);
  run = submitAnswer(run, "hou", 1200);
  assert.equal(run.index, 0);
  assert.equal(run.errors, 2);
  assert.equal(run.lastResult, "incorrect");
  run = submitAnswer(run, "nei", 1300);
  assert.equal(run.index, 1);
  assert.equal(run.correct, 1);
  assert.equal(run.errors, 2);
  assert.ok(Math.abs(getMetrics(run, 1400).accuracy - 100 / 3) < 1e-10);
});

test("empty answers and submissions before the start do not count", () => {
  const run = start();
  assert.equal(submitAnswer(run, " \t\n ", 1100), run);
  assert.equal(submitAnswer(run, "nei", 999), run);
  const metrics = getMetrics(run, 1100);
  assert.equal(metrics.correct, 0);
  assert.equal(metrics.errors, 0);
  assert.equal(metrics.accuracy, null);
});

test("a submission at the start is accepted; at or after the deadline it is not", () => {
  const run = submitAnswer(start(), "nei", 1000);
  const justBefore = submitAnswer(run, "hou", 60999);
  assert.equal(justBefore.correct, 2);
  assert.equal(justBefore.status, "running");
  for (const now of [61000, 61001, 100000]) {
    const finished = submitAnswer(run, "hou", now);
    assert.equal(finished.status, "finished");
    assert.equal(finished.correct, 1);
    assert.equal(finished.index, 1);
    assert.equal(finished.finishedAt, 61000);
  }
  assert.equal(submitAnswer(run, "", 61000).status, "finished");
});

test("finishing is idempotent and cannot end a live run before its deadline", () => {
  const run = start(30);
  assert.equal(finishRun(run, 30999), run);
  const finished = finishRun(run, 31000);
  assert.equal(finished.status, "finished");
  assert.equal(finished.finishedAt, 31000);
  assert.equal(finishRun(finished, 40000), finished);
  assert.equal(submitAnswer(finished, "nei", 40000), finished);
});

test("exhausting the text ends the run without cycling or scoring extra submissions", () => {
  let run = start(30);
  run = submitAnswer(run, "nei", 1100);
  run = submitAnswer(run, "hou", 1200);
  run = submitAnswer(run, "maa", 1300);
  assert.equal(run.status, "finished");
  assert.equal(run.finishedAt, 1300);
  assert.equal(run.index, 3);
  assert.equal(submitAnswer(run, "nei", 1400), run);
  const metrics = getMetrics(run, 5000);
  assert.equal(metrics.correct, 3);
  assert.equal(metrics.correctPerMinute, 6);
  assert.equal(metrics.elapsedSeconds, 0.3);
  assert.equal(metrics.accuracy, 100);
  assert.equal(metrics.progress, 1);
});

test("timing clamps to the run interval and speed always uses the fixed duration", () => {
  const run = submitAnswer(start(30), "nei", 1100);
  assert.equal(getMetrics(run, 1000).correctPerMinute, 2);
  assert.equal(getMetrics(run, 16000).correctPerMinute, 2);
  assert.equal(getMetrics(run, 16000).remainingSeconds, 15);
  assert.equal(getMetrics(run, 0).elapsedSeconds, 0);
  assert.equal(getMetrics(run, 40000).elapsedSeconds, 30);
  assert.equal(getMetrics(run, 40000).remainingSeconds, 0);
});

test("run configuration rejects unsupported durations and invalid question data", () => {
  assert.throws(() => start(10), TypeError);
  assert.throws(() => createRun({ durationSeconds: 60, now: NaN, questionSet }), TypeError);
  assert.throws(() => createRun({ durationSeconds: 60, now: 0, questionSet: [] }), TypeError);
  assert.throws(() => createRun({
    durationSeconds: 60,
    now: 0,
    questionSet: [{ hanzi: "你", answers: ["nei5"] }],
  }), TypeError);
});

test("the original question bank has at least 160 playable characters and no punctuation tokens", () => {
  assert.ok(QUESTIONS.length >= 8);
  const tokens = flattenQuestions();
  assert.ok(tokens.length >= 160);
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
