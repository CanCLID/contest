import test from "node:test";
import assert from "node:assert/strict";
import {
  FREE_INPUT_RULE_VERSION, FREE_INPUT_GRADING_VERSION, MAX_FREE_INPUT, MAX_FREE_TRACE_EVENTS, MAX_FREE_TRACE_BYTES,
  loadFreeInput, matchConfirmedInput, gradeConfirmedInput, createFreeTrace, recordFreeEvent,
} from "../demo/games/free-input.mjs";
import { CHAIN_BANK } from "../demo/games/chain/data.mjs";
import { ROCK_QUESTIONS } from "../demo/games/rocks/data.mjs";
import { flattenQuestions } from "../demo/questions.mjs";

const targets = (...answers) => answers.map(answer => ({ answers: Array.isArray(answer) ? answer : [answer] }));

test("one confirmed buffer can match one syllable or a whole word", async () => {
  const engine = await loadFreeInput();
  assert.equal(engine.rulesVersion, FREE_INPUT_RULE_VERSION);
  const expected = targets("hoeng", "gong");
  const one = engine.match("HOENG", expected);
  assert.deepEqual(one.accepted, [{ answer: "hoeng", targetIndex: 0, start: 0, end: 5 }]);
  assert.equal(one.complete, true);
  assert.equal(one.remainder, "");
  const whole = engine.match("hoenggong", expected);
  assert.deepEqual(whole.accepted.map(item => item.answer), ["hoeng", "gong"]);
  assert.equal(whole.consumedLength, 9);
  assert.equal(whole.complete, true);
  assert.equal(whole.ambiguous, false);
  assert.match(whole.segmentationVersion, /^yune-darts-/);
});

test("unmatched suffix is retained verbatim and never corrected or skipped", async () => {
  const engine = await loadFreeInput();
  const expected = targets("hoeng", "gong", "nei");
  for (const raw of ["HOENGGON", "hoengg", "hoengXgongnei"]) {
    const result = engine.match(raw, expected);
    assert.deepEqual(result.accepted.map(item => item.answer), ["hoeng"]);
    assert.equal(result.consumedLength, 5);
    assert.equal(result.remainder, raw.slice(5));
    assert.equal(result.complete, false);
  }
  const badStart = engine.match("xhoenggong", expected);
  assert.deepEqual(badStart.accepted, []);
  assert.equal(badStart.remainder, "xhoenggong");
  const afterLastTarget = engine.match("hoenggongNEI", targets("hoeng", "gong"));
  assert.equal(afterLastTarget.remainder, "NEI", "extra input must not spill into another round");
});

test("alternative readings with shared prefixes are matched jointly", async () => {
  const engine = await loadFreeInput();
  // Greedily taking the first, shorter answer would strand the final a.
  const longer = engine.match("aaa", targets(["a", "aa"], "a"));
  assert.deepEqual(longer.accepted.map(item => item.answer), ["aa", "a"]);
  assert.equal(longer.complete, true);
  assert.equal(longer.ambiguous, false);

  const sameCoverage = engine.match("aa", targets(["aa", "a"], "a"));
  assert.deepEqual(sameCoverage.accepted.map(item => item.answer), ["a", "a"]);
  assert.equal(sameCoverage.ambiguous, true, "one- and two-target interpretations both fit");

  const sameCount = engine.match("aaa", targets(["aa", "a"], ["a", "aa"]));
  assert.deepEqual(sameCount.accepted.map(item => item.answer), ["aa", "a"]);
  assert.equal(sameCount.ambiguous, true);
  assert.equal(engine.match("aa", targets(["aa", "aa"])).ambiguous, false,
    "duplicate accepted spellings are not distinct paths");
});

test("real Yune spans cover every accepted reading in all three current rounds", async () => {
  const engine = await loadFreeInput();
  const readings = new Set([
    ...CHAIN_BANK.flatMap(word => word.syllables),
    ...ROCK_QUESTIONS.flatMap(token => token.answers),
    ...flattenQuestions().flatMap(token => token.answers),
  ]);
  for (const reading of readings) {
    assert.equal(engine.match(reading, targets(reading)).complete, true, reading);
  }
});

test("an entire passage, including sentence boundaries, can be confirmed together", async () => {
  const engine = await loadFreeInput();
  const passage = flattenQuestions();
  const raw = passage.map(token => token.answers[0]).join("");
  assert.ok(raw.length > 128);
  assert.ok(passage.length > 32);
  const result = engine.match(raw, passage);
  assert.equal(result.complete, true);
  assert.equal(result.accepted.length, passage.length);
  assert.equal(result.accepted.at(-1).end, raw.length);
  assert.equal(result.remainder, "");
});

