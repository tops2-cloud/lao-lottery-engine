// The eight analysis models (R1–R8) and the ensemble.
//
// Every model only sees `history`: usable draws strictly BEFORE the target draw,
// sorted oldest → newest. Nothing here may look at the target's result.
//
// Each model returns a probability-like score for every possible number in each
// category (1000 for 3 ตัวบน, 100 for 2 ตัวบน / 2 ตัวล่าง) and its top-N picks.

'use strict';

const N_PICKS = 5; // numbers per category per model
const LICENSE = [7, 9, 8, 5, 4];
const OPPOSITE = { 0: 5, 1: 6, 2: 7, 3: 8, 4: 9, 5: 0, 6: 1, 7: 2, 8: 3, 9: 4 };

const pad = (n, w) => String(n).padStart(w, '0');
const CATS = {
  top3: { width: 3, field: 'top3' },
  top2: { width: 2, field: 'top2' },
  bottom2: { width: 2, field: 'bottom2' },
};

// ---------- helpers ----------
function digitsAt(draws, field, pos) {
  return draws.map((d) => Number(d[field][pos]));
}

function freq(values, smoothing = 1) {
  const c = Array(10).fill(smoothing);
  for (const v of values) c[v] += 1;
  const s = c.reduce((a, b) => a + b, 0);
  return c.map((x) => x / s);
}

function counts(values) {
  const c = Array(10).fill(0);
  for (const v of values) c[v] += 1;
  return c;
}

// Independent positional distributions → distribution over all numbers of that width.
function productDist(posProbs) {
  const width = posProbs.length;
  const size = 10 ** width;
  const out = new Float64Array(size);
  for (let n = 0; n < size; n++) {
    const s = pad(n, width);
    let p = 1;
    for (let i = 0; i < width; i++) p *= posProbs[i][Number(s[i])];
    out[n] = p;
  }
  return normalize(out);
}

function normalize(arr) {
  const s = arr.reduce((a, b) => a + b, 0) || 1;
  return Float64Array.from(arr, (x) => x / s);
}

function uniform(width) {
  const size = 10 ** width;
  return new Float64Array(size).fill(1 / size);
}

// Top-N by score; ties broken by the lower number so results are reproducible.
function topN(dist, width, n = N_PICKS) {
  return [...dist.keys()]
    .sort((a, b) => dist[b] - dist[a] || a - b)
    .slice(0, n)
    .map((x) => pad(x, width));
}

function positional(draws, cat) {
  const { width, field } = CATS[cat];
  return Array.from({ length: width }, (_, i) => freq(digitsAt(draws, field, i)));
}

function fromPositional(draws, cat) {
  return productDist(positional(draws, cat));
}

function pickAll(dists) {
  return Object.fromEntries(Object.entries(dists).map(([c, d]) => [c, topN(d, CATS[c].width)]));
}

function sameFieldRepeats(draws, field) {
  const m = {};
  for (const d of draws) m[d[field]] = (m[d[field]] || 0) + 1;
  return Object.entries(m)
    .filter(([, v]) => v > 1)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([num, times]) => ({ num, times }));
}

// ---------- R1: Short-term DNA ----------
function R1(history) {
  const windows = [3, 5, 7, 10].map((w) => {
    const recent = history.slice(-w);
    const prev = history.slice(-2 * w, -w);
    const all = recent.flatMap((d) => (d.top3 + d.bottom2).split('').map(Number));
    const c = counts(all);
    const prevDigits = new Set(prev.flatMap((d) => (d.top3 + d.bottom2).split('').map(Number)));
    const olderDigits = new Set(history.slice(0, -w).flatMap((d) => (d.top3 + d.bottom2).split('').map(Number)));
    return {
      window: w,
      digitCounts: c,
      repeated: c.map((x, i) => [i, x]).filter(([, x]) => x >= 2).map(([i]) => i),
      missing: c.map((x, i) => [i, x]).filter(([, x]) => x === 0).map(([i]) => i),
      returning: c.map((x, i) => [i, x]).filter(([i, x]) => x > 0 && prev.length && !prevDigits.has(i) && olderDigits.has(i)).map(([i]) => i),
    };
  });
  const recent10 = history.slice(-10);
  const positionChanges = ['top3', 'bottom2'].map((field) => ({
    field,
    changes: CATS[field].width
      ? Array.from({ length: CATS[field].width }, (_, i) => digitsAt(recent10, field, i).join(' → '))
      : [],
  }));
  const dists = Object.fromEntries(Object.keys(CATS).map((c) => [c, fromPositional(recent10, c)]));
  return {
    id: 'R1',
    name: 'Short-term DNA',
    dimension: 'short',
    data: `ผล ${Math.min(10, history.length)} งวดล่าสุด`,
    rule: 'ความถี่รายตำแหน่งใน 10 งวดล่าสุด (บวก 1 ทุกเลขกันศูนย์) แล้วคูณคะแนนแต่ละหลัก',
    limits: 'ตัวอย่างเล็กมาก เลขที่เสมอกันจะเรียงจากเลขน้อยไปมาก',
    stats: { windows, positionChanges },
    dists,
    picks: pickAll(dists),
  };
}

