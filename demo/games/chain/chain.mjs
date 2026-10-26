// Pure logic for 「粵拼詞鏈」: a seeded word-chain game where every correct
// syllable is worth 1 x the combo multiplier at the moment of submission.
// Two modes: "practice" (default, the fixed wordCount list ends the round) and
// "official" (the timed group round: a continuous seeded stream until T0, see
// docs/INTEGRATION-PLAN.md §A2). No DOM, no window, no storage — the DOM layer
// (chain-dom.mjs) owns all of that.
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

// 正式詞組輪（整合計劃 §A2）：固定 120 秒連續題流。official.mjs 直接 spread 呢個常數。
export const OFFICIAL_CHAIN = Object.freeze({
  mode: "official",
  durationSeconds: 120,
});

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

// 官方連續題流：批次編號入 seed、獨立重新洗牌——轉場唔靠共享 rng 嘅內部狀態，
// 撤回再打會補返同一批詞，同一 seed 全程可重現。
function drawBatch(bank, count, seed, batchIndex) {
  return drawWords(bank, count, mulberry32(hashSeed(`${seed}:${batchIndex}`)));
}

export function createChainGame({ now, seed = "", mode = "practice", wordCount = 20, durationSeconds, bank } = {}) {
  if (!Number.isFinite(now)) {
    throw new TypeError("A chain game needs a finite start time.");
  }
  if (mode !== "practice" && mode !== "official") {
    throw new TypeError("A chain game mode is either \"practice\" or \"official\".");
  }
  if (!Number.isInteger(wordCount) || wordCount <= 0) {
    throw new TypeError("A chain game needs a positive whole word count.");
  }
  validateBank(bank);

  const official = mode === "official";
  const roundSeconds = official ? (durationSeconds ?? OFFICIAL_CHAIN.durationSeconds) : null;
  if (official && (!Number.isFinite(roundSeconds) || roundSeconds <= 0)) {
    throw new TypeError("An official chain round needs a positive duration in seconds.");
  }

  const label = String(seed);
  return {
    status: "running",
    mode,
    startedAt: now,
    finishedAt: null,
    finishedReason: null,
    seed: label,
    durationSeconds: roundSeconds,
    endsAt: official ? now + roundSeconds * 1000 : null,
    words: drawWords(bank, wordCount, mulberry32(hashSeed(label))),
    wordCount,
    batchCount: 1,
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
    bank,
  };
}

// 官方定時輪嘅收卷：DOM 每秒同每次提交都可以叫。夠鐘先凍結答案同計時，
// finishedAt 定喺回合終點 T0，之後幾遲叫都唔會郁。
export function finishByTime(state, now) {
  if (!state || state.mode !== "official" || state.status !== "running") return state;
  if (!Number.isFinite(now) || !Number.isFinite(state.endsAt) || now < state.endsAt) return state;
  return {
    ...state,
    status: "finished",
    finishedAt: state.endsAt,
    finishedReason: "time",
  };
}

// Submit the current syllable. Right or wrong, the chain moves on. The last
// syllable of a word also judges the whole word: all correct raises the combo,
// any error resets it to zero. A correct syllable scores 1 x the multiplier
// that was in force when it was submitted (combo cap 1.5, see common.mjs).
// Official mode never ends on the word list: the stream keeps drawing batches
// until finishByTime (or a submission) notices the clock has run out.
export function typeSyllable(state, answer, now, { allowEmpty = false } = {}) {
  if (state.status !== "running" || !Number.isFinite(now) || now < state.startedAt) {
    return state;
  }
  // 官方定時輪：提交時發現逾時即刻收卷，遲到嘅答案一律唔接納。
  if (state.mode === "official" && now >= state.endsAt) {
    return finishByTime(state, now);
  }
  const normalized = normalizeAnswer(answer);
  if (!normalized && !allowEmpty) return state;

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
  // 練習：打完最後一個詞即完場。官方：連續題流，即場補下一批，游標直接入新一批。
  const exhausted = wordIndex >= state.words.length;
  let words = state.words;
  let batchCount = state.batchCount;
  let cursor = wordIndex;
  let status = "running";
  let finishedAt = null;
  let finishedReason = null;
  if (exhausted) {
    if (state.mode === "official") {
      words = [...state.words, ...drawBatch(state.bank, state.wordCount, state.seed, batchCount)];
      batchCount += 1;
    } else {
      cursor = state.words.length;
      status = "finished";
      finishedAt = now;
      finishedReason = "words";
    }
  }

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
    words,
    batchCount,
    // A finished game parks the cursor past the last word, like engine.mjs.
    wordIndex: cursor,
    syllableIndex: exhausted || lastSyllable ? 0 : state.syllableIndex + 1,
    status,
    finishedAt,
    finishedReason,
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
  const official = state.mode === "official";
  const timed = official && Number.isFinite(state.durationSeconds);
  // 官方定時輪：計分窗固定 T0（早打完都係咁多題），唔用實際遊玩時間。
  const scoredSeconds = timed ? state.durationSeconds : seconds;
  const totalSyllables = state.words.reduce((sum, word) => sum + word.syllables.length, 0);
  const current = state.words[state.wordIndex] ?? null;
  return {
    ...roundMetrics({ correct: state.correct, submitted, seconds: scoredSeconds }, { threshold: OFFICIAL_THRESHOLDS.timed }),
    mode: state.mode,
    correct: state.correct,
    errors: state.errors,
    submitted,
    seconds,
    scoredSeconds,
    elapsedSeconds: seconds,
    remainingSeconds: timed ? Math.max(0, state.durationSeconds - seconds) : null,
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
    progress: timed ? Math.min(1, seconds / state.durationSeconds) : (totalSyllables ? submitted / totalSyllables : 0),
  };
}
