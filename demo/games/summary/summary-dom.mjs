// 三輪成績卡 DOM 層：只負責畫 summary.mjs 砌好嘅資料，順手接好兩個清流程嘅掣。
import { clearFlow } from "../flow.mjs";
import {
  formatCounts,
  formatPercent,
  formatScore,
  formatThreshold,
  formatWindow,
  loadSummary,
  playerLine,
  summaryNote,
  totalsLine,
} from "./summary.mjs";

const $ = selector => document.querySelector(selector);

// 語言一變就要用新語言重新砌字串，所以資料唔喺 module 頂部拆死。
let state = loadSummary();

function cell(tag, className, text) {
  const node = document.createElement(tag);
  node.className = className;
  node.textContent = text;
  return node;
}

function renderRounds() {
  $("#round-rows").replaceChildren(...state.rows.map(row => {
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
  $("#player-line").textContent = playerLine(state.flow);
  $("#totals-line").textContent = totalsLine(state.totals);
  $("#summary-note").textContent = summaryNote();
}

function renderHistory() {
  $("#history-card").hidden = state.history.length === 0;
  $("#history-list").replaceChildren(...state.history.map(entry => {
    const item = document.createElement("li");
    item.append(
      cell("span", "history-when", entry.when),
      cell("span", "history-scores", entry.scores),
      cell("span", "history-flag", entry.flag),
    );
    return item;
  }));
}

function render() {
  $("#empty-card").hidden = state.flow !== null;
  $("#summary-card").hidden = state.flow === null;
  if (state.flow) renderRounds();
  renderHistory();
}

// i18n 切換語言之後喺 window 派 canclid-locale：重新讀一次流程再用新語言畫。
if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
  window.addEventListener("canclid-locale", () => {
    state = loadSummary({ record: false });
    render();
  });
}

// 「再玩一次流程」同「返回試玩賽場」都係真連結：先清流程，再畀瀏覽器跟 href 去。
for (const id of ["#again", "#back"]) {
  $(id).addEventListener("click", () => clearFlow());
}

render();
