'use strict';

const CAT_TH = { top3: '3 ตัวบน', top2: '2 ตัวบน', bottom2: '2 ตัวล่าง' };
const STATUS_TH = {
  verified: 'ยืนยัน 2+ แหล่ง', single: 'แหล่งเดียว', majority: 'เสียงข้างมาก',
  conflict: 'ขัดกัน', suspect: 'น่าสงสัย', no_draw: 'งดออกผล', pending: 'รอผล',
};
const MODEL_TH = { ENSEMBLE: 'ชุดสรุป', RANDOM: 'สุ่ม (ตัวเทียบ)', OPPOSITE: 'R8 คู่ตรงข้าม' };

const $app = document.getElementById('app');
const cache = {};
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pct = (x, d = 1) => `${(x * 100).toFixed(d)}%`;

const fmtDate = (iso) => new Intl.DateTimeFormat('th-TH', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${iso}T00:00:00Z`));
const fmtTime = (iso) => new Intl.DateTimeFormat('th-TH', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Bangkok' }).format(new Date(iso));

async function load(name) {
  if (!cache[name]) cache[name] = fetch(`data/${name}.json`, { cache: 'no-cache' }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  return cache[name];
}

const badge = (s) => `<span class="badge b-${esc(s)}">${esc(STATUS_TH[s] || s)}</span>`;
const nums = (list, small) => `<div class="nums${small ? ' small' : ''}">${(list || []).map((n, i) => `<span class="num${i === 0 && !small ? ' lead' : ''}">${esc(n)}</span>`).join('') || '<span class="sub">ไม่มี</span>'}</div>`;

// Bangkok "now" as { date: 'YYYY-MM-DD', minutes, weekday }
function bkkNow() {
  const t = new Date(Date.now() + 7 * 3600 * 1000);
  return { date: t.toISOString().slice(0, 10), minutes: t.getUTCHours() * 60 + t.getUTCMinutes(), weekday: t.getUTCDay() };
}

// Latest drawn result + how that day's locked set did
async function latestResultBlock(res) {
  const now = bkkNow();
  const isDrawDay = now.weekday >= 1 && now.weekday <= 5;
  const todayRow = res.draws.find((d) => d.date === now.date);
  let waiting = '';
  if (isDrawDay && !todayRow) {
    waiting = now.minutes < 20 * 60 + 30
      ? `<p class="sub">งวดวันนี้ออก 20:30 น. ระบบดึงผลรอบ 20:38, 20:52, 21:23 และ 22:07 น.</p>`
      : `<p class="waiting">รอผลงวดวันนี้ ระบบจะดึงผลอัตโนมัติภายใน 22:07 น. ลองรีเฟรชหน้านี้อีกครั้ง</p>`;
  }
  const d = res.draws.find((x) => x.usable || x.status === 'no_draw');
  if (!d) return waiting;
  if (d.status === 'no_draw') return `${waiting}<section class="result"><h2>ผลงวด${esc(fmtDate(d.date))}</h2><p>งดออกผล</p></section>`;

  const pred = await load(`predictions/${d.date}`);
  const actual = { top3: d.top3, top2: d.top2, bottom2: d.bottom2 };
  const cmp = (c) => {
    if (!pred) return '';
    const picks = pred.final[c] || [];
    const hit = picks.includes(actual[c]);
    return `<div class="cmp"><span class="${hit ? 'hit' : 'miss'}">${hit ? 'ชุดที่ล็อกไว้ถูก' : 'ชุดที่ล็อกไว้ไม่ถูก'}</span>
      ${picks.map((n) => `<span class="pick${n === actual[c] ? ' on' : ''}">${esc(n)}</span>`).join('')}</div>`;
  };
  return `${waiting}
    <section class="result" aria-label="ผลงวดล่าสุด">
      <h2>ผลงวด${esc(fmtDate(d.date))} ${badge(d.status)}</h2>
      ${d.last4 ? `<p class="sub">เลขท้าย 4 ตัว <b class="n">${esc(d.last4)}</b></p>` : ''}
      <div class="res-grid">
        ${['top3', 'top2', 'bottom2'].map((c) => `<div class="res"><span>${CAT_TH[c]}</span><b>${esc(actual[c])}</b>${cmp(c)}</div>`).join('')}
      </div>
      <p class="sub">ยืนยันจาก ${d.voters.map((s) => esc(res.sources[s]?.name || s)).join(', ') || '–'}${pred ? ` เทียบกับชุดที่ล็อกเมื่อ ${esc(fmtTime(pred.lockedAt))}` : ' (งวดนี้ไม่มีชุดที่ล็อกไว้)'}</p>
    </section>`;
}

// ---------- views ----------
async function viewPredict() {
  const res = await load('results');
  const top = res ? await latestResultBlock(res) : '';
  const p = await load('latest');
  if (!p) return top + '<p class="empty">ยังไม่มีคำทำนาย รัน <code>npm run build</code> หรือรอ GitHub Actions รอบถัดไป</p>';
  const actual = res?.draws.find((d) => d.date === p.target.date && d.usable);
  return `${top}
    <h1>งวดถัดไป ${esc(fmtDate(p.target.date))}</h1>
    <p class="sub">${actual ? `ผลออกแล้ว ${esc(actual.top3)} / ${esc(actual.bottom2)}` : 'ยังไม่ออกผล ออกจันทร์ถึงศุกร์ 20:30 น.'}</p>

    <section class="sealed" aria-label="ชุดเลขสรุปที่ล็อกไว้">
      <span class="seal">ล็อกแล้ว ${esc(fmtTime(p.lockedAt))}</span>
      <div class="row"><span>C · 3 ตัวบน</span>${nums(p.final.top3)}</div>
      <div class="row"><span>D · 2 ตัวบน</span>${nums(p.final.top2)}</div>
      <div class="row"><span>E · 2 ตัวล่าง</span>${nums(p.final.bottom2)}</div>
      <div class="row"><span>F · คู่ตรงข้าม</span>
        <div class="opp">
          ${['top3', 'top2', 'bottom2'].map((c) => `<div><small>${CAT_TH[c]}</small>${nums(p.opposite[c], true)}</div>`).join('')}
        </div>
      </div>
      <div class="lockmeta">
        <span>รหัสตรวจสอบ <code>${esc(p.hash)}</code></span>
        <span>ใช้ข้อมูลถึง ${esc(fmtDate(p.A.dataThrough))}</span>
        <span>คิดคะแนนจาก ${esc(p.ensemble.used.join(', '))}</span>
      </div>
    </section>
    <p class="sub">เลขแรกของแต่ละแถวคือคะแนนรวมสูงสุด คู่ตรงข้ามใช้ 0↔5, 1↔6, 2↔7, 3↔8, 4↔9 กับชุดสรุปเท่านั้น</p>

    <h2>G. จุดที่ควรระวัง</h2>
    <ul class="notes">${p.caveats.map((c) => `<li>${esc(c)}</li>`).join('')}</ul>
    ${p.ensemble.reasons?.length ? `<p class="sub">${p.ensemble.reasons.map(esc).join('<br>')}</p>` : ''}

    <h2>A. ข้อมูลที่ใช้</h2>
    <p>${esc(p.A.draws)} งวดที่ผ่านการตรวจ ถึงงวด${esc(fmtDate(p.A.dataThrough))} จากแหล่ง ${p.A.sources.map((s) => `<a href="${esc(s.url)}" rel="noopener" target="_blank">${esc(s.name)}</a>${s.independent ? '' : ' (สำเนาของ LottoTH)'}`).join(', ')}</p>
    <div class="scroll"><table class="tbl">
      <thead><tr><th>งวด</th><th>3 ตัวบน</th><th>2 ตัวบน</th><th>2 ตัวล่าง</th><th>สถานะ</th></tr></thead>
      <tbody>${p.A.recent.map((d) => `<tr><td>${esc(fmtDate(d.date))}</td><td class="n">${esc(d.top3)}</td><td class="n">${esc(d.top2)}</td><td class="n">${esc(d.bottom2)}</td><td>${badge(d.status)}</td></tr>`).join('')}</tbody>
    </table></div>
    <p class="sub">B. ตารางแยก 8 โมเดลอยู่ที่แท็บ <a href="#models">8 โมเดล</a></p>`;
}

async function viewModels() {
  const p = await load('latest');
  if (!p) return '<p class="empty">ยังไม่มีคำทำนาย</p>';
  const w = p.ensemble.weights;
  const used = new Set(p.ensemble.used);
  const head = `<h1>B. ผลแยก 8 โมเดล</h1><p class="sub">งวด${esc(fmtDate(p.target.date))} ทุกโมเดลเห็นเฉพาะข้อมูลก่อนงวดนี้</p>`;
  const table = `<div class="scroll"><table class="tbl">
    <thead><tr><th>โมเดล</th><th>3 ตัวบน</th><th>2 ตัวบน</th><th>2 ตัวล่าง</th><th>น้ำหนัก</th></tr></thead>
    <tbody>
      ${p.models.map((m) => `<tr><td><b>${esc(m.id)}</b> ${esc(m.name)}</td>
        <td class="n">${esc((m.picks.top3 || []).join(' ') || '–')}</td>
        <td class="n">${esc((m.picks.top2 || []).join(' ') || '–')}</td>
        <td class="n">${esc((m.picks.bottom2 || []).join(' ') || '–')}</td>
        <td>${used.has(m.id) ? esc(w[m.id]) : '0'}</td></tr>`).join('')}
      <tr><td><b>R8</b> Opposite</td><td class="n">${esc(p.opposite.top3.join(' '))}</td><td class="n">${esc(p.opposite.top2.join(' '))}</td><td class="n">${esc(p.opposite.bottom2.join(' '))}</td><td>จากชุดสรุป</td></tr>
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
  switch (m.id) {
    case 'R1': return s.windows.map((w) => dd(`${w.window} งวด`, `ซ้ำ ${list(w.repeated)} · หาย ${list(w.missing)} · กลับมา ${list(w.returning)}`)).join('')
      + s.positionChanges.map((p) => dd(`การเปลี่ยน ${CAT_TH[p.field]}`, p.changes.map((c) => `<div class="n">${esc(c)}</div>`).join(''))).join('');
    case 'R2': return dd('3 ตัวบนซ้ำ', reps(s.top3Repeats)) + dd('2 ตัวล่างซ้ำ', reps(s.bottom2Repeats)) + dd('ไม่เคยออก', s.absentByPosition.map((a) => `หลัก${esc(a.pos)}: ${list(a.digits)}`).join('<br>'));
    case 'R3': return dd('แหล่ง', s.sources.length ? s.sources.map((x) => `<a href="${esc(x.url)}" target="_blank" rel="noopener">${esc(x.name)}</a>${x.copies.length ? ` (ซ้ำกับ ${esc(x.copies.join(', '))})` : ''}`).join('<br>') : 'ยังไม่มี เพิ่มได้ที่ data/tips/');
    case 'R4': return dd('สัดส่วนเลขทะเบียนในอดีต', s.posShare.map((p) => `หลัก${esc(p.pos)} ${pct(p.share)}`).join(' · ') + ` (ถ้าสุ่มคาดว่า ${pct(s.expectedShare, 0)})`);
    case 'R5': return dd('กติกาที่ได้', s.rules.map(esc).join('<br>'));
    case 'R6': return s.windows.map((w) => dd(`${w.window} งวด (มี ${w.size})`, `3 ตัวบนซ้ำ ${reps(w.top3Repeats)}<br>2 ตัวล่างซ้ำ ${reps(w.bottom2Repeats)}`)).join('')
      + dd('สั้นเทียบยาว', s.trend.filter((t) => Math.abs(t.short - t.long) >= 0.04).map((t) => `เลข ${t.digit}: ${pct(t.short, 0)} เทียบ ${pct(t.long, 0)}`).join('<br>') || 'ไม่ต่างกันเกิน 4 จุด');
    case 'R7': return Object.entries(s.leaders).map(([c, pos]) => dd(`เด่นรายหลัก ${CAT_TH[c]}`, pos.map((d) => esc(d.join(' '))).join(' | '))).join('');
    default: return '';
  }
}

