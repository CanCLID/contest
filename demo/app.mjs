import { createRun, submitAnswer, undoAnswer, getMetrics, getComponentStats, splitJyutping } from "./engine.mjs?v=9";
import { OFFICIAL_THRESHOLDS } from "./games/common.mjs";
import { flowHref, startFlow } from "./games/flow.mjs";
import { initI18n, registerStrings, t } from "./i18n.mjs";
import { ARTICLE, QUESTIONS, flattenQuestions } from "./questions.mjs?v=10";

// 簡體粵文（hans）譯文：index.html 嘅靜態文案用 data-i18n 指去同一批 site.* key，
// 呢度連動態字串一齊登記；繁體原文行內做 fallback，冇登記嘅 key 會照出繁體。
registerStrings({
  hans: {
    // 頁面骨架同導覽
    "site.page.title": "粤语打字比赛 · CanCLID",
    "site.skipLink": "跳去主要内容",
    "site.brand": "粤语打字比赛",
    "site.nav.arena": "试玩赛场",
    "site.nav.games": "小游戏",
    "site.demoBadge": "试玩模式",
    "site.hero.title": "粤语打字比赛",
    // 本輪資料卡同 HUD
    "site.round.name": "参赛者",
    "site.round.group": "参赛组别",
    "site.round.length": "{count} 音节",
    "site.metric.elapsed": "已用时间",
    "site.metric.elapsedNote": "打完全文即结算",
    "site.metric.speed": "输入速度",
    "site.metric.speedUnit": "音节 / 分钟",
    "site.metric.accuracy": "答案准确度",
    "site.metric.attempts": "{correct} 正确 / {errors} 错误",
    "site.metric.none": "未有提交",
    "site.metric.progress": "{count} / {total} 音节",
    "site.component.heading": "分项准确度",
    "site.component.none": "— 未输入",
    "site.component.initial": "声母",
    "site.component.nucleus": "韵腹",
    "site.component.coda": "韵尾",
    "site.component.title": "{label} {value}：{correct} / {total} 正确，准确率 {rate}，错误率 {wrong}%",
    "site.component.empty": "{label} {value}：未输入",
    // 打字區
    "site.sentence.label": "第 {index} 句 / {total}",
    "site.passage.aria": "{text} 目前要打：{target}",
    "site.passage.done": "已完成全部题目",
    "site.next.last": "最后一段，跟住你嘅节奏完成。",
    "site.hint.toggle": "粤拼提示",
    "site.hint.used": "用过提示",
    "site.typing.focusHint": "点一下文字继续输入",
    "site.keyHint.confirm": " 确认；未输入时按 ",
    "site.answer.countdown": "倒数后，输入粤拼",
    "site.answer.running": "打粤拼，空白键确认",
    "site.answer.idle": "准备好就开始啦",
    "site.feedback.initial": "按「开始试玩」，直接打高亮字嘅粤拼。",
    "site.feedback.countdown": "准备好，倒数后先开始输入。",
    "site.feedback.running": "开始喇！唔使打声调数字。",
    "site.feedback.next": "下一字：{hanzi}",
    "site.feedback.incorrect": "未啱；按 Backspace 可修改。",
    "site.feedback.undo": "修改「{hanzi}」后确认。",
    "site.feedback.abandoned": "本轮已放弃，唔会记录成绩。",
    "site.countdown.ready": "准备起跑",
    "site.announce.countdown": "倒数 {count}",
    "site.announce.start": "开始！唔使打声调数字。",
    "site.announce.finished": "全文完成。综合分 {score}，答案准确度 {accuracy}%。",
    // 賽場狀態同完場
    "site.race.idle": "赛道准备好",
    "site.race.ready": "准备起跑",
    "site.race.running": "试玩进行中",
    "site.race.finished": "本轮已完成",
    "site.race.local": "本机试玩 · 无需登录",
    "site.race.group": "{group} · 全文 {count} 音节",
    "site.start.official": "开始三轮试玩",
    "site.start.practice": "开始单篇练习",
    "site.start.preparing": "准备中…",
    "site.start.running": "进行中",
    "site.startNote.countdown": "倒数 3 秒开始",
    "site.startNote.finish": "最后一字提交即完场",
    "site.result.board": "睇本机成绩",
    "site.result.title": "全文完成 · 试算综合分 {score}",
    "site.result.summary": "{name} · {time} · {correct} 啱／{errors} 错",
    "site.result.hintUsed": " · 用过提示",
    "site.playAgain": "再玩一场",
    "site.editSettings": "更改设定",
    "site.cancelRun": "放弃本轮，重新设定",
    // 設定卡
    "site.setup.title": "试玩设定",
    "site.flowNote.official": "官方三轮：单字 90 秒 → 词组 120 秒 → 篇章计时 → 三轮成绩卡",
    "site.flowNote.practice": "单篇练习：由头打到尾，可开粤拼提示，成绩存本机榜",
    "site.flow.official": "官方三轮试玩",
    "site.flow.officialBadge": "推荐 · 约 4 分钟",
    "site.flow.officialDesc": "单字 90 秒 → 词组 120 秒 → 篇章计时",
    "site.flow.practice": "自由练习",
    "site.flow.practiceDesc": "单篇＋四个小游戏 · 可开粤拼提示",
    "site.practice.lead": "喺呢页开始：单篇自由练习（可开粤拼提示）",
    "site.practice.label": "去小游戏玩（会离开试玩赛场）：",
    "site.practice.rocks": "单字 · 落石",
    "site.practice.chain": "词组 · 词链",
    "site.practice.ghost": "篇章 · 幽灵",
    "site.practice.tower": "解锁塔",
    "site.practice.lobby": "睇大厅全部介绍",
    "site.nickname.label": "昵称",
    "site.nickname.default": "粤拼新星",
    "site.setup.legend": "本轮试玩设定",
    "site.group.desktop": "电脑组",
    "site.group.desktopNote": "实体键盘",
    "site.group.mobile": "手机组",
    "site.group.mobileNote": "萤幕键盘",
    "site.article.detail": "示范粤文 · {count} 音节",
    "site.demoNote": "本机试玩，成绩只存喺呢个浏览器。",
    // 排行榜
    "site.backToArena": "返去试玩 ↗",
    "site.board.article": "同篇比较：{title}",
    "site.board.title": "无提示成绩",
    "site.board.intro": "同组别、文章同规则比较，按正式分排名。有提示同无提示合共保存最近 20 轮。",
    "site.board.localPill": "只存本机",
    "site.board.clear": "清除本机纪录",
    "site.board.hintedTitle": "用过提示嘅纪录",
    "site.board.hintedIntro": "按最近完成排列，只供练习参考，唔参与排名。",
    "site.board.sampleTitle": "排行榜效果预览",
    "site.board.sampleIntro": "以下全部係虚构示范数据（包括正式分栏），唔係真人参赛成绩。",
    "site.board.samplePill": "示范数据",
    "site.board.ruleLead": "正式分 R ＝ 正确音节／分钟 × 准确度；篇章准确度门槛 85%，未达门槛会标示「未达 85% 门槛」兼唔入正式排名。本机榜先按正式分、再按准确度、最后按用时排序，三项相同就并列。综合分（速度 × 准确度²）係旧 demo 试算，只作新旧纪录比较。正式赛三轮（单字 0.3／词组 0.3／篇章 0.4）以组内中位数标准化合成，由伺服器计算，详见",
    "site.board.ruleTail": "；三轮流程成绩唔入呢个本机单篇榜。",
    "site.board.rank": "名次",
    "site.board.name": "昵称 / 用时",
    "site.board.official": "正式分",
    "site.board.composite": "综合分",
    "site.board.accuracy": "准确度",
    "site.board.belowThreshold": "未达 85% 门槛",
    "site.board.samplePerson": "虚构示范人物",
    "site.board.local": "{time} · 本机",
    "site.board.speed": "{time} · {speed} 音节/分",
    "site.board.empty": "未有纪录。",
    "site.board.emptyNote": "完成全文后会显示喺呢度。",
    "site.storage.failed": "未能保存纪录，关页后新成绩会遗失。",
    "site.confirm.clear": "清除呢部装置目前文章、两个组别嘅试玩纪录？",
    // 玩法頁六張卡（標題喺 renderRules() 按卡序翻譯）
    "site.rules.official.title": "官方三轮试玩",
    "site.rules.official.p1": "流程：单字（落石）90 秒 → 词组（词链）120 秒 → 篇章（幽灵）计时，三轮顺住连打，最后出三轮成绩卡。",
    "site.rules.official.p2": "每轮完场自动写入流程状态再跳去下一轮；成绩卡逐轮显示计分窗／用时、正确／已交、准确度、正式分同门槛。门槛：单字 90%、词组 90%、篇章 85%，未达门槛嘅一轮正式赛唔计排名。",
    "site.rules.official.p3": "三轮总分由正式赛伺服器以组内中位数标准化（单字 0.3／词组 0.3／篇章 0.4）合成；demo 只存本机，唔係正式结算。第 3 轮有内建 55 音节／分示范幽灵陪跑，纯粹气氛，唔影响计分。",
    "site.rules.scoring.title": "计分方法",
    "site.rules.scoring.p1a": "正式分 ",
    "site.rules.scoring.p1b": "；准确度＝正确 ÷ 已提交，门槛为定时轮（单字／词组）90%、篇章 85%。准确度按最后保留答案计：撤回改错唔会永久扣分，但修正时间照计入用时。",
    "site.rules.scoring.p2a": "本机榜同时列正式分同旧 demo 试算综合分 ",
    "site.rules.scoring.p2b": "，后者只作新旧纪录比较。同分次序：正式分 → 准确度 → 用时，三项相同就并列；正式赛三轮同分次序係三轮合计准确度 → 篇章准确度 → 篇章用时。",
    "site.rules.scoring.p3a": "输入：直接打高亮字嘅无声调粤拼，字母显示喺汉字上方；",
    "site.rules.scoring.p3b": " 确认，错字照样前进；未输入字母时按 ",
    "site.rules.scoring.p3c": " 退回上一字或上一句。",
    "site.rules.games.title": "三个计分游戏",
    "site.rules.games.p1": "粤拼落石（单字）：60 秒内喺石头落地前打出石上单字，落地扣命，三条命或时间到就结算；官方模式固定 90 秒、无命，石头落地未击破当一次提交错误。",
    "site.rules.games.p2": "粤拼词链（词组）：同一 seed 抽出 20 个词，逐字或连打后按 Space／Enter 确认；完成词语连击 +1，倍率最高 ×1.5。官方模式同样自由输入，120 秒到点收卷。",
    "site.rules.games.p3": "幽灵竞速（篇章）：同自己最佳时间线或内建示范幽灵斗快打完全篇，另有「净计时」唔设对手；官方流程用 55 音节／分示范幽灵陪跑，唔影响计分。三个游戏都有练习／官方模式切换。",
    "site.rules.tools.title": "练习工具",
    "site.rules.tools.p1": "单篇自由练习：同一篇示范粤文由头打到尾，可以开「粤拼提示」，成绩存本机榜；用过提示嘅纪录另列，唔参与排名。",
    "site.rules.tools.p2": "声韵解锁塔：由声母开始逐层解锁韵腹、韵尾，自适应出题，达标先上到下一层；纯练习，唔设排名。",
    "site.rules.tools.p3": "游戏大厅有齐四个小游戏加单篇练习入口；试玩赛场设定卡拣「自由练习」就会展开同一批入口（单篇喺本页开始，其余连去对应小游戏）。",
    "site.rules.groups.title": "手机组同电脑组",
    "site.rules.groups.p1": "萤幕键盘拣手机组，实体键盘拣电脑组，平板亦按键盘分类。手机点一下题目，就可以用系统键盘输入。",
    "site.rules.groups.p2": "请自行确认组别，开赛后锁定。网站无法可靠核实装置或外接键盘。",
    "site.rules.local.title": "本机示范",
    "site.rules.local.p1": "目前用原创示范文章，正式文章稍后提供。冇帐户或同步对赛，纪录只存喺呢个浏览器。",
    "site.rules.local.p2": "排行榜示范人物同成绩均为虚构；未验证防作弊或 2,000 人比赛容量。",
    // 簡體同形（字符無變）嘅文案照樣登記，令 index.html 每個 data-i18n key 都喺度搵到譯文。
    "site.nav.leaderboard": "排行榜",
    "site.nav.rules": "玩法",
    "site.leaderboard.title": "排行榜",
    "site.rules.title": "玩法",
    "site.flow.label": "玩法",
    "site.round.article": "文章",
    "site.upNext": "下一句",
    "site.keyHint.edit": " 改上一字",
    "site.article.label": "今次嘅文章",
  },
});

