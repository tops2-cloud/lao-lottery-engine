'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { normalizeRecord, mergeSources, fromLast4 } = require('../scripts/lib/draws');
const { runModels, ensemble, opposite } = require('../scripts/lib/models');
const { scorePicks, binomTail } = require('../scripts/lib/backtest');
const { parseLottoth, parseSaihuay, parsePhonhuayHistory, parsePhonhuayDraw } = require('../scripts/lib/scrape');

test('derivation keeps leading zeros (4- and 6-digit formats)', () => {
  assert.deepStrictEqual(fromLast4('0618'), { last4: '0618', top3: '618', top2: '18', bottom2: '06' });
  const six = normalizeRecord({ full: '935721' });
  assert.strictEqual(six.top3, '721'); assert.strictEqual(six.bottom2, '57'); assert.strictEqual(six.top2, '21');
  assert.strictEqual(normalizeRecord({ last4: '0042' }).bottom2, '00');
});

test('a source whose printed split contradicts its own full number is flagged', () => {
  const n = normalizeRecord({ full: '012711', top3: '400', bottom2: '20' });
  assert.ok(n.issues.length >= 2);
});

test('merge statuses: verified, majority, conflict, copies not counted twice', () => {
  const d = mergeSources({
    phonhuay: { '2026-10-12': { last4: '7592' }, '2026-10-13': { last4: '7658' }, '2026-10-14': { last4: '1111' } },
    saihuay: { '2026-10-12': { top3: '592', bottom2: '75' }, '2026-10-13': { top3: '658', bottom2: '76' } },
    lottoth: { '2026-10-12': { noDraw: true }, '2026-10-14': { top3: '222', bottom2: '22' } },
    vgoldarena: { '2026-10-14': { full: '2222', top3: '222', bottom2: '22' } }, // copy of lottoth
  });
  const by = Object.fromEntries(d.map((x) => [x.date, x]));
  assert.strictEqual(by['2026-10-12'].status, 'majority');
  assert.strictEqual(by['2026-10-12'].top3, '592');
  assert.strictEqual(by['2026-10-13'].status, 'verified');
  assert.strictEqual(by['2026-10-14'].status, 'conflict'); // 1 vs 1 — the copy does not break the tie
  assert.strictEqual(by['2026-10-14'].usable, false);
});

test('opposite numbers use the 0↔5 … 4↔9 table, not reversal', () => {
  assert.strictEqual(opposite('294'), '749');
  assert.strictEqual(opposite('06'), '51');
});

test('models never see the target result', () => {
  const mk = (i) => { const n = String((i * 7919) % 10000).padStart(4, '0'); return { date: `2026-01-${String((i % 28) + 1).padStart(2, '0')}`, weekday: (i % 5) + 1, ...fromLast4(n), usable: true }; };
  const hist = Array.from({ length: 120 }, (_, i) => mk(i));
  const target = { date: '2026-12-01', weekday: 2, weekdayTh: 'อังคาร' };
  const a = ensemble(runModels(hist, target, null)).picks;
  const b = ensemble(runModels(hist.slice(), target, null)).picks;
  assert.deepStrictEqual(a, b);
  for (const c of ['top3', 'top2', 'bottom2']) assert.strictEqual(a[c].length, 5);
});

test('scoring separates exact, positional and common-digit matches', () => {
  const s = scorePicks({ top3: ['294', '111'], top2: ['49'], bottom2: ['32'] }, { top3: '294', top2: '94', bottom2: '32' });
  assert.strictEqual(s.top3.exact, true);
  assert.strictEqual(s.top2.exact, false); assert.strictEqual(s.top2.commonTop, 2); assert.strictEqual(s.top2.posBest, 0);
});

test('binomial tail sanity', () => {
  assert.ok(Math.abs(binomTail(1, 1, 0.5) - 0.5) < 1e-9);
  assert.strictEqual(binomTail(0, 10, 0.1), 1);
});

