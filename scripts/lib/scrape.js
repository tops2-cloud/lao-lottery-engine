// HTML scrapers for the result sites. Runs on GitHub Actions (Node 20+, global fetch).
// Each parser is defensive: if a site changes its layout the parser returns {} and
// the run logs a warning instead of writing bad data.
'use strict';

const UA = 'Mozilla/5.0 (compatible; lao-lottery-engine/1.0; +https://github.com)';

async function get(url) {
  const res = await fetch(url, { headers: { 'User-Agent': UA, 'Accept-Language': 'th,en;q=0.8' } });
  if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`);
  return res.text();
}

const stripTags = (html) =>
  html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const NO_DRAW = /งด/;

// Generic: split HTML into <tr> rows, find a date inside an href, read the cell texts.
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

// ---- ผลหวย.com: history page lists "งวดวันที่ … เลขท้าย 4 ตัว 3294" links ----
function parsePhonhuayHistory(html) {
  const out = {};
  const allDates = new Set();
  for (const m of html.matchAll(/<a[^>]+href="[^"]*\/results\/lao-lottery\/(\d{4}-\d{2}-\d{2})"[^>]*>([\s\S]*?)<\/a>/gi)) {
    allDates.add(m[1]);
    const t = stripTags(m[2]);
    const n = t.match(/เลขท้าย\s*4\s*ตัว\s*(?:คือ\s*)?(\d{4})(?!\d)/);
    if (n) out[m[1]] = { last4: n[1] };
  }
  return { records: out, dates: [...allDates].sort() };
}

// ---- ผลหวย.com: one draw page ("เลขท้าย 4 ตัว คือ 7592") ----
function parsePhonhuayDraw(html) {
  const t = stripTags(html);
  const n = t.match(/เลขท้าย\s*4\s*ตัว\s*(?:คือ\s*)?(\d{4})(?!\d)/);
  if (n) return { last4: n[1] };
  if (/งดออก/.test(t)) return { noDraw: true };
  return null;
}

// ---- LottoTH: table | date link | 3 ตัวบน | 2 ตัวล่าง | ผลรางวัล ----
function parseLottoth(html) {
  const out = {};
  for (const { date, cells } of tableRows(html, /\/lottery\/laosdevelops\/(\d{4}-\d{2}-\d{2})/)) {
    const [, top3, bottom2, full] = cells;
    if ([top3, bottom2].some((c) => c && NO_DRAW.test(c))) out[date] = { noDraw: true };
    else if (/^\d{3}$/.test(top3) && /^\d{2}$/.test(bottom2)) {
      out[date] = { top3, bottom2, ...(/^\d{4,6}$/.test(full || '') ? { full } : {}) };
    }
  }
  return out;
}

// ---- Saihuay: table | date link (…date=YYYY-MM-DD) | 3 ตัวบน | 2 ตัวล่าง ----
function parseSaihuay(html) {
  const out = {};
  for (const { date, cells } of tableRows(html, /(?:[?&;])date=(\d{4}-\d{2}-\d{2})/)) {
    const [, top3, bottom2] = cells;
    if ([top3, bottom2].some((c) => c && NO_DRAW.test(c))) out[date] = { noDraw: true };
    else if (/^\d{3}$/.test(top3) && /^\d{2}$/.test(bottom2)) out[date] = { top3, bottom2 };
    // "รอผล" rows are skipped
  }
  return out;
}

const SITES = {
  phonhuay: { url: 'https://xn--t3cmiit.com/lao-lottery/history', parse: (h) => parsePhonhuayHistory(h).records },
  lottoth: { url: 'https://lottoth.co/lottery/laosdevelops/history', parse: parseLottoth },
  saihuay: { url: 'https://saihuay.com/historical?lotto=lao_pathana', parse: parseSaihuay },
};

module.exports = { get, stripTags, parsePhonhuayHistory, parsePhonhuayDraw, parseLottoth, parseSaihuay, SITES };
