// Merging results from several sources into one list of draws, per market.
// All numbers stay strings so leading zeros are never lost.
'use strict';

const { MARKETS, WEEKDAYS_TH, weekdayOf, laoFromLast4, normalizeLao } = require('./markets');

const key = (n) => (n.noDraw ? 'NODRAW' : `${n.top3}|${n.bottom2}`);
const richness = (n) => Object.keys(n).length;

// sourcesData: { sourceId: { 'YYYY-MM-DD': rawRecord } } → draws sorted oldest first
function mergeSources(sourcesData, market = MARKETS.lao) {
  const SOURCES = market.sources;
  const dates = new Set();
  for (const recs of Object.values(sourcesData)) for (const d of Object.keys(recs)) dates.add(d);

  const draws = [];
  for (const date of [...dates].sort()) {
    const seen = {};
    const issues = [];
    for (const [sid, recs] of Object.entries(sourcesData)) {
      if (!recs[date]) continue;
      const n = market.normalize(recs[date]);
      seen[sid] = n;
      for (const msg of n.issues) issues.push(`${SOURCES[sid]?.name || sid}: ${msg}`);
    }

    // Votes count only independent, internally-consistent sources.
    const votes = {};
    for (const [sid, n] of Object.entries(seen)) {
      if (n.invalid || n.issues.length) continue;
      const meta = SOURCES[sid] || { independent: true };
      if (!meta.independent && seen[meta.copyOf]) continue; // copy of a source we already have
      (votes[key(n)] ||= []).push(sid);
    }
    const ranked = Object.entries(votes).sort((a, b) => b[1].length - a[1].length);
    const total = ranked.reduce((s, [, v]) => s + v.length, 0);

    let status;
    let pick = null;
    if (!ranked.length) status = 'suspect';
    else if (ranked.length === 1) { pick = ranked[0]; status = pick[1].length >= 2 ? 'verified' : 'single'; }
    else if (ranked[0][1].length > ranked[1][1].length && ranked[0][1].length >= 2) { pick = ranked[0]; status = 'majority'; }
    else status = 'conflict';

    let result = null;
    if (pick) {
      // Among agreeing sources, take the most complete record (e.g. the one with 3 ตัวล่าง).
      const n = pick[1].map((s) => seen[s]).sort((a, b) => richness(b) - richness(a))[0];
      if (n.noDraw) status = 'no_draw';
      else { const { noDraw, issues: _i, invalid, ...fields } = n; result = fields; }
    }
    if (status === 'majority' || status === 'conflict') {
      for (const [k, sids] of ranked) issues.push(`${sids.map((s) => SOURCES[s]?.name || s).join(', ')} ให้ ${k === 'NODRAW' ? 'งดออกผล' : k.replace('|', ' / ')}`);
    }

    const wd = weekdayOf(date);
    draws.push({
      date,
      weekday: wd,
      weekdayTh: WEEKDAYS_TH[wd],
      ...market.group(date),
      status, // verified | majority | single | conflict | suspect | no_draw
      usable: !!result && ['verified', 'majority', 'single'].includes(status),
      ...(result || {}),
      sources: Object.fromEntries(Object.entries(seen).map(([sid, n]) => [sid, n.noDraw ? 'งด' : n.invalid ? 'อ่านไม่ได้' : `${n.top3}/${n.bottom2}`])),
      voters: pick ? pick[1] : [],
      independentSources: total,
      issues,
    });
  }
  return draws;
}

// Backwards-compatible names used by tests and older scripts.
const SOURCES = MARKETS.lao.sources;
const normalizeRecord = normalizeLao;
const fromLast4 = laoFromLast4;

module.exports = { SOURCES, WEEKDAYS_TH, weekdayOf, fromLast4, normalizeRecord, mergeSources };
