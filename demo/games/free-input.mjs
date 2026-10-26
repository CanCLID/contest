// Space/Enter is the commit boundary. Grading consumes the complete submitted
// buffer, preserving wrong text rather than correcting it or retaining a tail.
import { loadSyllabifier } from "./chain/syllabifier.mjs";

export const FREE_INPUT_RULE_VERSION = "free-confirm-v2";
export const FREE_INPUT_GRADING_VERSION = "reference-prefix-edit-yune-v1";
export const MAX_FREE_INPUT = 4096;
export const MAX_FREE_TRACE_EVENTS = 20000;
export const MAX_FREE_TRACE_BYTES = 4 * 1024 * 1024;

// The pinned Yune inventory's longest syllable is six letters. This overlap
// leaves ample room for every prefix crossing a 96-letter window boundary.
const WINDOW_OVERLAP = 32;

function normalizeInput(raw) {
  if (typeof raw !== "string" || (raw !== "" && !/^[a-z]+$/i.test(raw))) {
    throw new TypeError("Free input accepts toneless ASCII letters only.");
  }
  if (raw.length > MAX_FREE_INPUT) {
    throw new RangeError(`Free input cannot exceed ${MAX_FREE_INPUT} letters.`);
  }
  return raw.toLowerCase();
}

function readGraph(input, segmentation) {
  if (!segmentation || segmentation.input !== input || !Array.isArray(segmentation.edges) ||
      typeof segmentation.version !== "string" || !segmentation.version) {
    throw new TypeError("Free input needs a Yune graph of the same normalized buffer.");
  }
  const spans = new Set();
  for (const edge of segmentation.edges) {
    if (!Number.isInteger(edge?.start) || !Number.isInteger(edge?.end) ||
        edge.start < 0 || edge.end <= edge.start || edge.end > input.length ||
        edge.text !== input.slice(edge.start, edge.end)) {
      throw new TypeError("Yune graph edges must preserve exact input offsets.");
    }
    spans.add(`${edge.start}:${edge.end}`);
  }
  return spans;
}

/**
 * Find the longest exact input prefix matching the first consecutive targets.
 * Alternative accepted readings are explored together: a short reading must
 * not hide a longer reading that enables more of the submitted text to match.
 * Ties prefer more completed targets, then the targets' stable answer order.
 * No call here advances a game or manufactures an answer for unmatched text.
 */
export function matchConfirmedInput(raw, targets, segmentation) {
  const normalized = normalizeInput(raw);
  const spans = readGraph(normalized, segmentation);
  if (!Array.isArray(targets) || targets.some(target => !Array.isArray(target?.answers) ||
      !target.answers.length || target.answers.some(answer =>
        typeof answer !== "string" || !/^[a-z]+$/.test(answer)))) {
    throw new TypeError("Targets need accepted lowercase, toneless readings.");
  }

  let offsets = [0];
  let ways = new Uint8Array(normalized.length + 1);
  ways[0] = 1;
  const predecessors = [];
  let consumedLength = 0;
  let acceptedCount = 0;
  let bestWays = 0;

  // Each target consumes at least one letter, so neither the loop nor the
  // predecessor matrix can grow with an unrelated, arbitrarily long bank.
  for (let targetIndex = 0; targetIndex < Math.min(targets.length, normalized.length); targetIndex++) {
    const previous = new Int16Array(normalized.length + 1).fill(-1);
    const nextWays = new Uint8Array(normalized.length + 1);
    const nextOffsets = [];
    const readings = [...new Set(targets[targetIndex].answers)];
    // Insertion order preserves lexicographic answer-choice order without
    // copying an entire path into each dynamic-programming state.
    for (const start of offsets) {
      for (const answer of readings) {
        const end = start + answer.length;
        if (end > normalized.length || !normalized.startsWith(answer, start) ||
            !spans.has(`${start}:${end}`)) continue;
        if (!nextWays[end]) {
          previous[end] = start;
          nextOffsets.push(end);
        }
        nextWays[end] = Math.min(2, nextWays[end] + ways[start]);
      }
    }
    if (!nextOffsets.length) break;
    predecessors.push(previous);
    for (const end of nextOffsets) {
      if (end > consumedLength) {
        consumedLength = end;
        acceptedCount = targetIndex + 1;
        bestWays = nextWays[end];
      } else if (end === consumedLength) {
        bestWays = Math.min(2, bestWays + nextWays[end]);
        acceptedCount = targetIndex + 1;
      }
    }
    offsets = nextOffsets;
    ways = nextWays;
  }

  const accepted = new Array(acceptedCount);
  let end = consumedLength;
  for (let targetIndex = acceptedCount - 1; targetIndex >= 0; targetIndex--) {
    const start = predecessors[targetIndex][end];
    accepted[targetIndex] = { answer: normalized.slice(start, end), targetIndex, start, end };
    end = start;
  }
  return {
    raw, normalized, accepted, consumedLength, remainder: raw.slice(consumedLength),
    complete: raw.length > 0 && consumedLength === raw.length,
    ambiguous: bestWays > 1,
    segmentationVersion: segmentation.version,
  };
}

