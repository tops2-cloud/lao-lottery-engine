'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const P = {
  root: ROOT,
  sources: path.join(ROOT, 'data', 'sources'),
  changes: path.join(ROOT, 'data', 'source-changes.json'),
  tips: path.join(ROOT, 'data', 'tips'),
  predictions: path.join(ROOT, 'predictions'),
  site: path.join(ROOT, 'public', 'data'),
};

function readJSON(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}

function writeJSON(file, obj) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(obj, null, 2) + '\n');
}

function loadSources() {
  const out = {};
  if (!fs.existsSync(P.sources)) return out;
  for (const f of fs.readdirSync(P.sources)) if (f.endsWith('.json')) out[f.replace(/\.json$/, '')] = readJSON(path.join(P.sources, f), {});
  return out;
}

// Add scraped records to a source file. Existing values are never silently replaced:
// if a source later reports something different, the change is logged and the new
// value is kept (the site itself corrected it), so the audit trail shows both.
function upsertSource(sourceId, records, fetchedAt) {
  const file = path.join(P.sources, `${sourceId}.json`);
  const cur = readJSON(file, {});
  const changes = readJSON(P.changes, []);
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
  const sorted = Object.fromEntries(Object.entries(cur).sort(([a], [b]) => b.localeCompare(a)));
  writeJSON(file, sorted);
  if (changed) writeJSON(P.changes, changes);
  return { added, changed };
}

module.exports = { P, readJSON, writeJSON, loadSources, upsertSource };
