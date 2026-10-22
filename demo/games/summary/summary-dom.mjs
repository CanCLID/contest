// 三輪成績卡 DOM 層：只負責畫 summary.mjs 砌好嘅資料，順手接好兩個清流程嘅掣。
import { clearFlow } from "../flow.mjs";
import {
  SUMMARY_NOTE,
  formatCounts,
  formatPercent,
  formatScore,
  formatThreshold,
  formatWindow,
  loadSummary,
  playerLine,
  totalsLine,
} from "./summary.mjs";

const $ = selector => document.querySelector(selector);
const { flow, rows, totals, history } = loadSummary();

function cell(tag, className, text) {
  const node = document.createElement(tag);
  node.className = className;
  node.textContent = text;
  return node;
}

function renderRounds() {
  $("#round-rows").replaceChildren(...rows.map(row => {
    const tr = document.createElement("tr");
    if (!row.done) tr.className = "missing";
    tr.append(
      cell("th", "round-name", row.label),
      cell("td", "round-window", formatWindow(row)),
      cell("td", "round-counts", formatCounts(row)),
      cell("td", "round-accuracy", formatPercent(row.accuracy)),
      cell("td", "round-score", formatScore(row)),
      cell("td", "round-threshold", formatThreshold(row)),
    );
    return tr;
  }));
  $("#player-line").textContent = playerLine(flow);
  $("#totals-line").textContent = totalsLine(totals);
  $("#summary-note").textContent = SUMMARY_NOTE;
}

function renderHistory() {
  $("#history-card").hidden = history.length === 0;
  $("#history-list").replaceChildren(...history.map(entry => {
    const item = document.createElement("li");
    item.append(
      cell("span", "history-when", entry.when),
      cell("span", "history-scores", entry.scores),
      cell("span", "history-flag", entry.complete ? "三輪齊全" : "未完成"),
    );
    return item;
  }));
}

function render() {
  $("#empty-card").hidden = flow !== null;
  $("#summary-card").hidden = flow === null;
  if (flow) renderRounds();
  renderHistory();
}

// 「再玩一次流程」同「返回試玩賽場」都係真連結：先清流程，再畀瀏覽器跟 href 去。
for (const id of ["#again", "#back"]) {
  $(id).addEventListener("click", () => clearFlow());
}

render();