function graphPathCount(length, edges) {
  const ways = new Uint8Array(length + 1);
  ways[0] = 1;
  for (const edge of edges) ways[edge.end] = Math.min(2, ways[edge.end] + ways[edge.start]);
  return length ? ways[length] : 0;
}

function supportedCounts(length, edges, candidates) {
  const wanted = new Set(candidates);
  const supported = new Set();
  const outgoing = Array.from({ length: length + 1 }, () => []);
  for (const edge of edges) outgoing[edge.start].push(edge.end);
  let offsets = new Set([0]);
  const maximum = Math.max(0, ...candidates);
  for (let count = 1; count <= maximum && offsets.size; count++) {
    const next = new Set();
    for (const start of offsets) for (const end of outgoing[start]) next.add(end);
    if (wanted.has(count) && next.has(length)) supported.add(count);
    offsets = next;
  }
  return supported;
}

function exactGradingPaths(input, targets) {
  let offsets = new Map([[0, { node: null, ways: 1 }]]);
  const complete = [];
  for (let index = 0; index < Math.min(targets.length, input.length); index++) {
    const next = new Map();
    for (const [start, prior] of offsets) {
      for (const answer of new Set(targets[index].answers)) {
        const end = start + answer.length;
        if (!input.startsWith(answer, start)) continue;
        const found = next.get(end);
        if (found) found.ways = Math.min(2, found.ways + prior.ways);
        else next.set(end, { ways: prior.ways,
          node: { answer, expected: answer, correct: true, targetIndex: index, start, end, previous: prior.node } });
      }
    }
    const found = next.get(input.length);
    if (found) complete.push({ count: index + 1, ...found });
    if (!next.size) break;
    offsets = next;
  }
  return complete;
}

function unpackExact(node) {
  const accepted = [];
  for (let current = node; current; current = current.previous) {
    const { previous, ...part } = current;
    accepted.push(part);
  }
  return accepted.reverse();
}

/**
 * Grade a variable-length confirmation against a nonempty prefix of targets.
 * The minimum reference edit cost selects the number of submitted syllables;
 * tied counts supported by a full Yune path win, then the shorter count.
 * Alignment preserves every input letter. A wrong span stays wrong even when
 * its inferred reference spelling is known. Counts and boundaries are grading
 * policy, not observed participant intent; raw and ambiguity travel with them.
 *
 * Each target runs a multi-source Levenshtein row seeded by the preceding
 * target's boundary costs. Runtime is O(input length × total reading length),
 * without enumerating all substrings or all pronunciation combinations.
 */
