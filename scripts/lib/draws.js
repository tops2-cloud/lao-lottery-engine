// Normalising and merging Lao Development (ลาวพัฒนา) results from several sources.
//
// Derivation rule (matches how Thai sites read the Lao draw):
//   last4   = last 4 digits of the published number (works for both the old 6-digit
//             and the current 4-digit format)
//   top3    = last 3 digits            (3 ตัวบน)
//   top2    = last 2 digits            (2 ตัวบน)
//   bottom2 = first 2 digits of last4  (2 ตัวล่าง)
// All numbers are kept as strings so leading zeros are never lost.

'use strict';

const WEEKDAYS_TH = ['อาทิตย์', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์'];

// Sources that are copies of another source are not independent evidence.
const SOURCES = {
  phonhuay: { name: 'ผลหวย.com', url: 'https://xn--t3cmiit.com/lao-lottery/history', independent: true },
  saihuay: { name: 'Saihuay', url: 'https://saihuay.com/historical?lotto=lao_pathana', independent: true },
  lottoth: { name: 'LottoTH', url: 'https://lottoth.co/lottery/laosdevelops/history', independent: true },
  vgoldarena: {
    name: 'Victory Gold Arena',
    url: 'https://vgoldarena.com/lotto/lao-lottery-history.php',
    independent: false,
    copyOf: 'lottoth',
  },
};

function weekdayOf(date) {
  // date: YYYY-MM-DD, interpreted as a calendar date (no timezone shift)
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

function isDigits(s, n) {
  return typeof s === 'string' && new RegExp(`^\\d{${n}}$`).test(s);
}

function fromLast4(last4) {
  return { last4, top3: last4.slice(1), top2: last4.slice(2), bottom2: last4.slice(0, 2) };
}

// Turn one raw source record into { top3, bottom2, top2, last4?, noDraw, issues[] }.
function normalizeRecord(rec) {
  const issues = [];
  if (rec.noDraw) return { noDraw: true, issues };

  let out = null;
  const full = rec.full ? String(rec.full).trim() : null;
  const last4 = rec.last4 ? String(rec.last4).trim() : full && full.length >= 4 ? full.slice(-4) : null;

  if (last4 && isDigits(last4, 4)) {
    out = fromLast4(last4);
    if (full && full.length !== 4 && full.length !== 6) issues.push(`เลขเต็มมี ${full.length} หลัก (คาดว่า 4 หรือ 6)`);
    // If the source also printed its own split, it must agree with the derivation.
    if (rec.top3 && rec.top3 !== out.top3) issues.push(`3 ตัวบนที่แหล่งพิมพ์ (${rec.top3}) ไม่ตรงกับเลขเต็ม ${full || last4} (${out.top3})`);
    if (rec.bottom2 && rec.bottom2 !== out.bottom2) issues.push(`2 ตัวล่างที่แหล่งพิมพ์ (${rec.bottom2}) ไม่ตรงกับเลขเต็ม ${full || last4} (${out.bottom2})`);
  } else if (isDigits(rec.top3, 3) && isDigits(rec.bottom2, 2)) {
    out = { top3: rec.top3, top2: rec.top3.slice(1), bottom2: rec.bottom2 };
    if (full) issues.push(`เลขเต็ม "${full}" อ่านไม่ได้`);
  } else {
    issues.push('ไม่มีเลขที่อ่านได้');
    return { invalid: true, issues };
  }
  return { ...out, noDraw: false, issues };
}

const key = (n) => (n.noDraw ? 'NODRAW' : `${n.top3}|${n.bottom2}`);

// sourcesData: { sourceId: { 'YYYY-MM-DD': rawRecord } }
// Returns array of draws sorted ascending by date.
function mergeSources(sourcesData) {
  const dates = new Set();
  for (const recs of Object.values(sourcesData)) for (const d of Object.keys(recs)) dates.add(d);

  const draws = [];
  for (const date of [...dates].sort()) {
    const seen = {};
    const issues = [];
    for (const [sid, recs] of Object.entries(sourcesData)) {
      if (!recs[date]) continue;
      const n = normalizeRecord(recs[date]);
      seen[sid] = n;
      for (const msg of n.issues) issues.push(`${SOURCES[sid]?.name || sid}: ${msg}`);
    }

    // Votes count only independent, internally-consistent sources.
    const votes = {};
    for (const [sid, n] of Object.entries(seen)) {
      if (n.invalid || n.issues.length) continue;
      const meta = SOURCES[sid] || { independent: true };
      if (!meta.independent && seen[meta.copyOf]) continue; // copy of a source we already have
      const k = key(n);
      (votes[k] ||= []).push(sid);
    }
    const ranked = Object.entries(votes).sort((a, b) => b[1].length - a[1].length);
    const total = ranked.reduce((s, [, v]) => s + v.length, 0);

    let status;
    let pick = null;
    if (!ranked.length) {
      status = 'suspect';
    } else if (ranked.length === 1) {
      pick = ranked[0];
      status = pick[1].length >= 2 ? 'verified' : 'single';
    } else if (ranked[0][1].length > ranked[1][1].length && ranked[0][1].length >= 2) {
      pick = ranked[0];
      status = 'majority';
    } else {
      status = 'conflict';
    }

    let result = null;
    if (pick) {
      const n = seen[pick[1][0]];
      result = n.noDraw ? null : { top3: n.top3, top2: n.top2, bottom2: n.bottom2, ...(n.last4 ? { last4: n.last4 } : {}) };
      if (n.noDraw) status = status === 'majority' || status === 'verified' || status === 'single' ? 'no_draw' : status;
    }
    if (status === 'majority' || status === 'conflict') {
      for (const [k, sids] of ranked) {
        issues.push(`${sids.map((s) => SOURCES[s]?.name || s).join(', ')} ให้ ${k === 'NODRAW' ? 'งดออกผล' : k.replace('|', ' / ')}`);
      }
    }

    const wd = weekdayOf(date);
    draws.push({
      date,
      weekday: wd,
      weekdayTh: WEEKDAYS_TH[wd],
      status, // verified | majority | single | conflict | suspect | no_draw
      usable: !!result && ['verified', 'majority', 'single'].includes(status),
      ...(result || {}),
      sources: Object.fromEntries(
        Object.entries(seen).map(([sid, n]) => [sid, n.noDraw ? 'งด' : n.invalid ? 'อ่านไม่ได้' : `${n.top3}/${n.bottom2}`]),
      ),
      voters: pick ? pick[1] : [],
      independentSources: total,
      issues,
    });
  }
  return draws;
}

module.exports = { SOURCES, WEEKDAYS_TH, weekdayOf, fromLast4, normalizeRecord, mergeSources, isDigits };
