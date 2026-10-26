# Contest Yune syllabifier adapter

This directory builds the small static-browser WASM used by the phrase-input game. It vendors Yune's MIT-licensed `DartsDoubleArray` source byte-for-byte from Yune commit `8de49aab76a996f3aaa72a36b9d098bb76cc8f6e` and extracts exact toneless syllables from that commit's shipped `jyut6ping3.dict.yaml`.

The two source classes have separate provenance. `LICENSE.YUNE-CODE` applies to the vendored Yune Darts code. The dictionary file itself has no copyright or license comment in its header. Yune's pinned `apps/yune-web/public-demo/PROVENANCE.md` says its Cantonese dictionary assets are TypeDuck-origin assets used with project-owner approval from the TypeDuck author; the build copies that notice byte-for-byte as `PROVENANCE.YUNE-WEB.md`. This adapter does not assert that Yune's MIT code license covers the dictionary data.

Run from the Contest repository root:

```sh
node tools/yune-syllabifier/build.mjs --yune ../yune
```

The script verifies all pinned source SHA-256 hashes before building. It requires Rust's `wasm32-unknown-unknown` target and writes the deployable artifact plus its provenance receipt to `demo/vendor/yune/`.

The WASM enumerates exact legal-syllable prefixes with Yune's Darts implementation. `demo/games/chain/syllabifier.mjs` turns those edges into whole-input reachability and ambiguity. This Contest-specific DAG is not Yune's complete IME graph and deliberately applies no schema algebra, fuzzy derivation, abbreviation, correction, completion, or candidate ranking.
