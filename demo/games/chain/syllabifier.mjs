const VERSION = "yune-darts-8de49aab/jyut6ping3-2024.11.14/contest-1";
const ABI_VERSION = 1;
const WASM_URL = new URL("../../vendor/yune/syllabifier.wasm", import.meta.url);

export const YUNE_SYLLABIFIER_VERSION = VERSION;
export const YUNE_SYLLABIFIER_MAX_INPUT_LENGTH = 128;

let loaded;

async function instantiateWasm() {
  if (WASM_URL.protocol === "file:") {
    const { readFile } = await import("node:fs/promises");
    return WebAssembly.instantiate(await readFile(WASM_URL), {});
  }

  const response = await fetch(WASM_URL);
  if (!response.ok) {
    throw new Error(`Unable to load Yune syllabifier WASM: HTTP ${response.status}`);
  }
  if (typeof WebAssembly.instantiateStreaming === "function") {
    try {
      return await WebAssembly.instantiateStreaming(response, {});
    } catch (error) {
      // Static hosts sometimes omit application/wasm. Retry the same real WASM
      // bytes through ArrayBuffer; there is intentionally no JavaScript engine fallback.
      const retry = await fetch(WASM_URL);
      if (!retry.ok) throw error;
      return WebAssembly.instantiate(await retry.arrayBuffer(), {});
    }
  }
  return WebAssembly.instantiate(await response.arrayBuffer(), {});
}

function reachablePathCount(inputLength, edges) {
  const outgoing = Array.from({ length: inputLength + 1 }, () => []);
  for (const edge of edges) outgoing[edge.start].push(edge.end);

  const paths = new Uint8Array(inputLength + 1);
  paths[inputLength] = 1;
  for (let start = inputLength - 1; start >= 0; start -= 1) {
    for (const end of outgoing[start]) {
      paths[start] = Math.min(2, paths[start] + paths[end]);
    }
  }
  return paths[0];
}

function createSyllabifier(exports) {
  const required = [
    "yune_syllabifier_abi_version",
    "yune_syllabifier_input_capacity",
    "yune_syllabifier_syllable_count",
    "yune_syllabifier_set_input_byte",
    "yune_syllabifier_segment",
    "yune_syllabifier_edge_start",
    "yune_syllabifier_edge_end",
  ];
  for (const name of required) {
    if (typeof exports[name] !== "function") {
      throw new Error(`Yune syllabifier WASM is missing export ${name}.`);
    }
  }
  if (exports.yune_syllabifier_abi_version() !== ABI_VERSION) {
    throw new Error("Unsupported Yune syllabifier WASM ABI.");
  }

  const maxInputLength = exports.yune_syllabifier_input_capacity();
  const syllableCount = exports.yune_syllabifier_syllable_count();

  function segment(raw) {
    if (typeof raw !== "string") {
      throw new TypeError("Yune syllabifier input must be a string.");
    }
    const input = raw.toLowerCase();
    if (input.length > maxInputLength) {
      throw new RangeError(`Yune syllabifier input cannot exceed ${maxInputLength} characters.`);
    }
    if (input !== "" && !/^[a-z]+$/u.test(input)) {
      return { input, edges: [], complete: false, ambiguous: false, version: VERSION };
    }

    for (let index = 0; index < input.length; index += 1) {
      if (exports.yune_syllabifier_set_input_byte(index, input.charCodeAt(index)) !== 0) {
        throw new Error("Yune syllabifier WASM rejected an in-range input byte.");
      }
    }
    const edgeCount = exports.yune_syllabifier_segment(input.length);
    if (edgeCount < 0) {
      throw new Error(`Yune syllabifier WASM failed with status ${edgeCount}.`);
    }

    const edges = [];
    for (let index = 0; index < edgeCount; index += 1) {
      const start = exports.yune_syllabifier_edge_start(index);
      const end = exports.yune_syllabifier_edge_end(index);
      if (start >= end || end > input.length) {
        throw new Error("Yune syllabifier WASM returned an invalid edge.");
      }
      edges.push({ start, end, text: input.slice(start, end) });
    }
    const pathCount = input === "" ? 0 : reachablePathCount(input.length, edges);
    return {
      input,
      edges,
      complete: pathCount > 0,
      ambiguous: pathCount > 1,
      version: VERSION,
    };
  }

  return Object.freeze({ segment, version: VERSION, maxInputLength, syllableCount });
}

export async function loadSyllabifier() {
  const attempt = loaded ??= instantiateWasm()
    .then(({ instance }) => createSyllabifier(instance.exports));
  try {
    return await attempt;
  } catch (error) {
    // A transient fetch/deploy failure must not poison every later start attempt.
    // Preserve a newer concurrent retry if one has already replaced this promise.
    if (loaded === attempt) loaded = undefined;
    throw error;
  }
}
