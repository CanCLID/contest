export const COMPONENTS = {
  initial: ["b", "p", "m", "f", "d", "t", "n", "l", "g", "k", "ng", "h", "gw", "kw", "w", "z", "c", "s", "j"],
  nucleus: ["aa", "a", "e", "i", "o", "u", "oe", "eo", "yu", "m", "ng"],
  coda: ["i", "u", "m", "n", "ng", "p", "t", "k"],
};

const componentTypes = Object.keys(COMPONENTS);
const initialsByLength = [...COMPONENTS.initial].sort((a, b) => b.length - a.length);
const codasByLength = [...COMPONENTS.coda].sort((a, b) => b.length - a.length);

export function splitJyutping(value) {
  const syllable = value.trim().toLowerCase().replace(/[1-6]$/, "");
  if (syllable === "m" || syllable === "ng") return { initial: "", nucleus: syllable, coda: "" };
  const initial = initialsByLength.find(part => syllable.startsWith(part)) ?? "";
  const remainder = syllable.slice(initial.length);
  const coda = codasByLength.find(part => remainder.endsWith(part) &&
    COMPONENTS.nucleus.includes(remainder.slice(0, -part.length))) ?? "";
  // Keep an unknown remainder so a typo can still have a correct initial.
  return { initial, nucleus: coda ? remainder.slice(0, -coda.length) : remainder, coda };
}

export function getComponentStats(run = null) {
  const stats = Object.fromEntries(componentTypes.map(type => [type,
    COMPONENTS[type].map(value => ({ value, correct: 0, total: 0, accuracy: null })),
  ]));
  for (const [index, submission] of (run?.answers ?? []).entries()) {
    const candidates = run.questionSet[index].answers;
    const actual = splitJyutping(submission.answer);
    const exact = candidates.find(answer => answer === submission.answer);
    let expected = splitJyutping(exact ?? candidates[0]);
    if (!exact) {
      // Compare one reading as a whole; earlier candidates win ties.
      const matches = candidate => componentTypes.filter(type =>
        candidate[type] && candidate[type] === actual[type]).length;
      for (const candidate of candidates.slice(1).map(splitJyutping)) {
        if (matches(candidate) > matches(expected)) expected = candidate;
      }
    }
    for (const type of componentTypes) {
      const cell = stats[type].find(item => item.value === expected[type]);
      if (!cell) continue;
      cell.total++;
      if (actual[type] === expected[type]) cell.correct++;
      cell.accuracy = cell.correct / cell.total * 100;
    }
  }
  return stats;
}

export function createRun({ now, questionSet }) {
  if (!Number.isFinite(now)) {
    throw new TypeError("A run needs a finite start time.");
  }
  if (!Array.isArray(questionSet) || questionSet.length === 0 ||
      questionSet.some(token => !token.hanzi || !Array.isArray(token.answers) ||
        token.answers.length === 0 || token.answers.some(answer => !/^[a-z]+$/.test(answer)))) {
    throw new TypeError("A run needs tokens with lowercase, toneless Jyutping answers.");
  }

  return {
    status: "running",
    startedAt: now,
    finishedAt: null,
    questionSet,
    index: 0,
    answers: [],
    correct: 0,
    errors: 0,
    lastResult: null,
    lastAnswer: "",
  };
}

export function finishRun(run, now) {
  if (run.status === "finished" || run.index < run.questionSet.length ||
      !Number.isFinite(now) || now < run.startedAt) {
    return run;
  }
  return {
    ...run,
    status: "finished",
    finishedAt: now,
  };
}

export function submitAnswer(run, answer, now) {
  if (run.status !== "running" || !Number.isFinite(now) || now < run.startedAt) return run;

  const normalized = answer.trim().toLowerCase();
  if (!normalized) return run;
  const correct = run.questionSet[run.index].answers.includes(normalized);
  return finishRun({
    ...run,
    index: run.index + 1,
    answers: [...run.answers, { answer: normalized, correct }],
    correct: run.correct + (correct ? 1 : 0),
    errors: run.errors + (correct ? 0 : 1),
    lastResult: correct ? "correct" : "incorrect",
    lastAnswer: normalized,
  }, now);
}

export function undoAnswer(run, now) {
  if (run.status !== "running" || run.index === 0 ||
      !Number.isFinite(now) || now < run.startedAt) return run;
  const previous = run.answers.at(-1);
  return {
    ...run,
    index: run.index - 1,
    answers: run.answers.slice(0, -1),
    correct: run.correct - (previous.correct ? 1 : 0),
    errors: run.errors - (previous.correct ? 0 : 1),
    lastResult: null,
    lastAnswer: previous.answer,
  };
}

export function getMetrics(run, now) {
  const effectiveNow = run.finishedAt ?? now;
  const elapsedSeconds = Math.max(0, (effectiveNow - run.startedAt) / 1000);
  const submitted = run.answers.length;
  const accuracyRatio = submitted ? run.correct / submitted : 0;
  const syllablesPerMinute = elapsedSeconds ? submitted / elapsedSeconds * 60 : 0;
  return {
    correct: run.correct,
    errors: run.errors,
    submitted,
    accuracy: submitted ? accuracyRatio * 100 : null,
    elapsedSeconds,
    syllablesPerMinute,
    correctPerMinute: elapsedSeconds ? run.correct / elapsedSeconds * 60 : 0,
    // Provisional demo formula; the competition scoring rule is not decided.
    score: syllablesPerMinute * accuracyRatio ** 2,
    progress: run.index / run.questionSet.length,
    total: run.questionSet.length,
  };
}
