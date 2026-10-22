import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { detectLocale, getLocale, initI18n, registerStrings, setLocale, t } from "../demo/i18n.mjs";

const STORAGE_KEY = "canclid-contest-locale";

// 運行庫嘅語言係模組狀態：每個測試完都還原返繁體，唔好影響下一個測試。
test.afterEach(() => {
  setLocale("hant");
});

// 運行庫喺呼叫嗰刻先讀 globalThis 嘅 document／window／localStorage／navigator，
// 所以測試要暫時掛假物件，完咗還原（原本冇嘅就刪走）。
function withGlobals(globals, run) {
  const previous = new Map(Object.keys(globals).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(globals)) {
    Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
  }
  try {
    return run();
  } finally {
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  }
}

function memoryStorage(store = new Map()) {
  return {
    store,
    getItem: key => (store.has(key) ? store.get(key) : null),
    setItem(key, value) { store.set(key, String(value)); },
    removeItem(key) { store.delete(key); },
  };
}

// 迷你 DOM：運行庫只需要 querySelectorAll、documentElement、click 委派同 event 派發。
function fakeNode(dataset = {}, textContent = "", placeholder = null) {
  const attributes = new Map();
  if (placeholder !== null) attributes.set("placeholder", placeholder);
  return {
    dataset,
    textContent,
    setAttribute(name, value) { attributes.set(name, String(value)); },
    getAttribute(name) { return attributes.get(name) ?? null; },
    closest(selector) { return selector === "[data-locale-toggle]" && "localeToggle" in dataset ? this : null; },
  };
}

function fakeDom() {
  const toggle = fakeNode({ localeToggle: "" }, "简");
  const nav = fakeNode({ i18n: "test.nav" }, "試玩賽場");
  const same = fakeNode({ i18n: "test.same" }, "玩法");
  const nickname = fakeNode({ i18nPlaceholder: "test.nickname" }, "", "粵拼新星");
  const nodes = [toggle, nav, same, nickname];
  const listeners = new Map();
  const documentElement = {
    lang: null,
    setAttribute(name, value) { if (name === "lang") this.lang = value; },
    getAttribute(name) { return name === "lang" ? this.lang : null; },
  };
  const window = {
    listeners,
    addEventListener(type, listener) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(listener);
    },
    fire(type, event) { for (const listener of listeners.get(type) ?? []) listener(event); },
    CustomEvent: class CustomEvent {
      constructor(type, init) { this.type = type; Object.assign(this, init ?? {}); }
    },
    dispatchEvent(event) { this.fire(event.type, event); return true; },
  };
  const document = {
    documentElement,
    addEventListener(type, listener) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(listener);
    },
    querySelectorAll(selector) {
      if (selector === "[data-i18n]") return nodes.filter(node => node.dataset.i18n);
      if (selector === "[data-i18n-placeholder]") return nodes.filter(node => node.dataset.i18nPlaceholder);
      if (selector === "[data-locale-toggle]") return nodes.filter(node => "localeToggle" in node.dataset);
      return [];
    },
  };
  return {
    document, window, documentElement, toggle, nav, same, nickname,
    click(target) { for (const listener of listeners.get("click") ?? []) listener({ target }); },
  };
}

function withDom(run, { store = new Map() } = {}) {
  const dom = fakeDom();
  const storage = memoryStorage(store);
  return withGlobals({ document: dom.document, window: dom.window, localStorage: storage }, () => run(dom, storage));
}

test("冇 navigator／localStorage 嗰陣 detectLocale 預設繁體，t() 出返原文", () => {
  assert.equal(detectLocale(), "hant");
  assert.equal(getLocale(), "hant");
  assert.equal(t("test.unknown", "繁體原文"), "繁體原文");
});

test("setLocale('hans') 之後 t() 出簡體，registerStrings 生效，還原返繁體", () => {
  registerStrings({ hans: { "test.nav": "试玩赛场" } });
  assert.equal(t("test.nav", "試玩賽場"), "試玩賽場", "繁體照出原文");
  setLocale("hans");
  assert.equal(getLocale(), "hans");
  assert.equal(t("test.nav", "試玩賽場"), "试玩赛场");
  assert.equal(t("test.missing", "未登記"), "未登記", "冇登記嘅 key 保持原文");
  setLocale("hant");
  assert.equal(t("test.nav", "試玩賽場"), "試玩賽場");
});

test("t() 用 {var} 套變數，簡體譯文一樣套，缺變數保持原樣", () => {
  registerStrings({ hans: { "test.sentence": "第 {index} 句 / {total}" } });
  assert.equal(t("test.sentence", "第 {index} 句 / {total}", { index: 1, total: 3 }), "第 1 句 / 3");
  setLocale("hans");
  assert.equal(t("test.sentence", "第 {index} 句 / {total}", { index: 2, total: 3 }), "第 2 句 / 3");
  assert.equal(t("test.sentence", "第 {index} 句 / {total}", { index: 2 }), "第 2 句 / {total}");
});

