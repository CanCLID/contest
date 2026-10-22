// 三輪成績卡嘅純邏輯：讀流程狀態同歷史，砌出逐輪顯示資料同格式化字串。
// 零 DOM，node --test 可以直接 import；summary-dom.mjs 只負責畫。
import { registerStrings, t } from "../../i18n.mjs";
import { formatClock } from "../common.mjs";
import { FLOW_ROUNDS, appendFlowHistory, flowTotals, readFlow, readFlowHistory } from "../flow.mjs";

// 簡體粵文譯文：index.html 嘅 data-i18n 靜態文案同下面嘅動態格式化字串一齊喺度登記。
registerStrings({
  hans: {
    "summary.skip": "跳去主要内容",
    "summary.navBack": "‹ 试玩赛场",
    "summary.badge": "三轮成绩卡",
    "summary.heroTitle": "官方三轮试玩 · 成绩卡",
    "summary.heroText": "单字 90 秒 → 词组 120 秒 → 篇章（示范幽灵陪跑）计时，三轮成绩一次过睇。",
    "summary.emptyTitle": "未有流程数据",
    "summary.emptyText": "直接开成绩卡系唔会有数据嘅。要先由试玩赛场开始「官方三轮试玩」，顺住三轮打完，先会喺呢度见到成绩。",
    "summary.startFlow": "开始流程 ↗",
    "summary.backArena": "返回试玩赛场",
    "summary.tableCaption": "官方三轮试玩成绩",
    "summary.colRound": "轮次",
    "summary.colWindow": "计分窗／用时",
    "summary.colCounts": "正确／已交",
    "summary.colAccuracy": "准确度",
    "summary.colScore": "正式分",
    "summary.colThreshold": "门槛",
    "summary.again": "再玩一次流程 ↗",
    "summary.back": "返回试玩赛场",
    "summary.historyTitle": "最近流程",
    "summary.note": "三轮总分排名以组内中位数结算，正式比赛由服务器计算；呢度系本机流程试玩。",
    "summary.group.desktop": "电脑组",
    "summary.group.mobile": "手机组",
    "summary.round": "第 {index} 轮 · {label}",
    "summary.round.single": "单字",
    "summary.round.words": "词组",
    "summary.round.passage": "篇章",
    "summary.window.missing": "未完成",
    "summary.window.timed": "固定 {seconds} 秒计分窗",
    "summary.window.elapsed": "用时 {clock}",
    "summary.score.missing": "未完成",
    "summary.threshold.meets": "达标（{percent}%）",
    "summary.threshold.misses": "未达 {percent}%",
    "summary.player.started": "开始 {when}",
    "summary.totals.empty": "三轮都未开始。",
    "summary.totals.line": "本机合计：正式分 {score}（三轮直接相加，唔系正式结算）· 正确 {correct} / 已交 {submitted} · {progress}",
    "summary.totals.complete": "三轮齐全",
    "summary.totals.missing": "仲有 {missing} 轮未完成",
    "summary.history.flag.complete": "三轮齐全",
    "summary.history.flag.missing": "未完成",
  },
});

export const SUMMARY_NOTE = "三輪總分排名以組內中位數結算，正式比賽由伺服器計算；呢度係本機流程試玩。";
export const GROUP_LABELS = Object.freeze({ desktop: "電腦組", mobile: "手機組" });

// 界面語言版本嘅注意事項；SUMMARY_NOTE 係繁體原文，字典冇譯文就退回佢。
export function summaryNote() {
  return t("summary.note", SUMMARY_NOTE);
}

export function formatWhen(at) {
  if (!Number.isFinite(at)) return "—";
  return new Date(at).toLocaleString("zh-HK", {
    month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

export function formatPercent(ratio) {
  return Number.isFinite(ratio) ? `${Math.round(ratio * 100)}%` : "—";
}

// 輪次名（單字／詞組／篇章）跟界面語言出，譯文缺咗就用 official.mjs 嘅原文。
function roundLabel(round) {
  return t(`summary.round.${round.id}`, round.label);
}

// 逐輪一行：缺輪都會出一行（done: false），等成績卡一定有三行。
export function roundRows(flow) {
  return FLOW_ROUNDS.map(round => {
    const result = flow?.rounds?.[round.id] ?? null;
    const timed = Number.isFinite(round.durationSeconds);
    return {
      roundId: round.id,
      index: round.index + 1,
      label: t("summary.round", "第 {index} 輪 · {label}", {
        index: round.index + 1,
        label: roundLabel(round),
      }),
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
  if (!row?.done) return t("summary.window.missing", "未完成");
  return row.timed
    ? t("summary.window.timed", "固定 {seconds} 秒計分窗", { seconds: row.windowSeconds })
    : t("summary.window.elapsed", "用時 {clock}", { clock: formatClock(row.seconds) });
}

export function formatCounts(row) {
  return row?.done ? `${row.correct} / ${row.submitted}` : "—";
}

export function formatScore(row) {
  return row?.done && Number.isFinite(row.officialScore)
    ? row.officialScore.toFixed(1)
    : t("summary.score.missing", "未完成");
}

export function formatThreshold(row) {
  if (!row?.done) return "—";
  const percent = Math.round(row.threshold * 100);
  return row.meetsThreshold
    ? t("summary.threshold.meets", "達標（{percent}%）", { percent })
    : t("summary.threshold.misses", "未達 {percent}%", { percent });
}

export function playerLine(flow) {
  if (!flow) return "";
  const parts = [];
  if (flow.player?.name) parts.push(flow.player.name);
  if (flow.player?.group) {
    parts.push(t(`summary.group.${flow.player.group}`, GROUP_LABELS[flow.player.group] ?? ""));
  }
  parts.push(t("summary.player.started", "開始 {when}", { when: formatWhen(flow.startedAt) }));
  return parts.join(" · ");
}

// 本機合計只係三輪直接相加，唔係正式結算（正式要組內中位數標準化）。
export function totalsLine(totals) {
  if (!totals || totals.rounds === 0) return t("summary.totals.empty", "三輪都未開始。");
  const missing = FLOW_ROUNDS.length - totals.rounds;
  const progress = missing === 0
    ? t("summary.totals.complete", "三輪齊全")
    : t("summary.totals.missing", "仲有 {missing} 輪未完成", { missing });
  return t("summary.totals.line",
    "本機合計：正式分 {score}（三輪直接相加，唔係正式結算）· 正確 {correct} / 已交 {submitted} · {progress}", {
      score: totals.officialScore.toFixed(1),
      correct: totals.correct,
      submitted: totals.submitted,
      progress,
    });
}

export function historyRows(history = []) {
  return history.map(entry => ({
    at: entry.at,
    when: formatWhen(entry.at),
    complete: entry.totals?.complete === true,
    flag: entry.totals?.complete === true
      ? t("summary.history.flag.complete", "三輪齊全")
      : t("summary.history.flag.missing", "未完成"),
    scores: FLOW_ROUNDS
      .map(round => {
        const result = entry.rounds?.[round.id];
        return `${roundLabel(round)} ${result ? result.officialScore.toFixed(1) : "—"}`;
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
