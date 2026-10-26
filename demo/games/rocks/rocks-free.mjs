import { tick, typeSyllable } from "./rocks.mjs";

export function confirmRocksInput(state, raw, now, engine) {
  if (!state || state.status !== "running") return { state, remainder: raw, accepted: [], expired: false };
  if (!Number.isFinite(now) || now < state.updatedAt) return { state, remainder: raw, accepted: [], expired: false };
  const timed = tick(state, now);
  if (timed.status !== "running" || timed.spawned !== state.spawned) {
    return { state: timed, remainder: "", accepted: [], expired: true };
  }
  // The single-character round reveals only one target. Even a string that
  // happens to contain the next hidden answer is one submission to this stone.
  const targets = [timed.target];
  const plan = engine.grade(raw, targets);
  const next = typeSyllable(timed, raw, now);
  return { ...plan, state: next, targets: targets.map(({ hanzi, answers }) => ({ hanzi, answers: [...answers] })), expired: false };
}