export function gradeConfirmedInput(raw, targets, segmentation) {
  const normalized = normalizeInput(raw);
  const spans = readGraph(normalized, segmentation);
  if (!Array.isArray(targets) || targets.some(target => !Array.isArray(target?.answers) ||
      !target.answers.length || target.answers.some(answer =>
        typeof answer !== "string" || !/^[a-z]+$/.test(answer)))) {
    throw new TypeError("Targets need accepted lowercase, toneless readings.");
  }
  const envelope = { raw, normalized, segmentationVersion: segmentation.version,
    gradingVersion: FREE_INPUT_GRADING_VERSION };
  if (!raw || !targets.length) return { ...envelope, accepted: [], consumedLength: 0,
    remainder: raw, complete: false, ambiguous: false, candidateCounts: [], graphSupportedCounts: [],
    countAmbiguous: false, countSource: "none", editDistance: 0 };

  const exact = exactGradingPaths(normalized, targets);
  if (exact.length) {
    const candidateCounts = exact.map(item => item.count);
    const plans = exact.map(item => unpackExact(item.node));
    const known = exact.filter((item, index) => plans[index].every(part => spans.has(`${part.start}:${part.end}`)))
      .map(item => item.count);
    const missing = candidateCounts.filter(count => !known.includes(count));
    const supported = new Set([...known, ...supportedCounts(raw.length, segmentation.edges, missing)]);
    const graphSupportedCounts = candidateCounts.filter(count => supported.has(count));
    const chosenCount = (graphSupportedCounts.length ? graphSupportedCounts : candidateCounts)[0];
    const chosen = exact.findIndex(item => item.count === chosenCount);
    return { ...envelope, accepted: plans[chosen], consumedLength: raw.length, remainder: "", complete: true,
      editDistance: 0, candidateCounts, graphSupportedCounts, countAmbiguous: candidateCounts.length > 1,
      alignmentAmbiguous: exact[chosen].ways > 1,
      ambiguous: candidateCounts.length > 1 || exact[chosen].ways > 1, countSource: "exact-prefix" };
  }

  const size = raw.length + 1;
  const infinity = 0x3fffffff;
  let costs = new Int32Array(size).fill(infinity);
  costs[0] = 0;
  let correctCounts = new Int32Array(size);
  let ambiguities = new Uint8Array(size);
  const boundaries = [];
  const endings = [];

  for (let targetIndex = 0; targetIndex < targets.length; targetIndex++) {
    const choices = [...new Set(targets[targetIndex].answers)];
    const nextCosts = new Int32Array(size).fill(infinity);
    const nextCorrect = new Int32Array(size);
    const nextStarts = new Int32Array(size).fill(-1);
    const nextReadings = new Int32Array(size);
    const nextAmbiguous = new Uint8Array(size);

    for (let choiceIndex = 0; choiceIndex < choices.length; choiceIndex++) {
      const reading = choices[choiceIndex];
      let row = costs.slice();
      let origins = Int32Array.from({ length: size }, (_, index) => index);
      let rowAmbiguous = ambiguities.slice();

      // Inserting input before this reading belongs to this target's span.
      for (let column = 1; column < size; column++) {
        const inserted = row[column - 1] + 1;
        if (inserted < row[column] || (inserted === row[column] &&
            correctCounts[origins[column - 1]] > correctCounts[origins[column]])) {
          const tied = inserted === row[column];
          const ambiguous = tied && (rowAmbiguous[column] || origins[column - 1] !== origins[column]);
          row[column] = inserted;
          origins[column] = origins[column - 1];
          rowAmbiguous[column] = ambiguous || rowAmbiguous[column - 1] ? 1 : 0;
        } else if (inserted === row[column] && origins[column - 1] !== origins[column]) {
          rowAmbiguous[column] = 1;
        }
      }

      for (let letter = 0; letter < reading.length; letter++) {
        const next = new Int32Array(size);
        const nextOrigins = new Int32Array(size);
        const nextAmbig = new Uint8Array(size);
        next[0] = row[0] + 1;
        nextOrigins[0] = origins[0];
        nextAmbig[0] = rowAmbiguous[0];
        for (let column = 1; column < size; column++) {
          const same = normalized[column - 1] === reading[letter];
          let cost = row[column - 1] + (same ? 0 : 1);
          let origin = origins[column - 1];
          let ambiguous = rowAmbiguous[column - 1];
          const consider = (otherCost, otherOrigin, otherAmbiguous) => {
            if (otherCost < cost) {
              cost = otherCost; origin = otherOrigin; ambiguous = otherAmbiguous;
            } else if (otherCost === cost) {
              ambiguous ||= otherAmbiguous || otherOrigin !== origin;
              const priorCorrect = correctCounts[otherOrigin];
              const chosenCorrect = correctCounts[origin];
              if (priorCorrect > chosenCorrect ||
                  (priorCorrect === chosenCorrect && otherOrigin < origin)) {
                origin = otherOrigin;
              }
            }
          };
          consider(row[column] + 1, origins[column], rowAmbiguous[column]);
          consider(next[column - 1] + 1, nextOrigins[column - 1], nextAmbig[column - 1]);
          next[column] = cost;
          nextOrigins[column] = origin;
          nextAmbig[column] = ambiguous ? 1 : 0;
        }
        row = next; origins = nextOrigins; rowAmbiguous = nextAmbig;
      }

      for (let end = 0; end < size; end++) {
        let start = origins[end];
        let count = correctCounts[start] + (end - start === reading.length &&
          normalized.startsWith(reading, start) ? 1 : 0);
        let cost = row[end];
        let ambiguous = rowAmbiguous[end];
        // A partially exact span can lose a DP tie to a path with more already
        // correct targets. Reintroduce its complete, zero-edit span here so
        // boundary ties maximize the total number of exactly typed targets.
        const exactStart = end - reading.length;
        if (exactStart >= 0 && normalized.startsWith(reading, exactStart)) {
          const exactCost = costs[exactStart];
          const exactCount = correctCounts[exactStart] + 1;
          if (exactCost < cost || (exactCost === cost && (exactCount > count ||
              (exactCount === count && exactStart < start)))) {
            ambiguous = (exactCost === cost && (ambiguous || start !== exactStart)) || ambiguities[exactStart];
            cost = exactCost; count = exactCount; start = exactStart;
          } else if (exactCost === cost) {
            ambiguous ||= ambiguities[exactStart] || start !== exactStart;
          }
        }
        const tied = cost === nextCosts[end];
        if (cost < nextCosts[end] || (tied && (count > nextCorrect[end] ||
            (count === nextCorrect[end] && (nextStarts[end] < 0 || start < nextStarts[end]))))) {
          ambiguous ||= tied && (nextAmbiguous[end] || start !== nextStarts[end]);
          nextCosts[end] = cost; nextCorrect[end] = count; nextStarts[end] = start;
          nextReadings[end] = choiceIndex;
          nextAmbiguous[end] = ambiguous ? 1 : 0;
        } else if (tied) {
          nextAmbiguous[end] ||= ambiguous || start !== nextStarts[end] ? 1 : 0;
        }
      }
    }
    boundaries.push({ starts: nextStarts, readings: nextReadings, choices });
    endings.push({ count: targetIndex + 1, cost: nextCosts[raw.length], ambiguous: nextAmbiguous[raw.length] });
    costs = nextCosts; correctCounts = nextCorrect; ambiguities = nextAmbiguous;
  }

  const minimumCost = Math.min(...endings.map(item => item.cost));
  const candidateCounts = endings.filter(item => item.cost === minimumCost).map(item => item.count);
  const supported = supportedCounts(raw.length, segmentation.edges, candidateCounts);
  const graphSupportedCounts = candidateCounts.filter(count => supported.has(count));
  const chosenCount = (graphSupportedCounts.length ? graphSupportedCounts : candidateCounts)[0];
  const accepted = new Array(chosenCount);
  let end = raw.length;
  for (let index = chosenCount - 1; index >= 0; index--) {
    const boundary = boundaries[index];
    const start = boundary.starts[end];
    const answer = normalized.slice(start, end);
    const correct = targets[index].answers.includes(answer);
    accepted[index] = { answer, expected: correct ? answer : boundary.choices[boundary.readings[end]],
      correct, targetIndex: index, start, end };
    end = start;
  }
  const alignmentAmbiguous = !!endings[chosenCount - 1].ambiguous;
  return { ...envelope, accepted, consumedLength: raw.length, remainder: "", complete: true,
    editDistance: minimumCost, candidateCounts, graphSupportedCounts,
    countAmbiguous: candidateCounts.length > 1, alignmentAmbiguous,
    ambiguous: candidateCounts.length > 1 || alignmentAmbiguous, countSource: "reference-aligned" };
}

