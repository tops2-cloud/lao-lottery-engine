// The analysis models (R1–R8) and the ensemble, shared by every market.
//
// Every model only sees `history`: usable draws strictly BEFORE the target draw,
// oldest → newest. Nothing here may look at the target's result.
//
// A category ("cat") is one kind of number: top3, top2, bottom2, or bottom3 (Thai:
// four 3-digit numbers per draw). Each model returns a score for every possible
// number in each category and its top-N picks.
'use strict';

const N_PICKS = 5;
const LICENSE = [7, 9, 8, 5, 4];
const OPPOSITE = { 0: 5, 1: 6, 2: 7, 3: 8, 4: 9, 5: 0, 6: 1, 7: 2, 8: 3, 9: 4 };
const CAT_DEF = {
  top3: { width: 3, multi: false, th: '3 ตัวบน' },
  bottom3: { width: 3, multi: true, th: '3 ตัวล่าง' },
  top2: { width: 2, multi: false, th: '2 ตัวบน' },
  bottom2: { width: 2, multi: false, th: '2 ตัวล่าง' },
};
const DEFAULT_CATS = ['top3', 'top2', 'bottom2'];
const POS_TH = { 3: ['ร้อย', 'สิบ', 'หน่วย'], 2: ['สิบ', 'หน่วย'] };

const pad = (n, w) => String(n).padStart(w, '0');

// ---------- helpers ----------
function values(d, cat) {
  const v = d[cat];
  if (v == null) return [];
  return Array.isArray(v) ? v : [v];
}
function digitsAt(draws, cat, pos) {
  return draws.flatMap((d) => values(d, cat).map((x) => Number(x[pos])));
}
function freq(vals, smoothing = 1) {
  const c = Array(10).fill(smoothing);
  for (const v of vals) c[v] += 1;
  const s = c.reduce((a, b) => a + b, 0);
  return c.map((x) => x / s);
}
function counts(vals) {
  const c = Array(10).fill(0);
  for (const v of vals) c[v] += 1;
  return c;
}
function normalize(arr) {
  const s = arr.reduce((a, b) => a + b, 0) || 1;
  return Float64Array.from(arr, (x) => x / s);
}
function uniform(width) {
  const size = 10 ** width;
  return new Float64Array(size).fill(1 / size);
}
function productDist(posProbs) {
  const width = posProbs.length;
  const out = new Float64Array(10 ** width);
  for (let n = 0; n < out.length; n++) {
    const s = pad(n, width);
    let p = 1;
    for (let i = 0; i < width; i++) p *= posProbs[i][Number(s[i])];
    out[n] = p;
  }
  return normalize(out);
}
// Top-N by score; ties broken by the lower number so results are reproducible.
function topN(dist, width, n = N_PICKS) {
  return [...dist.keys()].sort((a, b) => dist[b] - dist[a] || a - b).slice(0, n).map((x) => pad(x, width));
}
function positional(draws, cat) {
  const { width } = CAT_DEF[cat];
  return Array.from({ length: width }, (_, i) => freq(digitsAt(draws, cat, i)));
}
const fromPositional = (draws, cat) => productDist(positional(draws, cat));
const perCat = (cats, fn) => Object.fromEntries(cats.map((c) => [c, fn(c)]));
const pickAll = (cats, dists) => perCat(cats, (c) => topN(dists[c], CAT_DEF[c].width));

function repeats(draws, cat) {
  const m = {};
  for (const d of draws) for (const v of values(d, cat)) m[v] = (m[v] || 0) + 1;
  return Object.entries(m).filter(([, v]) => v > 1).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([num, times]) => ({ num, times }));
}
// Digits of the "base" categories (top2 is derived from top3, so it is left out).
const baseDigits = (draws, cats) => draws.flatMap((d) => cats.filter((c) => c !== 'top2').flatMap((c) => values(d, c)).join('').split('').filter(Boolean).map(Number));

