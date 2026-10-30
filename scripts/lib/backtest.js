'use strict';

const { CATS, N_PICKS, runModels, ensemble, pad } = require('./models');

// Seeded PRNG (mulberry32) so the random baseline is reproducible.
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomPicks(rand) {
  const out = {};
  for (const [c, { width }] of Object.entries(CATS)) {
    const s = new Set();
    while (s.size < N_PICKS) s.add(pad(Math.floor(rand() * 10 ** width), width));
    out[c] = [...s];
  }
  return out;
}

function multisetCommon(a, b) {
  const m = {};
  for (const ch of a) m[ch] = (m[ch] || 0) + 1;
  let n = 0;
  for (const ch of b) if (m[ch] > 0) { m[ch]--; n++; }
  return n;
}

// Score one model's picks against an actual result.
// exact     – one of the picks equals the result
// posBest   – most digits matched in the right position by any pick
// commonTop – digits in common (any position) between the FIRST pick and the result, when not exact
function scorePicks(picks, actual) {
  const out = {};
  for (const c of Object.keys(CATS)) {
    const list = picks[c] || [];
    const a = actual[c];
    if (!list.length || !a) { out[c] = null; continue; }
    const exact = list.includes(a);
    const posBest = Math.max(...list.map((p) => p.split('').filter((ch, i) => ch === a[i]).length));
    const first = list[0];
    out[c] = { exact, posBest, commonTop: exact ? null : multisetCommon(first, a), n: list.length };
  }
  return out;
}

// One-sided binomial tail P(X >= k), X ~ Bin(n, p)
function binomTail(k, n, p) {
  if (k <= 0) return 1;
  let logC = 0; let tail = 0;
  for (let i = 0; i <= n; i++) {
    if (i > 0) logC += Math.log(n - i + 1) - Math.log(i);
    if (i >= k) tail += Math.exp(logC + i * Math.log(p) + (n - i) * Math.log(1 - p));
  }
  return Math.min(1, tail);
}

function summarize(rows) {
  // rows: [{ model, cat, score }]
  const agg = {};
  for (const { model, cat, score } of rows) {
    if (!score) continue;
    const k = `${model}|${cat}`;
    const a = (agg[k] ||= { model, cat, tests: 0, hits: 0, posSum: 0, commonSum: 0, commonN: 0, n: score.n });
    a.tests++; a.hits += score.exact ? 1 : 0; a.posSum += score.posBest;
    if (score.commonTop !== null) { a.commonSum += score.commonTop; a.commonN++; }
  }
  return Object.values(agg).map((a) => {
    const width = CATS[a.cat].width;
    const expected = a.n / 10 ** width;
    return {
      model: a.model,
      cat: a.cat,
      tests: a.tests,
      hits: a.hits,
      rate: a.tests ? a.hits / a.tests : 0,
      expectedRate: expected,
      vsRandom: a.tests ? a.hits / a.tests / expected : 0,
      pValue: binomTail(a.hits, a.tests, expected),
      avgPosMatched: a.tests ? a.posSum / a.tests : 0,
      avgCommonDigits: a.commonN ? a.commonSum / a.commonN : 0,
    };
  });
}

// Walk-forward: for each target draw, models see only earlier usable draws.
function walkForward(draws, { minHistory = 30, maxTests = Infinity, seed = 20261030 } = {}) {
  const usable = draws.filter((d) => d.usable);
  const rand = rng(seed);
  const rows = [];
  const start = Math.max(minHistory, usable.length - maxTests);
  for (let i = start; i < usable.length; i++) {
    const target = usable[i];
    const history = usable.slice(0, i);
    const models = runModels(history, target, null);
    const ens = ensemble(models);
    const actual = { top3: target.top3, top2: target.top2, bottom2: target.bottom2 };
    for (const m of models) if (!m.empty) for (const [cat, s] of Object.entries(scorePicks(m.picks, actual))) rows.push({ model: m.id, cat, score: s });
    for (const [cat, s] of Object.entries(scorePicks(ens.picks, actual))) rows.push({ model: 'ENSEMBLE', cat, score: s });
    for (const [cat, s] of Object.entries(scorePicks(randomPicks(rand), actual))) rows.push({ model: 'RANDOM', cat, score: s });
  }
  const summary = summarize(rows);
  // Many model×category pairs are tested at once, so a few small p-values appear by
  // chance alone. Bonferroni-adjust over every non-baseline row.
  const m = summary.filter((r) => r.model !== 'RANDOM').length;
  for (const r of summary) r.pAdjusted = Math.min(1, r.pValue * m);
  return { tests: usable.length - start, from: usable[start]?.date, to: usable[usable.length - 1]?.date, comparisons: m, summary };
}

module.exports = { scorePicks, summarize, walkForward, binomTail, randomPicks, rng };