const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const tokens = flattenQuestions();
const storageKey = "canclid-contest-demo-v2";
// 介面文字一律係 [i18n key, 繁體原文]：t() 按當前語言揀簡體譯文或者還原原文。
const groupNames = {
  desktop: ["site.group.desktop", "電腦組"],
  mobile: ["site.group.mobile", "手機組"],
};
function groupName(value) {
  const [key, text] = groupNames[value] ?? groupNames.desktop;
  return t(key, text);
}
// 主入口預設「官方三輪試玩」（單字 → 詞組 → 篇章 → 成績卡）；單篇自由練習保留原本玩法。
// 遊戲大廳「單篇練習」卡會帶 ?practice=1 過嚟，預設揀返單篇自由練習。
const flowNotes = {
  official: ["site.flowNote.official", "官方三輪：單字 90 秒 → 詞組 120 秒 → 篇章計時 → 三輪成績卡"],
  practice: ["site.flowNote.practice", "單篇練習：由頭打到尾，可開粵拼提示，成績存本機榜"],
};
const practiceRequested = (() => {
  try {
    return new URLSearchParams(location.search).get("practice") === "1";
  } catch {
    return false;
  }
})();
let flowChoice = practiceRequested ? "practice" : "official";
let group = matchMedia("(max-width: 760px)").matches ? "mobile" : "desktop";
let boardGroup = group;
let run = null;
let round = null;
let countdownEnds = null;
let ticker = null;
let resultSaved = false;
let hintsVisible = false;
let composing = false;
let draft = "";
let draftCursor = 0;
let draftSelectionEnd = 0;
let answerVersion = 0;
let physicalEdit = null;
let composition = null;
let committedComposition = null;
let currentGlyph = null;
let currentReading = null;
let readingElements = [];
let storageAvailable = true;
let records = readRecords();

