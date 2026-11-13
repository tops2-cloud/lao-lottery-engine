// Runs the normal pipeline inside a Vercel function:
//   1. copy the data folders that were bundled with the deployment into /tmp
//   2. bring them up to date with the newest commit on GitHub (only changed files are downloaded)
//   3. run fetch / build there
//   4. commit whatever really changed back to GitHub
// The committed predictions/*.json are the lock: the commit time is the proof.
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const gh = require('./github');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const DIRS = ['data', 'predictions', 'public/data'];

function walk(root, rel = '') {
  const dir = path.join(root, rel);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const r = rel ? `${rel}/${e.name}` : e.name;
    return e.isDirectory() ? walk(root, r) : [r];
  });
}

// builtAt changes on every build; it alone is not a reason to commit.
function normalized(buf) {
  const s = buf.toString('utf8');
  try {
    const o = JSON.parse(s);
    if (o && typeof o === 'object' && !Array.isArray(o)) delete o.builtAt;
    return JSON.stringify(o);
  } catch { return s; }
}

async function prepare() {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'lle-'));
  for (const d of DIRS) {
    const src = path.join(REPO_ROOT, d);
    if (fs.existsSync(src)) fs.cpSync(src, path.join(work, d), { recursive: true });
  }
  const h = await gh.head();
  const entries = (await gh.tree(h.tree)).filter((e) => DIRS.some((d) => e.path.startsWith(`${d}/`)));
  const wanted = new Set(entries.map((e) => e.path));
  let downloaded = 0;
  for (const e of entries) {
    const file = path.join(work, e.path);
    const local = fs.existsSync(file) ? fs.readFileSync(file) : null;
    if (local && gh.blobSha(local) === e.sha) continue;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, await gh.blob(e.sha));
    downloaded++;
  }
  for (const d of DIRS) for (const rel of walk(work, d)) if (!wanted.has(rel)) fs.rmSync(path.join(work, rel));
  const snapshot = new Map();
  for (const d of DIRS) for (const rel of walk(work, d)) snapshot.set(rel, normalized(fs.readFileSync(path.join(work, rel))));
  process.env.LLE_ROOT = work;
  return { work, head: h, snapshot, downloaded };
}

function changedFiles(ctx) {
  const out = [];
  for (const d of DIRS) {
    for (const rel of walk(ctx.work, d)) {
      const buf = fs.readFileSync(path.join(ctx.work, rel));
      if (ctx.snapshot.get(rel) !== normalized(buf)) out.push({ path: rel, content: buf.toString('utf8') });
    }
  }
  return out;
}

// Predictions that already exist on GitHub must never be rewritten.
function guardLocked(ctx, files) {
  for (const f of files) {
    if (/^predictions\/(thai\/)?\d{4}-\d{2}-\d{2}\.json$/.test(f.path) && ctx.snapshot.has(f.path)) {
      throw new Error(`ไฟล์คำทำนายที่ล็อกแล้วถูกแก้: ${f.path}`);
    }
  }
}

async function commit(ctx, message) {
  const files = changedFiles(ctx);
  if (!files.length) return { committed: false, files: 0 };
  guardLocked(ctx, files);
  const sha = await gh.commitFiles(ctx.head.sha, ctx.head.tree, files, message);
  return { committed: true, files: files.length, sha };
}

function readSite(ctx, marketSite) {
  const dir = path.join(ctx.work, marketSite);
  const read = (n) => { try { return JSON.parse(fs.readFileSync(path.join(dir, `${n}.json`), 'utf8')); } catch { return null; } };
  return { results: read('results'), status: read('status'), latest: read('latest'), live: read('live'), predictions: read('predictions') };
}

function cleanup(ctx) {
  try { fs.rmSync(ctx.work, { recursive: true, force: true }); } catch { /* ignore */ }
  delete process.env.LLE_ROOT;
}

// Run fn(ctx) on fresh data, commit, and return the market's site files.
// If someone else committed in between, start again once on top of their commit.
async function withWork(fn, message, siteDir) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const ctx = await prepare();
    try {
      const result = await fn(ctx);
      try {
        result.commit = await commit(ctx, typeof message === 'function' ? message(result) : message);
      } catch (e) {
        if (e.status === 422 && attempt === 0) continue; // branch moved: redo on the new head
        throw e;
      }
      result.files = readSite(ctx, siteDir);
      return result;
    } finally {
      cleanup(ctx);
    }
  }
  throw new Error('GitHub กำลังมีการอัปเดตพร้อมกัน ลองใหม่อีกครั้ง');
}

module.exports = { prepare, changedFiles, commit, readSite, cleanup, withWork, normalized, REPO_ROOT };