test('scrapers parse the layouts seen on 2026-10-30', () => {
  const lt = parseLottoth(`<table><tr><th>งวด</th></tr>
    <tr><td><a href="/lottery/laosdevelops/2026-10-29">29 ตุลาคม 2569</a></td><td>294</td><td>32</td><td>3294</td></tr>
    <tr><td><a href="/lottery/laosdevelops/2026-10-12">12 ตุลาคม 2569</a></td><td>งด</td><td>งด</td><td>งด</td></tr></table>`);
  assert.deepStrictEqual(lt['2026-10-29'], { top3: '294', bottom2: '32', full: '3294' });
  assert.deepStrictEqual(lt['2026-10-12'], { noDraw: true });

  const sh = parseSaihuay(`<table><tr><td><a href="/historical?lotto=lao_pathana&date=2026-10-30">30 ต.ค.</a></td><td>รอผล</td><td>รอผล</td></tr>
    <tr><td><a href="https://saihuay.com/historical?lotto=lao_pathana&amp;date=2026-10-28">28 ต.ค.</a></td><td><span>618</span></td><td>06</td></tr></table>`);
  assert.deepStrictEqual(sh, { '2026-10-28': { top3: '618', bottom2: '06' } });

  const ph = parsePhonhuayHistory(`<a class="x" href="/results/lao-lottery/2026-10-28"><span>งวดวันที่ 28 ตุลาคม 2569</span> <span>เลขท้าย 4 ตัว</span> <b>0618</b></a>
    <li><a href="/results/lao-lottery/2024-01-03">งวดวันที่ 3 มกราคม 2567</a></li>`);
  assert.deepStrictEqual(ph.records, { '2026-10-28': { last4: '0618' } });
  assert.deepStrictEqual(ph.dates, ['2024-01-03', '2026-10-28']);
  assert.deepStrictEqual(parsePhonhuayDraw('<p>เลขท้าย 4 ตัว คือ 7592</p>'), { last4: '7592' });
});

// ---------------------------------------------------------------- Thai
const { MARKETS, normalizeThai, thaiNextDate } = require('../scripts/lib/markets');
const { parseArchiveFile, parseLottothGov } = require('../scripts/lib/scrape');
const { chance } = require('../scripts/lib/backtest');

test('Thai archive file parses with Windows line endings', () => {
  const r = parseArchiveFile('http://x\r\nFIRST 011781\r\nTHREE_FIRST 392 402\r\nTHREE_LAST 171 255\r\nTWO 48\r\n');
  assert.deepStrictEqual(r, { first: '011781', two: '48', front3: ['392', '402'], last3: ['171', '255'] });
  const n = normalizeThai(r);
  assert.strictEqual(n.top3, '781'); assert.strictEqual(n.top2, '81'); assert.strictEqual(n.bottom2, '48');
  assert.deepStrictEqual(n.bottom3, ['392', '402', '171', '255']);
});

test('Thai merge: LottoTH confirms top3/bottom2, archive supplies 3 ตัวล่าง', () => {
  const d = mergeSources({
    archive: { '2026-10-16': { first: '011781', two: '48', front3: ['392', '402'], last3: ['171', '255'] } },
    lottoth: { '2026-10-16': { full: '011781', top3: '781', bottom2: '48' } },
  }, MARKETS.thai);
  assert.strictEqual(d[0].status, 'verified');
  assert.deepStrictEqual(d[0].bottom3, ['392', '402', '171', '255']);
  assert.strictEqual(d[0].group, 'mid');
});

test('3 ตัวล่าง: a pick hits if it matches any of the four numbers', () => {
  const s = scorePicks({ bottom3: ['171', '000'] }, { bottom3: ['392', '402', '171', '255'] }, ['bottom3']);
  assert.strictEqual(s.bottom3.exact, true);
  assert.ok(Math.abs(chance(5, 4, 3) - 0.0199) < 0.0005);
});

test('Thai schedule: 1st/16th with the yearly shifts, and waits for a late result', () => {
  assert.strictEqual(thaiNextDate('2026-10-16'), '2026-11-01');
  assert.strictEqual(thaiNextDate('2026-11-01'), '2026-11-16');
  assert.strictEqual(thaiNextDate('2026-12-16'), '2027-01-02');
  assert.strictEqual(thaiNextDate('2027-01-02'), '2027-01-17');
  assert.strictEqual(thaiNextDate('2027-04-16'), '2027-05-02');
  assert.strictEqual(MARKETS.thai.nextTarget([{ date: '2026-10-16' }], '2026-11-02'), null);
});

test('LottoTH government parser reads columns by shape', () => {
  const r = parseLottothGov('<table><tr><td><a href="/lottery/goverment/2026-10-16">16 ต.ค.</a></td><td>781</td><td>48</td><td>011781</td></tr></table>');
  assert.deepStrictEqual(r, { '2026-10-16': { full: '011781', top3: '781', bottom2: '48' } });
});

test('Thai models cover all four categories', () => {
  const mk = (i) => { const f = String((i * 7919) % 1000000).padStart(6, '0'); return { date: `2020-01-${String((i % 28) + 1).padStart(2, '0')}`, group: i % 2 ? 'early' : 'mid', top3: f.slice(3), top2: f.slice(4), bottom2: f.slice(0, 2), bottom3: [f.slice(0, 3), f.slice(1, 4), f.slice(2, 5), f.slice(3)], usable: true }; };
  const hist = Array.from({ length: 80 }, (_, i) => mk(i));
  const cats = MARKETS.thai.cats;
  const ens = ensemble(runModels(hist, { date: '2026-11-01', group: 'early', groupTh: 'งวดต้นเดือน' }, null, cats), undefined, cats);
  for (const c of cats) assert.strictEqual(ens.picks[c].length, 5);
});
