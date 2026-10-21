// Pure logic for 「粵拼詞鏈」: a seeded word-chain game where every correct
// syllable is worth 1 x the combo multiplier at the moment of submission.
// No DOM, no window, no storage — the DOM layer (chain-dom.mjs) owns all of that.
import {
  OFFICIAL_THRESHOLDS,
  comboMultiplier,
  hashSeed,
  mulberry32,
  normalizeAnswer,
  roundMetrics,
  shuffled,
} from "../common.mjs";

const HAN = /\p{Script=Han}/u;

// Shared shape check for word banks; data.mjs runs it at import time so a typo
// in the bank fails loudly instead of reaching the game.
export function validateBank(bank) {
  if (!Array.isArray(bank) || bank.length === 0) {
    throw new TypeError("A word bank needs at least one entry.");
  }
  for (const entry of bank) {
    const syllables = entry?.syllables;
    if (typeof entry?.word !== "string" || entry.word === "" ||
        !Array.isArray(syllables) || syllables.length === 0 ||
        syllables.some(syllable => typeof syllable !== "string" || !/^[a-z]+$/.test(syllable))) {
      throw new TypeError("A word bank entry needs a word and lowercase, toneless Jyutping syllables.");
    }
    const hanzi = [...entry.word].filter(character => HAN.test(character)).length;
    if (hanzi !== syllables.length) {
      throw new TypeError(`"${entry.word}" has ${hanzi} Han characters but ${syllables.length} syllables.`);
    }
  }
  return bank;
}

// Draw `count` words from the bank with the seeded rng. A game longer than the
// bank keeps drawing extra shuffles instead of repeating one fixed order.
function drawWords(bank, count, rng) {
  const drawn = [];
  while (drawn.length < count) {
    drawn.push(...shuffled(bank, rng).slice(0, count - drawn.length));
  }
  return drawn.map(({ word, syllables }) => ({ word, syllables: [...syllables] }));
}

export function createChainGame({ now, seed = "", wordCount = 20, bank } = {}) {
  if (!Number.isFinite(now)) {
    throw new TypeError("A chain game needs a finite start time.");
  }
  if (!Number.isInteger(wordCount) || wordCount <= 0) {
    throw new TypeError("A chain game needs a positive whole word count.");
  }
  validateBank(bank);

  const rng = mulberry32(hashSeed(String(seed)));
  return {
    status: "running",
    startedAt: now,
    finishedAt: null,
    seed: String(seed),
    words: drawWords(bank, wordCount, rng),
    wordIndex: 0,
    syllableIndex: 0,
    answers: [],
    correct: 0,
    errors: 0,
    combo: 0,
    score: 0,
    lastResult: null,
    lastAnswer: "",
    wordResult: null,
  };
}

// Submit the current syllable. Right or wrong, the chain moves on. The last
// syllable of a word also judges the whole word: all correct raises the combo,
// any error resets it to zero. A correct syllable scores 1 x the multiplier
// that was in force when it was submitted (combo cap 1.5, see common.mjs).
export function typeSyllable(state, answer, now) {
  if (state.status !== "running" || !Number.isFinite(now) || now < state.startedAt) {
    return state;
  }
  const normalized = normalizeAnswer(answer);
  if (!normalized) return state;

  const word = state.words[state.wordIndex];
  const expected = word.syllables[state.syllableIndex];
  const correct = normalized === expected;
  const multiplier = comboMultiplier(state.combo);
  const answers = [...state.answers, {
    wordIndex: state.wordIndex,
    syllableIndex: state.syllableIndex,
    answer: normalized,
    expected,
    correct,
    multiplier,
    // Snapshots make a recall an exact rollback instead of a re-computation.
    comboBefore: state.combo,
    scoreBefore: state.score,
    at: now,
  }];

  const lastSyllable = state.syllableIndex + 1 >= word.syllables.length;
  let combo = state.combo;
  let wordResult = null;
  if (lastSyllable) {
    const wordAnswers = answers.filter(item => item.wordIndex === state.wordIndex);
    const wordCorrect = wordAnswers.length === word.syllables.length &&
      wordAnswers.every(item => item.correct);
    combo = wordCorrect ? state.combo + 1 : 0;
    wordResult = wordCorrect ? "correct" : "incorrect";
  }

  const wordIndex = lastSyllable ? state.wordIndex + 1 : state.wordIndex;
  const finished = wordIndex >= state.words.length;
  return {
    ...state,
    answers,
    correct: state.correct + (correct ? 1 : 0),
    errors: state.errors + (correct ? 0 : 1),
    score: state.score + (correct ? multiplier : 0),
    combo,
    wordResult,
    lastResult: correct ? "correct" : "incorrect",
    lastAnswer: normalized,
    // A finished game parks the cursor past the last word, like engine.mjs.
    wordIndex: finished ? state.words.length : wordIndex,
    syllableIndex: finished || lastSyllable ? 0 : state.syllableIndex + 1,
    status: finished ? "finished" : "running",
    finishedAt: finished ? now : null,
  };
}

// Backspace on an empty draft: drop the last submitted syllable so it can be
// typed again. Its score and combo contribution roll back exactly.
export function recallSyllable(state) {
  if (state.status !== "running" || state.answers.length === 0) return state;
  const previous = state.answers.at(-1);
  return {
    ...state,
    answers: state.answers.slice(0, -1),
    wordIndex: previous.wordIndex,
    syllableIndex: previous.syllableIndex,
    correct: state.correct - (previous.correct ? 1 : 0),
    errors: state.errors - (previous.correct ? 0 : 1),
    combo: previous.comboBefore,
    score: previous.scoreBefore,
    lastResult: null,
    lastAnswer: previous.answer,
    wordResult: null,
  };
}

// Official round metrics (90% threshold for word-level play) plus the chain
// extras the UI needs: combo, running score and progress.
export function getChainMetrics(state, now) {
  const effectiveNow = state.finishedAt ?? (Number.isFinite(now) ? now : state.startedAt);
  const seconds = Math.max(0, (effectiveNow - state.startedAt) / 1000);
  const submitted = state.answers.length;
  const totalSyllables = state.words.reduce((sum, word) => sum + word.syllables.length, 0);
  const current = state.words[state.wordIndex] ?? null;
  return {
    ...roundMetrics({ correct: state.correct, submitted, seconds }, { threshold: OFFICIAL_THRESHOLDS.timed }),
    correct: state.correct,
    errors: state.errors,
    submitted,
    seconds,
    elapsedSeconds: seconds,
    combo: state.combo,
    multiplier: comboMultiplier(state.combo),
    score: state.score,
    status: state.status,
    words: state.words.length,
    completedWords: Math.min(state.wordIndex, state.words.length),
    wordNumber: Math.min(state.wordIndex + 1, state.words.length),
    syllableIndex: state.syllableIndex,
    syllablesInWord: current ? current.syllables.length : 0,
    totalSyllables,
    progress: totalSyllables ? submitted / totalSyllables : 0,
  };
}
