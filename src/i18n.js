// Translations. The English source text is the key (gettext style), so English needs no dictionary and a missing
// German entry falls back to English. Dictionaries live in src/lang/<code>.js ({ 'English text': 'Übersetzung' });
// a plural entry is [one, other] and is looked up by its "other" text (see tn).
import { de } from './lang/de.js';

export const LANGS = { en: 'English', de: 'Deutsch' };
export const DICTS = { en: {}, de };

// First browser language we ship, else English. Accepts navigator.languages-style arrays.
export function detect(list) {
  for (const l of Array.isArray(list) ? list : []) {
    const code = String(l || '').toLowerCase().split(/[-_]/)[0];
    if (LANGS[code]) return code;
  }
  return 'en';
}

let lang = 'en';
const listeners = new Set();
export const getLang = () => lang;
export function setLang(code) {
  if (!LANGS[code] || code === lang) return;
  lang = code;
  for (const f of listeners) f(code);
}
export const onLang = f => { listeners.add(f); return () => listeners.delete(f); };

const fill = (s, p) => (p ? s.replace(/\{(\w+)\}/g, (m, k) => (k in p ? p[k] : m)) : s);

export function t(key, params) {
  let s = DICTS[lang][key];
  if (s === undefined && lang !== 'en' && key) (globalThis.__i18nMissing ||= new Set()).add(key); // dev aid: see tests/i18n + docs
  if (Array.isArray(s)) s = s[1];
  return fill(typeof s === 'string' ? s : key, params);
}

// Translate a finished message whose English form was built from a template with placeholders (parser warnings,
// validation errors, ...): exact key first, else the first template key it matches, e.g. 'Skipped "x"' -> 'Skipped "{tok}"'.
const patterns = {};
function patternsFor(code) {
  return patterns[code] || (patterns[code] = Object.keys(DICTS[code]).filter(k => k.includes('{'))
    .map(k => ({ k, re: new RegExp('^' + k.replace(/[.*+?^$()|[\]\\]/g, '\\$&').replace(/\{(\w+)\}/g, '(?<$1>[\\s\\S]+?)') + '$') })));
}
export function tm(msg) {
  if (typeof msg !== 'string' || lang === 'en' || DICTS[lang][msg] !== undefined) return t(msg);
  for (const { k, re } of patternsFor(lang)) {
    const m = re.exec(msg);
    if (m) return t(k, m.groups);
  }
  return msg;
}

// Plural: tn(3, '{n} note', '{n} notes') -> "3 notes". {n} is filled in automatically.
export function tn(n, one, other, params) {
  const e = DICTS[lang][other];
  const forms = Array.isArray(e) ? e : [one, other];
  const rule = new Intl.PluralRules(lang).select(n);
  return fill(forms[rule === 'one' ? 0 : 1], { n: fmt(n), ...params });
}

// Locale-aware number: fmt(1234.5) -> "1,234.5" / "1.234,5"; digits fixes the decimals.
// Formatters are memoised: constructing an Intl.NumberFormat costs far more than formatting with one.
const nfCache = new Map();
export function fmt(n, digits) {
  const k = lang + '|' + digits;
  let nf = nfCache.get(k);
  if (!nf) nfCache.set(k, nf = new Intl.NumberFormat(lang, digits === undefined ? {} : { minimumFractionDigits: digits, maximumFractionDigits: digits }));
  return nf.format(n);
}

// Static markup: data-i18n="English text" on an element translates its text; data-i18n-attr="aria-label,title"
// translates those attributes. The English original is remembered so switching back works.
export function applyStatic(root = document) {
  if (typeof document === 'undefined') return;
  document.documentElement.lang = lang;
  for (const el of root.querySelectorAll('[data-i18n]')) {
    const key = el.dataset.i18n || (el.dataset.i18n = el.textContent.trim());
    el.textContent = t(key);
  }
  for (const el of root.querySelectorAll('[data-i18n-html]')) {
    el.dataset.i18nHtml = el.dataset.i18nHtml || el.innerHTML.trim(); // key = the English markup
    el.innerHTML = t(el.dataset.i18nHtml);
  }
  for (const el of root.querySelectorAll('[data-i18n-attr]')) {
    for (const a of el.dataset.i18nAttr.split(',')) {
      const k = 'i18nEn' + a.replace(/(^|-)(\w)/g, (m, d, c) => c.toUpperCase());
      if (!(k in el.dataset)) el.dataset[k] = el.getAttribute(a) || '';
      el.setAttribute(a, t(el.dataset[k]));
    }
  }
}