/** Load the actual bundled Yune WASM. Failures are surfaced and can be retried. */
export async function loadFreeInput() {
  const syllabifier = await loadSyllabifier();
  const capacity = syllabifier.maxInputLength;
  const step = capacity - WINDOW_OVERLAP;
  if (step <= 0) throw new Error("Yune input capacity is too small for overlapping windows.");

  function segment(raw) {
    const input = normalizeInput(raw);
    const edges = [];
    for (let offset = 0; offset < input.length; offset += step) {
      const part = input.slice(offset, offset + capacity);
      const lastWindow = offset + capacity >= input.length;
      const graph = syllabifier.segment(part);
      for (const edge of graph.edges) {
        // Each start offset belongs to exactly one window. The overlap only
        // supplies the ending letters of syllables that cross its boundary.
        if (!lastWindow && edge.start >= step) continue;
        edges.push({ start: offset + edge.start, end: offset + edge.end, text: edge.text });
      }
      if (lastWindow) break;
    }
    edges.sort((a, b) => a.start - b.start || a.end - b.end);
    const paths = graphPathCount(input.length, edges);
    return { input, edges, complete: paths > 0, ambiguous: paths > 1, version: syllabifier.version };
  }

  return Object.freeze({
    version: syllabifier.version,
    rulesVersion: FREE_INPUT_RULE_VERSION,
    maxInputLength: MAX_FREE_INPUT,
    segment,
    match(raw, targets) { return matchConfirmedInput(raw, targets, segment(raw)); },
    grade(raw, targets) { return gradeConfirmedInput(raw, targets, segment(raw)); },
  });
}