// ---------- R1: Short-term DNA ----------
function R1(history, target, cats) {
  const windows = [3, 5, 7, 10].map((w) => {
    const recent = history.slice(-w);
    const prev = history.slice(-2 * w, -w);
    const c = counts(baseDigits(recent, cats));
    const prevDigits = new Set(baseDigits(prev, cats));
    const older = new Set(baseDigits(history.slice(0, -w), cats));
    return {
      window: w,
      digitCounts: c,
      repeated: c.map((x, i) => [i, x]).filter(([, x]) => x >= 2).map(([i]) => i),
      missing: c.map((x, i) => [i, x]).filter(([, x]) => x === 0).map(([i]) => i),
      returning: c.map((x, i) => [i, x]).filter(([i, x]) => x > 0 && prev.length && !prevDigits.has(i) && older.has(i)).map(([i]) => i),
    };
  });
  const recent10 = history.slice(-10);
  const positionChanges = cats.filter((c) => c !== 'top2' && !CAT_DEF[c].multi).map((field) => ({
    field,
    changes: Array.from({ length: CAT_DEF[field].width }, (_, i) => digitsAt(recent10, field, i).join(' → ')),
  }));
  const dists = perCat(cats, (c) => fromPositional(recent10, c));
  return {
    id: 'R1', name: 'Short-term DNA', dimension: 'short',
    data: `ผล ${Math.min(10, history.length)} งวดล่าสุด`,
    rule: 'ความถี่รายตำแหน่งใน 10 งวดล่าสุด (บวก 1 ทุกเลขกันศูนย์) แล้วคูณคะแนนแต่ละหลัก',
    limits: 'ตัวอย่างเล็กมาก เลขที่เสมอกันจะเรียงจากเลขน้อยไปมาก',
    stats: { windows, positionChanges },
    dists, picks: pickAll(cats, dists),
  };
}

// ---------- R2: Same-group pattern (Lao: weekday, Thai: early/mid month) ----------
function R2(history, target, cats, opts = {}) {
  const win = opts.groupWindow || 20;
  const same = history.filter((d) => d.group === target.group).slice(-win);
  const dists = perCat(cats, (c) => fromPositional(same, c));
  const first = cats[0];
  return {
    id: 'R2', name: 'Weekday / Draw-day Pattern', dimension: 'weekday',
    data: `${target.groupTh} ย้อนหลัง ${same.length} ครั้ง`,
    rule: `ความถี่รายตำแหน่งของ${target.groupTh}ย้อนหลังสูงสุด ${win} ครั้ง`,
    limits: same.length < 10 ? `มีข้อมูล${target.groupTh}แค่ ${same.length} ครั้ง (ต่ำกว่า 10) — ความน่าเชื่อถือต่ำ` : 'ตัวอย่าง 10–20 ครั้งยังเล็ก ความต่างของความถี่ส่วนใหญ่อยู่ในระดับสุ่ม',
    stats: {
      sample: same.length,
      repeats: perCat(cats.filter((c) => c !== 'top2'), (c) => repeats(same, c).slice(0, 8)),
      absentByPosition: POS_TH[CAT_DEF[first].width].map((pos, i) => ({ pos, digits: counts(digitsAt(same, first, i)).map((x, d) => [d, x]).filter(([, x]) => x === 0).map(([d]) => d) })),
    },
    dists, picks: pickAll(cats, dists),
  };
}

// ---------- R3: Public tips ----------
function R3(history, target, cats, opts = {}) {
  const tips = opts.tips;
  const sources = (tips && tips.sources) || [];
  const seen = new Map();
  for (const s of sources) {
    const sig = JSON.stringify(cats.map((c) => [...(s.numbers?.[c] || [])].sort()));
    if (!seen.has(sig)) seen.set(sig, { ...s, copies: [] });
    else seen.get(sig).copies.push(s.name);
  }
  const unique = [...seen.values()];
  const dists = {};
  const tally = {};
  for (const c of cats) {
    const { width } = CAT_DEF[c];
    const arr = new Float64Array(10 ** width);
    const t = {};
    for (const s of unique) for (const num of new Set(s.numbers?.[c] || [])) {
      if (!new RegExp(`^\\d{${width}}$`).test(num)) continue;
      arr[Number(num)] += 1; t[num] = (t[num] || 0) + 1;
    }
    dists[c] = arr.some((x) => x > 0) ? normalize(arr) : uniform(width);
    tally[c] = Object.entries(t).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }
  return {
    id: 'R3', name: 'Public Tips', dimension: 'tips',
    data: unique.length ? `แหล่งแนวทาง ${unique.length} แหล่งที่ไม่ซ้ำกัน (จากทั้งหมด ${sources.length})` : 'ยังไม่มีข้อมูลเลขแนวทางสำหรับงวดนี้',
    rule: 'นับจำนวนแหล่งอิสระที่เสนอเลขเดียวกัน แหล่งที่รายการเหมือนกันทุกตัวนับเป็นแหล่งเดียว',
    limits: 'เลขสำนักไม่ใช่สถิติผลรางวัล ใช้เป็นมิติแยกและไม่มีน้ำหนักถ้าไม่มีข้อมูล',
    empty: unique.length === 0,
    stats: { sources: unique.map(({ name, url, fetched, copies }) => ({ name, url, fetched, copies })), tally },
    dists,
    picks: unique.length ? perCat(cats, (c) => tally[c].slice(0, N_PICKS).map(([n]) => n)) : perCat(cats, () => []),
  };
}

