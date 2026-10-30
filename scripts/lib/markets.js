// Market definitions. Each market has its own data, predictions, backtest and site
// folder — Lao and Thai numbers are never mixed.
'use strict';

const WEEKDAYS_TH = ['อาทิตย์', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์'];

function weekdayOf(date) {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}
function addDays(date, n) {
  const t = new Date(`${date}T00:00:00Z`); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10);
}
const isDigits = (s, n) => typeof s === 'string' && new RegExp(`^\\d{${n}}$`).test(s);

// ---------------------------------------------------------------- Lao
// top3 = last 3 digits, top2 = last 2, bottom2 = first 2 of the last 4 digits.
function laoFromLast4(last4) {
  return { last4, top3: last4.slice(1), top2: last4.slice(2), bottom2: last4.slice(0, 2) };
}
function normalizeLao(rec) {
  const issues = [];
  if (rec.noDraw) return { noDraw: true, issues };
  const full = rec.full ? String(rec.full).trim() : null;
  const last4 = rec.last4 ? String(rec.last4).trim() : full && full.length >= 4 ? full.slice(-4) : null;
  let out;
  if (last4 && isDigits(last4, 4)) {
    out = laoFromLast4(last4);
    if (full && full.length !== 4 && full.length !== 6) issues.push(`เลขเต็มมี ${full.length} หลัก (คาดว่า 4 หรือ 6)`);
    if (rec.top3 && rec.top3 !== out.top3) issues.push(`3 ตัวบนที่แหล่งพิมพ์ (${rec.top3}) ไม่ตรงกับเลขเต็ม ${full || last4} (${out.top3})`);
    if (rec.bottom2 && rec.bottom2 !== out.bottom2) issues.push(`2 ตัวล่างที่แหล่งพิมพ์ (${rec.bottom2}) ไม่ตรงกับเลขเต็ม ${full || last4} (${out.bottom2})`);
  } else if (isDigits(rec.top3, 3) && isDigits(rec.bottom2, 2)) {
    out = { top3: rec.top3, top2: rec.top3.slice(1), bottom2: rec.bottom2 };
    if (full) issues.push(`เลขเต็ม "${full}" อ่านไม่ได้`);
  } else {
    return { invalid: true, issues: ['ไม่มีเลขที่อ่านได้'] };
  }
  return { ...out, noDraw: false, issues };
}

// ---------------------------------------------------------------- Thai
// top3/top2 come from the first prize, bottom3 = the four 3-digit prizes
// (เลขหน้า 3 ตัว ×2 + เลขท้าย 3 ตัว ×2), bottom2 = เลขท้าย 2 ตัว.
function normalizeThai(rec) {
  const issues = [];
  if (rec.noDraw) return { noDraw: true, issues };
  const first = rec.first || (isDigits(rec.full, 6) ? rec.full : null);
  let top3 = rec.top3;
  if (first) {
    if (!isDigits(first, 6)) return { invalid: true, issues: [`รางวัลที่ 1 "${first}" ไม่ใช่ 6 หลัก`] };
    if (top3 && top3 !== first.slice(-3)) issues.push(`3 ตัวบน (${top3}) ไม่ตรงกับรางวัลที่ 1 ${first}`);
    top3 = first.slice(-3);
  }
  const bottom2 = rec.two || rec.bottom2;
  if (!isDigits(top3, 3) || !isDigits(bottom2, 2)) return { invalid: true, issues: ['ไม่มีเลขที่อ่านได้'] };
  const out = { top3, top2: top3.slice(1), bottom2, noDraw: false, issues };
  if (first) out.first = first;
  if (rec.front3 || rec.last3) {
    const b3 = [...(rec.front3 || []), ...(rec.last3 || [])];
    if (b3.length === 4 && b3.every((x) => isDigits(x, 3))) { out.bottom3 = b3; out.front3 = rec.front3; out.last3 = rec.last3; } else issues.push('เลข 3 ตัวล่างไม่ครบ 4 ชุด');
  }
  return out;
}