test("overlapping real WASM windows preserve syllables crossing their seam", async () => {
  const engine = await loadFreeInput();
  const expected = targets(...Array(93).fill("a"), "gwaang", ...Array(80).fill(["hoeng", "gong"]).flat());
  const raw = expected.map(token => token.answers[0]).join("");
  const graph = engine.segment(raw);
  assert.ok(graph.edges.some(edge => edge.start === 93 && edge.end === 99 && edge.text === "gwaang"));
  assert.equal(new Set(graph.edges.map(edge => `${edge.start}:${edge.end}`)).size, graph.edges.length);
  for (const edge of graph.edges) assert.equal(edge.text, raw.slice(edge.start, edge.end));
  const result = engine.match(raw, expected);
  assert.equal(result.complete, true);
  assert.equal(result.accepted.length, expected.length);
  assert.equal(engine.segment("a".repeat(MAX_FREE_INPUT)).complete, true);
});

test("invalid input and malformed or unrelated graphs cannot become accepted text", async () => {
  const engine = await loadFreeInput();
  for (const raw of [null, 1, "hoeng gong", "hoeng1gong2", "香港", "hoeng\ngong"]) {
    assert.throws(() => engine.match(raw, targets("hoeng", "gong")), TypeError);
  }
  assert.throws(() => engine.segment("a".repeat(MAX_FREE_INPUT + 1)), RangeError);
  const graph = engine.segment("hoeng");
  assert.throws(() => matchConfirmedInput("gong", targets("gong"), graph), TypeError);
  assert.throws(() => matchConfirmedInput("hoeng", targets("hoeng"), {
    ...graph, edges: [{ start: 0, end: 5, text: "heong" }],
  }), TypeError);
  assert.throws(() => matchConfirmedInput("hoeng", [{ answers: ["HOENG"] }], graph), TypeError);
  assert.equal(matchConfirmedInput("hoeng", targets("hoeng"), { ...graph, edges: [] }).consumedLength, 0,
    "an exact declared answer never substitutes a fake graph");
  assert.equal(engine.match("", targets("hoeng")).complete, false);
  assert.deepEqual(engine.match("", targets("hoeng")).accepted, []);
  assert.equal(engine.match("hoeng", []).remainder, "hoeng");
});

test("confirmation grades one syllable, a group, or a whole word and consumes the full buffer", async () => {
  const engine = await loadFreeInput();
  const expected = targets("hoeng", "gong", "jan");
  for (const [raw, count] of [["HOENG", 1], ["hoenggong", 2], ["hoenggongjan", 3]]) {
    const result = engine.grade(raw, expected);
    assert.equal(result.raw, raw);
    assert.equal(result.normalized, raw.toLowerCase());
    assert.equal(result.accepted.length, count);
    assert.ok(result.accepted.every(part => part.correct && part.answer === part.expected));
    assert.equal(result.accepted.map(part => part.answer).join(""), raw.toLowerCase());
    assert.equal(result.consumedLength, raw.length);
    assert.equal(result.remainder, "");
    assert.equal(result.complete, true);
    assert.equal(result.editDistance, 0);
    assert.equal(result.countSource, "exact-prefix");
    assert.equal(result.gradingVersion, FREE_INPUT_GRADING_VERSION);
  }
});

test("misspellings are committed as errors without losing later exact syllables", async () => {
  const engine = await loadFreeInput();
  const expected = targets("hoeng", "gong");
  for (const [raw, answers, correct] of [
    ["hoenggon", ["hoeng", "gon"], [true, false]],
    ["honggong", ["hong", "gong"], [false, true]],
    ["hoeanggong", ["hoeang", "gong"], [false, true]],
    ["hoenggongzzz", ["hoeng", "gongzzz"], [true, false]],
  ]) {
    const result = engine.grade(raw, expected);
    assert.deepEqual(result.accepted.map(part => part.answer), answers);
    assert.deepEqual(result.accepted.map(part => part.correct), correct);
    assert.equal(result.accepted.map(part => part.answer).join(""), raw);
    assert.equal(result.consumedLength, raw.length);
    assert.equal(result.remainder, "");
    assert.equal(result.complete, true);
    assert.equal(result.countSource, "reference-aligned");
  }
  const wrong = engine.grade("zzz", expected);
  assert.ok(wrong.accepted.length >= 1);
  assert.ok(wrong.accepted.every(part => !part.correct));
  assert.equal(wrong.accepted.map(part => part.answer).join(""), "zzz");
  const boundaryTypo = engine.grade("hoengxgong", expected);
  assert.equal(boundaryTypo.accepted.map(part => part.answer).join(""), "hoengxgong");
  assert.equal(boundaryTypo.accepted.filter(part => part.correct).length, 1);
  assert.equal(boundaryTypo.alignmentAmbiguous, true);
});

