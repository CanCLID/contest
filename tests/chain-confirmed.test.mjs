import test from "node:test";
import assert from "node:assert/strict";
import { createChainGame } from "../demo/games/chain/chain.mjs";
import { confirmChainInput, undoChainInput } from "../demo/games/chain/confirmed.mjs";
import { loadFreeInput } from "../demo/games/free-input.mjs";

const engine = await loadFreeInput();
const bank = [{ word: "香港", syllables: ["hoeng", "gong"] }];
const start = options => createChainGame({ now: 0, seed: "confirmed", wordCount: 3, bank, ...options });

test("confirmed chain grades errors, clears the entire input, and undo restores the graded chunk", () => {
  const initial = start();
  const first = confirmChainInput(initial, "HOENGGON", 100, engine);
  assert.equal(first.syllableIndex, 0);
  assert.equal(first.wordIndex, 1);
  assert.equal(first.score, 1);
  assert.equal(first.correct, 1);
  assert.equal(first.errors, 1);
  assert.equal(first.lastSubmission.plan.remainder, "");
  assert.deepEqual(first.answers.map(item => item.correct), [true, false]);
  const undone = undoChainInput(first, 200);
  assert.equal(undone.wordIndex, 0);
  assert.equal(undone.lastAnswer, "HOENGGON");
  assert.equal(undone.score, 0);
  assert.equal(undone.errors, 0);
  const fixed = confirmChainInput(undone, "HOENGGONG", 300, engine);
  assert.equal(fixed.correct, 2);
  assert.equal(fixed.errors, 0);
  assert.equal(fixed.combo, 1);
  assert.equal(fixed.score, 2);
});

test("only the current word can be graded, never a hidden next word", () => {
  const initial = start();
  const guessed = confirmChainInput(initial, "hoenggonghoenggong", 100, engine);
  assert.ok(guessed.wordIndex <= 1);
  assert.ok(guessed.answers.length <= 2);
  assert.ok(guessed.errors > 0);
  assert.ok(guessed.answers.every(answer => answer.wordIndex === 0));
  assert.equal(guessed.lastSubmission.plan.accepted.map(part => part.answer).join(""), "hoenggonghoenggong");
  assert.equal(guessed.lastSubmission.plan.remainder, "");
  const restored = undoChainInput(guessed, 200);
  assert.equal(restored.lastAnswer, "hoenggonghoenggong");
  assert.equal(restored.answers.length, 0);
});

test("single and grouped confirmations use the same original scoring", () => {
  const first = confirmChainInput(start(), "hoeng", 100, engine);
  assert.equal(first.wordIndex, 0);
  assert.equal(first.syllableIndex, 1);
  const split = confirmChainInput(first, "gon", 200, engine);
  const together = confirmChainInput(start(), "hoenggon", 200, engine);
  for (const key of ["wordIndex", "syllableIndex", "correct", "errors", "score", "combo"]) {
    assert.equal(split[key], together[key], key);
  }
});

test("confirmation deadline and final freeze preserve accepted answers", () => {
  const timed = start({ mode: "official", durationSeconds: 1 });
  const expired = confirmChainInput(timed, "hoenggong", 1000, engine);
  assert.equal(expired.status, "finished");
  assert.equal(expired.answers.length, 0);
  const final = confirmChainInput(start({ wordCount: 1 }), "hoenggongZZ", 100, engine);
  assert.equal(final.status, "finished");
  assert.equal(final.lastSubmission.plan.remainder, "");
  assert.ok(final.errors > 0);
  assert.equal(undoChainInput(final, 200), final);
  assert.equal(confirmChainInput(final, "hoeng", 200, engine), final);
});

test("a graded omission counts as an error while a genuinely empty confirmation does nothing", () => {
  const initial = start({ bank: [{ word: "甲乙丙", syllables: ["nei", "a", "hou"] }] });
  assert.equal(confirmChainInput(initial, "", 100, engine), initial);
  const result = confirmChainInput(initial, "neihou", 100, engine);
  assert.deepEqual(result.answers.map(item => item.answer), ["nei", "", "hou"]);
  assert.equal(result.correct, 2);
  assert.equal(result.errors, 1);
  assert.equal(result.wordIndex, 1);
  const undo = undoChainInput(result, 200);
  assert.equal(undo.answers.length, 0);
  assert.equal(undo.errors, 0);
  assert.equal(undo.lastAnswer, "neihou");
});