async function viewBacktest() {
  const [bt, live] = await Promise.all([load('backtest'), load('live')]);
  if (!bt) return '<p class="empty">ยังไม่มีผล backtest</p>';
  const order = ['ENSEMBLE', 'R1', 'R2', 'R4', 'R5', 'R6', 'R7', 'RANDOM'];
  const byCat = (c) => bt.summary.filter((r) => r.cat === c).sort((a, b) => order.indexOf(a.model) - order.indexOf(b.model));
  const sigAny = bt.summary.some((r) => r.model !== 'RANDOM' && r.pAdjusted < 0.05);
  const tbl = (c) => `<h3>${CAT_TH[c]} (เลือก ${bt.picksPerModel} ชุด สุ่มคาดว่าถูก ${pct(byCat(c)[0]?.expectedRate ?? 0)})</h3>
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
    ${['top3', 'top2', 'bottom2'].map(tbl).join('')}
    <p class="sub">* จำนวนตัวเลขที่ตรงกับผลโดยไม่สนตำแหน่ง ของชุดแรกในงวดที่ไม่ถูกตรง ใช้แยก "มีเลขร่วม" ออกจาก "ถูกตรง" R3 ไม่อยู่ในตารางเพราะไม่มีเลขแนวทางย้อนหลัง</p>

    <h2>ผลจริงของคำทำนายที่ล็อกไว้</h2>
    ${entries.length ? `<p class="sub">${entries.length} งวดที่ล็อกก่อนผลออก ตัวเลขคือ ถูกตรง/จำนวนงวด</p>
    <table class="tbl"><thead><tr><th>โมเดล</th>${['top3', 'top2', 'bottom2'].map((c) => `<th>${CAT_TH[c]}</th>`).join('')}</tr></thead><tbody>
      ${['ENSEMBLE', 'OPPOSITE', 'R1', 'R2', 'R3', 'R4', 'R5', 'R6', 'R7'].filter((m) => liveRows.some((r) => r.m === m)).map((m) => `<tr><td>${esc(MODEL_TH[m] || m)}</td>${['top3', 'top2', 'bottom2'].map((c) => { const r = liveAgg[`${m}|${c}`]; return `<td class="n">${r ? `${r.h}/${r.t}` : '–'}</td>`; }).join('')}</tr>`).join('')}
    </tbody></table>` : '<p class="empty">ยังไม่มีงวดที่ผลออกหลังล็อกคำทำนาย ตัวเลขจริงจะเริ่มสะสมหลังงวดแรก</p>'}`;
}