function readRecords(fallback = []) {
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey) || "[]");
    if (!Array.isArray(saved)) return [];
    return saved.filter(item => item && item.rules === 2 && item.articleId === ARTICLE.id &&
      ["desktop", "mobile"].includes(item.group) &&
      typeof item.name === "string" && item.name.length <= 16 &&
      Number.isSafeInteger(item.correct) && item.correct >= 0 && item.correct <= tokens.length &&
      Number.isSafeInteger(item.errors) && item.errors >= 0 && item.correct + item.errors === tokens.length &&
      Number.isFinite(item.elapsedSeconds) && item.elapsedSeconds >= 0 &&
      Number.isFinite(item.at) && (item.hintsUsed === undefined || typeof item.hintsUsed === "boolean"))
      .slice(-20).map(item => ({ ...item, hintsUsed: item.hintsUsed ?? false }));
  } catch {
    storageAvailable = false;
    return fallback;
  }
}

function writeRecords() {
  try {
    localStorage.setItem(storageKey, JSON.stringify(records));
    storageAvailable = true;
  } catch {
    storageAvailable = false;
  }
}

function mergeRecords(...sources) {
  const merged = new Map(sources.flat().map(item => [
    item.id ?? JSON.stringify([item.at, item.name, item.group, item.articleId, item.correct, item.errors]),
    item,
  ]));
  return [...merged.values()].sort((a, b) => a.at - b.at).slice(-20);
}

function setPressed(selector, attribute, value) {
  $$(selector).forEach(button => {
    const selected = button.dataset[attribute] === String(value);
    button.classList.toggle("selected", selected);
    button.setAttribute("aria-pressed", String(selected));
  });
}

function announce(message) {
  $("#announcer").textContent = message;
}

// 高頻更新（100ms tick／rAF）只喺值有變先寫 DOM，避免重複寫入觸發無謂重排。
function setText(selector, value) {
  const node = $(selector);
  if (node.textContent !== value) node.textContent = value;
}

function setAttr(selector, name, value) {
  const node = $(selector);
  if (node.getAttribute(name) !== value) node.setAttribute(name, value);
}

function setWidth(selector, percent) {
  const node = $(selector);
  const width = `${percent}%`;
  if (node.style.width !== width) node.style.width = width;
}

function showView(view) {
  $$(".view").forEach(section => { section.hidden = section.id !== `${view}-view`; });
  $$(".nav-link").forEach(button => {
    const active = button.dataset.view === view;
    button.classList.toggle("active", active);
    if (active) button.setAttribute("aria-current", "page");
    else button.removeAttribute("aria-current");
  });
  if (view === "leaderboard") renderBoards();
  if (view === "arena" && run?.status === "running") focusAnswer();
}

function positionAnswer(scroll = false) {
  if (!currentGlyph || $("#arena-view").hidden || $("#race-card").hidden) return;
  if (scroll) currentGlyph.scrollIntoView({ block: "nearest", inline: "nearest" });
  const glyphBounds = currentGlyph.getBoundingClientRect();
  const surface = $("#typing-surface");
  const surfaceBounds = surface.getBoundingClientRect();
  $("#answer").style.left = `${glyphBounds.left - surfaceBounds.left + surface.scrollLeft + glyphBounds.width / 2}px`;
  $("#answer").style.top = `${glyphBounds.top - surfaceBounds.top + surface.scrollTop}px`;
}

function focusAnswer() {
  if ($("#answer").disabled || $("#race-card").hidden) return;
  positionAnswer(true);
  const target = round?.group === "mobile" ? $("#answer") : $("#typing-surface");
  target.focus({ preventScroll: true });
}

function renderDraft() {
  if (currentReading) renderReading(currentReading);
  if (round?.group === "mobile" && run?.status === "running") positionAnswer(false);
}

function renderHint() {
  const running = run?.status === "running";
  if (!running) hintsVisible = false;
  $("#hint-toggle").disabled = !running;
  $("#hint-toggle").setAttribute("aria-pressed", String(hintsVisible));
  $("#typing-surface").classList.toggle("show-hints", hintsVisible);
  $("#next-sentence").classList.toggle("show-hints", hintsVisible);
  readingElements.forEach(renderReading);
  $("#hint-used").hidden = !round?.hintsUsed;
}

function readingParts(answer) {
  const { initial, nucleus, coda } = splitJyutping(answer);
  return [initial, nucleus + coda];
}

function expectedReading(answers, input) {
  const exact = answers.find(answer => answer === input);
  if (exact) return exact;
  const prefix = answers.find(answer => answer.startsWith(input));
  if (prefix) return prefix;
  const actual = readingParts(input);
  const matches = answer => readingParts(answer).filter((part, index) => part && part === actual[index]).length;
  return answers.reduce((best, answer) => matches(answer) > matches(best) ? answer : best);
}

