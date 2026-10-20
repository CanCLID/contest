export function createRun({ durationSeconds, now, questionSet }) {
  if (![30, 60].includes(durationSeconds) || !Number.isFinite(now)) {
    throw new TypeError("A run needs a 30 or 60 second duration and a finite start time.");
  }
  if (!Array.isArray(questionSet) || questionSet.length === 0 ||
      questionSet.some(token => !token.hanzi || !Array.isArray(token.answers) ||
        token.answers.length === 0 || token.answers.some(answer => !/^[a-z]+$/.test(answer)))) {
    throw new TypeError("A run needs tokens with lowercase, toneless Jyutping answers.");
  }

  return {
    status: "running",
    durationSeconds,
    startedAt: now,
    deadline: now + durationSeconds * 1000,
    finishedAt: null,
    questionSet,
    index: 0,
    correct: 0,
    errors: 0,
    lastResult: null,
    lastAnswer: "",
  };
}

export function finishRun(run, now) {
  if (run.status === "finished" ||
      (now < run.deadline && run.index < run.questionSet.length)) {
    return run;
  }
  return {
    ...run,
    status: "finished",
    finishedAt: Math.min(now, run.deadline),
  };
}

export function submitAnswer(run, answer, now) {
  const current = finishRun(run, now);
  if (current.status !== "running" || now < current.startedAt) return current;

  const normalized = answer.trim().toLowerCase();
  if (!normalized) return current;
  const correct = current.questionSet[current.index].answers.includes(normalized);
  return finishRun({
    ...current,
    index: current.index + (correct ? 1 : 0),
    correct: current.correct + (correct ? 1 : 0),
    errors: current.errors + (correct ? 0 : 1),
    lastResult: correct ? "correct" : "incorrect",
    lastAnswer: normalized,
  }, now);
}

export function getMetrics(run, now) {
  const effectiveNow = run.finishedAt ?? now;
  const elapsedSeconds = Math.max(0, Math.min(
    run.durationSeconds,
    (effectiveNow - run.startedAt) / 1000,
  ));
  const attempts = run.correct + run.errors;
  return {
    correct: run.correct,
    errors: run.errors,
    accuracy: attempts ? run.correct / attempts * 100 : null,
    // Finishing the text early does not shorten the scoring denominator.
    correctPerMinute: run.correct / (run.durationSeconds / 60),
    elapsedSeconds,
    remainingSeconds: Math.max(0, run.durationSeconds - elapsedSeconds),
    progress: run.index / run.questionSet.length,
    total: run.questionSet.length,
  };
}
