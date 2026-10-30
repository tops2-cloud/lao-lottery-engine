// Scrapers for the result sites. Runs on GitHub Actions (Node 20+, global fetch).
// Each parser is defensive: if a site changes its layout the parser returns {} and
// the run logs a warning instead of writing bad data.
'use strict';

const UA = 'Mozilla/5.0 (compatible; lao-lottery-engine/1.0; +https://github.com)';

async function get(url, accept = 'text/html') {
  const res = await fetch(url, { headers: { 'User-Agent': UA, 'Accept-Language': 'th,en;q=0.8', Accept: accept } });
  if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`);
  return res.text();
}

const stripTags = (html) =>
  html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();

const NO_DRAW = /งด/;

function tableRows(html, hrefDateRe) {
  const rows = [];
  for (const m of html.matchAll(/<tr[\s\S]*?<\/tr>/gi)) {
    const tr = m[0];
    const dm = tr.match(hrefDateRe);
    if (!dm) continue;
    const cells = [...tr.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((c) => stripTags(c[1]));
    rows.push({ date: dm[1], cells });
  }
  return rows;
}

// ================================================================ Lao
function parsePhonhuayHistory(html) {
  const out = {};
  const allDates = new Set();
  for (const m of html.matchAll(/<a[^>]+href="[^"]*\/results\/lao-lottery\/(\d{4}-\d{2}-\d{2})"[^>]*>([\s\S]*?)<\/a>/gi)) {
    allDates.add(m[1]);
    const n = stripTags(m[2]).match(/เลขท้าย\s*4\s*ตัว\s*(?:คือ\s*)?(\d{4})(?!\d)/);
    if (n) out[m[1]] = { last4: n[1] };
  }
  return { records: out, dates: [...allDates].sort() };
}

function parsePhonhuayDraw(html) {
  const t = stripTags(html);
  const n = t.match(/เลขท้าย\s*4\s*ตัว\s*(?:คือ\s*)?(\d{4})(?!\d)/);
  if (n) return { last4: n[1] };
  if (/งดออก/.test(t)) return { noDraw: true };
  return null;
}

function parseLottoth(html) {
  const out = {};
  for (const { date, cells } of tableRows(html, /\/lottery\/laosdevelops\/(\d{4}-\d{2}-\d{2})/)) {
    const [, top3, bottom2, full] = cells;
    if ([top3, bottom2].some((c) => c && NO_DRAW.test(c))) out[date] = { noDraw: true };
    else if (/^\d{3}$/.test(top3) && /^\d{2}$/.test(bottom2)) out[date] = { top3, bottom2, ...(/^\d{4,6}$/.test(full || '') ? { full } : {}) };
  }
  return out;
}

function parseSaihuay(html) {
  const out = {};
  for (const { date, cells } of tableRows(html, /(?:[?&;])date=(\d{4}-\d{2}-\d{2})/)) {
    const [, top3, bottom2] = cells;
    if ([top3, bottom2].some((c) => c && NO_DRAW.test(c))) out[date] = { noDraw: true };
    else if (/^\d{3}$/.test(top3) && /^\d{2}$/.test(bottom2)) out[date] = { top3, bottom2 };
  }
  return out;
}

// ================================================================ Thai
// thai-lotto-archive text file: "FIRST 011781", "THREE_FIRST 392 402", "THREE_LAST 171 255", "TWO 48"
function parseArchiveFile(text) {
  const lines = Object.fromEntries(text.replace(/\r/g, '').split('\n').map((l) => l.trim().split(/\s+/)).filter((p) => p.length > 1).map(([k, ...v]) => [k, v]));
  const first = lines.FIRST?.[0];
  const two = lines.TWO?.[0];
  if (!/^\d{6}$/.test(first || '') || !/^\d{2}$/.test(two || '')) return null;
  const rec = { first, two };
  if (lines.THREE_FIRST && lines.THREE_LAST) { rec.front3 = lines.THREE_FIRST.slice(0, 2); rec.last3 = lines.THREE_LAST.slice(0, 2); }
  return rec;
}

// LottoTH government page — same site template as the Lao page. Columns are read by
// shape (6-digit first prize, 3-digit top, 2-digit bottom) so small layout changes don't matter.
function parseLottothGov(html) {
  const out = {};
  for (const { date, cells } of tableRows(html, /\/lottery\/gove?rn?ment\/(\d{4}-\d{2}-\d{2})/)) {
    const rest = cells.slice(1);
    const full = rest.find((c) => /^\d{6}$/.test(c));
    const top3 = rest.find((c) => /^\d{3}$/.test(c));
    const bottom2 = rest.find((c) => /^\d{2}$/.test(c));
    if (bottom2 && (full || top3)) out[date] = { ...(full ? { full } : {}), ...(top3 ? { top3 } : {}), bottom2 };
  }
  return out;
}

const ARCHIVE_LIST = 'https://api.github.com/repos/vicha-w/thai-lotto-archive/contents/lottonumbers';
const ARCHIVE_RAW = (name) => `https://raw.githubusercontent.com/vicha-w/thai-lotto-archive/master/lottonumbers/${name}`;

const SITES = {
  lao: {
    phonhuay: { url: 'https://xn--t3cmiit.com/lao-lottery/history', parse: (h) => parsePhonhuayHistory(h).records },
    lottoth: { url: 'https://lottoth.co/lottery/laosdevelops/history', parse: parseLottoth },
    saihuay: { url: 'https://saihuay.com/historical?lotto=lao_pathana', parse: parseSaihuay },
  },
  thai: {
    lottoth: { url: 'https://lottoth.co/lottery/goverment/history', parse: parseLottothGov },
  },
};

module.exports = { get, stripTags, parsePhonhuayHistory, parsePhonhuayDraw, parseLottoth, parseSaihuay, parseArchiveFile, parseLottothGov, ARCHIVE_LIST, ARCHIVE_RAW, SITES };
