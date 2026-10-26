// The source is vendored byte-for-byte from Yune, so keep its wider API intact
// even though this tiny adapter needs only build + common-prefix search.
#[allow(dead_code)]
mod double_array;
mod syllables;

use std::sync::{Mutex, OnceLock};

use double_array::DartsDoubleArray;
use syllables::SYLLABLES;

const ABI_VERSION: u32 = 1;
const MAX_INPUT_BYTES: usize = 128;
const INVALID_EDGE: u32 = u32::MAX;

#[derive(Clone, Copy)]
struct Edge {
    start: u32,
    end: u32,
}

static INDEX: OnceLock<Option<DartsDoubleArray>> = OnceLock::new();
static INPUT: Mutex<[u8; MAX_INPUT_BYTES]> = Mutex::new([0; MAX_INPUT_BYTES]);
static EDGES: Mutex<Vec<Edge>> = Mutex::new(Vec::new());

fn index() -> Option<&'static DartsDoubleArray> {
    INDEX
        .get_or_init(|| {
            let keys = SYLLABLES
                .iter()
                .enumerate()
                .map(|(value, syllable)| (*syllable, value as u32))
                .collect::<Vec<_>>();
            DartsDoubleArray::build(&keys).ok()
        })
        .as_ref()
}

#[no_mangle]
pub extern "C" fn yune_syllabifier_abi_version() -> u32 {
    ABI_VERSION
}

#[no_mangle]
pub extern "C" fn yune_syllabifier_input_capacity() -> u32 {
    MAX_INPUT_BYTES as u32
}

#[no_mangle]
pub extern "C" fn yune_syllabifier_syllable_count() -> u32 {
    SYLLABLES.len() as u32
}

#[no_mangle]
pub extern "C" fn yune_syllabifier_set_input_byte(index: u32, value: u32) -> i32 {
    let Ok(index) = usize::try_from(index) else {
        return -1;
    };
    let Ok(value) = u8::try_from(value) else {
        return -1;
    };
    let Ok(mut input) = INPUT.lock() else {
        return -1;
    };
    let Some(slot) = input.get_mut(index) else {
        return -1;
    };
    *slot = value;
    0
}

// Enumerate every exact toneless-syllable prefix at every byte offset. The
// JavaScript adapter derives whole-input reachability from this raw DAG.
#[no_mangle]
pub extern "C" fn yune_syllabifier_segment(input_len: u32) -> i32 {
    let Ok(input_len) = usize::try_from(input_len) else {
        return -1;
    };
    if input_len > MAX_INPUT_BYTES {
        return -1;
    }

    let Ok(input) = INPUT.lock() else {
        return -1;
    };
    let input = &input[..input_len];
    if !input.iter().all(u8::is_ascii_lowercase) {
        if let Ok(mut edges) = EDGES.lock() {
            edges.clear();
        }
        return -2;
    }
    let Some(index) = index() else {
        return -3;
    };

    let mut next = Vec::new();
    for start in 0..input.len() {
        for matched in index.common_prefix_search_bytes(&input[start..]) {
            let end = start.saturating_add(matched.length);
            if end <= input.len() {
                next.push(Edge {
                    start: start as u32,
                    end: end as u32,
                });
            }
        }
    }
    next.sort_unstable_by_key(|edge| (edge.start, edge.end));

    let Ok(mut edges) = EDGES.lock() else {
        return -1;
    };
    *edges = next;
    i32::try_from(edges.len()).unwrap_or(-1)
}

#[no_mangle]
pub extern "C" fn yune_syllabifier_edge_start(index: u32) -> u32 {
    let Ok(index) = usize::try_from(index) else {
        return INVALID_EDGE;
    };
    EDGES
        .lock()
        .ok()
        .and_then(|edges| edges.get(index).map(|edge| edge.start))
        .unwrap_or(INVALID_EDGE)
}

#[no_mangle]
pub extern "C" fn yune_syllabifier_edge_end(index: u32) -> u32 {
    let Ok(index) = usize::try_from(index) else {
        return INVALID_EDGE;
    };
    EDGES
        .lock()
        .ok()
        .and_then(|edges| edges.get(index).map(|edge| edge.end))
        .unwrap_or(INVALID_EDGE)
}
