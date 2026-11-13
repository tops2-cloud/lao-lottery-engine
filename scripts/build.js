#!/usr/bin/env node
// Main pipeline. Safe to run any time; it never rewrites an existing prediction.
//   node scripts/build.js                          every market, current Bangkok time
//   node scripts/build.js --market thai            one market
//   node scripts/build.js --now 2026-10-30T12:00:00+07:00   pretend it is this time (testing)
//   node scripts/build.js --skip-backtest
//   node scripts/build.js --no-lock     update data only; predictions are locked from the app's button
// The same code runs inside the Vercel API (api/*.js) through buildMarket().
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { MARKETS, weekdayOf, addDays, WEEKDAYS_TH } = require('./lib/markets');
const { mergeSources } = require('./lib/draws');
const { runModels, ensemble, DEFAULT_WEIGHTS, N_PICKS, CAT_DEF } = require('./lib/models');
const { walkForward, scorePicks } = require('./lib/backtest');
const { pathsFor, readJSON, writeJSON, loadSources } = require('./lib/store');

const arg = (name) => { const i = process.argv.indexOf(name); return i > -1 ? process.argv[i + 1] : null; };
let NOW = new Date();
const BKK_OFFSET = 7 * 3600 * 1000;
const toMin = (hhmm) => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; };

function bkkParts(d) {
  const t = new Date(d.getTime() + BKK_OFFSET);
  return { date: t.toISOString().slice(0, 10), minutes: t.getUTCHours() * 60 + t.getUTCMinutes() };
}
const closeUTC = (market, date) => new Date(`${date}T${market.close}:00+07:00`);

function targetFor(market, date) {
  const wd = weekdayOf(date);
  return { date, weekday: wd, weekdayTh: WEEKDAYS_TH[wd], ...market.group(date) };
}

function stripModel(m) { const { dists, ...rest } = m; return rest; }