test("a single visible target grades the whole submission as one answer", async () => {
  const engine = await loadFreeInput();
  for (const raw of ["hoenggong", "zzz", "hoengz"]) {
    const result = engine.grade(raw, targets("hoeng"));
    assert.deepEqual(result.accepted, [{ answer: raw, expected: "hoeng", correct: false,
      targetIndex: 0, start: 0, end: raw.length }]);
    assert.equal(result.remainder, "");
  }
});

test("omitted syllables get explicit empty error spans without shifting subsequent exact text", async () => {
  const engine = await loadFreeInput();
  const result = engine.grade("neihou", targets("nei", "a", "hou"));
  assert.deepEqual(result.accepted, [
    { answer: "nei", expected: "nei", correct: true, targetIndex: 0, start: 0, end: 3 },
    { answer: "", expected: "a", correct: false, targetIndex: 1, start: 3, end: 3 },
    { answer: "hou", expected: "hou", correct: true, targetIndex: 2, start: 3, end: 6 },
  ]);
  assert.equal(result.editDistance, 1);
  assert.equal(result.accepted.map(part => part.answer).join(""), "neihou");
});

test("Yune count support breaks equal edit-cost ties before the shorter prefix rule", async () => {
  const engine = await loadFreeInput();
  const yuneTie = engine.grade("hoenggong", targets("hoeng", "syut"));
  assert.deepEqual(yuneTie.candidateCounts, [1, 2]);
  assert.deepEqual(yuneTie.graphSupportedCounts, [2]);
  assert.equal(yuneTie.accepted.length, 2);
  assert.deepEqual(yuneTie.accepted.map(part => part.correct), [true, false]);
  assert.equal(yuneTie.countAmbiguous, true, "a selected count remains an inference");
  assert.equal(yuneTie.ambiguous, true);

  const shorter = engine.grade("aa", targets(["a", "aa"], "a"));
  assert.deepEqual(shorter.candidateCounts, [1, 2]);
  assert.deepEqual(shorter.graphSupportedCounts, [1, 2]);
  assert.equal(shorter.accepted.length, 1);
  assert.equal(shorter.accepted[0].answer, "aa");
});

test("alternative readings are jointly aligned and same-cost boundaries preserve the most exact answers", async () => {
  const engine = await loadFreeInput();
  const alternatives = engine.grade("leihou", targets(["nei", "lei"], "hou"));
  assert.deepEqual(alternatives.accepted.map(part => part.answer), ["lei", "hou"]);
  assert.ok(alternatives.accepted.every(part => part.correct));
  const sameCount = engine.grade("aaa", targets(["aa", "a"], ["a", "aa"]));
  assert.equal(sameCount.accepted.length, 2);
  assert.equal(sameCount.alignmentAmbiguous, true);
  assert.equal(engine.grade("aa", targets(["aa", "aa"])).ambiguous, false);

  const tied = engine.grade("baabaabaa", targets("baa", "aa", "aa"));
  assert.equal(tied.editDistance, 2);
  assert.equal(tied.accepted.length, 3);
  assert.equal(tied.accepted.filter(part => part.correct).length, 2);
  assert.equal(tied.accepted.map(part => part.answer).join(""), "baabaabaa");
});

test("an entire passage can include a later typo without stranding its remaining text", async () => {
  const engine = await loadFreeInput();
  const passage = flattenQuestions();
  const typed = passage.map(token => token.answers[0]);
  const wrongIndex = 30;
  typed[wrongIndex] = "q" + typed[wrongIndex].slice(1);
  const raw = typed.join("");
  const result = engine.grade(raw, passage);
  assert.equal(result.accepted.length, passage.length);
  assert.equal(result.editDistance, 1);
  assert.deepEqual(result.accepted.map(part => part.answer), typed);
  assert.deepEqual(result.accepted.map(part => part.correct), passage.map((_, index) => index !== wrongIndex));
  assert.equal(result.accepted.at(-1).end, raw.length);
  assert.equal(result.remainder, "");
});

