// 三輪成績卡嘅純邏輯：讀流程狀態同歷史，砌出逐輪顯示資料同格式化字串。
// 零 DOM，node --test 可以直接 import；summary-dom.mjs 只負責畫。
import { formatClock } from "../common.mjs";
import { FLOW_ROUNDS, appendFlowHistory, flowTotals, readFlow, readFlowHistory } from "../flow.mjs";

export const SUMMARY_NOTE = "三輪總分排名以組內中位數結算，正式比賽由伺服器計算；呢度係本機流程試玩。";
export const GROUP_LABELS = Object.freeze({ desktop: "電腦組", mobile: "手機組" });

export function formatWhen(at) {
  if (!Number.isFinite(at)) return "—";
  return new Date(at).toLocaleString("zh-HK", {
    month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

export function formatPercent(ratio) {
  return Number.isFinite(ratio) ? `${Math.round(ratio * 100)}%` : "—";
}

// 逐輪一行：缺輪都會出一行（done: false），等成績卡一定有三行。
export function roundRows(flow) {
  return FLOW_ROUNDS.map(round => {
    const result = flow?.rounds?.[round.id] ?? null;
    const timed = Number.isFinite(round.durationSeconds);
    return {
      roundId: round.id,
      index: round.index + 1,
      label: `第 ${round.index + 1} 輪 · ${round.label}`,
      game: round.game,
      timed,
      windowSeconds: round.durationSeconds,
      threshold: round.threshold,
      done: result !== null,
      seconds: result?.seconds ?? null,
      correct: result?.correct ?? 0,
      submitted: result?.submitted ?? 0,
      accuracy: result?.accuracy ?? null,
      officialScore: result?.officialScore ?? null,
      meetsThreshold: result?.meetsThreshold ?? false,
    };
  });
}

// 定時輪顯示固定計分窗，篇章顯示實際完成用時。
export function formatWindow(row) {
  if (!row?.done) return "未完成";
  return row.timed ? `固定 ${row.windowSeconds} 秒計分窗` : `用時 ${formatClock(row.seconds)}`;
}

export function formatCounts(row) {
  return row?.done ? `${row.correct} / ${row.submitted}` : "—";
}

export function formatScore(row) {
  return row?.done && Number.isFinite(row.officialScore) ? row.officialScore.toFixed(1) : "未完成";
}

export function formatThreshold(row) {
  if (!row?.done) return "—";
  const percent = Math.round(row.threshold * 100);
  return row.meetsThreshold ? `達標（${percent}%）` : `未達 ${percent}%`;
}

export function playerLine(flow) {
  if (!flow) return "";
  const parts = [];
  if (flow.player?.name) parts.push(flow.player.name);
  if (flow.player?.group) parts.push(GROUP_LABELS[flow.player.group] ?? "");
  parts.push(`開始 ${formatWhen(flow.startedAt)}`);
  return parts.join(" · ");
}

// 本機合計只係三輪直接相加，唔係正式結算（正式要組內中位數標準化）。
export function totalsLine(totals) {
  if (!totals || totals.rounds === 0) return "三輪都未開始。";
  const missing = FLOW_ROUNDS.length - totals.rounds;
  return `本機合計：正式分 ${totals.officialScore.toFixed(1)}（三輪直接相加，唔係正式結算）· ` +
    `正確 ${totals.correct} / 已交 ${totals.submitted} · ${missing === 0 ? "三輪齊全" : `仲有 ${missing} 輪未完成`}`;
}

export function historyRows(history = []) {
  return history.map(entry => ({
    at: entry.at,
    when: formatWhen(entry.at),
    complete: entry.totals?.complete === true,
    scores: FLOW_ROUNDS
      .map(round => {
        const result = entry.rounds?.[round.id];
        return `${round.label} ${result ? result.officialScore.toFixed(1) : "—"}`;
      })
      .join(" · "),
  })).reverse();
}

// 成績卡嘅唯一入口：讀流程、砌三行、補歷史（完成嘅流程自動入 localStorage 歷史）。
export function loadSummary({ record = true } = {}) {
  const flow = readFlow();
  const rows = roundRows(flow);
  const totals = flowTotals(flow?.rounds ?? {});
  if (record && flow && totals.complete) appendFlowHistory(flow, totals);
  return { flow, rows, totals, history: historyRows(readFlowHistory()) };
}
