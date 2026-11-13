// Shared steps for the API: decide whether a result should already be out, fetch it,
// build the site files, and (for predict) lock the next draw.
'use strict';

const { MARKETS, thaiNextDate, weekdayOf, addDays } = require('../../scripts/lib/markets');
const { mergeSources } = require('../../scripts/lib/draws');
const { loadSources } = require('../../scripts/lib/store');
const { buildMarket } = require('../../scripts/build');
const fetchers = require('../../scripts/fetch-results');

const BKK = 7 * 3600 * 1000;
const bkk = (d) => { const t = new Date(d.getTime() + BKK); return { date: t.toISOString().slice(0, 10), min: t.getUTCHours() * 60 + t.getUTCMinutes() }; };
const toMin = (hhmm) => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; };

// The newest draw whose result should be published by now and that we don't have yet.
function missingDraw(market, now) {
  const draws = mergeSources(loadSources(market), market);
  const have = new Set(draws.map((d) => d.date));
  const { date: today, min } = bkk(now);
  if (market.id === 'lao') {
    let d = min >= toMin(market.drawTime) + 10 ? today : addDays(today, -1);
    for (let i = 0; i < 7 && !market.isDrawDay(d); i++) d = addDays(d, -1);
    return have.has(d) ? null : d;
  }
  // Thai: the draw after the last one we have, once 16:00 of that day has passed
  const last = draws.length ? draws[draws.length - 1].date : '2015-08-16';
  const next = thaiNextDate(last);
  const due = next < today || (next === today && min >= 16 * 60);
  return due ? next : null;
}

async function fetchIfNeeded(market, now) {
  const missing = missingDraw(market, now);
  if (!missing) return { fetched: false, missing: null };
  const iso = now.toISOString();
  if (market.id === 'lao') await fetchers.lao(iso, false);
  else await fetchers.thai(iso);
  return { fetched: true, missing, stillMissing: missingDraw(market, now) };
}

function marketFrom(q) {
  const m = MARKETS[q];
  if (!m) { const e = new Error('market ต้องเป็น lao หรือ thai'); e.status = 400; throw e; }
  return m;
}

module.exports = { missingDraw, fetchIfNeeded, buildMarket, marketFrom, MARKETS, weekdayOf };
