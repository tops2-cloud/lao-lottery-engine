#!/usr/bin/env node
// Main pipeline. Safe to run any time; it never rewrites an existing prediction.
//   node scripts/build.js                 normal run (uses current Bangkok time)
//   node scripts/build.js --now 2026-10-30T12:00:00+07:00   pretend it is this time (testing)
//   node scripts/build.js --skip-backtest
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { mergeSources, SOURCES, weekdayOf, WEEKDAYS_TH } = require('./lib/draws');
const { runModels, ensemble, DEFAULT_WEIGHTS, N_PICKS } = require('./lib/models');
const { walkForward, scorePicks } = require('./lib/backtest');
const { P, readJSON, writeJSON, loadSources } = require('./lib/store');

const arg = (name) => { const i = process.argv.indexOf(name); return i > -1 ? process.argv[i + 1] : null; };
const NOW = arg('--now') ? new Date(arg('--now')) : new Date();
const BKK_OFFSET = 7 * 3600 * 1000;
const CLOSE = { h: 20, m: 15 }; // last moment a prediction counts as "before the draw"

function bkkParts(d) {
  const t = new Date(d.getTime() + BKK_OFFSET);
  return { date: t.toISOString().slice(0, 10), minutes: t.getUTCHours() * 60 + t.getUTCMinutes() };
}
function addDays(date, n) {
  const t = new Date(`${date}T00:00:00Z`); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10);
}
function drawCloseUTC(date) { return new Date(`${date}T${String(CLOSE.h).padStart(2, '0')}:${String(CLOSE.m).padStart(2, '0')}:00+07:00`); }

function nextTarget(draws) {
  const { date: today, minutes } = bkkParts(NOW);
  const known = new Set(draws.map((d) => d.date));
  let d = today;
  if (minutes >= CLOSE.h * 60 + CLOSE.m) d = addDays(d, 1);
  for (let i = 0; i < 14; i++, d = addDays(d, 1)) {
    const wd = weekdayOf(d);
    if (wd === 0 || wd === 6) continue;
    if (known.has(d)) continue;
    return { date: d, weekday: wd, weekdayTh: WEEKDAYS_TH[wd] };
  }
  throw new Error('no target found');
}

function stripModel(m) {
  const { dists, ...rest } = m;
  return rest;
}

function caveats({ history, models, target, issuesInWindow, backtest }) {
  const out = [];
  out.push('ผลหวยออกแบบสุ่ม งวดก่อนไม่มีผลต่องวดถัดไป ชุดเลขเหล่านี้เป็นผลของกระบวนการวิเคราะห์ ไม่ใช่การบอกว่าเลขใดมีโอกาสสูงขึ้น');
  const r2 = models.find((m) => m.id === 'R2');
  if (r2.stats.sample < 10) out.push(`R2 มีงวดวัน${target.weekdayTh}ย้อนหลังแค่ ${r2.stats.sample} ครั้ง`);
  if (models.find((m) => m.id === 'R3').empty) out.push('R3 ไม่มีเลขแนวทางสำหรับงวดนี้ จึงไม่ถูกนำมาคิดคะแนน (เพิ่มได้ที่ data/tips/)');
  if (history.length < 100) out.push(`ข้อมูลที่ใช้ได้มี ${history.length} งวด (ต่ำกว่า 100 ที่ R6 ต้องการ)`);
  const excluded = issuesInWindow.filter((d) => d.status !== 'majority').length;
  const majority = issuesInWindow.length - excluded;
  if (excluded) out.push(`ใน 100 งวดล่าสุดมี ${excluded} งวดที่ข้อมูลขัดกันหรือน่าสงสัยและถูกตัดออก`);
  if (majority) out.push(`ใน 100 งวดล่าสุดมี ${majority} งวดที่แหล่งข้อมูลไม่ตรงกัน ใช้ค่าที่แหล่งอิสระส่วนใหญ่ยืนยัน (ดูหน้า "คุณภาพข้อมูล")`);
  const single = history.slice(-100).filter((d) => d.status === 'single').length;
  if (single) out.push(`${single} จาก ${Math.min(100, history.length)} งวดล่าสุดมีแหล่งเดียว ยังไม่ได้ตรวจทานกับแหล่งที่สอง`);
  if (backtest) {
    const rows = backtest.summary.filter((r) => r.model !== 'RANDOM');
    const raw = rows.filter((r) => r.pValue < 0.05).length;
    const adj = rows.filter((r) => r.pAdjusted < 0.05);
    out.push(adj.length
      ? `Backtest ${backtest.tests} งวด: ${adj.map((r) => `${r.model} ${r.cat}`).join(', ')} ดีกว่าสุ่มแม้ปรับการทดสอบหลายรายการแล้ว — ยังต้องรอยืนยันจากผลจริงหลังล็อก`
      : `Backtest ${backtest.tests} งวด: ไม่มีโมเดลใดดีกว่าสุ่มอย่างมีนัยสำคัญหลังปรับการทดสอบ ${backtest.comparisons} รายการ (ก่อนปรับมี ${raw} รายการที่ p<0.05 ซึ่งเกิดโดยบังเอิญได้ — ตัวสุ่มเองก็ทำได้)`);
  }
  out.push('ไม่แสดงเลขกลับตามที่กำหนด');
  return out;
}

