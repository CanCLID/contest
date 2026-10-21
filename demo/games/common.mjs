// Shared helpers for the Jyutping mini-games in demo/games/.
// All games import from here instead of duplicating scoring, seeding,
// combo and storage logic. Frozen contract: extend only via the integrator.

export const OFFICIAL_THRESHOLDS = { passage: 0.85, timed: 0.9 };
export const COMBO_CAP = 1.5;
export const COMBO_STEP = 0.1;

export function normalizeAnswer(value) {
  return String(value ?? "").toLowerCase().replace(/[^a-z]/g, "");
}

export function hashSeed(text) {
  let hash = 0x811c9dc5;
  for (const ch of String(text)) {
    hash ^= ch.codePointAt(0);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

export function mulberry32(seed) {
  let state = seed >>> 0;
  return function next() {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffled(items, rng) {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

// Official scoring direction (SPEC §5.5, confirmed 2026-10-22):
// single-round R = correct syllables per minute x accuracy, plus an
// accuracy threshold below which the round does not rank.
export function roundMetrics({ correct, submitted, seconds }, { threshold = OFFICIAL_THRESHOLDS.timed } = {}) {
  const minutes = seconds / 60;
  const accuracy = submitted > 0 ? correct / submitted : 0;
  const correctPerMinute = minutes > 0 ? correct / minutes : 0;
  const grossPerMinute = minutes > 0 ? submitted / minutes : 0;
  return {
    accuracy,
    correctPerMinute,
    grossPerMinute,
    demoScore: grossPerMinute * accuracy ** 2,
    officialScore: correctPerMinute * accuracy,
    meetsThreshold: submitted > 0 && accuracy >= threshold,
    threshold,
  };
}

export function comboMultiplier(combo, cap = COMBO_CAP, step = COMBO_STEP) {
  return Math.min(cap, 1 + step * Math.max(0, combo));
}

export function formatClock(totalSeconds) {
  const seconds = Math.max(0, totalSeconds);
  const minutes = Math.floor(seconds / 60);
  const rest = seconds - minutes * 60;
  return `${String(minutes).padStart(2, "0")}:${rest < 10 ? "0" : ""}${rest.toFixed(1)}`;
}

const hasStorage = typeof localStorage !== "undefined";

export function readJson(key, fallback = null) {
  if (!hasStorage) return fallback;
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? fallback : JSON.parse(raw);
  } catch {
    return fallback;
  }
}

export function writeJson(key, value) {
  if (!hasStorage) return false;
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}