function renderReading({ element, token, index, preview }) {
  const submitted = run?.answers[index];
  const input = submitted?.answer ?? (run?.status === "running" && run.index === index ? draft : "");
  const expected = expectedReading(token.answers, input);
  const segments = [];
  const add = (type, text) => { if (text) segments.push({ type, text }); };
  let correction = false;
  if (submitted && !submitted.correct) {
    const actualParts = readingParts(input);
    readingParts(expected).forEach((part, index) => {
      const actual = actualParts[index];
      if (part === actual) add("typed", actual);
      else {
        correction = true;
        // Match the source's initial (wrong first) and rime (expected first) corrections.
        if (index === 0) add("wrong", actual);
        add("correct", part);
        if (index === 1) add("wrong", actual);
      }
    });
  } else if (!submitted && hintsVisible) {
    if (!input) add("hint", token.answers.join(" / "));
    else if (expected.startsWith(input)) {
      add("typed", input);
      add("hint", expected.slice(input.length));
    } else {
      let prefix = 0;
      while (prefix < expected.length && expected[prefix] === input[prefix]) prefix++;
      const overlap = Math.min(input.length, expected.length);
      add("typed", input.slice(0, prefix));
      add("correct", expected.slice(prefix, overlap));
      add("wrong", input.slice(prefix));
      add("hint", expected.slice(overlap));
      correction = true;
    }
  } else add("typed", input);
  element.dataset.input = input;
  element.dataset.expected = expected;
  element.hidden = preview && !hintsVisible;
  element.setAttribute("aria-label", input
    ? `${token.hanzi}：輸入 ${input}${correction ? `，正確讀法 ${expected}` : ""}`
    : hintsVisible ? `${token.hanzi}：${token.answers.join(" / ")}` : "");
  element.replaceChildren(...segments.map(({ type, text }) => {
    const segment = document.createElement(type === "wrong" ? "del" : "span");
    segment.className = `reading-${type}`;
    segment.textContent = text;
    return segment;
  }));
}

function createRuby(token, index, preview = false) {
  const ruby = document.createElement("ruby");
  ruby.className = "glyph-ruby";
  const hanzi = document.createElement("span");
  hanzi.className = "glyph-hanzi";
  hanzi.textContent = token.hanzi;
  const reading = document.createElement("rt");
  reading.className = "glyph-reading";
  readingElements.push({ element: reading, token, index, preview });
  ruby.append(hanzi, reading);
  return ruby;
}

function setDraft(value, start, end = start) {
  draft = value.replace(/[^a-z]/gi, "").toLowerCase();
  draftCursor = Math.min(start ?? draft.length, draft.length);
  draftSelectionEnd = Math.min(end ?? draftCursor, draft.length);
  $("#answer").value = draft;
  $("#answer").setSelectionRange(draftCursor, draftSelectionEnd);
  renderDraft();
}

function restoreDraft() {
  setDraft(draft, draftCursor, draftSelectionEnd);
}

function selection() {
  const input = $("#answer");
  return input.value === draft ? [input.selectionStart ?? draftCursor, input.selectionEnd ?? draftCursor] : [draftCursor, draftCursor];
}

function editDraft(letter = null) {
  let [start, end] = selection();
  if (letter === null && start === end) start = Math.max(0, start - 1);
  const replacement = letter ?? "";
  setDraft(draft.slice(0, start) + replacement + draft.slice(end), start + replacement.length);
}

function markPhysicalEdit() {
  const edit = {};
  physicalEdit = edit;
  if (composition) composition.physical = true;
  committedComposition = null;
  // A canceled keydown can still be followed by native input in the same event turn.
  setTimeout(() => { if (physicalEdit === edit) physicalEdit = null; }, 0);
}

function captureComposition(event) {
  if (composition?.version === answerVersion && !composition.physical && typeof event.data === "string" && /^[a-z]*$/i.test(event.data)) {
    const { base, start, end } = composition;
    const letters = (event.data ?? "").toLowerCase();
    setDraft(base.slice(0, start) + letters + base.slice(end), start + letters.length);
  } else restoreDraft();
}

function isCompositionCommit(event) {
  return /Composition/.test(event.inputType ?? "") ||
    (committedComposition && event.data === committedComposition.data);
}

function renderComponentStats() {
  const labels = {
    initial: t("site.component.initial", "聲母"),
    nucleus: t("site.component.nucleus", "韻腹"),
    coda: t("site.component.coda", "韻尾"),
  };
  for (const [part, items] of Object.entries(getComponentStats(run))) {
    const cells = items.map(({ value, correct, total, accuracy }) => {
      const cell = document.createElement("span");
      cell.className = "component-cell";
      cell.dataset.value = value;
      cell.setAttribute("role", "listitem");
      const rate = accuracy === null ? "—" : `${Math.round(accuracy)}%`;
      cell.title = total
        ? t("site.component.title", "{label} {value}：{correct} / {total} 正確，準確率 {rate}，錯誤率 {wrong}%",
          { label: labels[part], value, correct, total, rate, wrong: Math.round(100 - accuracy) })
        : t("site.component.empty", "{label} {value}：未輸入", { label: labels[part], value });
      cell.setAttribute("aria-label", cell.title);
      if (total) cell.classList.add(correct === total ? "correct" : correct === 0 ? "incorrect" : "mixed");
      const sound = document.createElement("span");
      sound.className = "component-sound";
      sound.textContent = value;
      const percent = document.createElement("span");
      percent.className = "component-rate";
      percent.textContent = rate;
      cell.append(sound, percent);
      return cell;
    });
    $(`#component-${part}`).replaceChildren(...cells);
  }
}

function renderPassage() {
  const index = run?.index ?? 0;
  const sentenceIndex = tokens[Math.min(index, tokens.length - 1)].sentenceIndex;
  const question = QUESTIONS[sentenceIndex];
  let absoluteIndex = tokens.findIndex(token => token.sentenceIndex === sentenceIndex);
  let previousGlyph = null;
  currentGlyph = null;
  currentReading = null;
  readingElements = [];
  $("#passage").replaceChildren();
  for (const character of question.text) {
    const element = document.createElement("span");
    if (/\p{Script=Han}/u.test(character)) {
      element.classList.add("glyph");
      element.append(createRuby(tokens[absoluteIndex], absoluteIndex));
      previousGlyph = element;
      if (absoluteIndex < index) element.classList.add(run.answers[absoluteIndex].correct ? "correct" : "incorrect");
      if (absoluteIndex === index) {
        element.classList.add("current");
        currentGlyph = element;
        currentReading = readingElements.at(-1);
      }
      absoluteIndex++;
    } else {
      element.classList.add("punctuation");
      element.textContent = character;
      if (previousGlyph) {
        previousGlyph.classList.add("punctuated");
        previousGlyph.append(element);
        continue;
      }
    }
    $("#passage").append(element);
  }
  $("#sentence-label").textContent = t("site.sentence.label", "第 {index} 句 / {total}", {
    index: String(sentenceIndex + 1).padStart(2, "0"), total: QUESTIONS.length,
  });
  const next = $("#next-sentence");
  next.replaceChildren();
  const nextQuestion = QUESTIONS[sentenceIndex + 1];
  if (nextQuestion) {
    for (const character of nextQuestion.text) {
      if (/\p{Script=Han}/u.test(character)) {
        next.append(createRuby(tokens[absoluteIndex], absoluteIndex, true));
        absoluteIndex++;
      } else next.append(document.createTextNode(character));
    }
  } else next.append(document.createTextNode(t("site.next.last", "最後一段，跟住你嘅節奏完成。")));
  $("#passage").setAttribute("aria-label", t("site.passage.aria", "{text} 目前要打：{target}", {
    text: question.text,
    target: tokens[index]?.hanzi ?? t("site.passage.done", "已完成全部題目"),
  }));
  renderDraft();
  renderHint();
  renderComponentStats();
  positionAnswer();
}

