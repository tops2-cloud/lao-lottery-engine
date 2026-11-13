// POST /api/predict  { market: 'lao'|'thai', pin: '…', target: 'YYYY-MM-DD' }
// Locks the next draw's prediction once: computed from the newest data at the moment of
// the press, committed to GitHub, and never rewritten. Refused after the close time.
'use strict';

const crypto = require('crypto');
const { withWork } = require('./_lib/work');
const { fetchIfNeeded, buildMarket, marketFrom } = require('./_lib/run');

function pinOk(given) {
  const want = process.env.LOCK_PIN || '';
  if (!want) return null; // not configured
  const a = crypto.createHash('sha256').update(String(given || '')).digest();
  const b = crypto.createHash('sha256').update(want).digest();
  return crypto.timingSafeEqual(a, b);
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'ใช้ POST' });
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
    const market = marketFrom(body.market);
    const ok = pinOk(body.pin);
    if (ok === null) return res.status(200).json({ ok: false, code: 'NO_PIN', error: 'ยังไม่ได้ตั้งค่า LOCK_PIN ใน Vercel' });
    if (!ok) {
      await new Promise((r) => setTimeout(r, 1200)); // slow down guessing
      return res.status(401).json({ ok: false, code: 'BAD_PIN', error: 'PIN ไม่ถูกต้อง' });
    }
    const now = new Date();
    const result = await withWork(async () => {
      await fetchIfNeeded(market, now);
      const b = buildMarket(market, { now, lock: true, skipBacktest: true, log: () => {} });
      if (body.target && b.target && body.target !== b.target.date) b.message = `งวดถัดไปตอนนี้คือ ${b.target.date} (หน้าจอแสดง ${body.target}) ${b.message}`;
      return { ok: b.locked, lockedNow: b.lockedNow, target: b.target, message: b.message };
    }, (r) => `app: lock ${market.id} ${r.target?.date || ''}`.trim(), market.paths.site);
    res.status(200).json(result);
  } catch (e) {
    res.status(e.status && e.status < 500 ? e.status : 200).json({ ok: false, code: e.code || null, error: e.message });
  }
};