function weightsFromBacktest(bt) {
  // R4/R5 only earn weight with strong walk-forward evidence on ≥200 tests.
  const w = { ...DEFAULT_WEIGHTS };
  const reasons = [];
  for (const id of ['R4', 'R5']) {
    const rows = (bt?.summary || []).filter((r) => r.model === id && r.tests >= 200 && r.pAdjusted < 0.05);
    if (rows.length >= 2) { w[id] = 0.5; reasons.push(`${id} ได้น้ำหนัก 0.5 เพราะ backtest ผ่านหลังปรับค่า p ใน ${rows.map((r) => r.cat).join(', ')}`); }
  }
  return { weights: w, reasons };
}

(function main() {
  const draws = mergeSources(loadSources());
  const usable = draws.filter((d) => d.usable);
  const builtAt = NOW.toISOString();

  // ---------- results ----------
  writeJSON(path.join(P.site, 'results.json'), {
    builtAt,
    sources: SOURCES,
    counts: draws.reduce((a, d) => ((a[d.status] = (a[d.status] || 0) + 1), a), {}),
    draws: [...draws].reverse(),
  });

  // ---------- backtest (walk-forward) ----------
  let backtest = readJSON(path.join(P.site, 'backtest.json'), null);
  if (!process.argv.includes('--skip-backtest')) {
    backtest = { builtAt, method: 'walk-forward: แต่ละงวดใช้เฉพาะข้อมูลก่อนหน้าเท่านั้น, ขั้นต่ำ 30 งวด', picksPerModel: N_PICKS, ...walkForward(draws, { minHistory: 30 }) };
    writeJSON(path.join(P.site, 'backtest.json'), backtest);
  }

  // ---------- score locked predictions ----------
  fs.mkdirSync(P.predictions, { recursive: true });
  const byDate = Object.fromEntries(usable.map((d) => [d.date, d]));
  const allDraws = Object.fromEntries(draws.map((d) => [d.date, d]));
  const live = [];
  const index = [];
  for (const f of fs.readdirSync(P.predictions).filter((x) => /^\d{4}-\d{2}-\d{2}\.json$/.test(x)).sort()) {
    const pred = readJSON(path.join(P.predictions, f));
    const date = pred.target.date;
    const onTime = new Date(pred.lockedAt) <= drawCloseUTC(date);
    const actual = byDate[date];
    const entry = { date, lockedAt: pred.lockedAt, onTime, hash: pred.hash, status: allDraws[date]?.status || 'pending' };
    if (actual) {
      const a = { top3: actual.top3, top2: actual.top2, bottom2: actual.bottom2 };
      entry.actual = a;
      entry.scores = Object.fromEntries([
        ...pred.models.filter((m) => !m.empty).map((m) => [m.id, scorePicks(m.picks, a)]),
        ['ENSEMBLE', scorePicks(pred.final, a)],
        ['OPPOSITE', scorePicks(pred.opposite, a)],
      ]);
      if (onTime) live.push(entry);
    }
    index.push(entry);
  }
  writeJSON(path.join(P.site, 'live.json'), { builtAt, note: 'นับเฉพาะคำทำนายที่ล็อกก่อน 20:15 น. ของวันออกผล', entries: live });

  // ---------- new prediction ----------
  const target = nextTarget(draws);
  const predFile = path.join(P.predictions, `${target.date}.json`);
  // After tonight's draw, wait for its result before locking the next draw so the
  // next prediction includes it. Give up waiting at 23:00 (the morning run covers it).
  const { date: todayBkk, minutes: nowMin } = bkkParts(NOW);
  const todayWd = weekdayOf(todayBkk);
  const awaitingToday = todayWd >= 1 && todayWd <= 5 && nowMin >= 20 * 60 + 30 && nowMin < 23 * 60 && !allDraws[todayBkk];
  if (awaitingToday && target.date > todayBkk && !fs.existsSync(predFile)) {
    console.log(`ยังไม่มีผลงวด ${todayBkk} — รอรอบถัดไปก่อนล็อกงวด ${target.date}`);
  } else if (fs.existsSync(predFile)) {
    console.log(`คำทำนายงวด ${target.date} ล็อกไว้แล้ว — ไม่เขียนทับ`);
  } else if (NOW > drawCloseUTC(target.date)) {
    console.log(`เลยเวลาปิดของงวด ${target.date} แล้ว — ไม่สร้าง`);
  } else {
    const history = usable.filter((d) => d.date < target.date);
    const tipsFile = path.join(P.tips, `${target.date}.json`);
    const tips = readJSON(tipsFile, null);
    const models = runModels(history, target, tips);
    const { weights, reasons } = weightsFromBacktest(backtest);
    const ens = ensemble(models, weights);
    const issuesInWindow = draws.filter((d) => d.date < target.date).slice(-100).filter((d) => ['conflict', 'suspect', 'majority'].includes(d.status));
    const pred = {
      target,
      lockedAt: builtAt,
      A: {
        dataThrough: history[history.length - 1]?.date,
        draws: history.length,
        recent: history.slice(-10).reverse().map(({ date, weekdayTh, top3, top2, bottom2, status }) => ({ date, weekdayTh, top3, top2, bottom2, status })),
        sources: Object.values(SOURCES).map(({ name, url, independent }) => ({ name, url, independent })),
      },
      models: models.map(stripModel),
      ensemble: { used: ens.used, weights, reasons },
      final: ens.picks,
      opposite: ens.opposite,
      caveats: caveats({ history, models, target, issuesInWindow, backtest }),
    };
    pred.hash = crypto.createHash('sha256').update(JSON.stringify({ target, lockedAt: builtAt, final: pred.final, models: pred.models.map((m) => [m.id, m.picks]) })).digest('hex').slice(0, 16);
    writeJSON(predFile, pred);
    index.push({ date: target.date, lockedAt: builtAt, onTime: true, hash: pred.hash, status: 'pending' });
    console.log(`ล็อกคำทำนายงวด ${target.date} (${target.weekdayTh}) hash ${pred.hash}`);
  }

  // ---------- site bundle ----------
  const latestFile = fs.readdirSync(P.predictions).filter((x) => /^\d{4}-\d{2}-\d{2}\.json$/.test(x)).sort().pop();
  if (latestFile) fs.copyFileSync(path.join(P.predictions, latestFile), path.join(P.site, 'latest.json'));
  fs.mkdirSync(path.join(P.site, 'predictions'), { recursive: true });
  for (const f of fs.readdirSync(P.predictions).filter((x) => x.endsWith('.json'))) fs.copyFileSync(path.join(P.predictions, f), path.join(P.site, 'predictions', f));
  writeJSON(path.join(P.site, 'predictions.json'), { builtAt, entries: index.sort((a, b) => b.date.localeCompare(a.date)) });
  writeJSON(path.join(P.site, 'changes.json'), readJSON(P.changes, []));

  console.log(`ข้อมูล ${draws.length} งวด (ใช้ได้ ${usable.length}), backtest ${backtest?.tests ?? '-'} งวด, ตรวจคำทำนายแล้ว ${live.length}`);
})();