function formatTime(seconds) {
  const tenths = Math.floor(seconds * 10);
  return `${String(Math.floor(tenths / 600)).padStart(2, "0")}:${String(Math.floor(tenths / 10) % 60).padStart(2, "0")}.${tenths % 10}`;
}

function renderMetrics(now = Date.now()) {
  const metrics = run ? getMetrics(run, now) : {
    elapsedSeconds: 0, syllablesPerMinute: 0, accuracy: null, correct: 0, errors: 0, submitted: 0, progress: 0,
  };
  setText("#time", formatTime(metrics.elapsedSeconds));
  setText("#speed", String(Math.round(metrics.syllablesPerMinute)));
  setText("#accuracy", metrics.accuracy === null ? "—" : `${Math.round(metrics.accuracy)}%`);
  setText("#attempts", metrics.correct + metrics.errors
    ? t("site.metric.attempts", "{correct} 正確 / {errors} 錯誤", { correct: metrics.correct, errors: metrics.errors })
    : t("site.metric.none", "未有提交"));
  setText("#completed-count", t("site.metric.progress", "{count} / {total} 音節", { count: metrics.submitted, total: tokens.length }));
  const fraction = metrics.progress * 100;
  setWidth("#time-bar", fraction);
  setAttr(".time-track", "aria-valuenow", String(Math.round(fraction)));
}

function playerName() {
  return $("#nickname").value.trim().slice(0, 16) || t("site.nickname.default", "粵拼新星");
}

// 官方三輪試玩：記低開始時間同參加者資料，再交去第 1 輪（落石官方單字輪）。
function startOfficialFlow() {
  startFlow(Date.now(), { name: playerName(), group });
  location.href = flowHref("single");
}

// 開始掣文字跟玩法揀選變；resetRound 還原設定卡時用返同一段文字。
function renderStartLabel() {
  const label = flowChoice === "official"
    ? t("site.start.official", "開始三輪試玩")
    : t("site.start.practice", "開始單篇練習");
  $("#start").innerHTML = `${label} <span aria-hidden="true">↗</span>`;
}

function renderFlowChoice() {
  const official = flowChoice === "official";
  const officialButton = $("#flow-official");
  const practiceButton = $("#flow-practice");
  officialButton.classList.toggle("selected", official);
  officialButton.setAttribute("aria-pressed", String(official));
  practiceButton.classList.toggle("selected", !official);
  practiceButton.setAttribute("aria-pressed", String(!official));
  const [noteKey, noteText] = flowNotes[official ? "official" : "practice"];
  $("#flow-note").textContent = t(noteKey, noteText);
  // 自由練習面板（單篇入口＋小遊戲 chips）跟玩法揀選展開／收埋。
  $("#practice-panel").hidden = official;
  renderStartLabel();
}

// 賽場狀態文字（未開始／倒數／進行中／完成）跟住 run 狀態重畫：開局、完場同語言切換都行呢支。
function renderRaceChrome() {
  if (round) {
    $("#race-group").textContent = t("site.race.group", "{group} · 全文 {count} 音節", { group: groupName(round.group), count: tokens.length });
    $("#round-length").textContent = t("site.round.length", "{count} 音節", { count: tokens.length });
  } else {
    $("#race-group").textContent = t("site.race.local", "本機試玩 · 無需登入");
  }
  if (countdownEnds !== null) {
    $("#race-status").textContent = t("site.race.ready", "準備起跑");
    $("#start").textContent = t("site.start.preparing", "準備中…");
    $("#start-note").textContent = t("site.startNote.countdown", "倒數 3 秒開始");
    return;
  }
  if (run?.status === "running") {
    $("#race-status").textContent = t("site.race.running", "試玩進行中");
    $("#start").textContent = t("site.start.running", "進行中");
    $("#start-note").textContent = t("site.startNote.finish", "最後一字提交即完場");
    return;
  }
  if (run?.status === "finished") {
    $("#race-status").textContent = t("site.race.finished", "本輪已完成");
    $("#start-note").textContent = "";
    return;
  }
  $("#race-status").textContent = t("site.race.idle", "賽道準備好");
  $("#start-note").textContent = t("site.startNote.countdown", "倒數 3 秒開始");
  renderStartLabel();
}

function startRound(replay = false) {
  if (countdownEnds !== null || run?.status === "running" || (replay && !round)) return;
  run = null;
  resultSaved = false;
  composing = false;
  composition = null;
  committedComposition = null;
  physicalEdit = null;
  answerVersion++;
  round = replay ? { ...round }
    : { group, articleId: ARTICLE.id, name: playerName(), rules: 2 };
  hintsVisible = false;
  round.hintsUsed = false;
  countdownEnds = Date.now() + 3000;
  $("#setup-card").hidden = true;
  $("#round-summary").hidden = false;
  $("#round-name").textContent = round.name;
  $("#round-group").textContent = groupName(round.group);
  $("#round-article").textContent = ARTICLE.title;
  $("#round-actions").hidden = false;
  $("#play-again").hidden = true;
  $("#edit-settings").hidden = true;
  $("#setup-fields").disabled = true;
  $("#start").disabled = true;
  $("#cancel-run").hidden = false;
  $("#result").hidden = true;
  $("#race-card").hidden = false;
  $("#arena-view").classList.add("has-race");
  $("#typing-form").hidden = false;
  renderRaceChrome();
  $("#countdown-overlay").hidden = false;
  $("#answer").disabled = false;
  setDraft("");
  $("#answer").placeholder = t("site.answer.countdown", "倒數後，輸入粵拼");
  $("#input-feedback").textContent = t("site.feedback.countdown", "準備好，倒數後先開始輸入。");
  document.body.classList.add("running");
  showView("arena");
  renderPassage();
  renderMetrics();
  // Focus during the initiating tap so mobile browsers can open their keyboard.
  focusAnswer();
  tick();
  ticker = setInterval(tick, 100);
}