// ---------- R4: License matrix (personal) ----------
function R4(history, target, cats) {
  const L = LICENSE;
  const win = (w) => L.map((_, i) => Array.from({ length: w }, (_, k) => L[(i + k) % L.length]).join(''));
  const lists = { 3: win(3), 2: win(2) };
  const set = new Set(L);
  const first = cats[0];
  const posShare = POS_TH[CAT_DEF[first].width].map((pos, i) => {
    const ds = digitsAt(history, first, i);
    return { pos, share: ds.length ? ds.filter((d) => set.has(d)).length / ds.length : 0 };
  });
  const mk = (list, width) => { const arr = new Float64Array(10 ** width); for (const n of list) arr[Number(n)] = 1; return normalize(arr); };
  return {
    id: 'R4', name: 'License Matrix', dimension: 'personal',
    data: `ชุดเลขทะเบียน ${L.join(', ')}`,
    rule: `เลขต่อเนื่องตามลำดับทะเบียนแบบวนรอบ: 3 ตัว = ${lists[3].join(', ')} / 2 ตัว = ${lists[2].join(', ')}`,
    limits: 'โมเดลส่วนบุคคล ไม่ได้มาจากผลรางวัล ไม่มีน้ำหนักในชุดสรุปจนกว่า backtest จะสนับสนุน',
    stats: { posShare, expectedShare: L.length / 10 },
    dists: perCat(cats, (c) => mk(lists[CAT_DEF[c].width], CAT_DEF[c].width)),
    picks: perCat(cats, (c) => lists[CAT_DEF[c].width]),
  };
}

// ---------- R5: Delta / modulo ----------
function R5(history, target, cats) {
  const recent = history.slice(-11); // ~10 transitions
  const dists = {};
  const rules = [];
  for (const c of cats) {
    const { width, multi } = CAT_DEF[c];
    const pos = [];
    for (let i = 0; i < width; i++) {
      const seq = digitsAt(recent, c, i); // multi-value cats: values in draw order
      const deltas = seq.slice(1).map((v, k) => (v - seq[k] + 10) % 10);
      const dc = counts(deltas);
      const last = seq[seq.length - 1] ?? 0;
      const p = Array(10).fill(1);
      dc.forEach((cnt, d) => { p[(last + d) % 10] += cnt; });
      const s = p.reduce((a, b) => a + b, 0);
      pos.push(p.map((x) => x / s));
      const best = dc.indexOf(Math.max(...dc));
      if (c !== 'top2') rules.push(`${CAT_DEF[c].th} หลัก${POS_TH[width][i]}: ล่าสุด ${last}, ผลต่างที่พบบ่อยสุด +${best} → ${(last + best) % 10}${multi ? ' (ไล่ทุกชุดตามลำดับ)' : ''}`);
    }
    dists[c] = productDist(pos);
  }
  return {
    id: 'R5', name: 'Delta / Modulo', dimension: 'experimental',
    data: `ผลต่างรายหลัก ${Math.max(0, recent.length - 1)} ช่วงล่าสุด`,
    rule: 'เลขหลักถัดไป = (เลขงวดก่อน + ผลต่าง) mod 10 ถ่วงตามความถี่ของผลต่าง ใน 10 ช่วงล่าสุด',
    limits: 'สมมติว่างวดก่อนมีผลต่องวดถัดไป ซึ่งในการออกรางวัลแบบสุ่มไม่เป็นจริง — โมเดลทดลอง ไม่มีน้ำหนักในชุดสรุป',
    stats: { rules },
    dists, picks: pickAll(cats, dists),
  };
}