function caveats({ market, history, models, target, issuesInWindow, backtest, tipsDir }) {
  const out = [];
  out.push('ผลหวยออกแบบสุ่ม งวดก่อนไม่มีผลต่องวดถัดไป ชุดเลขเหล่านี้เป็นผลของกระบวนการวิเคราะห์ ไม่ใช่การบอกว่าเลขใดมีโอกาสสูงขึ้น');
  const r2 = models.find((m) => m.id === 'R2');
  if (r2.stats.sample < 10) out.push(`R2 มี${target.groupTh}ย้อนหลังแค่ ${r2.stats.sample} ครั้ง`);
  if (models.find((m) => m.id === 'R3').empty) out.push(`R3 ไม่มีเลขแนวทางสำหรับงวดนี้ จึงไม่ถูกนำมาคิดคะแนน (เพิ่มได้ที่ ${tipsDir}/)`);
  if (history.length < 100) out.push(`ข้อมูลที่ใช้ได้มี ${history.length} งวด (ต่ำกว่า 100 ที่ R6 ต้องการ)`);
  const excluded = issuesInWindow.filter((d) => d.status !== 'majority').length;
  const majority = issuesInWindow.length - excluded;
  if (excluded) out.push(`ใน 100 งวดล่าสุดมี ${excluded} งวดที่ข้อมูลขัดกันหรือน่าสงสัยและถูกตัดออก`);
  if (majority) out.push(`ใน 100 งวดล่าสุดมี ${majority} งวดที่แหล่งข้อมูลไม่ตรงกัน ใช้ค่าที่แหล่งอิสระส่วนใหญ่ยืนยัน (ดูหน้า "คุณภาพข้อมูล")`);
  const single = history.slice(-100).filter((d) => d.status === 'single').length;
  if (single) out.push(`${single} จาก ${Math.min(100, history.length)} งวดล่าสุดมีแหล่งเดียว ยังไม่ได้ตรวจทานกับแหล่งที่สอง`);
  if (market.id === 'thai') out.push('หวยไทยออกเดือนละ 2 ครั้ง การยืนยันจากผลจริงหลังล็อกจะสะสมช้ากว่าหวยลาวมาก');
  if (backtest) {
    const rows = backtest.summary.filter((r) => r.model !== 'RANDOM');
    const raw = rows.filter((r) => r.pValue < 0.05).length;
    const adj = rows.filter((r) => r.pAdjusted < 0.05);
    out.push(adj.length
      ? `Backtest ${backtest.tests} งวด: ${adj.map((r) => `${r.model} ${CAT_DEF[r.cat].th}`).join(', ')} ดีกว่าสุ่มแม้ปรับการทดสอบหลายรายการแล้ว — ยังต้องรอยืนยันจากผลจริงหลังล็อก`
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
    if (rows.length >= 2) { w[id] = 0.5; reasons.push(`${id} ได้น้ำหนัก 0.5 เพราะ backtest ผ่านหลังปรับค่า p ใน ${rows.map((r) => CAT_DEF[r.cat].th).join(', ')}`); }
  }
  return { weights: w, reasons };
}

// The real draw a locked prediction should be scored against.
function matchActual(market, pred, usable) {
  if (!market.matchWindowDays) return usable.find((d) => d.date === pred.target.date) || null;
  const after = pred.A?.dataThrough || '0000';
  const until = addDays(pred.target.date, market.matchWindowDays);
  return usable.find((d) => d.date > after && d.date <= until) || null;
}

// opts: { now: Date, lock: boolean, skipBacktest: boolean, log: fn }
// Returns { target, locked, lockedNow, prediction, message }.
function buildMarket(market, opts = {}) {
  NOW = opts.now || new Date();
  const lock = opts.lock !== false;
  const log = opts.log || console.log;
  const P = pathsFor(market);
  const cats = market.cats;
  const draws = mergeSources(loadSources(market), market);
  const usable = draws.filter((d) => d.usable);
  const builtAt = NOW.toISOString();
  const meta = { id: market.id, name: market.name, fullName: market.fullName, cats, drawTime: market.drawTime, close: market.close };

  writeJSON(path.join(P.site, 'results.json'), {
    builtAt, market: meta, sources: market.sources,
    counts: draws.reduce((a, d) => ((a[d.status] = (a[d.status] || 0) + 1), a), {}),
    draws: [...draws].reverse(),
  });

  // ---------- backtest (walk-forward) ----------
  let backtest = readJSON(path.join(P.site, 'backtest.json'), null);
  if (!opts.skipBacktest && usable.length > 30) {
    backtest = { builtAt, method: 'walk-forward: แต่ละงวดใช้เฉพาะข้อมูลก่อนหน้าเท่านั้น, ขั้นต่ำ 30 งวด', picksPerModel: N_PICKS, cats, ...walkForward(draws, { minHistory: 30, cats, groupWindow: market.groupWindow }) };
    writeJSON(path.join(P.site, 'backtest.json'), backtest);
  }

  // ---------- score locked predictions ----------
  fs.mkdirSync(P.predictions, { recursive: true });
  const allDraws = Object.fromEntries(draws.map((d) => [d.date, d]));
  const live = [];
  const index = [];
  const predFiles = () => fs.readdirSync(P.predictions).filter((x) => /^\d{4}-\d{2}-\d{2}\.json$/.test(x)).sort();
  for (const f of predFiles()) {
    const pred = readJSON(path.join(P.predictions, f));
    const actualDraw = matchActual(market, pred, usable);
    const drawDate = actualDraw?.date || pred.target.date;
    const onTime = new Date(pred.lockedAt) <= closeUTC(market, drawDate);
    const entry = { date: pred.target.date, drawDate, lockedAt: pred.lockedAt, onTime, hash: pred.hash, status: actualDraw ? actualDraw.status : allDraws[pred.target.date]?.status || 'pending' };
    if (actualDraw) {
      const a = Object.fromEntries(cats.map((c) => [c, actualDraw[c]]).filter(([, v]) => v != null));
      entry.actual = a;
      entry.scores = Object.fromEntries([
        ...pred.models.filter((m) => !m.empty).map((m) => [m.id, scorePicks(m.picks, a, cats)]),
        ['ENSEMBLE', scorePicks(pred.final, a, cats)],
        ['OPPOSITE', scorePicks(pred.opposite, a, cats)],
      ]);
      if (onTime) live.push(entry);
    }
    index.push(entry);
  }
  writeJSON(path.join(P.site, 'live.json'), { builtAt, note: `นับเฉพาะคำทำนายที่ล็อกก่อน ${market.close} น. ของวันออกผล`, entries: live });

  // ---------- new prediction ----------
  const { date: todayBkk, minutes: nowMin } = bkkParts(NOW);
  const from = nowMin >= toMin(market.close) ? addDays(todayBkk, 1) : todayBkk;
  const targetDate = market.nextTarget(draws, from);
  const tag = `[${market.id}]`;
  if (!targetDate) {
    const message = 'รอผลงวดที่ควรออกแล้วก่อน จึงจะทำนายงวดถัดไปได้';
    log(`${tag} ${message}`);
    finishSite(market, P, builtAt, index, predFiles, { target: null, closeAt: null, locked: false, drawTime: market.drawTime, close: market.close });
    log(`${tag} ข้อมูล ${draws.length} งวด (ใช้ได้ ${usable.length}), backtest ${backtest?.tests ?? '-'} งวด, ตรวจคำทำนายแล้ว ${live.length}`);
    return { target: null, locked: false, lockedNow: false, message };
  }
  const target = targetFor(market, targetDate);
  const predFile = path.join(P.predictions, `${target.date}.json`);
  // From tonight's close until its result is in, the next draw can't be predicted yet,
  // so the prediction always includes the latest result.
  const awaitingToday = market.isDrawDay(todayBkk) && nowMin >= toMin(market.close) && nowMin < toMin(market.awaitUntil) && !allDraws[todayBkk];
  let message = '';
  let lockedNow = false;
  let prediction = null;
  if (fs.existsSync(predFile)) {
    message = `คำทำนายงวด ${target.date} ล็อกไว้แล้ว`;
    prediction = readJSON(predFile);
  } else if (awaitingToday && target.date > todayBkk) {
    message = `ยังไม่มีผลงวด ${todayBkk} รอผลเข้าก่อนจึงจะทำนายงวด ${target.date} ได้`;
  } else if (NOW > closeUTC(market, target.date)) {
    message = `เลยเวลาปิดรับของงวด ${target.date} แล้ว`;
  } else if (!lock) {
    message = `งวด ${target.date} ยังไม่ได้ทำนาย`;
  } else {
    const history = usable.filter((d) => d.date < target.date);
    const tips = readJSON(path.join(P.tips, `${target.date}.json`), null);
    const models = runModels(history, target, tips, cats, { groupWindow: market.groupWindow });
    const { weights, reasons } = weightsFromBacktest(backtest);
    const ens = ensemble(models, weights, cats);
    const issuesInWindow = draws.filter((d) => d.date < target.date).slice(-100).filter((d) => ['conflict', 'suspect', 'majority'].includes(d.status));
    const pred = {
      market: market.id,
      target,
      lockedAt: builtAt,
      A: {
        dataThrough: history[history.length - 1]?.date,
        draws: history.length,
        recent: history.slice(-10).reverse().map((d) => ({ date: d.date, weekdayTh: d.weekdayTh, status: d.status, ...Object.fromEntries(cats.map((c) => [c, d[c]])) })),
        sources: Object.values(market.sources).map(({ name, url, independent }) => ({ name, url, independent })),
      },
      models: models.map(stripModel),
      ensemble: { used: ens.used, weights, reasons },
      final: ens.picks,
      opposite: ens.opposite,
      caveats: caveats({ market, history, models, target, issuesInWindow, backtest, tipsDir: market.paths.tips }),
    };
    pred.hash = crypto.createHash('sha256').update(JSON.stringify({ market: market.id, target, lockedAt: builtAt, final: pred.final, models: pred.models.map((m) => [m.id, m.picks]) })).digest('hex').slice(0, 16);
    writeJSON(predFile, pred);
    index.push({ date: target.date, drawDate: target.date, lockedAt: builtAt, onTime: true, hash: pred.hash, status: allDraws[target.date]?.status || 'pending' });
    message = `ล็อกคำทำนายงวด ${target.date} (${target.weekdayTh}) hash ${pred.hash}`;
    lockedNow = true;
    prediction = pred;
  }
  log(`${tag} ${message}`);

  const locked = fs.existsSync(predFile);
  finishSite(market, P, builtAt, index, predFiles, { target, closeAt: closeUTC(market, target.date).toISOString(), locked, drawTime: market.drawTime, close: market.close });
  log(`${tag} ข้อมูล ${draws.length} งวด (ใช้ได้ ${usable.length}), backtest ${backtest?.tests ?? '-'} งวด, ตรวจคำทำนายแล้ว ${live.length}`);
  return { target, locked, lockedNow, prediction, message };
}

function finishSite(market, P, builtAt, index, predFiles, status) {
  // status.json has no builtAt on purpose: it only changes when the target or lock changes.
  writeJSON(path.join(P.site, 'status.json'), status);
  const latest = predFiles().pop();
  if (latest) fs.copyFileSync(path.join(P.predictions, latest), path.join(P.site, 'latest.json'));
  fs.mkdirSync(path.join(P.site, 'predictions'), { recursive: true });
  for (const f of predFiles()) fs.copyFileSync(path.join(P.predictions, f), path.join(P.site, 'predictions', f));
  writeJSON(path.join(P.site, 'predictions.json'), { builtAt, entries: index.sort((a, b) => b.date.localeCompare(a.date)) });
  writeJSON(path.join(P.site, 'changes.json'), readJSON(P.changes, []));
}

module.exports = { buildMarket };

if (require.main === module) {
  const only = arg('--market');
  const now = arg('--now') ? new Date(arg('--now')) : new Date();
  for (const m of Object.values(MARKETS)) {
    if (!only || only === m.id) buildMarket(m, { now, lock: !process.argv.includes('--no-lock'), skipBacktest: process.argv.includes('--skip-backtest') });
  }
}