function tick() {
  const now = Date.now();
  if (countdownEnds !== null) {
    const remaining = Math.ceil((countdownEnds - now) / 1000);
    if (remaining > 0) {
      if ($("#countdown-number").textContent !== String(remaining)) {
        announce(t("site.announce.countdown", "倒數 {count}", { count: remaining }));
        $("#countdown-number").textContent = String(remaining);
      }
      return;
    }
    run = createRun({ now: countdownEnds, questionSet: tokens });
    countdownEnds = null;
    $("#countdown-overlay").hidden = true;
    answerVersion++;
    setDraft("");
    $("#answer").placeholder = t("site.answer.running", "打粵拼，空白鍵確認");
    $("#status-dot").classList.add("live");
    renderRaceChrome();
    $("#input-feedback").textContent = t("site.feedback.running", "開始喇！唔使打聲調數字。");
    renderDraft();
    renderHint();
    if (!$("#arena-view").hidden) focusAnswer();
    announce(t("site.announce.start", "開始！唔使打聲調數字。"));
  }
  if (run) {
    renderMetrics(now);
    if (run.status === "finished") completeRound();
  }
}

function submit() {
  if ((composing && !composition?.physical) || !run || run.status !== "running") return;
  const value = draft;
  run = submitAnswer(run, value, Date.now());
  answerVersion++;
  setDraft("");
  if (run.status === "finished") {
    renderMetrics();
    renderPassage();
    completeRound();
    return;
  }
  if (!value.trim()) {
    renderDraft();
    return;
  }
  if (run.lastResult === "correct") {
    $("#input-feedback").textContent = t("site.feedback.next", "下一字：{hanzi}", { hanzi: tokens[run.index].hanzi });
  } else {
    $("#input-feedback").textContent = t("site.feedback.incorrect", "未啱；按 Backspace 可修改。");
  }
  renderPassage();
  positionAnswer(true);
  renderMetrics();
}

function undoLast() {
  if ((composing && !composition?.physical) || !run || run.status !== "running" || run.index === 0) return;
  run = undoAnswer(run, Date.now());
  answerVersion++;
  setDraft(run.lastAnswer, 0, run.lastAnswer.length);
  $("#input-feedback").textContent = t("site.feedback.undo", "修改「{hanzi}」後確認。", { hanzi: tokens[run.index].hanzi });
  renderPassage();
  focusAnswer();
  renderMetrics();
}

function handleDelete(event) {
  if (event.isComposing || composing || draft !== "" ||
      !run || run.status !== "running" || run.index === 0) return;
  event.preventDefault();
  undoLast();
  return true;
}

// 完場卡文案（標題＋一行成績）；語言切換時用同一支按凍結咗嘅 metrics 重畫。
function renderResultCard(metrics) {
  $("#result-title").textContent = t("site.result.title", "全文完成 · 試算綜合分 {score}", { score: metrics.score.toFixed(1) });
  $("#result-summary").textContent = t("site.result.summary", "{name} · {time} · {correct} 啱／{errors} 錯", {
    name: round.name, time: formatTime(metrics.elapsedSeconds), correct: metrics.correct, errors: metrics.errors,
  }) + (round.hintsUsed ? t("site.result.hintUsed", " · 用過提示") : "");
}

function completeRound() {
  clearInterval(ticker);
  ticker = null;
  const metrics = getMetrics(run, Date.now());
  $("#answer").disabled = true;
  $("#typing-surface").classList.remove("focused");
  $("#typing-form").hidden = true;
  $("#result").hidden = false;
  $("#cancel-run").hidden = true;
  $("#setup-fields").disabled = true;
  $("#play-again").hidden = false;
  $("#edit-settings").hidden = false;
  renderRaceChrome();
  $("#status-dot").classList.remove("live");
  renderResultCard(metrics);
  renderHint();
  if (!resultSaved) {
    const result = { ...round, id: crypto.randomUUID(), correct: metrics.correct, errors: metrics.errors, elapsedSeconds: metrics.elapsedSeconds, at: Date.now() };
    // Merge persisted rounds with this tab's rounds, including failed writes.
    records = mergeRecords(readRecords(records), records, [result]);
    writeRecords();
    resultSaved = true;
    if (!$("#leaderboard-view").hidden) renderBoards();
    announce(t("site.announce.finished", "全文完成。綜合分 {score}，答案準確度 {accuracy}%。", {
      score: metrics.score.toFixed(1), accuracy: Math.round(metrics.accuracy),
    }));
  }
  document.body.classList.remove("running");
}

function resetRound() {
  clearInterval(ticker);
  ticker = null;
  countdownEnds = null;
  run = null;
  round = null;
  hintsVisible = false;
  composing = false;
  composition = null;
  committedComposition = null;
  physicalEdit = null;
  answerVersion++;
  $("#setup-card").hidden = false;
  $("#round-summary").hidden = true;
  $("#round-actions").hidden = true;
  $("#play-again").hidden = true;
  $("#edit-settings").hidden = true;
  $("#race-card").hidden = true;
  $("#arena-view").classList.remove("has-race");
  $("#countdown-overlay").hidden = true;
  $("#result").hidden = true;
  $("#typing-form").hidden = false;
  $("#answer").disabled = true;
  setDraft("");
  $("#answer").placeholder = t("site.answer.idle", "準備好就開始啦");
  $("#typing-surface").classList.remove("focused");
  $("#setup-fields").disabled = false;
  $("#cancel-run").hidden = true;
  $("#start").disabled = false;
  renderRaceChrome();
  $("#status-dot").classList.remove("live");
  $("#input-feedback").textContent = t("site.feedback.abandoned", "本輪已放棄，唔會記錄成績。");
  document.body.classList.remove("running");
  renderPassage();
  renderMetrics();
  $("#start").focus({ preventScroll: true });
}

