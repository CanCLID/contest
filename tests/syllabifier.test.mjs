import test from "node:test";
import assert from "node:assert/strict";
import { copyFile, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { CHAIN_BANK } from "../demo/games/chain/data.mjs";
import {
  loadSyllabifier,
  YUNE_SYLLABIFIER_MAX_INPUT_LENGTH,
  YUNE_SYLLABIFIER_VERSION,
} from "../demo/games/chain/syllabifier.mjs";

const wasmUrl = new URL("../demo/vendor/yune/syllabifier.wasm", import.meta.url);

test("the checked-in artifact is a standalone WASM module with the Yune Darts ABI", async () => {
  const bytes = await readFile(wasmUrl);
  const module = await WebAssembly.compile(bytes);
  assert.deepEqual(WebAssembly.Module.imports(module), []);
  const names = WebAssembly.Module.exports(module).map(item => item.name);
  assert.ok(names.includes("yune_syllabifier_segment"));
  assert.ok(names.includes("yune_syllabifier_edge_start"));
  assert.ok(names.includes("yune_syllabifier_edge_end"));
});

test("loadSyllabifier loads and caches the real local WASM in Node", async () => {
  const first = await loadSyllabifier();
  const second = await loadSyllabifier();
  assert.equal(second, first);
  assert.equal(first.version, YUNE_SYLLABIFIER_VERSION);
  assert.equal(first.maxInputLength, YUNE_SYLLABIFIER_MAX_INPUT_LENGTH);
  assert.equal(first.syllableCount, 706);
});

test("a failed first WASM load can be retried after the artifact becomes available", async t => {
  const root = await mkdtemp(join(tmpdir(), "contest-yune-syllabifier-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const moduleDirectory = join(root, "demo/games/chain");
  const vendorDirectory = join(root, "demo/vendor/yune");
  const modulePath = join(moduleDirectory, "syllabifier.mjs");
  await mkdir(moduleDirectory, { recursive: true });
  await copyFile(new URL("../demo/games/chain/syllabifier.mjs", import.meta.url), modulePath);

  const isolated = await import(`${pathToFileURL(modulePath).href}?retry-test`);
  await assert.rejects(isolated.loadSyllabifier(), /ENOENT|no such file/u);

  await mkdir(vendorDirectory, { recursive: true });
  await copyFile(wasmUrl, join(vendorDirectory, "syllabifier.wasm"));
  const recovered = await isolated.loadSyllabifier();
  assert.equal(recovered.segment("hoenggong").complete, true);
});

test("a continuous phrase produces exact offset edges and a complete path", async () => {
  const syllabifier = await loadSyllabifier();
  const result = syllabifier.segment("HOENGGONG");
  assert.equal(result.input, "hoenggong");
  assert.equal(result.complete, true);
  assert.equal(result.version, YUNE_SYLLABIFIER_VERSION);
  assert.ok(result.edges.some(edge => edge.start === 0 && edge.end === 5 && edge.text === "hoeng"));
  assert.ok(result.edges.some(edge => edge.start === 5 && edge.end === 9 && edge.text === "gong"));
});

test("the DAG retains multiple legal prefixes and reports whole-input ambiguity", async () => {
  const result = (await loadSyllabifier()).segment("aaang");
  assert.equal(result.complete, true);
  assert.equal(result.ambiguous, true);
  assert.ok(result.edges.some(edge => edge.start === 0 && edge.text === "a"));
  assert.ok(result.edges.some(edge => edge.start === 0 && edge.text === "aa"));
});

test("legal offsets after an error remain available for answer alignment", async () => {
  const result = (await loadSyllabifier()).segment("zzzhoenggong");
  assert.equal(result.complete, false);
  assert.ok(result.edges.some(edge => edge.start === 3 && edge.end === 8 && edge.text === "hoeng"));
  assert.ok(result.edges.some(edge => edge.start === 8 && edge.end === 12 && edge.text === "gong"));
});

test("strict toneless full spelling rejects tones, separators and overlong input", async () => {
  const syllabifier = await loadSyllabifier();
  assert.deepEqual(syllabifier.segment("hoeng1gong2").edges, []);
  assert.equal(syllabifier.segment("hoeng gong").complete, false);
  assert.equal(syllabifier.segment("").complete, false);
  assert.throws(() => syllabifier.segment("a".repeat(129)), RangeError);
  assert.throws(() => syllabifier.segment(null), TypeError);
});

test("every current chain-bank syllable and complete word is covered", async () => {
  const syllabifier = await loadSyllabifier();
  for (const entry of CHAIN_BANK) {
    const input = entry.syllables.join("");
    const result = syllabifier.segment(input);
    assert.equal(result.complete, true, `${entry.word} (${input}) needs a complete syllable path`);

    let start = 0;
    for (const syllable of entry.syllables) {
      const end = start + syllable.length;
      assert.ok(
        result.edges.some(edge => edge.start === start && edge.end === end && edge.text === syllable),
        `${entry.word} needs edge ${start}-${end} ${syllable}`,
      );
      start = end;
    }
  }
});