// ---------- R2: Weekday pattern ----------
function R2(history, target) {
  const same = history.filter((d) => d.weekday === target.weekday).slice(-20);
  const dists = Object.fromEntries(Object.keys(CATS).map((c) => [c, fromPositional(same, c)]));
  const pos = positional(same, 'top3');
  return {
    id: 'R2',
    name: 'Weekday Pattern',
    dimension: 'weekday',
    data: `วัน${target.weekdayTh} ย้อนหลัง ${same.length} ครั้ง`,
    rule: 'ความถี่รายตำแหน่งของงวดวันเดียวกันย้อนหลังสูงสุด 20 ครั้ง',
    limits: same.length < 10 ? `มีข้อมูลวันเดียวกันแค่ ${same.length} ครั้ง (ต่ำกว่า 10) — ความน่าเชื่อถือต่ำ` : 'ตัวอย่าง 10–20 ครั้งยังเล็ก ความต่างของความถี่ส่วนใหญ่อยู่ในระดับสุ่ม',
    stats: {
      sample: same.length,
      top3Repeats: sameFieldRepeats(same, 'top3'),
      bottom2Repeats: sameFieldRepeats(same, 'bottom2'),
      absentByPosition: pos.map((p, i) => ({ pos: ['ร้อย', 'สิบ', 'หน่วย'][i], digits: counts(digitsAt(same, 'top3', i)).map((x, d) => [d, x]).filter(([, x]) => x === 0).map(([d]) => d) })),
    },
    dists,
    picks: pickAll(dists),
  };
}

// ---------- R3: Public tips ----------
// tips: { sources: [{ name, url, fetched, numbers: { top3: [], top2: [], bottom2: [] } }] }
function R3(history, target, tips) {
  const sources = (tips && tips.sources) || [];
  // Sources publishing an identical list are treated as one copy.
  const seen = new Map();
  for (const s of sources) {
    const sig = JSON.stringify(['top3', 'top2', 'bottom2'].map((c) => [...(s.numbers?.[c] || [])].sort()));
    if (!seen.has(sig)) seen.set(sig, { ...s, copies: [] });
    else seen.get(sig).copies.push(s.name);
  }
  const unique = [...seen.values()];
  const dists = {};
  const tally = {};
  for (const [c, { width }] of Object.entries(CATS)) {
    const arr = new Float64Array(10 ** width);
    const t = {};
    for (const s of unique) for (const num of new Set(s.numbers?.[c] || [])) {
      if (!new RegExp(`^\\d{${width}}$`).test(num)) continue;
      arr[Number(num)] += 1;
      t[num] = (t[num] || 0) + 1;
    }
    dists[c] = arr.some((x) => x > 0) ? normalize(arr) : uniform(width);
    tally[c] = Object.entries(t).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }
  return {
    id: 'R3',
    name: 'Public Tips',
    dimension: 'tips',
    data: unique.length ? `แหล่งแนวทาง ${unique.length} แหล่งที่ไม่ซ้ำกัน (จากทั้งหมด ${sources.length})` : 'ยังไม่มีข้อมูลเลขแนวทางสำหรับงวดนี้',
    rule: 'นับจำนวนแหล่งอิสระที่เสนอเลขเดียวกัน แหล่งที่รายการเหมือนกันทุกตัวนับเป็นแหล่งเดียว',
    limits: 'เลขสำนักไม่ใช่สถิติผลรางวัล ใช้เป็นมิติแยกและไม่มีน้ำหนักถ้าไม่มีข้อมูล',
    empty: unique.length === 0,
    stats: { sources: unique.map(({ name, url, fetched, copies }) => ({ name, url, fetched, copies })), tally },
    dists,
    picks: unique.length ? Object.fromEntries(Object.keys(CATS).map((c) => [c, tally[c].slice(0, N_PICKS).map(([n]) => n)])) : { top3: [], top2: [], bottom2: [] },
  };
}

