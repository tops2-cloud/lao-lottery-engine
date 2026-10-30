#!/usr/bin/env node
// One-off: load the hand-collected CSVs in seed/ into data/sources/*.json.
'use strict';

const fs = require('fs');
const path = require('path');
const { P, upsertSource } = require('./lib/store');

const SEED = path.join(P.root, 'seed');
for (const f of fs.readdirSync(SEED).filter((x) => x.endsWith('.csv'))) {
  const id = f.replace(/\.csv$/, '');
  const lines = fs.readFileSync(path.join(SEED, f), 'utf8').split('\n').filter((l) => l.trim() && !l.startsWith('#'));
  const header = lines.shift().split(',');
  const recs = {};
  for (const line of lines) {
    const row = Object.fromEntries(line.split(',').map((v, i) => [header[i], v.trim()]));
    const { date, ...rest } = row;
    if (Object.values(rest).some((v) => v === 'งด')) recs[date] = { noDraw: true };
    else recs[date] = Object.fromEntries(Object.entries(rest).filter(([k]) => k !== 'top2'));
  }
  const r = upsertSource(id, recs, '2026-10-30T11:00:00+07:00');
  console.log(`${id}: +${r.added} (changed ${r.changed})`);
}