test("grading validates input and graph provenance and leaves an empty confirmation as a no-op", async () => {
  const engine = await loadFreeInput();
  for (const raw of [null, 1, "hoeng gong", "hoeng1", "香港", "hoeng\ngong"]) {
    assert.throws(() => engine.grade(raw, targets("hoeng")), TypeError);
  }
  assert.throws(() => engine.grade("a".repeat(MAX_FREE_INPUT + 1), targets("a")), RangeError);
  const graph = engine.segment("hoeng");
  assert.throws(() => gradeConfirmedInput("gong", targets("gong"), graph), TypeError);
  assert.throws(() => gradeConfirmedInput("hoeng", targets("hoeng"), {
    ...graph, edges: [{ start: 0, end: 5, text: "heong" }],
  }), TypeError);
  assert.throws(() => gradeConfirmedInput("hoeng", [{ answers: [] }], graph), TypeError);
  assert.deepEqual(engine.grade("", targets("hoeng")).accepted, []);
  assert.equal(engine.grade("", targets("hoeng")).complete, false);
  assert.equal(engine.grade("hoeng", []).consumedLength, 0);
});

test("maximum-length grading remains bounded for both one target and the whole current passage", { timeout: 2000 }, async () => {
  const engine = await loadFreeInput();
  const raw = "z".repeat(MAX_FREE_INPUT);
  for (const expected of [targets("hoeng"), flattenQuestions()]) {
    const result = engine.grade(raw, expected);
    assert.ok(result.accepted.length >= 1 && result.accepted.length <= expected.length);
    assert.equal(result.accepted.map(part => part.answer).join(""), raw);
    assert.equal(result.consumedLength, MAX_FREE_INPUT);
    assert.equal(result.remainder, "");
    assert.ok(result.accepted.every(part => part.correct === expected[part.targetIndex].answers.includes(part.answer)));
  }
});

test("trace events snapshot original text, use relative times and protect envelope fields", () => {
  const trace = createFreeTrace({ round: "words", seed: "seed", startedAt: 1000 });
  const details = { before: "HOENGGON", accepted: [{ answer: "hoeng" }], seq: 90, type: "fake", t: 50 };
  assert.equal(recordFreeEvent(trace, "confirm", details, 1250), trace);
  details.accepted[0].answer = "changed";
  assert.equal(trace.rulesVersion, FREE_INPUT_RULE_VERSION);
  assert.equal(trace.events[0].before, "HOENGGON");
  assert.equal(trace.events[0].accepted[0].answer, "hoeng");
  assert.equal(trace.events[0].seq, 0);
  assert.equal(trace.events[0].type, "confirm");
  assert.equal(trace.events[0].t, 250);
  assert.equal(trace.droppedEvents, 0);
  assert.ok(trace.bytesRecorded > 0);
  recordFreeEvent(trace, "edit", { after: "a".repeat(MAX_FREE_INPUT + 1) }, 1300);
  assert.equal(trace.events[1].after.length, MAX_FREE_INPUT);
  assert.equal(trace.events[1].truncatedFields.after, MAX_FREE_INPUT + 1);
  assert.doesNotThrow(() => JSON.stringify(trace));
});

test("trace caps report omitted observations without reusing their sequence numbers", () => {
  const countTrace = createFreeTrace({ round: "single", startedAt: 0 });
  countTrace.events = Array(MAX_FREE_TRACE_EVENTS).fill({});
  countTrace.totalEvents = MAX_FREE_TRACE_EVENTS;
  recordFreeEvent(countTrace, "confirm", { raw: "nei" }, 100);
  assert.equal(countTrace.events.length, MAX_FREE_TRACE_EVENTS);
  assert.equal(countTrace.totalEvents, MAX_FREE_TRACE_EVENTS + 1);
  assert.equal(countTrace.droppedEvents, 1);

  const byteTrace = createFreeTrace({ round: "passage", startedAt: 0 });
  byteTrace.bytesRecorded = MAX_FREE_TRACE_BYTES - 60;
  recordFreeEvent(byteTrace, "edit", { raw: "a".repeat(100) }, 1);
  assert.equal(byteTrace.events.length, 0);
  assert.equal(byteTrace.droppedEvents, 1);
  recordFreeEvent(byteTrace, "x", {}, 2);
  assert.equal(byteTrace.events[0].seq, 1);
  assert.equal(byteTrace.totalEvents, 2);
});