/** Local observation buffer; it does not upload or persist anything. */
export function createFreeTrace({ round, seed = "", startedAt }) {
  if (typeof round !== "string" || !round || !Number.isFinite(startedAt)) {
    throw new TypeError("A free-input trace needs a round and finite start time.");
  }
  return {
    format: "canclid-free-input-trace-v1", rulesVersion: FREE_INPUT_RULE_VERSION,
    round, seed: String(seed), startedAt,
    events: [], totalEvents: 0, droppedEvents: 0, bytesRecorded: 0,
    observation: "browser-text-edits; not a complete physical keystroke trace",
  };
}

export function recordFreeEvent(trace, type, details = {}, at) {
  if (!trace || !Array.isArray(trace.events) || !Number.isFinite(trace.startedAt) ||
      !Number.isInteger(trace.totalEvents) || typeof type !== "string" || !type ||
      !details || typeof details !== "object" || Array.isArray(details) || !Number.isFinite(at)) {
    throw new TypeError("A trace event needs a valid trace, type, details and timestamp.");
  }
  const seq = trace.totalEvents++;
  if (trace.events.length >= MAX_FREE_TRACE_EVENTS) {
    trace.droppedEvents++;
    return trace;
  }
  const truncatedFields = {};
  const bounded = JSON.parse(JSON.stringify(details, (key, value) => {
    if (typeof value === "string" && value.length > MAX_FREE_INPUT) {
      truncatedFields[key] = value.length;
      return value.slice(0, MAX_FREE_INPUT);
    }
    return value;
  }));
  const event = { ...bounded, seq, type, t: Math.max(0, at - trace.startedAt),
    ...(Object.keys(truncatedFields).length ? { truncatedFields } : {}) };
  const bytes = new TextEncoder().encode(JSON.stringify(event)).byteLength;
  if (trace.bytesRecorded + bytes > MAX_FREE_TRACE_BYTES) {
    trace.droppedEvents++;
    return trace;
  }
  trace.events.push(event);
  trace.bytesRecorded += bytes;
  return trace;
}
