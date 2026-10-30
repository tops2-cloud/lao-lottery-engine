#!/usr/bin/env node
// Pull the latest results from each site into data/sources/*.json.
//   node scripts/fetch-results.js            latest pages from every site
//   node scripts/fetch-results.js --backfill  also fetch ผลหวย.com draw pages for dates we lack (max 40/run)
'use strict';

const { get, parsePhonhuayHistory, parsePhonhuayDraw, SITES } = require('./lib/scrape');
const { loadSources, upsertSource } = require('./lib/store');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const now = new Date().toISOString();
  const backfill = process.argv.includes('--backfill');
  let ok = 0;
  let phonhuayDates = [];

  for (const [id, site] of Object.entries(SITES)) {
    try {
      const html = await get(site.url);
      const recs = site.parse(html);
      if (id === 'phonhuay') phonhuayDates = parsePhonhuayHistory(html).dates;
      const n = Object.keys(recs).length;
      if (!n) { console.warn(`⚠️  ${id}: อ่านตารางไม่ได้ (โครงสร้างหน้าอาจเปลี่ยน) — ข้าม`); continue; }
      const r = upsertSource(id, recs, now);
      console.log(`✓ ${id}: อ่านได้ ${n} งวด, ใหม่ ${r.added}, เปลี่ยน ${r.changed}`);
      ok++;
    } catch (e) {
      console.warn(`⚠️  ${id}: ${e.message}`);
    }
    await sleep(1500);
  }

  if (backfill && phonhuayDates.length) {
    const have = loadSources().phonhuay || {};
    const todo = phonhuayDates.filter((d) => !have[d]).reverse().slice(0, 40); // newest first
    const recs = {};
    for (const date of todo) {
      try {
        const r = parsePhonhuayDraw(await get(`https://xn--t3cmiit.com/results/lao-lottery/${date}`));
        if (r) recs[date] = r;
      } catch (e) { console.warn(`⚠️  backfill ${date}: ${e.message}`); }
      await sleep(2000);
    }
    const r = upsertSource('phonhuay', recs, now);
    console.log(`✓ backfill ผลหวย.com: ${Object.keys(recs).length}/${todo.length} งวด, ใหม่ ${r.added}; เหลือ ${phonhuayDates.filter((d) => !have[d]).length - todo.length}`);
  }

  if (!ok) { console.error('ไม่มีแหล่งใดอ่านได้เลย'); process.exitCode = 1; }
})();