// 正式分 R ＝ 正確音節／分鐘 × 準確度（SPEC §5.5），本機榜以此排名；
// demo 試算綜合分（速度 × 準確度²）保留嚟同舊紀錄比較。
function rankRecords(items) {
  return items.map(item => {
    const submitted = item.correct + item.errors;
    const accuracy = submitted ? item.correct / submitted * 100 : 0;
    const speed = item.elapsedSeconds > 0 ? submitted / item.elapsedSeconds * 60 : 0;
    const officialScore = item.elapsedSeconds > 0 ? item.correct / item.elapsedSeconds * 60 * (accuracy / 100) : 0;
    return {
      ...item,
      speed,
      accuracy,
      officialScore,
      belowThreshold: accuracy < OFFICIAL_THRESHOLDS.passage * 100,
      score: speed * (accuracy / 100) ** 2,
    };
  }).sort((a, b) => b.officialScore - a.officialScore || b.accuracy - a.accuracy ||
    a.elapsedSeconds - b.elapsedSeconds || a.at - b.at);
}

function renderTable(container, items, sample = false, ranked = true) {
  container.replaceChildren();
  if (!items.length) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.innerHTML = `${t("site.board.empty", "未有紀錄。")}<p>${t("site.board.emptyNote", "完成全文後會顯示喺呢度。")}</p>`;
    container.append(empty);
    return;
  }
  const table = document.createElement("table");
  table.className = ranked ? "score-table ranked" : "score-table";
  const headers = [
    ...(ranked ? [t("site.board.rank", "名次")] : []),
    t("site.board.name", "暱稱 / 用時"),
    ...(ranked ? [t("site.board.official", "正式分")] : []),
    t("site.board.composite", "綜合分"),
    t("site.board.accuracy", "準確度"),
  ];
  table.innerHTML = `<thead><tr>${headers.map(header => `<th scope='col'>${header}</th>`).join("")}</tr></thead>`;
  const tbody = document.createElement("tbody");
  let rank = 0;
  let last = null;
  const ordered = rankRecords(items);
  if (!ranked) ordered.sort((a, b) => b.at - a.at);
  for (const [index, item] of ordered.entries()) {
    if (!last || item.officialScore !== last.officialScore || item.accuracy !== last.accuracy ||
        item.elapsedSeconds !== last.elapsedSeconds) rank = index + 1;
    last = item;
    const row = document.createElement("tr");
    if (ranked) {
      if (rank === 1 && item.correct > 0) row.className = "best";
      const rankCell = document.createElement("td");
      rankCell.textContent = item.correct ? String(rank).padStart(2, "0") : "—";
      row.append(rankCell);
    }
    const nameCell = document.createElement("td");
    nameCell.className = "score-name";
    nameCell.append(document.createTextNode(item.name));
    const source = document.createElement("small");
    source.textContent = t("site.board.speed", "{time} · {speed} 音節/分", {
      time: formatTime(item.elapsedSeconds), speed: Math.round(item.speed),
    });
    nameCell.append(source);
    const origin = document.createElement("small");
    origin.textContent = sample
      ? t("site.board.samplePerson", "虛構示範人物")
      : t("site.board.local", "{time} · 本機", { time: new Date(item.at).toLocaleString("zh-HK", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }) });
    nameCell.append(origin);
    const demoCell = document.createElement("td");
    const demoText = ranked ? document.createElement("span") : document.createElement("strong");
    demoText.textContent = item.score.toFixed(1);
    demoCell.append(demoText);
    const accuracyCell = document.createElement("td");
    accuracyCell.textContent = item.accuracy === null ? "—" : `${Math.round(item.accuracy)}%`;
    if (ranked) {
      const officialCell = document.createElement("td");
      officialCell.className = "score-official";
      const officialText = document.createElement("strong");
      officialText.textContent = item.officialScore.toFixed(1);
      officialCell.append(officialText);
      if (item.belowThreshold) {
        officialCell.classList.add("below-threshold");
        const note = document.createElement("small");
        note.textContent = t("site.board.belowThreshold", "未達 85% 門檻");
        officialCell.append(note);
      }
      row.append(nameCell, officialCell, demoCell, accuracyCell);
    } else {
      row.append(nameCell, demoCell, accuracyCell);
    }
    tbody.append(row);
  }
  table.append(tbody);
  container.append(table);
}

function renderBoards() {
  setPressed("[data-board-group]", "boardGroup", boardGroup);
  const groupRecords = records.filter(item => item.group === boardGroup && item.articleId === ARTICLE.id && item.rules === 2);
  renderTable($("#local-board"), groupRecords.filter(item => !item.hintsUsed));
  const hintedRecords = groupRecords.filter(item => item.hintsUsed);
  $("#hinted-board-card").hidden = hintedRecords.length === 0;
  renderTable($("#hinted-board"), hintedRecords, false, false);
  const baseTime = boardGroup === "mobile" ? 105 : 65;
  const sample = [
    { name: "打字阿晴", elapsedSeconds: baseTime, correct: tokens.length, errors: 0 },
    { name: "粵拼小隊長", elapsedSeconds: baseTime + 12, correct: tokens.length - 4, errors: 4 },
    { name: "慢慢嚟都得", elapsedSeconds: baseTime + 24, correct: tokens.length - 8, errors: 8 },
    { name: "邊學邊打", elapsedSeconds: baseTime + 30, correct: tokens.length - 18, errors: 18 },
  ].map((item, index) => ({ ...item, at: index }));
  renderTable($("#sample-board"), sample, true);
  $("#storage-note").textContent = storageAvailable ? "" : t("site.storage.failed", "未能保存紀錄，關頁後新成績會遺失。");
  $("#clear-scores").hidden = records.length === 0;
}

// 玩法頁六張卡嘅標題喺 HTML 保持原樣（現有測試要求 <h2>標題</h2> 冇屬性），
// 所以按卡序喺度動態翻譯；卡入面嘅段落由 data-i18n 靜態處理。
const ruleTitles = [
  ["site.rules.official.title", "官方三輪試玩"],
  ["site.rules.scoring.title", "計分方法"],
  ["site.rules.games.title", "三個計分遊戲"],
  ["site.rules.tools.title", "練習工具"],
  ["site.rules.groups.title", "手機組同電腦組"],
  ["site.rules.local.title", "本機示範"],
];
function renderRules() {
  $$(".rule-card h2").forEach((heading, index) => {
    const entry = ruleTitles[index];
    if (entry) heading.textContent = t(entry[0], entry[1]);
  });
}