// ---------- R4: License matrix (personal) ----------
function R4(history) {
  const L = LICENSE;
  const win = (w) => L.map((_, i) => Array.from({ length: w }, (_, k) => L[(i + k) % L.length]).join(''));
  const p3 = win(3);
  const p2 = win(2);
  const set = new Set(L);
  // How often licence digits appeared in each position historically (informational).
  const posShare = ['ร้อย', 'สิบ', 'หน่วย'].map((name, i) => {
    const ds = digitsAt(history, 'top3', i);
    return { pos: name, share: ds.length ? ds.filter((d) => set.has(d)).length / ds.length : 0 };
  });
  const mk = (list, width) => {
    const arr = new Float64Array(10 ** width);
    for (const n of list) arr[Number(n)] = 1;
    return normalize(arr);
  };
  return {
    id: 'R4',
    name: 'License Matrix',
    dimension: 'personal',
    data: `ชุดเลขทะเบียน ${L.join(', ')}`,
    rule: `เลขต่อเนื่องตามลำดับทะเบียนแบบวนรอบ: 3 ตัว = ${p3.join(', ')} / 2 ตัว = ${p2.join(', ')}`,
    limits: 'โมเดลส่วนบุคคล ไม่ได้มาจากผลรางวัล ไม่มีน้ำหนักในชุดสรุปจนกว่า backtest จะสนับสนุน',
    stats: { posShare, expectedShare: L.length / 10 },
    dists: { top3: mk(p3, 3), top2: mk(p2, 2), bottom2: mk(p2, 2) },
    picks: { top3: p3, top2: p2, bottom2: p2 },
  };
}

// ---------- R5: Delta / modulo ----------
function R5(history) {
  const recent = history.slice(-11); // 10 transitions
  const dists = {};
  const rules = [];
  for (const [c, { width, field }] of Object.entries(CATS)) {
    const pos = [];
    for (let i = 0; i < width; i++) {
      const seq = digitsAt(recent, field, i);
      const deltas = seq.slice(1).map((v, k) => (v - seq[k] + 10) % 10);
      const dc = counts(deltas);
      const last = seq[seq.length - 1];
      // Distribution of next digit = last + delta (mod 10), weighted by delta frequency.
      const p = Array(10).fill(1);
      dc.forEach((cnt, d) => { p[(last + d) % 10] += cnt; });
      const s = p.reduce((a, b) => a + b, 0);
      pos.push(p.map((x) => x / s));
      const best = dc.indexOf(Math.max(...dc));
      if (c !== 'top2') rules.push(`${c === 'top3' ? '3 ตัวบน' : '2 ตัวล่าง'} หลัก${['ร้อย', 'สิบ', 'หน่วย'].slice(3 - width)[i]}: งวดก่อน ${last}, ผลต่างที่พบบ่อยสุด +${best} → ${(last + best) % 10}`);
    }
    dists[c] = productDist(pos);
  }
  return {
    id: 'R5',
    name: 'Delta / Modulo',
    dimension: 'experimental',
    data: `ผลต่างรายหลัก ${Math.max(0, recent.length - 1)} ช่วงล่าสุด`,
    rule: 'เลขหลักถัดไป = (เลขงวดก่อน + ผลต่าง) mod 10 ถ่วงตามความถี่ของผลต่าง ใน 10 ช่วงล่าสุด',
    limits: 'สมมติว่างวดก่อนมีผลต่องวดถัดไป ซึ่งในการออกรางวัลแบบสุ่มไม่เป็นจริง — โมเดลทดลอง ไม่มีน้ำหนักในชุดสรุป',
    stats: { rules },
    dists,
    picks: pickAll(dists),
  };
}

// ---------- R6: Rolling statistics ----------
function R6(history) {
  const ws = [30, 50, 100];
  const windows = ws.map((w) => {
    const h = history.slice(-w);
    const all = h.flatMap((d) => (d.top3 + d.bottom2).split('').map(Number));
    return {
      window: w,
      size: h.length,
      digitCounts: counts(all),
      top3Repeats: sameFieldRepeats(h, 'top3').slice(0, 10),
      top2Repeats: sameFieldRepeats(h, 'top2').slice(0, 10),
      bottom2Repeats: sameFieldRepeats(h, 'bottom2').slice(0, 10),
      positional: positional(h, 'top3').map((p) => p.map((x) => +x.toFixed(4))),
    };
  });
  const dists = {};
  for (const c of Object.keys(CATS)) {
    const parts = ws.map((w) => positional(history.slice(-w), c));
    const avg = parts[0].map((_, i) => Array.from({ length: 10 }, (_, d) => parts.reduce((s, p) => s + p[i][d], 0) / parts.length));
    dists[c] = productDist(avg);
  }
  // Short vs long trend: digit share last 10 vs last 100
  const share = (h) => { const c = counts(h.flatMap((d) => (d.top3 + d.bottom2).split('').map(Number))); const s = c.reduce((a, b) => a + b, 0) || 1; return c.map((x) => x / s); };
  const s10 = share(history.slice(-10));
  const s100 = share(history.slice(-100));
  return {
    id: 'R6',
    name: 'Rolling Statistics',
    dimension: 'long',
    data: `ย้อนหลัง 30 / 50 / 100 งวด (มีจริง ${Math.min(100, history.length)})`,
    rule: 'เฉลี่ยความถี่รายตำแหน่งของ 3 หน้าต่าง (30, 50, 100 งวด) แล้วคูณคะแนนแต่ละหลัก',
    limits: 'ใช้ข้อมูลชุดเดียวกับ R1/R7 แต่ช่วงเวลาต่างกัน — ไม่ใช่หลักฐานอิสระจากกัน',
    stats: { windows, trend: s10.map((v, d) => ({ digit: d, short: +v.toFixed(3), long: +s100[d].toFixed(3) })) },
    dists,
    picks: pickAll(dists),
  };
}

