// Space/Enter grades the complete buffer against the current word only.
// Correct and incorrect spans both advance; the original submission is logged.
import { finishByTime, recallSyllable, typeSyllable } from "./chain.mjs";
import { FREE_INPUT_RULE_VERSION } from "../free-input.mjs";

export function visibleChainTargets(state) {
  return state.words.slice(state.wordIndex, state.wordIndex + 1).flatMap(word =>
    word.syllables.flatMap((answer, index) => index < state.syllableIndex ? [] : [{
      hanzi: [...word.word][index], answers: [answer],
      wordIndex: state.wordIndex, syllableIndex: index,
    }]));
}

export function confirmChainInput(state, raw, now, engine) {
  if (!state || state.status !== "running" || !Number.isFinite(now) ||
      now < (state.lastInputAt ?? state.startedAt) || !raw) return state;
  const timed = finishByTime(state, now);
  if (timed.status !== "running") return timed;
  const targets = visibleChainTargets(state);
  const plan = engine.grade(raw, targets);
  let next = state;
  for (const part of plan.accepted) next = typeSyllable(next, part.answer, now, { allowEmpty: true });
  const id = `input-${(state.submissionCount ?? 0) + 1}`;
  const submission = { id, at: now, raw, plan, targets: targets.slice(0, plan.accepted.length),
    acceptedRaw: raw.slice(0, plan.consumedLength),
    before: { answersLength: state.answers.length, wordIndex: state.wordIndex, syllableIndex: state.syllableIndex } };
  return { ...next, lastInputAt: now, lastSubmission: submission,
    submissionCount: (state.submissionCount ?? 0) + 1,
    commits: plan.accepted.length ? [...(state.commits ?? []), submission] : state.commits ?? [],
    rulesVersion: FREE_INPUT_RULE_VERSION };
}

export function undoChainInput(state, now) {
  if (!state || state.status !== "running" || !Number.isFinite(now) ||
      now < (state.lastInputAt ?? state.startedAt)) return state;
  const timed = finishByTime(state, now);
  if (timed.status !== "running") return timed;
  const commit = state.commits?.at(-1);
  if (!commit) return state;
  let next = state;
  while (next.answers.length > commit.before.answersLength) next = recallSyllable(next);
  return { ...next, commits: state.commits.slice(0, -1), lastSubmission: null,
    lastInputAt: now, lastAnswer: commit.acceptedRaw };
}
