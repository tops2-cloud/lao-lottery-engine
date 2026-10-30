#!/usr/bin/env node
// One-off: import a local clone of github.com/vicha-w/thai-lotto-archive into
// data/thai/sources/archive.json (draws from 2015-09-01, when เลขหน้า 3 ตัว began).
//   node scripts/import-thai-archive.js /path/to/thai-lotto-archive
'use strict';

const fs = require('fs');
const path = require('path');
const { MARKETS } = require('./lib/markets');
const { parseArchiveFile } = require('./lib/scrape');
const { upsertSource } = require('./lib/store');

const dir = path.join(process.argv[2] || '.', 'lottonumbers');
const recs = {};
for (const f of fs.readdirSync(dir).filter((n) => /^\d{4}-\d{2}-\d{2}\.txt$/.test(n) && n >= '2015-09-01').sort()) {
  const r = parseArchiveFile(fs.readFileSync(path.join(dir, f), 'utf8'));
  if (r) recs[f.slice(0, 10)] = r; else console.warn('skip', f);
}
const r = upsertSource('archive', recs, new Date().toISOString(), MARKETS.thai);
console.log(`archive: +${r.added} (changed ${r.changed}) from ${Object.keys(recs).length} files`);