async function viewHistory() {
  const r = await load('results');
  if (!r) return '<p class="empty">ไม่มีข้อมูล</p>';
  return `<h1>ผลย้อนหลัง</h1>
    <p class="sub">${r.draws.length} งวด เรียงจากล่าสุด แสดงค่าจากแต่ละแหล่งเพื่อเทียบ</p>
    <div class="scroll"><table class="tbl">
      <thead><tr><th>งวด</th><th>3 ตัวบน</th><th>2 ตัวบน</th><th>2 ตัวล่าง</th><th>สถานะ</th><th>แต่ละแหล่ง</th></tr></thead>
      <tbody>${r.draws.map((d) => `<tr><td>${esc(fmtDate(d.date))}</td>
        <td class="n">${esc(d.top3 || '–')}</td><td class="n">${esc(d.top2 || '–')}</td><td class="n">${esc(d.bottom2 || '–')}</td>
        <td>${badge(d.status)}</td>
        <td class="sub">${Object.entries(d.sources).map(([s, v]) => `${esc(r.sources[s]?.name || s)}: ${esc(v)}`).join('<br>')}</td></tr>`).join('')}</tbody>
    </table></div>`;
}

async function viewQuality() {
  const [r, changes] = await Promise.all([load('results'), load('changes')]);
  if (!r) return '<p class="empty">ไม่มีข้อมูล</p>';
  const c = r.counts;
  const bad = r.draws.filter((d) => ['majority', 'conflict', 'suspect'].includes(d.status));
  return `<h1>คุณภาพข้อมูล</h1>
    <ul class="notes">
      <li>${c.verified || 0} งวดยืนยันจากแหล่งอิสระ 2 แหล่งขึ้นไป</li>
      <li>${c.single || 0} งวดมีแหล่งเดียว ใช้ได้แต่ยังไม่ได้ตรวจทาน</li>
      <li>${c.majority || 0} งวดแหล่งไม่ตรงกัน ใช้ค่าที่แหล่งส่วนใหญ่ยืนยัน</li>
      <li>${(c.conflict || 0) + (c.suspect || 0)} งวดขัดกันหรือน่าสงสัย ตัดออกจากการวิเคราะห์</li>
    </ul>
    <p class="sub">Victory Gold Arena อ้างอิง LottoTH จึงนับเป็นแหล่งเดียวกัน ไม่ใช้ยืนยันซ้ำ</p>
    <h2>งวดที่ต้องดู</h2>
    ${bad.length ? bad.map((d) => `<h3>${esc(fmtDate(d.date))} ${badge(d.status)}</h3><ul class="notes">${d.issues.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>`).join('') : '<p class="empty">ไม่มี</p>'}
    <h2>แหล่งที่แก้ข้อมูลภายหลัง</h2>
    ${changes && changes.length ? `<ul class="notes">${changes.slice(-50).reverse().map((x) => `<li>${esc(r.sources[x.source]?.name || x.source)} งวด ${esc(fmtDate(x.date))}: ${esc(JSON.stringify(x.before))} เป็น ${esc(JSON.stringify(x.after))}</li>`).join('')}</ul>` : '<p class="sub">ยังไม่พบ</p>'}`;
}

async function viewArchive() {
  const idx = await load('predictions');
  const list = idx?.entries || [];
  return `<h1>คำทำนายที่ล็อกไว้</h1>
    <p>ทุกไฟล์ถูก commit ลง GitHub ก่อนผลออก เวลา commit และรหัสตรวจสอบแก้ย้อนหลังไม่ได้ ระบบนับผลเฉพาะไฟล์ที่ล็อกก่อน 20:15 น.</p>
    ${list.length ? `<div class="scroll"><table class="tbl"><thead><tr><th>งวด</th><th>ล็อกเมื่อ</th><th>ผล</th><th>ชุดสรุป</th><th>ไฟล์</th></tr></thead><tbody>
      ${list.map((e) => {
        const s = e.scores?.ENSEMBLE;
        const res = e.actual ? `${esc(e.actual.top3)}/${esc(e.actual.bottom2)}` : badge(e.status);
        const hit = s ? ['top3', 'top2', 'bottom2'].map((c) => `<span class="${s[c]?.exact ? 'hit' : 'miss'}">${CAT_TH[c]} ${s[c]?.exact ? 'ถูก' : 'ไม่ถูก'}</span>`).join('<br>') : '–';
        return `<tr><td>${esc(fmtDate(e.date))}</td><td>${esc(fmtTime(e.lockedAt))}${e.onTime ? '' : '<br><span class="badge b-conflict">ล็อกช้า ไม่นับ</span>'}</td><td class="n">${res}</td><td>${hit}</td><td><a href="data/predictions/${esc(e.date)}.json">${esc(e.hash)}</a></td></tr>`;
      }).join('')}
    </tbody></table></div>` : '<p class="empty">ยังไม่มี</p>'}`;
}

const VIEWS = { predict: viewPredict, models: viewModels, backtest: viewBacktest, history: viewHistory, quality: viewQuality, archive: viewArchive };

async function route() {
  const v = (location.hash.slice(1) || 'predict');
  const view = VIEWS[v] ? v : 'predict';
  document.querySelectorAll('.tabs a').forEach((a) => {
    if (a.dataset.view === view) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  });
  try { $app.innerHTML = await VIEWS[view](); } catch (e) { $app.innerHTML = `<p class="empty">แสดงหน้านี้ไม่ได้: ${esc(e.message)}</p>`; }
  const r = await load('results');
  if (r) document.getElementById('built').textContent = `อัปเดตข้อมูล ${fmtTime(r.builtAt)}`;
}

window.addEventListener('hashchange', () => { route(); window.scrollTo(0, 0); });
route();