$$("[data-view]").forEach(button => button.addEventListener("click", () => showView(button.dataset.view)));
$$("[data-group]").forEach(button => button.addEventListener("click", () => {
  group = button.dataset.group;
  setPressed("[data-group]", "group", group);
}));
$$("[data-board-group]").forEach(button => button.addEventListener("click", () => {
  boardGroup = button.dataset.boardGroup;
  renderBoards();
}));
$("#start").addEventListener("click", () => {
  if (flowChoice === "official") {
    startOfficialFlow();
    return;
  }
  startRound();
});
$("#flow-official").addEventListener("click", () => {
  flowChoice = "official";
  renderFlowChoice();
});
$("#flow-practice").addEventListener("click", () => {
  flowChoice = "practice";
  renderFlowChoice();
});
$("#play-again").addEventListener("click", () => startRound(true));
$("#edit-settings").addEventListener("click", resetRound);
$("#cancel-run").addEventListener("click", resetRound);
$("#hint-toggle").addEventListener("pointerdown", event => {
  if (run?.status === "running") event.preventDefault();
});
$("#hint-toggle").addEventListener("click", () => {
  if (run?.status !== "running") return;
  const [start, end] = selection();
  hintsVisible = !hintsVisible;
  if (hintsVisible) round.hintsUsed = true;
  renderHint();
  focusAnswer();
  $("#answer").setSelectionRange(start, end);
});
$("#typing-form").addEventListener("submit", event => { event.preventDefault(); submit(); });
$("#answer").addEventListener("compositionstart", () => {
  if (round?.group !== "mobile") { restoreDraft(); return; }
  composing = true;
  const [start, end] = selection();
  composition = { version: answerVersion, base: draft, start, end, physical: !!physicalEdit };
});
$("#answer").addEventListener("compositionupdate", captureComposition);
$("#answer").addEventListener("compositionend", event => {
  captureComposition(event);
  const commit = { data: event.data };
  committedComposition = commit;
  setTimeout(() => { if (committedComposition === commit) committedComposition = null; }, 0);
  composing = false;
  composition = null;
});
for (const selector of ["#answer", "#typing-surface"]) {
  $(selector).addEventListener("focus", () => $("#typing-surface").classList.add("focused"));
  $(selector).addEventListener("blur", () => $("#typing-surface").classList.remove("focused"));
}
$("#typing-surface").addEventListener("click", focusAnswer);
$("#typing-surface").addEventListener("keydown", event => {
  if (event.ctrlKey || event.metaKey || event.altKey || event.key === "Tab") return;
  if (!run || run.status !== "running") return;
  const letter = /^[a-z]$/i.test(event.key ?? "") ? event.key.toLowerCase()
    : /^Key[A-Z]$/.test(event.code ?? "") ? event.code.slice(3).toLowerCase() : null;
  if (letter) {
    event.preventDefault();
    markPhysicalEdit();
    editDraft(letter);
    return;
  }
  const key = event.code === "Space" ? " " : event.code === "NumpadEnter" ? "Enter"
    : ["Enter", "Backspace"].includes(event.code) ? event.code : event.key;
  if (![" ", "Enter", "Backspace"].includes(key)) return;
  if ((event.isComposing || composing) && !event.code && !composition?.physical) return;
  event.preventDefault();
  markPhysicalEdit();
  if (key !== "Backspace") submit();
  else if (draft) editDraft();
  else undoLast();
});
$("#answer").addEventListener("beforeinput", event => {
  if (round?.group !== "mobile" || physicalEdit) {
    if (event.cancelable !== false) event.preventDefault();
    restoreDraft();
    return;
  }
  if (event.isComposing || composing) return;
  if (isCompositionCommit(event)) {
    if (event.cancelable !== false) event.preventDefault();
    restoreDraft();
    return;
  }
  committedComposition = null;
  if ((event.inputType === "insertText" && /^\s+$/u.test(event.data ?? "")) ||
      event.inputType === "insertLineBreak" || event.inputType === "insertParagraph") {
    if (event.cancelable !== false) { event.preventDefault(); submit(); }
    return;
  }
  if (event.inputType === "deleteContentBackward") handleDelete(event);
});
$("#answer").addEventListener("input", event => {
  if (event.isComposing || composing) { captureComposition(event); return; }
  if (round?.group !== "mobile" || physicalEdit || isCompositionCommit(event)) {
    restoreDraft();
    return;
  }
  committedComposition = null;
  const value = $("#answer").value;
  // Reject a non-Latin IME commit; never guess a pronunciation from its characters.
  if (event.inputType !== "insertFromPaste" && /[^a-z\s]/i.test(value)) {
    restoreDraft();
    return;
  }
  const cursor = $("#answer").selectionStart ?? value.length;
  setDraft(value, value.slice(0, cursor).replace(/[^a-z]/gi, "").length);
  if (/\s$/.test(value)) submit();
});
$("#view-result-board").addEventListener("click", () => {
  boardGroup = round.group;
  showView("leaderboard");
});
$("#clear-scores").addEventListener("click", () => {
  if (!confirm(t("site.confirm.clear", "清除呢部裝置目前文章、兩個組別嘅試玩紀錄？"))) return;
  records = [];
  writeRecords();
  renderBoards();
});
document.addEventListener("visibilitychange", () => {
  if (!document.hidden && (run?.status === "running" || countdownEnds !== null)) tick();
});
window.addEventListener("storage", event => {
  if (event.key === storageKey || event.key === null) {
    records = event.newValue === null || event.newValue === "[]" ? [] : mergeRecords(readRecords(records), records);
    if (!$("#leaderboard-view").hidden) renderBoards();
  }
});

// 設定卡同榜頭嘅文章資料（標題本身係文章內容，唔翻譯）。
function renderArticleInfo() {
  $("#article-title").textContent = ARTICLE.title;
  $("#article-detail").textContent = t("site.article.detail", "示範粵文 · {count} 音節", { count: tokens.length });
  $("#board-article").textContent = t("site.board.article", "同篇比較：{title}", { title: ARTICLE.title });
}

setPressed("[data-group]", "group", group);
renderFlowChoice();
renderRules();
renderArticleInfo();
// 輸入提示由 app.mjs 動態改寫（唔用 data-i18n），所以開場都要用 t() 寫一次。
$("#input-feedback").textContent = t("site.feedback.initial", "按「開始試玩」，直接打高亮字嘅粵拼。");
renderPassage();
renderMetrics();
renderBoards();
renderRaceChrome();

// 語言切換：靜態文案由 i18n 運行庫自動換，動態文字喺度按現有狀態重畫；
// 比賽進行中都只行現有 render（重畫 passage／HUD），唔會改動 run 狀態。
window.addEventListener("canclid-locale", () => {
  renderFlowChoice();
  renderRules();
  renderArticleInfo();
  renderBoards();
  renderPassage();
  renderMetrics();
  renderComponentStats();
  renderHint();
  renderRaceChrome();
  if (run?.status === "finished") renderResultCard(getMetrics(run, Date.now()));
});
// 啟動 i18n：偵測語言、套用靜態翻譯、綁定 [data-locale-toggle]。
initI18n();