// ---------- R7: Position analysis with digit relationships ----------
function R7(history) {
  const dists = {};
  const leaders = {};
  for (const [c, { width, field }] of Object.entries(CATS)) {
    const p0 = freq(digitsAt(history, field, 0));
    // transition counts between neighbouring positions
    const trans = Array.from({ length: width - 1 }, () => Array.from({ length: 10 }, () => Array(10).fill(1)));
    for (const d of history) for (let i = 0; i < width - 1; i++) trans[i][Number(d[field][i])][Number(d[field][i + 1])] += 1;
    const arr = new Float64Array(10 ** width);
    for (let n = 0; n < arr.length; n++) {
      const s = pad(n, width);
      let p = p0[Number(s[0])];
      for (let i = 0; i < width - 1; i++) {
        const row = trans[i][Number(s[i])];
        p *= row[Number(s[i + 1])] / row.reduce((a, b) => a + b, 0);
      }
      arr[n] = p;
    }
    dists[c] = normalize(arr);
    leaders[c] = positional(history, c).map((p) => p.map((x, d) => [d, x]).sort((a, b) => b[1] - a[1] || a[0] - b[0]).slice(0, 3).map(([d]) => d));
  }
  return {
    id: 'R7',
    name: 'Position Analysis',
    dimension: 'position',
    data: `รายตำแหน่ง ทุกงวดที่มี (${history.length} งวด)`,
    rule: 'P(หลักแรก) × P(หลักถัดไป | หลักก่อน) จากความถี่รายตำแหน่งจริง — ไม่ใช้ความถี่รวม',
    limits: 'ความสัมพันธ์ระหว่างหลักต้องใช้ข้อมูลมาก (100 คู่ต่อตำแหน่ง) ข้อมูลหลักร้อยงวดยังบางมาก',
    stats: { leaders },
    dists,
    picks: pickAll(dists),
  };
}

// ---------- R8: Opposite numbers (applied to final picks only) ----------
function opposite(num) {
  return num.split('').map((d) => OPPOSITE[Number(d)]).join('');
}

// ---------- Ensemble ----------
// Section 3 of the spec: score by short-term, long-term, weekday, position and tips.
// R4 (personal) and R5 (experimental) get weight 0 unless `weights` overrides it
// (backtest.js only raises them when walk-forward results are significant).
const DEFAULT_WEIGHTS = { R1: 1, R2: 1, R3: 1, R4: 0, R5: 0, R6: 1, R7: 1 };

function ensemble(models, weights = DEFAULT_WEIGHTS) {
  const active = models.filter((m) => (weights[m.id] || 0) > 0 && !m.empty);
  const dists = {};
  const picks = {};
  for (const [c, { width }] of Object.entries(CATS)) {
    const size = 10 ** width;
    const arr = new Float64Array(size);
    const wsum = active.reduce((s, m) => s + weights[m.id], 0) || 1;
    for (const m of active) for (let i = 0; i < size; i++) arr[i] += (weights[m.id] * m.dists[c][i]) / wsum;
    dists[c] = arr;
    picks[c] = topN(arr, width);
  }
  return {
    used: active.map((m) => m.id),
    weights,
    dists,
    picks,
    opposite: Object.fromEntries(Object.entries(picks).map(([c, list]) => [c, list.map(opposite)])),
  };
}

function runModels(history, target, tips) {
  return [R1(history), R2(history, target), R3(history, target, tips), R4(history), R5(history), R6(history), R7(history)];
}

module.exports = { N_PICKS, CATS, LICENSE, OPPOSITE, DEFAULT_WEIGHTS, runModels, ensemble, opposite, topN, pad };