// Next expected Thai draw: the 1st or 16th after the last draw, with the shifts
// that recur every year. Other one-off shifts are handled when scoring by matching
// a prediction to the first real draw after it was locked.
function thaiNextDate(lastDate) {
  const min = addDays(lastDate, 7);
  let [y, m] = min.split('-').map(Number);
  for (let i = 0; i < 4; i++) {
    for (const day of [1, 16]) {
      let d = `${y}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      if (d.endsWith('-01-01')) d = `${y}-01-02`; // 30 Dec until 2023, 2 Jan since
      else if (d.endsWith('-01-16')) d = `${y}-01-17`;
      else if (d.endsWith('-05-01')) d = `${y}-05-02`;
      if (d > min) return d;
    }
    m++; if (m > 12) { m = 1; y++; }
  }
  throw new Error('no Thai date');
}

const MARKETS = {
  lao: {
    id: 'lao',
    name: 'หวยลาว',
    fullName: 'ลาวพัฒนา',
    cats: ['top3', 'top2', 'bottom2'],
    sources: {
      phonhuay: { name: 'ผลหวย.com', url: 'https://xn--t3cmiit.com/lao-lottery/history', independent: true },
      saihuay: { name: 'Saihuay', url: 'https://saihuay.com/historical?lotto=lao_pathana', independent: true },
      lottoth: { name: 'LottoTH', url: 'https://lottoth.co/lottery/laosdevelops/history', independent: true },
      vgoldarena: { name: 'Victory Gold Arena', url: 'https://vgoldarena.com/lotto/lao-lottery-history.php', independent: false, copyOf: 'lottoth' },
    },
    normalize: normalizeLao,
    group: (date) => { const w = weekdayOf(date); return { group: String(w), groupTh: `วัน${WEEKDAYS_TH[w]}` }; },
    groupWindow: 20,
    drawTime: '20:30',
    close: '20:15',
    awaitUntil: '23:00',
    matchWindowDays: 0, // a Lao prediction is only scored against its own date
    isDrawDay: (date) => { const w = weekdayOf(date); return w >= 1 && w <= 5; },
    // first weekday on/after `from` that has no record yet
    nextTarget(draws, from) {
      const known = new Set(draws.map((d) => d.date));
      let d = from;
      for (let i = 0; i < 14; i++, d = addDays(d, 1)) if (this.isDrawDay(d) && !known.has(d)) return d;
      throw new Error('no target');
    },
    paths: { sources: 'data/sources', changes: 'data/source-changes.json', tips: 'data/tips', predictions: 'predictions', site: 'public/data' },
  },

  thai: {
    id: 'thai',
    name: 'หวยไทย',
    fullName: 'สลากกินแบ่งรัฐบาล',
    cats: ['top3', 'bottom3', 'top2', 'bottom2'],
    sources: {
      archive: { name: 'thai-lotto-archive (sanook/kapook)', url: 'https://github.com/vicha-w/thai-lotto-archive', independent: true },
      lottoth: { name: 'LottoTH', url: 'https://lottoth.co/lottery/goverment/history', independent: true },
    },
    normalize: normalizeThai,
    group: (date) => { const day = Number(date.slice(8)); const early = day <= 8 || day >= 25; return { group: early ? 'early' : 'mid', groupTh: early ? 'งวดต้นเดือน' : 'งวดกลางเดือน' }; },
    groupWindow: 20,
    drawTime: '14:30',
    close: '14:00',
    awaitUntil: '20:00',
    matchWindowDays: 10,
    isDrawDay: () => false, // waiting is handled in nextTarget
    // The expected next draw. If that date has passed without a result (late data or a
    // shifted draw), return null so nothing is locked until the result arrives —
    // otherwise the next prediction would skip a draw. After matchWindowDays it moves on.
    nextTarget(draws, from) {
      const last = draws.length ? draws[draws.length - 1].date : '2015-08-16';
      let d = thaiNextDate(last);
      if (d < from && addDays(d, this.matchWindowDays) >= from) return null;
      while (d < from) d = thaiNextDate(d);
      return d;
    },
    paths: { sources: 'data/thai/sources', changes: 'data/thai/source-changes.json', tips: 'data/thai/tips', predictions: 'predictions/thai', site: 'public/data/thai' },
  },
};

module.exports = { MARKETS, WEEKDAYS_TH, weekdayOf, addDays, isDigits, laoFromLast4, normalizeLao, normalizeThai, thaiNextDate };
