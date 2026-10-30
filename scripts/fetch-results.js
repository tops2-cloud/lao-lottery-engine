#!/usr/bin/env node
// Pull the latest results into data/**/sources/*.json.
//   node scripts/fetch-results.js                   every market
//   node scripts/fetch-results.js --market thai     one market
//   --backfill   also fetch missing older draws (Lao: ผลหวย.com draw pages, max 40/run)
'use strict';

const { MARKETS } = require('./lib/markets');
const { get, parsePhonhuayHistory, parsePhonhuayDraw, parseArchiveFile, ARCHIVE_LIST, ARCHIVE_RAW, SITES } = require('./lib/scrape');
const { loadSources, upsertSource } = require('./lib/store');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const arg = (name) => { const i = process.argv.indexOf(name); return i > -1 ? process.argv[i + 1] : null; };

async function scrapeSites(market, now) {
  let ok = 0;
  let extra = {};
  for (const [id, site] of Object.entries(SITES[market.id] || {})) {
    try {
      const html = await get(site.url);
      const recs = site.parse(html);
      if (id === 'phonhuay') extra.phonhuayDates = parsePhonhuayHistory(html).dates;
      const n = Object.keys(recs).length;
      if (!n) { console.warn(`⚠️  [${market.id}] ${id}: อ่านตารางไม่ได้ (โครงสร้างหน้าอาจเปลี่ยน) — ข้าม`); continue; }
      const r = upsertSource(id, recs, now, market);
      console.log(`✓ [${market.id}] ${id}: อ่านได้ ${n} งวด, ใหม่ ${r.added}, เปลี่ยน ${r.changed}`);
      ok++;
    } catch (e) {
      console.warn(`⚠️  [${market.id}] ${id}: ${e.message}`);
    }
    await sleep(1500);
  }
  return { ok, extra };
}

async function lao(now, backfill) {
  const market = MARKETS.lao;
  const { ok, extra } = await scrapeSites(market, now);
  if (backfill && extra.phonhuayDates?.length) {
    const have = loadSources(market).phonhuay || {};
    const missing = extra.phonhuayDates.filter((d) => !have[d]);
    const todo = missing.slice().reverse().slice(0, 40);
    const recs = {};
    for (const date of todo) {
      try { const r = parsePhonhuayDraw(await get(`https://xn--t3cmiit.com/results/lao-lottery/${date}`)); if (r) recs[date] = r; } catch (e) { console.warn(`⚠️  backfill ${date}: ${e.message}`); }
      await sleep(2000);
    }
    const r = upsertSource('phonhuay', recs, now, market);
    console.log(`✓ [lao] backfill ผลหวย.com: ${Object.keys(recs).length}/${todo.length} งวด, ใหม่ ${r.added}; เหลือ ${missing.length - todo.length}`);
  }
  return ok;
}

async function thai(now) {
  const market = MARKETS.thai;
  let ok = (await scrapeSites(market, now)).ok;
  // Main source: thai-lotto-archive on GitHub (one text file per draw).
  try {
    const list = JSON.parse(await get(ARCHIVE_LIST, 'application/vnd.github+json'));
    const have = loadSources(market).archive || {};
    const names = list.map((x) => x.name).filter((n) => /^\d{4}-\d{2}-\d{2}\.txt$/.test(n) && n >= '2015-09-01');
    const todo = names.filter((n) => !have[n.slice(0, 10)]).slice(-30);
    const recs = {};
    for (const name of todo) {
      const r = parseArchiveFile(await get(ARCHIVE_RAW(name), 'text/plain'));
      if (r) recs[name.slice(0, 10)] = r; else console.warn(`⚠️  [thai] archive ${name}: อ่านไม่ได้`);
      await sleep(300);
    }
    const r = upsertSource('archive', recs, now, market);
    console.log(`✓ [thai] archive: ไฟล์ทั้งหมด ${names.length}, ใหม่ ${r.added}`);
    ok++;
  } catch (e) {
    console.warn(`⚠️  [thai] archive: ${e.message}`);
  }
  return ok;
}

(async () => {
  const now = new Date().toISOString();
  const only = arg('--market');
  const backfill = process.argv.includes('--backfill');
  let ok = 0;
  if (!only || only === 'lao') ok += await lao(now, backfill);
  if (!only || only === 'thai') ok += await thai(now);
  if (!ok) { console.error('ไม่มีแหล่งใดอ่านได้เลย'); process.exitCode = 1; }
})();
