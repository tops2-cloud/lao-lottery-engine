'use strict';

const fs = require('fs');
const path = require('path');
const { MARKETS } = require('./markets');

const ROOT = path.resolve(__dirname, '..', '..');

// Absolute paths for a market's folders.
function pathsFor(market = MARKETS.lao) {
  const p = market.paths;
  return {
    root: ROOT,
    sources: path.join(ROOT, p.sources),
    changes: path.join(ROOT, p.changes),
    tips: path.join(ROOT, p.tips),
    predictions: path.join(ROOT, p.predictions),
    site: path.join(ROOT, p.site),
  };
}
const P = pathsFor(MARKETS.lao); // Lao paths, kept for older callers

function readJSON(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}
function writeJSON(file, obj) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(obj, null, 2) + '\n');
}

function loadSources(market = MARKETS.lao) {
  const dir = pathsFor(market).sources;
  const out = {};
  if (!fs.existsSync(dir)) return out;
  for (const f of fs.readdirSync(dir)) if (f.endsWith('.json')) out[f.replace(/\.json$/, '')] = readJSON(path.join(dir, f), {});
  return out;
}

// Add scraped records to a source file. If a source later reports something
// different, the change is logged and the new value kept, so the audit trail shows both.
// upsertSource(sourceId, records, fetchedAt, market?)
function upsertSource(sourceId, records, fetchedAt, market = MARKETS.lao) {
  const P2 = pathsFor(market);
  const file = path.join(P2.sources, `${sourceId}.json`);
  const cur = readJSON(file, {});
  const changes = readJSON(P2.changes, []);
  let added = 0; let changed = 0;
  for (const [date, rec] of Object.entries(records)) {
    const next = { ...rec, fetched: fetchedAt };
    const prev = cur[date];
    if (!prev) { cur[date] = next; added++; continue; }
    const strip = ({ fetched, ...r }) => JSON.stringify(r);
    if (strip(prev) !== strip(next)) {
      changes.push({ source: sourceId, date, before: prev, after: next, detected: fetchedAt });
      cur[date] = next; changed++;
    }
  }
  writeJSON(file, Object.fromEntries(Object.entries(cur).sort(([a], [b]) => b.localeCompare(a))));
  if (changed) writeJSON(P2.changes, changes);
  return { added, changed };
}

module.exports = { P, pathsFor, readJSON, writeJSON, loadSources, upsertSource };