test("setLocale 寫入 localStorage，非法 locale 拋 RangeError", () => {
  withDom((dom, storage) => {
    setLocale("hans");
    assert.equal(storage.store.get(STORAGE_KEY), "hans");
    setLocale("hant");
    assert.equal(storage.store.get(STORAGE_KEY), "hant");
    assert.throws(() => setLocale("zh-TW"), RangeError);
    assert.throws(() => setLocale(""), RangeError);
    assert.equal(getLocale(), "hant", "拋錯唔會改到當前語言");
  });
});

test("detectLocale 先讀 localStorage，再跟 navigator 語言判斷簡繁", async () => {
  const stored = await import("../demo/i18n.mjs?case=stored-hans");
  withGlobals({ localStorage: memoryStorage(new Map([[STORAGE_KEY, "hans"]])) }, () => {
    assert.equal(stored.getLocale(), "hans");
  });
  for (const [language, expected] of [
    ["zh-CN", "hans"], ["zh-SG", "hans"], ["zh-Hans", "hans"],
    ["zh-TW", "hant"], ["zh-HK", "hant"], ["en-US", "hant"],
  ]) {
    const instance = await import(`../demo/i18n.mjs?case=lang-${language}`);
    withGlobals({ navigator: { language, languages: [language] } }, () => {
      assert.equal(instance.getLocale(), expected, language);
    });
  }
});

test("data-i18n／data-i18n-placeholder 跟 locale 換，hant 還原原文，lang 同步", () => {
  registerStrings({ hans: { "test.nav": "试玩赛场", "test.nickname": "粤拼新星" } });
  withDom(dom => {
    initI18n();
    assert.equal(dom.documentElement.lang, "zh-Hant-HK");
    assert.equal(dom.nav.textContent, "試玩賽場");
    assert.equal(dom.nickname.getAttribute("placeholder"), "粵拼新星");
    setLocale("hans");
    assert.equal(dom.documentElement.lang, "zh-Hans");
    assert.equal(dom.nav.textContent, "试玩赛场");
    assert.equal(dom.same.textContent, "玩法", "同形字保持原樣");
    assert.equal(dom.nickname.getAttribute("placeholder"), "粤拼新星");
    setLocale("hant");
    assert.equal(dom.documentElement.lang, "zh-Hant-HK");
    assert.equal(dom.nav.textContent, "試玩賽場");
    assert.equal(dom.nickname.getAttribute("placeholder"), "粵拼新星");
  });
});

test("initI18n 綁定 [data-locale-toggle]：撳掣切換、更新 aria，再派 canclid-locale", () => {
  registerStrings({ hans: { "test.nav": "试玩赛场" } });
  withDom(dom => {
    const events = [];
    dom.window.addEventListener("canclid-locale", event => events.push(event.detail.locale));
    initI18n();
    assert.equal(dom.toggle.textContent, "简");
    assert.equal(dom.toggle.getAttribute("aria-pressed"), "false");
    assert.equal(dom.toggle.getAttribute("aria-label"), "切換简体粤文界面");
    dom.click(dom.toggle);
    assert.equal(getLocale(), "hans");
    assert.equal(dom.toggle.textContent, "繁");
    assert.equal(dom.toggle.getAttribute("aria-pressed"), "true");
    assert.equal(dom.toggle.getAttribute("aria-label"), "切換繁體粤語界面");
    assert.equal(dom.nav.textContent, "试玩赛场");
    assert.deepEqual(events, ["hans"]);
    dom.click(dom.toggle);
    assert.equal(getLocale(), "hant");
    assert.equal(dom.toggle.textContent, "简");
    assert.equal(dom.nav.textContent, "試玩賽場");
    assert.deepEqual(events, ["hans", "hant"]);
  });
});

test("主站 index.html 每個 data-i18n key 喺 app.mjs 都有對應（譯文或者 t() 原文）", () => {
  const html = readFileSync(new URL("../demo/index.html", import.meta.url), "utf8");
  const source = readFileSync(new URL("../demo/app.mjs", import.meta.url), "utf8");
  const registered = new Set([...source.matchAll(/"(site\.[^"]+)"/g)].map(match => match[1]));
  const keys = [...html.matchAll(/data-i18n(?:-placeholder)?="([^"]+)"/g)].map(match => match[1]);
  assert.ok(keys.length > 80, `index.html 嘅 data-i18n 元素數量唔合理：${keys.length}`);
  for (const key of new Set(keys)) {
    assert.ok(registered.has(key), `index.html 用咗 ${key}，但 app.mjs 冇登記`);
  }
  assert.ok([...registered].some(key => key.startsWith("site.")), "app.mjs 應該登記 site.* 譯文");
});
