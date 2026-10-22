// 全站 i18n 運行庫：繁體粵語（預設）／簡體粵文。零依賴。
// 用法：
//   - 靜態文案：HTML 留繁體原文，俾要翻譯嘅元素加 data-i18n="ns.key"。
//   - 動態文案：t("ns.key", "繁體原文", { var })——繁體原文行內做 fallback，
//     簡體譯文用 registerStrings({ hans: { "ns.key": "…" } }) 登記（各頁面模組
//     喺 import 時登記自己嘅 namespace，並行開發唔使改呢個檔）。
//   - 每頁啟動時 call initI18n()：偵測語言、套用靜態翻譯、綁定 [data-locale-toggle]。
//   - setLocale() 之後會 re-apply 靜態文案，並喺 window 派 "canclid-locale"；
//     動態介面要監聽呢個 event 重繪（或直接 call 自己現有嘅 render）。

const STORAGE_KEY = "canclid-contest-locale";
const LOCALE_EVENT = "canclid-locale";
const hansDict = new Map();
let current = null;

// 切換掣共用文案（所有頁面一致，喺度登記免得每頁重複）。
hansDict.set("common.toggleHans", "简");
hansDict.set("common.toggleHant", "繁");
hansDict.set("common.toggleAriaHant", "切換简体粤文界面");
hansDict.set("common.toggleAriaHans", "切換繁體粤語界面");

export function detectLocale() {
  if (current) return current;
  try {
    if (typeof localStorage !== "undefined") {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved === "hant" || saved === "hans") return (current = saved);
    }
  } catch {}
  let lang = "";
  try {
    if (typeof navigator !== "undefined") {
      const languages = navigator.languages;
      lang = String((Array.isArray(languages) && languages[0]) || navigator.language || "").toLowerCase();
    }
  } catch {}
  current = /(^|-)(cn|sg)(-|$)/.test(lang) || lang.includes("hans") ? "hans" : "hant";
  return current;
}

export function getLocale() {
  return detectLocale();
}

export function registerStrings({ hans }) {
  for (const [key, value] of Object.entries(hans ?? {})) hansDict.set(key, value);
}

export function t(key, hantText, vars) {
  const locale = detectLocale();
  const template = locale === "hans" ? (hansDict.get(key) ?? hantText) : hantText;
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (match, name) => (vars[name] != null ? String(vars[name]) : match));
}

function swapElement(el, attr, dictKey) {
  const cacheAttr = `i18nHant${attr === "textContent" ? "" : attr[0].toUpperCase() + attr.slice(1)}`;
  const original = el.dataset[cacheAttr];
  if (original == null) el.dataset[cacheAttr] = attr === "textContent" ? el.textContent : el.getAttribute(attr);
  if (detectLocale() === "hans") {
    const value = hansDict.get(dictKey);
    if (value != null) {
      if (attr === "textContent") el.textContent = value;
      else el.setAttribute(attr, value);
    }
  } else if (el.dataset[cacheAttr] != null) {
    if (attr === "textContent") el.textContent = el.dataset[cacheAttr];
    else el.setAttribute(attr, el.dataset[cacheAttr]);
  }
}

export function applyStaticI18n(root = typeof document !== "undefined" ? document : null) {
  if (!root || !root.querySelectorAll) return;
  for (const el of root.querySelectorAll("[data-i18n]")) swapElement(el, "textContent", el.dataset.i18n);
  for (const el of root.querySelectorAll("[data-i18n-placeholder]")) swapElement(el, "placeholder", el.dataset.i18nPlaceholder);
  const html = root.documentElement;
  if (html && html.setAttribute) html.setAttribute("lang", detectLocale() === "hans" ? "zh-Hans" : "zh-Hant-HK");
}

function updateToggleButtons() {
  if (typeof document === "undefined") return;
  const hans = detectLocale() === "hans";
  for (const button of document.querySelectorAll("[data-locale-toggle]")) {
    button.textContent = hans ? t("common.toggleHant", "繁") : t("common.toggleHans", "简");
    button.setAttribute("aria-label", hans ? t("common.toggleAriaHans", "切換繁體粤語界面") : t("common.toggleAriaHant", "切換简体粤文界面"));
    button.setAttribute("aria-pressed", String(hans));
  }
}

export function setLocale(locale) {
  if (locale !== "hant" && locale !== "hans") throw new RangeError("locale must be hant|hans");
  if (locale === current) return;
  current = locale;
  try {
    if (typeof localStorage !== "undefined") localStorage.setItem(STORAGE_KEY, locale);
  } catch {}
  applyStaticI18n();
  updateToggleButtons();
  try {
    if (typeof window !== "undefined" && typeof window.dispatchEvent === "function" && typeof window.CustomEvent === "function") {
      window.dispatchEvent(new window.CustomEvent(LOCALE_EVENT, { detail: { locale } }));
    }
  } catch {}
}

export function initI18n() {
  detectLocale();
  applyStaticI18n();
  updateToggleButtons();
  try {
    if (typeof document !== "undefined" && typeof document.addEventListener === "function") {
      document.addEventListener("click", event => {
        const button = event.target && typeof event.target.closest === "function" ? event.target.closest("[data-locale-toggle]") : null;
        if (button) setLocale(detectLocale() === "hant" ? "hans" : "hant");
      });
    }
  } catch {}
  return current;
}
