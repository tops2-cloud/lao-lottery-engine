// GET /api/refresh?market=lao|thai
// Called when the app opens. Fetches a result that should be out but isn't stored yet,
// rebuilds the market's site files, commits changes to GitHub, and returns the files
// so the page can show them before Vercel finishes redeploying. Never locks anything.
'use strict';

const { withWork } = require('./_lib/work');
const { fetchIfNeeded, buildMarket, marketFrom } = require('./_lib/run');

module.exports = async (req, res) => {
  try {
    const market = marketFrom(req.query.market);
    const now = new Date();
    const result = await withWork(async () => {
      const f = await fetchIfNeeded(market, now);
      const b = buildMarket(market, { now, lock: false, skipBacktest: true, log: () => {} });
      return { ok: true, fetched: f.fetched, missing: f.missing, stillMissing: f.stillMissing || null, message: b.message };
    }, (r) => `app: update ${market.id}${r.missing ? ` (result ${r.missing})` : ''}`, market.paths.site);
    // A result that is due but not found yet: let the next visit try again soon.
    res.setHeader('Cache-Control', result.stillMissing ? 'no-store' : 's-maxage=60, stale-while-revalidate=60');
    res.status(200).json(result);
  } catch (e) {
    res.setHeader('Cache-Control', 'no-store');
    res.status(e.status && e.status < 500 ? e.status : 200).json({ ok: false, code: e.code || null, error: e.message });
  }
};
