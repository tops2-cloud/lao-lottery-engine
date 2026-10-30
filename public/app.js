'use strict';

const CAT_TH = { top3: '3 ตัวบน', bottom3: '3 ตัวล่าง', top2: '2 ตัวบน', bottom2: '2 ตัวล่าง' };
const CAT_SHORT = { top3: 'บน', bottom3: '3ล่าง', top2: '2บน', bottom2: 'ล่าง' };
const STATUS_TH = {
  verified: 'ยืนยัน 2+ แหล่ง', single: 'แหล่งเดียว', majority: 'เสียงข้างมาก',
  conflict: 'ขัดกัน', suspect: 'น่าสงสัย', no_draw: 'งดออกผล', pending: 'รอผล',
};
const MODEL_TH = { ENSEMBLE: 'ชุดสรุป', RANDOM: 'สุ่ม (ตัวเทียบ)', OPPOSITE: 'R8 คู่ตรงข้าม' };
// showFrom: a draw dated today is only shown from this time (minutes after midnight, Bangkok)
const MARKETS = {
  lao: { base: 'data', defaultCats: ['top3', 'top2', 'bottom2'], letters: { top3: 'C', top2: 'D', bottom2: 'E' }, showFrom: 20 * 60 + 30, runs: '20:38–22:07' },
  thai: { base: 'data/thai', defaultCats: ['top3', 'bottom3', 'top2', 'bottom2'], letters: {}, showFrom: 16 * 60, runs: '16:23, 17:47 และ 19:13' },
};