// ---------- R6: Rolling statistics ----------
function R6(history, target, cats) {
  const ws = [30, 50, 100];
  const windows = ws.map((w) => {
    const h = history.slice(-w);
    return {
      window: w, size: h.length,
      digitCounts: counts(baseDigits(h, cats)),
      repeats: perCat(cats, (c) => repeats(h, c).slice(0, 10)),
    };
  });
  const dists = perCat(cats, (c) => {
    const parts = ws.map((w) => positional(history.slice(-w), c));
    const avg = parts[0].map((_, i) => Array.from({ length: 10 }, (_, d) => parts.reduce((s, p) => s + p[i][d], 0) / parts.length));
    return productDist(avg);
  });
  const share = (h) => { const c = counts(baseDigits(h, cats)); const s = c.reduce((a, b) => a + b, 0) || 1; return c.map((x) => x / s); };
  const s10 = share(history.slice(-10));
  const s100 = share(history.slice(-100));
  return {
    id: 'R6', name: 'Rolling Statistics', dimension: 'long',
    data: `ย้อนหลัง 30 / 50 / 100 งวด (มีจริง ${Math.min(100, history.length)})`,
    rule: 'เฉลี่ยความถี่รายตำแหน่งของ 3 หน้าต่าง (30, 50, 100 งวด) แล้วคูณคะแนนแต่ละหลัก',
    limits: 'ใช้ข้อมูลชุดเดียวกับ R1/R7 แต่ช่วงเวลาต่างกัน — ไม่ใช่หลักฐานอิสระจากกัน',
    stats: { windows, trend: s10.map((v, d) => ({ digit: d, short: +v.toFixed(3), long: +s100[d].toFixed(3) })) },
    dists, picks: pickAll(cats, dists),
  };
}

// ---------- R7: Position analysis with digit relationships ----------
function R7(history, target, cats) {
  const dists = {};
  const leaders = {};
  for (const c of cats) {
    const { width } = CAT_DEF[c];
    const p0 = freq(digitsAt(history, c, 0));
    const trans = Array.from({ length: width - 1 }, () => Array.from({ length: 10 }, () => Array(10).fill(1)));
    for (const d of history) for (const v of values(d, c)) for (let i = 0; i < width - 1; i++) trans[i][Number(v[i])][Number(v[i + 1])] += 1;
    const arr = new Float64Array(10 ** width);
    for (let n = 0; n < arr.length; n++) {
      const s = pad(n, width);
      let p = p0[Number(s[0])];
      for (let i = 0; i < width - 1; i++) { const row = trans[i][Number(s[i])]; p *= row[Number(s[i + 1])] / row.reduce((a, b) => a + b, 0); }
      arr[n] = p;
    }
    dists[c] = normalize(arr);
    leaders[c] = positional(history, c).map((p) => p.map((x, d) => [d, x]).sort((a, b) => b[1] - a[1] || a[0] - b[0]).slice(0, 3).map(([d]) => d));
  }
  return {
    id: 'R7', name: 'Position Analysis', dimension: 'position',
    data: `รายตำแหน่ง ทุกงวดที่มี (${history.length} งวด)`,
    rule: 'P(หลักแรก) × P(หลักถัดไป | หลักก่อน) จากความถี่รายตำแหน่งจริง — ไม่ใช้ความถี่รวม',
    limits: 'ความสัมพันธ์ระหว่างหลักต้องใช้ข้อมูลมาก (100 คู่ต่อตำแหน่ง) ข้อมูลหลักร้อยงวดยังบางมาก',
    stats: { leaders },
    dists, picks: pickAll(cats, dists),
  };
}

// ---------- R8: Opposite numbers (applied to final picks only) ----------
const opposite = (num) => num.split('').map((d) => OPPOSITE[Number(d)]).join('');

// ---------- Ensemble ----------
const DEFAULT_WEIGHTS = { R1: 1, R2: 1, R3: 1, R4: 0, R5: 0, R6: 1, R7: 1 };

function ensemble(models, weights = DEFAULT_WEIGHTS, cats = DEFAULT_CATS) {
  const active = models.filter((m) => (weights[m.id] || 0) > 0 && !m.empty);
  const dists = {};
  const picks = {};
  for (const c of cats) {
    const { width } = CAT_DEF[c];
    const arr = new Float64Array(10 ** width);
    const wsum = active.reduce((s, m) => s + weights[m.id], 0) || 1;
    for (const m of active) for (let i = 0; i < arr.length; i++) arr[i] += (weights[m.id] * m.dists[c][i]) / wsum;
    dists[c] = arr;
    picks[c] = topN(arr, width);
  }
  return { used: active.map((m) => m.id), weights, dists, picks, opposite: perCat(cats, (c) => picks[c].map(opposite)) };
}

// runModels(history, target, tips, cats?, opts?)
function runModels(history, target, tips, cats = DEFAULT_CATS, opts = {}) {
  const o = { ...opts, tips };
  return [R1, R2, R3, R4, R5, R6, R7].map((fn) => fn(history, target, cats, o));
}

module.exports = { N_PICKS, CAT_DEF, DEFAULT_CATS, LICENSE, OPPOSITE, DEFAULT_WEIGHTS, runModels, ensemble, opposite, topN, pad, values };