const $app = document.getElementById('app');
const cache = {};
let market = 'lao';
const M = () => MARKETS[market];

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pct = (x, d = 1) => `${(x * 100).toFixed(d)}%`;
const fmtDate = (iso) => new Intl.DateTimeFormat('th-TH', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${iso}T00:00:00Z`));
const fmtTime = (iso) => new Intl.DateTimeFormat('th-TH', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Bangkok' }).format(new Date(iso));
const vals = (v) => (v == null ? [] : Array.isArray(v) ? v : [v]);
const show = (v) => esc(vals(v).join(' ') || '–');

async function load(name) {
  const url = `${M().base}/${name}.json`;
  if (!cache[url]) cache[url] = fetch(url, { cache: 'no-cache' }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  return cache[url];
}
async function catsOf() {
  const r = await load('results');
  return r?.market?.cats || M().defaultCats;
}

const badge = (s) => `<span class="badge b-${esc(s)}">${esc(STATUS_TH[s] || s)}</span>`;
const nums = (list, small) => `<div class="nums${small ? ' small' : ''}">${(list || []).map((n, i) => `<span class="num${i === 0 && !small ? ' lead' : ''}">${esc(n)}</span>`).join('') || '<span class="sub">ไม่มี</span>'}</div>`;

function bkkNow() {
  const t = new Date(Date.now() + 7 * 3600 * 1000);
  return { date: t.toISOString().slice(0, 10), minutes: t.getUTCHours() * 60 + t.getUTCMinutes(), weekday: t.getUTCDay() };
}

// ---------- latest result + how that draw's locked set did ----------
const pickRow = (label, picks, win) => {
  const hit = picks.some((p) => win.includes(p));
  return `<div class="cmp-row"><span class="lbl">${label}</span><span class="mark ${hit ? 'hit' : 'miss'}" aria-label="${hit ? 'ถูก' : 'ไม่ถูก'}">${hit ? '✓' : '✗'}</span>${picks.map((n) => `<span class="pick${win.includes(n) ? ' on' : ''}">${esc(n)}</span>`).join('')}</div>`;
};

function laoNums(d, cats) {
  return `<div class="r-nums">${cats.map((c) => `<div><small>${CAT_TH[c]}</small><b>${show(d[c])}</b></div>`).join('')}</div>`;
}

// Laid out like the official sheet: รางวัลที่ 1, เลขหน้า 3 ตัว, เลขท้าย 3 ตัว, เลขท้าย 2 ตัว
function thaiNums(d) {
  if (!d.first && !d.front3) return laoNums(d, ['top3', 'top2', 'bottom2']);
  return `<div class="t-nums">
      <div class="t-first"><small>รางวัลที่ 1</small><b>${esc(d.first || '–')}</b></div>
      <div class="t-two"><small>เลขท้าย 2 ตัว</small><b>${esc(d.bottom2)}</b></div>
      <div><small>เลขหน้า 3 ตัว</small><b>${(d.front3 || ['–']).map(esc).join(' ')}</b></div>
      <div><small>เลขท้าย 3 ตัว</small><b>${(d.last3 || ['–']).map(esc).join(' ')}</b></div>
    </div>`;
}

async function latestResultBlock(res, cats, latestPred) {
  const now = bkkNow();
  // Before draw time, today's draw is not shown yet — show the one before it.
  const visible = (d) => !(d.date === now.date && now.minutes < M().showFrom);
  const d = res.draws.find((x) => (x.usable || x.status === 'no_draw') && visible(x));
  const drawToday = market === 'lao' ? now.weekday >= 1 && now.weekday <= 5 : latestPred?.target?.date === now.date;
  const waiting = drawToday && now.minutes >= M().showFrom && !res.draws.some((x) => x.date === now.date)
    ? `<p class="waiting">รอผลงวดวันนี้ ระบบดึงผลรอบ ${M().runs} น.</p>` : '';
  if (!d) return waiting;
  if (d.status === 'no_draw') return `${waiting}<section class="result"><div class="r-head"><b>ผลงวด ${esc(fmtDate(d.date))}</b></div><p class="tiny">งดออกผล</p></section>`;

  const idx = await load('predictions');
  const entry = idx?.entries?.find((e) => (e.drawDate || e.date) === d.date && e.actual);
  const pred = entry ? await load(`predictions/${entry.date}`) : await load(`predictions/${d.date}`);
  const cmp = pred ? `<div class="cmp">${cats.map((c) => pickRow(CAT_TH[c], pred.final[c] || [], vals(d[c]))).join('')}</div>` : '';
  return `${waiting}
    <section class="result" aria-label="ผลงวดล่าสุด">
      <div class="r-head"><b>ผลงวด ${esc(fmtDate(d.date))}</b>${badge(d.status)}</div>
      ${market === 'thai' ? thaiNums(d) : laoNums(d, cats)}
      ${cmp}
      ${market === 'lao' && d.last4 ? `<p class="tiny">เลขท้าย 4 ตัว ${esc(d.last4)}</p>` : ''}
    </section>`;
}

// ---------- views ----------
async function viewPredict() {
  const res = await load('results');
  const cats = await catsOf();
  const p = await load('latest');
  if (!res) return `<p class="empty">ยังไม่มีข้อมูล${market === 'thai' ? 'หวยไทย' : ''}บนเว็บ ให้ไปที่ GitHub แท็บ Actions แล้วกด Run workflow หนึ่งครั้ง ถ้ารันแล้วยังไม่ขึ้น ให้ดูขั้น "Build" ว่ามีข้อความผิดพลาดหรือไม่</p>`;
  const top = await latestResultBlock(res, cats, p);
  if (!p) return top + '<p class="empty">ยังไม่มีคำทำนาย ระบบจะล็อกเมื่อ GitHub Actions รันรอบถัดไป</p>';
  const actual = res?.draws.find((d) => d.date === p.target.date && d.usable);
  const L = M().letters;
  const row = (c, list, small) => `<div class="row${small ? ' opp' : ''}"><span>${small ? '' : esc(L[c] ? `${L[c]} ` : '')}${CAT_TH[c]}</span>${nums(list, small)}</div>`;
  return `${top}
    <section class="sealed" aria-label="ชุดเลขสรุปที่ล็อกไว้">
      <div class="s-head"><b>งวดถัดไป ${esc(fmtDate(p.target.date))}</b><span class="seal">ล็อก ${esc(fmtTime(p.lockedAt))}</span></div>
      ${actual ? `<p class="tiny">ผลออกแล้ว ${esc(actual.top3)} / ${esc(actual.bottom2)}</p>` : ''}
      ${cats.map((c) => row(c, p.final[c])).join('')}
      <p class="f-title">${market === 'lao' ? 'F ' : ''}คู่ตรงข้าม <span>(0↔5 1↔6 2↔7 3↔8 4↔9)</span></p>
      ${cats.map((c) => row(c, p.opposite[c], true)).join('')}
      <p class="tiny lockmeta">รหัส ${esc(p.hash)} · ข้อมูลถึง ${esc(fmtDate(p.A.dataThrough))} · คะแนนจาก ${esc(p.ensemble.used.join(' '))}</p>
    </section>

    <details class="fold">
      <summary>${market === 'lao' ? 'G. ' : ''}จุดที่ควรระวัง (${p.caveats.length})</summary>
      <ul class="notes">${p.caveats.map((c) => `<li>${esc(c)}</li>`).join('')}</ul>
      ${p.ensemble.reasons?.length ? `<p class="sub">${p.ensemble.reasons.map(esc).join('<br>')}</p>` : ''}
    </details>

    <details class="fold">
      <summary>${market === 'lao' ? 'A. ' : ''}ข้อมูลที่ใช้ (${esc(p.A.draws)} งวด)</summary>
      <p class="sub">ถึงงวด${esc(fmtDate(p.A.dataThrough))} จาก ${p.A.sources.map((s) => `<a href="${esc(s.url)}" rel="noopener" target="_blank">${esc(s.name)}</a>${s.independent ? '' : ' (สำเนาของ LottoTH)'}`).join(', ')}</p>
      <div class="scroll tight"><table class="tbl compact">
        <thead><tr><th>งวด</th>${cats.map((c) => `<th>${CAT_SHORT[c]}</th>`).join('')}<th></th></tr></thead>
        <tbody>${p.A.recent.map((d) => `<tr><td>${esc(fmtDate(d.date))}</td>${cats.map((c) => `<td class="n${Array.isArray(d[c]) ? ' multi' : ''}">${show(d[c])}</td>`).join('')}<td>${d.status === 'verified' ? '<span class="hit" title="ยืนยัน 2+ แหล่ง">✓</span>' : badge(d.status)}</td></tr>`).join('')}</tbody>
      </table></div>
    </details>
    <p class="tiny">${market === 'lao' ? 'B. ' : ''}ตารางแยกแต่ละโมเดลอยู่ที่แท็บ <a href="#${market}/models">8 โมเดล</a></p>`;
}

async function viewModels() {
  const p = await load('latest');
  if (!p) return '<p class="empty">ยังไม่มีคำทำนาย</p>';
  const cats = await catsOf();
  const w = p.ensemble.weights;
  const used = new Set(p.ensemble.used);
  const head = `<h1>${market === 'lao' ? 'B. ' : ''}ผลแยก 8 โมเดล</h1><p class="sub">งวด${esc(fmtDate(p.target.date))} ทุกโมเดลเห็นเฉพาะข้อมูลก่อนงวดนี้</p>`;
  const table = `<div class="scroll"><table class="tbl">
    <thead><tr><th>โมเดล</th>${cats.map((c) => `<th>${CAT_TH[c]}</th>`).join('')}<th>น้ำหนัก</th></tr></thead>
    <tbody>
      ${p.models.map((m) => `<tr><td><b>${esc(m.id)}</b> ${esc(m.name)}</td>${cats.map((c) => `<td class="n">${show(m.picks[c])}</td>`).join('')}<td>${used.has(m.id) ? esc(w[m.id]) : '0'}</td></tr>`).join('')}
      <tr><td><b>R8</b> Opposite</td>${cats.map((c) => `<td class="n">${show(p.opposite[c])}</td>`).join('')}<td>จากชุดสรุป</td></tr>
    </tbody></table></div>`;
  const details = p.models.map((m) => `
    <details class="model">
      <summary><span class="id">${esc(m.id)}</span><span>${esc(m.name)}</span><span class="w">${used.has(m.id) ? `น้ำหนัก ${esc(w[m.id])}` : 'ไม่นำมาคิดคะแนน'}</span></summary>
      <dl>
        <dt>ข้อมูลที่ใช้</dt><dd>${esc(m.data)}</dd>
        <dt>กติกา</dt><dd>${esc(m.rule)}</dd>
        <dt>ข้อจำกัด</dt><dd>${esc(m.limits)}</dd>
        ${modelStats(m)}
      </dl>
    </details>`).join('');
  return head + table + '<h2>รายละเอียดแต่ละโมเดล</h2>' + details;
}

function modelStats(m) {
  const s = m.stats || {};
  const dd = (t, v) => `<dt>${esc(t)}</dt><dd>${v}</dd>`;
  const list = (a) => (a && a.length ? esc(a.join(', ')) : '–');
  const reps = (a) => (a && a.length ? a.slice(0, 8).map((r) => `${esc(r.num)}×${r.times}`).join(', ') : 'ไม่มี');
  // Older Lao files store repeats as top3Repeats/bottom2Repeats; newer ones as repeats[cat].
  const repsOf = (o) => o.repeats || { top3: o.top3Repeats, bottom2: o.bottom2Repeats };
  const repLines = (o) => Object.entries(repsOf(o)).filter(([, v]) => v).map(([c, v]) => `${CAT_TH[c]}ซ้ำ ${reps(v)}`).join('<br>');
  switch (m.id) {
    case 'R1': return s.windows.map((w) => dd(`${w.window} งวด`, `ซ้ำ ${list(w.repeated)} · หาย ${list(w.missing)} · กลับมา ${list(w.returning)}`)).join('')
      + s.positionChanges.map((p) => dd(`การเปลี่ยน ${CAT_TH[p.field]}`, p.changes.map((c) => `<div class="n">${esc(c)}</div>`).join(''))).join('');
    case 'R2': return dd('เลขซ้ำ', repLines(s)) + dd('ไม่เคยออก', s.absentByPosition.map((a) => `หลัก${esc(a.pos)}: ${list(a.digits)}`).join('<br>'));
    case 'R3': return dd('แหล่ง', s.sources.length ? s.sources.map((x) => `<a href="${esc(x.url)}" target="_blank" rel="noopener">${esc(x.name)}</a>${x.copies.length ? ` (ซ้ำกับ ${esc(x.copies.join(', '))})` : ''}`).join('<br>') : 'ยังไม่มี');
    case 'R4': return dd('สัดส่วนเลขทะเบียนในอดีต', s.posShare.map((p) => `หลัก${esc(p.pos)} ${pct(p.share)}`).join(' · ') + ` (ถ้าสุ่มคาดว่า ${pct(s.expectedShare, 0)})`);
    case 'R5': return dd('กติกาที่ได้', s.rules.map(esc).join('<br>'));
    case 'R6': return s.windows.map((w) => dd(`${w.window} งวด (มี ${w.size})`, repLines(w))).join('')
      + dd('สั้นเทียบยาว', s.trend.filter((t) => Math.abs(t.short - t.long) >= 0.04).map((t) => `เลข ${t.digit}: ${pct(t.short, 0)} เทียบ ${pct(t.long, 0)}`).join('<br>') || 'ไม่ต่างกันเกิน 4 จุด');
    case 'R7': return Object.entries(s.leaders).map(([c, pos]) => dd(`เด่นรายหลัก ${CAT_TH[c]}`, pos.map((d) => esc(d.join(' '))).join(' | '))).join('');
    default: return '';
  }
}

async function viewBacktest() {
  const [bt, live] = await Promise.all([load('backtest'), load('live')]);
  if (!bt) return '<p class="empty">ยังไม่มีผล backtest</p>';
  const cats = bt.cats || (await catsOf());
  const order = ['ENSEMBLE', 'R1', 'R2', 'R4', 'R5', 'R6', 'R7', 'RANDOM'];
  const byCat = (c) => bt.summary.filter((r) => r.cat === c).sort((a, b) => order.indexOf(a.model) - order.indexOf(b.model));
  const sigAny = bt.summary.some((r) => r.model !== 'RANDOM' && r.pAdjusted < 0.05);
  const tbl = (c) => `<h3>${CAT_TH[c]} (เลือก ${bt.picksPerModel} ชุด สุ่มคาดว่าถูก ${pct(byCat(c)[0]?.expectedRate ?? 0, 2)})</h3>
    <div class="scroll"><table class="tbl">
      <thead><tr><th>โมเดล</th><th>ถูกตรง</th><th>อัตรา</th><th>เทียบสุ่ม</th><th>p (ปรับแล้ว)</th><th>ตรงตำแหน่งเฉลี่ย</th><th>ตัวเลขร่วม*</th></tr></thead>
      <tbody>${byCat(c).map((r) => `<tr class="${r.model === 'RANDOM' ? 'baseline' : ''}"><td>${esc(MODEL_TH[r.model] || r.model)}</td>
        <td class="n">${r.hits}/${r.tests}</td><td class="n">${pct(r.rate)}</td><td class="n">×${r.vsRandom.toFixed(2)}</td>
        <td class="n">${r.model === 'RANDOM' ? `${r.pValue.toFixed(3)} (ไม่ปรับ)` : r.pAdjusted.toFixed(2)}</td>
        <td class="n">${r.avgPosMatched.toFixed(2)}</td><td class="n">${r.avgCommonDigits.toFixed(2)}</td></tr>`).join('')}</tbody>
    </table></div>`;

  const entries = live?.entries || [];
  const liveAgg = {};
  for (const e of entries) for (const [m, sc] of Object.entries(e.scores)) for (const [c, s] of Object.entries(sc)) {
    if (!s) continue; const k = `${m}|${c}`; (liveAgg[k] ||= { m, c, t: 0, h: 0 }); liveAgg[k].t++; liveAgg[k].h += s.exact ? 1 : 0;
  }
  const liveRows = Object.values(liveAgg);

  return `<h1>Backtest</h1>
    <div class="callout">${sigAny ? 'มีบางรายการดีกว่าสุ่มหลังปรับค่า p แล้ว แต่ต้องรอยืนยันจากคำทำนายที่ล็อกจริงก่อนจะเชื่อ' : `หลังทดสอบ ${bt.tests} งวด ไม่มีโมเดลใดดีกว่าการสุ่มอย่างมีนัยสำคัญ (ปรับค่า p สำหรับการทดสอบ ${bt.comparisons} รายการพร้อมกัน) ลองดูแถว "สุ่ม" ซึ่งบางหมวดก็ได้อัตราสูงเพราะโชค`}</div>
    <p class="sub">${esc(bt.method)} ช่วง ${esc(fmtDate(bt.from))} ถึง ${esc(fmtDate(bt.to))}</p>
    ${cats.map(tbl).join('')}
    <p class="sub">* จำนวนตัวเลขที่ตรงกับผลโดยไม่สนตำแหน่ง ของชุดแรกในงวดที่ไม่ถูกตรง R3 ไม่อยู่ในตารางเพราะไม่มีเลขแนวทางย้อนหลัง${cats.includes('bottom3') ? ' 3 ตัวล่างออก 4 ชุดต่องวด จึงมีโอกาสถูกสูงกว่า 3 ตัวบน' : ''}</p>

    <h2>ผลจริงของคำทำนายที่ล็อกไว้</h2>
    ${entries.length ? `<p class="sub">${entries.length} งวดที่ล็อกก่อนผลออก ตัวเลขคือ ถูกตรง/จำนวนงวด</p>
    <div class="scroll tight"><table class="tbl compact"><thead><tr><th>โมเดล</th>${cats.map((c) => `<th>${CAT_SHORT[c]}</th>`).join('')}</tr></thead><tbody>
      ${['ENSEMBLE', 'OPPOSITE', 'R1', 'R2', 'R3', 'R4', 'R5', 'R6', 'R7'].filter((m) => liveRows.some((r) => r.m === m)).map((m) => `<tr><td>${esc(MODEL_TH[m] || m)}</td>${cats.map((c) => { const r = liveAgg[`${m}|${c}`]; return `<td class="n">${r ? `${r.h}/${r.t}` : '–'}</td>`; }).join('')}</tr>`).join('')}
    </tbody></table></div>` : '<p class="empty">ยังไม่มีงวดที่ผลออกหลังล็อกคำทำนาย ตัวเลขจริงจะเริ่มสะสมหลังงวดแรก</p>'}`;
}

async function viewHistory() {
  const r = await load('results');
  if (!r) return '<p class="empty">ไม่มีข้อมูล</p>';
  const cats = await catsOf();
  return `<h1>ผลย้อนหลัง</h1>
    <p class="sub">${r.draws.length} งวด เรียงจากล่าสุด</p>
    <div class="scroll"><table class="tbl compact">
      <thead><tr><th>งวด</th>${cats.map((c) => `<th>${CAT_SHORT[c]}</th>`).join('')}<th>สถานะ</th><th>แต่ละแหล่ง</th></tr></thead>
      <tbody>${r.draws.map((d) => `<tr><td>${esc(fmtDate(d.date))}</td>
        ${cats.map((c) => `<td class="n${Array.isArray(d[c]) ? ' multi' : ''}">${show(d[c])}</td>`).join('')}
        <td>${badge(d.status)}</td>
        <td class="sub">${Object.entries(d.sources).map(([s, v]) => `${esc(r.sources[s]?.name || s)}: ${esc(v)}`).join('<br>')}</td></tr>`).join('')}</tbody>
    </table></div>`;
}

async function viewQuality() {
  const [r, changes] = await Promise.all([load('results'), load('changes')]);
  if (!r) return '<p class="empty">ไม่มีข้อมูล</p>';
  const c = r.counts;
  const bad = r.draws.filter((d) => ['majority', 'conflict', 'suspect'].includes(d.status));
  const note = market === 'lao'
    ? 'Victory Gold Arena อ้างอิง LottoTH จึงนับเป็นแหล่งเดียวกัน ไม่ใช้ยืนยันซ้ำ'
    : 'งวดย้อนหลังมาจากคลัง thai-lotto-archive ซึ่งรวบรวมจาก sanook และ kapook ส่วนงวดใหม่จะตรวจทานกับ LottoTH (เฉพาะ 3 ตัวบนและ 2 ตัวล่าง)';
  return `<h1>คุณภาพข้อมูล</h1>
    <ul class="notes">
      <li>${c.verified || 0} งวดยืนยันจากแหล่งอิสระ 2 แหล่งขึ้นไป</li>
      <li>${c.single || 0} งวดมีแหล่งเดียว ใช้ได้แต่ยังไม่ได้ตรวจทาน</li>
      <li>${c.majority || 0} งวดแหล่งไม่ตรงกัน ใช้ค่าที่แหล่งส่วนใหญ่ยืนยัน</li>
      <li>${(c.conflict || 0) + (c.suspect || 0)} งวดขัดกันหรือน่าสงสัย ตัดออกจากการวิเคราะห์</li>
    </ul>
    <p class="sub">${note}</p>
    <h2>งวดที่ต้องดู</h2>
    ${bad.length ? bad.map((d) => `<h3>${esc(fmtDate(d.date))} ${badge(d.status)}</h3><ul class="notes">${d.issues.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>`).join('') : '<p class="empty">ไม่มี</p>'}
    <h2>แหล่งที่แก้ข้อมูลภายหลัง</h2>
    ${changes && changes.length ? `<ul class="notes">${changes.slice(-50).reverse().map((x) => `<li>${esc(r.sources[x.source]?.name || x.source)} งวด ${esc(fmtDate(x.date))}: ${esc(JSON.stringify(x.before))} เป็น ${esc(JSON.stringify(x.after))}</li>`).join('')}</ul>` : '<p class="sub">ยังไม่พบ</p>'}`;
}

async function viewArchive() {
  const idx = await load('predictions');
  const r = await load('results');
  const cats = await catsOf();
  const list = idx?.entries || [];
  const close = r?.market?.close || '20:15';
  return `<h1>คำทำนายที่ล็อกไว้</h1>
    <p>ทุกไฟล์ถูก commit ลง GitHub ก่อนผลออก เวลา commit และรหัสตรวจสอบแก้ย้อนหลังไม่ได้ ระบบนับผลเฉพาะไฟล์ที่ล็อกก่อน ${esc(close)} น. ของวันออกผล</p>
    ${list.length ? `<div class="scroll tight"><table class="tbl compact"><thead><tr><th>งวด</th><th>ล็อกเมื่อ</th><th>ผล</th><th>ชุดสรุป</th><th>ไฟล์</th></tr></thead><tbody>
      ${list.map((e) => {
        const s = e.scores?.ENSEMBLE;
        const res = e.actual ? `${esc(e.actual.top3)}/${esc(e.actual.bottom2)}${e.drawDate && e.drawDate !== e.date ? `<br><span class="sub">ออก ${esc(fmtDate(e.drawDate))}</span>` : ''}` : badge(e.status);
        const hit = s ? cats.map((c) => `<span class="${s[c]?.exact ? 'hit' : 'miss'}">${CAT_TH[c]} ${s[c]?.exact ? 'ถูก' : 'ไม่ถูก'}</span>`).join('<br>') : '–';
        return `<tr><td>${esc(fmtDate(e.date))}</td><td>${esc(fmtTime(e.lockedAt))}${e.onTime ? '' : '<br><span class="badge b-conflict">ล็อกช้า ไม่นับ</span>'}</td><td class="n">${res}</td><td>${hit}</td><td><a href="${M().base}/predictions/${esc(e.date)}.json">${esc(e.hash)}</a></td></tr>`;
      }).join('')}
    </tbody></table></div>` : '<p class="empty">ยังไม่มี</p>'}`;
}

const VIEWS = { predict: viewPredict, models: viewModels, backtest: viewBacktest, history: viewHistory, quality: viewQuality, archive: viewArchive };

async function route() {
  // #lao/predict, #thai/backtest … (old links like #predict open หวยลาว)
  const parts = location.hash.slice(1).split('/');
  const mk = MARKETS[parts[0]] ? parts[0] : 'lao';
  const v = MARKETS[parts[0]] ? parts[1] : parts[0];
  const view = VIEWS[v] ? v : 'predict';
  market = mk;
  document.querySelectorAll('.markets a').forEach((a) => {
    a.href = `#${a.dataset.market}/${view}`;
    if (a.dataset.market === mk) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  });
  document.querySelectorAll('.tabs a').forEach((a) => {
    a.href = `#${mk}/${a.dataset.view}`;
    if (a.dataset.view === view) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  });
  document.getElementById('legal').hidden = mk !== 'lao';
  try { $app.innerHTML = await VIEWS[view](); } catch (e) { $app.innerHTML = `<p class="empty">แสดงหน้านี้ไม่ได้: ${esc(e.message)}</p>`; }
  const r = await load('results');
  document.getElementById('built').textContent = r ? `อัปเดตข้อมูล ${fmtTime(r.builtAt)}` : '';
}

window.addEventListener('hashchange', () => { route(); window.scrollTo(0, 0); });
route();
