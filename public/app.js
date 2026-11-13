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
const TH_MON = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
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
// Put files returned by the API into the cache so the page shows them right away,
// before Vercel has redeployed the static copies.
function seed(mk, files) {
  const base = MARKETS[mk].base;
  for (const [name, data] of Object.entries(files || {})) if (data) cache[`${base}/${name}.json`] = Promise.resolve(data);
  if (files?.latest?.target?.date) cache[`${base}/predictions/${files.latest.target.date}.json`] = Promise.resolve(files.latest);
}

const refreshed = {};
function setSync(text) {
  const el = document.getElementById('sync');
  if (!el) return;
  el.textContent = text || '';
  el.hidden = !text;
}
// Once per market per visit: ask the server to pick up any new result.
async function refreshMarket(mk) {
  if (refreshed[mk]) return;
  refreshed[mk] = true;
  setSync('กำลังตรวจผลล่าสุด…');
  try {
    const r = await fetch(`/api/refresh?market=${mk}`).then((x) => x.json());
    if (r.ok) {
      seed(mk, r.files);
      setSync('');
      if (market === mk && currentView !== 'dream') render();
    } else {
      setSync(r.code === 'NO_TOKEN' ? '' : `ตรวจผลล่าสุดไม่สำเร็จ: ${r.error || ''}`);
    }
  } catch {
    setSync(''); // offline or no API: the saved data is still shown
  }
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

// Running score of the locked summary set vs. what random picks would expect.
async function scoreLine(cats) {
  const live = await load('live');
  const entries = (live?.entries || []).filter((e) => e.scores?.ENSEMBLE);
  if (!entries.length) return '';
  const width = { top3: 3, bottom3: 3, top2: 2, bottom2: 2 };
  const cells = cats.map((c) => {
    let hits = 0; let n = 0; let exp = 0;
    for (const e of entries) {
      const s = e.scores.ENSEMBLE[c];
      if (!s) continue;
      n++; hits += s.exact ? 1 : 0;
      exp += 1 - (1 - (s.n || 5) / 10 ** width[c]) ** (s.k || 1);
    }
    return `<div><small>${CAT_TH[c]}</small><b class="${hits ? 'hit' : ''}">${hits}<span>/${n}</span></b><i>สุ่ม ${exp < 0.1 ? exp.toFixed(2) : exp.toFixed(1)}</i></div>`;
  }).join('');
  return `<section class="score" aria-label="คะแนนสะสม">
      <p class="sc-head">ผลจริงของชุดสรุปที่ล็อกไว้ <span>${entries.length} งวด · ถูก/งวด</span></p>
      <div class="sc-grid" style="grid-template-columns:repeat(${cats.length},1fr)">${cells}</div>
    </section>`;
}

// Earlier locked predictions (newest first), each with its result if known.
async function previousBlock(latestDate, cats) {
  const idx = await load('predictions');
  const list = (idx?.entries || []).filter((e) => e.date !== latestDate).slice(0, 10);
  if (!list.length) return '';
  const preds = await Promise.all(list.map((e) => load(`predictions/${e.date}`)));
  const cards = list.map((e, i) => {
    const pr = preds[i];
    if (!pr) return '';
    const a = e.actual;
    const hits = a ? cats.filter((c) => e.scores?.ENSEMBLE?.[c]?.exact).length : 0;
    const head = `<div class="p-head"><b>งวด ${esc(fmtDate(e.date))}</b>${a
      ? `<span class="p-res">ผล ${esc(a.top3)} / ${esc(a.bottom2)}</span><span class="${hits ? 'hit' : 'miss'}">${hits ? `ถูก ${hits} หมวด` : 'ไม่ถูก'}</span>`
      : badge(e.status === 'no_draw' ? 'no_draw' : 'pending')}</div>`;
    const rows = cats.map((c) => (a
      ? pickRow(CAT_TH[c], pr.final[c] || [], vals(a[c]))
      : `<div class="cmp-row"><span class="lbl">${CAT_TH[c]}</span><span class="mark"></span>${(pr.final[c] || []).map((n) => `<span class="pick">${esc(n)}</span>`).join('')}</div>`)).join('');
    return `<div class="prev">${head}${rows}<p class="tiny">ล็อก ${esc(fmtTime(e.lockedAt))}${e.onTime ? '' : ' · ล็อกช้า ไม่นับ'}</p></div>`;
  }).join('');
  return `<details class="fold">
      <summary>คำทำนายงวดก่อนหน้า (${list.length})</summary>
      ${cards}
      <p class="tiny">ทั้งหมดดูได้ที่แท็บ <a href="#${market}/archive">คำทำนายที่ล็อก</a></p>
    </details>`;
}

// ---------- views ----------
async function viewPredict() {
  const res = await load('results');
  const cats = await catsOf();
  const p = await load('latest');
  const st = await load('status');
  if (!res) return '<p class="empty">ยังไม่มีข้อมูลบนเว็บ กำลังตรวจผลล่าสุด…</p>';
  const top = await latestResultBlock(res, cats, p);
  const targetDate = st ? st.target?.date : p?.target?.date;
  const locked = st ? st.locked && p?.target?.date === targetDate : !!p;
  const more = `<div class="more">
      <a class="btn" href="#${market}/models">8 โมเดล</a>
      <a class="btn" href="#${market}/backtest">Backtest</a>
      <a class="btn" href="#${market}/archive">คำทำนายที่ล็อกไว้</a>
      <a class="btn" href="#${market}/quality">คุณภาพข้อมูล</a>
      <a class="btn wide" href="#${market}/random">ตรวจความสุ่ม</a>
    </div>`;
  if (!locked) {
    return `${top}${predictCard(st)}
    ${await scoreLine(cats)}
    ${await previousBlock(targetDate, cats)}
    ${more}`;
  }
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

    ${await scoreLine(cats)}
    ${await previousBlock(p.target.date, cats)}

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
    ${more}`;
}

// ---------- predict button ----------
const PIN_KEY = 'lle-pin';
const getPin = () => { try { return localStorage.getItem(PIN_KEY) || ''; } catch { return ''; } };
const setPin = (v) => { try { if (v) localStorage.setItem(PIN_KEY, v); else localStorage.removeItem(PIN_KEY); } catch { /* storage off */ } };

function predictCard(st) {
  if (!st || !st.target) {
    return `<section class="sealed pending"><div class="s-head"><b>งวดถัดไป</b></div><p class="tiny">รอผลงวดล่าสุดเข้าก่อน จึงจะทำนายงวดถัดไปได้</p></section>`;
  }
  const t = st.target.date;
  const closeAt = st.closeAt ? new Date(st.closeAt) : null;
  const head = `<div class="s-head"><b>งวดถัดไป ${esc(fmtDate(t))}</b></div>`;
  if (closeAt && Date.now() > closeAt.getTime()) {
    return `<section class="sealed pending">${head}<p class="tiny">ปิดรับงวดนี้แล้ว (${esc(fmtTime(st.closeAt))}) งวดนี้ไม่ได้ทำนาย</p></section>`;
  }
  const needPin = !getPin();
  return `<section class="sealed pending" id="predictCard">${head}
      <p class="tiny">ยังไม่ได้ทำนายงวดนี้ กดได้ครั้งเดียว ใช้ข้อมูลล่าสุด ณ ตอนกด และแก้ภายหลังไม่ได้${closeAt ? ` · ปิดรับ ${esc(fmtTime(st.closeAt))}` : ''}</p>
      <form id="predictForm" class="pform">
        ${needPin ? '<input id="pin" type="password" inputmode="numeric" autocomplete="current-password" placeholder="PIN" aria-label="PIN" required>' : ''}
        <button type="submit" class="btn primary" id="predictBtn">ทำนายงวดนี้</button>
      </form>
      <p class="tiny perr" id="predictMsg" hidden></p>
    </section>`;
}

function afterPredict() {
  const form = document.getElementById('predictForm');
  if (!form) return;
  form.onsubmit = async (ev) => {
    ev.preventDefault();
    const btn = document.getElementById('predictBtn');
    const msg = document.getElementById('predictMsg');
    const pinInput = document.getElementById('pin');
    const pin = pinInput ? pinInput.value.trim() : getPin();
    const st = await load('status');
    btn.disabled = true; btn.textContent = 'กำลังคำนวณ…'; msg.hidden = true;
    let r;
    try {
      r = await fetch('/api/predict', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ market, pin, target: st?.target?.date }) }).then((x) => x.json());
    } catch {
      r = { ok: false, error: 'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ ลองใหม่อีกครั้ง' };
    }
    if (r.code === 'BAD_PIN') setPin('');
    else if (pin && (r.ok || r.message)) setPin(pin);
    if (r.files) seed(market, r.files);
    if (r.ok) { render(); return; }
    btn.disabled = false; btn.textContent = 'ทำนายงวดนี้';
    msg.textContent = r.error || r.message || 'ทำนายไม่สำเร็จ';
    msg.hidden = false;
    if (r.code === 'BAD_PIN' && !pinInput) render();
  };
}

async function viewModels() {
  const p = await load('latest');
  if (!p) return '<p class="empty">ยังไม่มีคำทำนาย</p>';
  const cats = await catsOf();
  const w = p.ensemble.weights;
  const used = new Set(p.ensemble.used);
  const head = `<a class="back" href="#${market}/predict">‹ กลับไปคำทำนาย</a><h1>ผลแยก 8 โมเดล</h1><p class="sub">งวด${esc(fmtDate(p.target.date))} ทุกโมเดลเห็นเฉพาะข้อมูลก่อนงวดนี้</p>`;
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

  return `<a class="back" href="#${market}/predict">‹ กลับไปคำทำนาย</a><h1>Backtest</h1>
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
  const dShort = (iso) => { const t = new Date(`${iso}T00:00:00Z`); return `${t.getUTCDate()} ${TH_MON[t.getUTCMonth()]} ${String(t.getUTCFullYear() + 543).slice(-2)}`; };
  const STATUS_ICON = { verified: '<span class="hit" title="ยืนยัน 2+ แหล่ง">✓</span>', single: '' };
  const cell = (d, c) => (Array.isArray(d[c])
    ? `<td class="n m3">${d[c].map(esc).reduce((acc, x, i) => acc + (i && i % 2 === 0 ? '<br>' : i ? ' ' : '') + x, '')}</td>`
    : `<td class="n">${esc(d[c] ?? '–')}</td>`);
  return `<h1>ผลย้อนหลัง</h1>
    <p class="sub">${r.draws.length} งวด เรียงจากล่าสุด · ✓ ยืนยันจาก 2 แหล่งขึ้นไป</p>
    <table class="tbl hist">
      <thead><tr><th>งวด</th>${cats.map((c) => `<th>${CAT_SHORT[c]}</th>`).join('')}<th></th></tr></thead>
      <tbody>${r.draws.map((d) => `<tr>
        <td class="dt">${esc(dShort(d.date))}<small>${esc(d.weekdayTh || '')}</small></td>
        ${d.usable ? cats.map((c) => cell(d, c)).join('') : `<td colspan="${cats.length}" class="sub">${esc(STATUS_TH[d.status] || d.status)}</td>`}
        <td class="st">${d.status in STATUS_ICON ? STATUS_ICON[d.status] : d.usable ? badge(d.status) : ''}</td></tr>`).join('')}</tbody>
    </table>
    <p class="tiny">ค่าจากแต่ละแหล่งของงวดที่ไม่ตรงกัน ดูได้ที่ <a href="#${market}/quality">คุณภาพข้อมูล</a></p>`;
}

async function viewQuality() {
  const [r, changes] = await Promise.all([load('results'), load('changes')]);
  if (!r) return '<p class="empty">ไม่มีข้อมูล</p>';
  const c = r.counts;
  const bad = r.draws.filter((d) => ['majority', 'conflict', 'suspect'].includes(d.status));
  const note = market === 'lao'
    ? 'Victory Gold Arena อ้างอิง LottoTH จึงนับเป็นแหล่งเดียวกัน ไม่ใช้ยืนยันซ้ำ'
    : 'งวดย้อนหลังมาจากคลัง thai-lotto-archive ซึ่งรวบรวมจาก sanook และ kapook ส่วนงวดใหม่จะตรวจทานกับ LottoTH (เฉพาะ 3 ตัวบนและ 2 ตัวล่าง)';
  return `<a class="back" href="#${market}/predict">‹ กลับไปคำทำนาย</a><h1>คุณภาพข้อมูล</h1>
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
  return `<a class="back" href="#${market}/predict">‹ กลับไปคำทำนาย</a><h1>คำทำนายที่ล็อกไว้</h1>
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

// ---------- ฝัน/พบเจอ: text → numbers from public/dreams.json ----------
let DREAMS = null;
async function loadDreams() {
  if (!DREAMS) DREAMS = fetch('dreams.json', { cache: 'no-cache' }).then((r) => (r.ok ? r.json() : { items: [] })).catch(() => ({ items: [] }));
  return DREAMS;
}
const COMBINING = /[ัิ-ฺ็-๎]/; // Thai vowel/tone marks that continue a syllable
function findWords(text, items) {
  const hits = [];
  for (const it of items) {
    let at = -1; let word = '';
    for (const w of [...it.words].sort((a, b) => b.length - a.length)) {
      let i = text.indexOf(w);
      while (i > -1 && COMBINING.test(text[i + w.length] || '')) i = text.indexOf(w, i + 1);
      if (i > -1 && (at === -1 || i < at)) { at = i; word = w; }
    }
    if (at > -1) hits.push({ ...it, at, word });
  }
  return hits.sort((a, b) => a.at - b.at);
}
const OPP = { 0: 5, 1: 6, 2: 7, 3: 8, 4: 9, 5: 0, 6: 1, 7: 2, 8: 3, 9: 4 };
const DAY_NUM = [1, 2, 3, 4, 5, 6, 7]; // เลขประจำวัน อาทิตย์=1 … เสาร์=7
const DAY_TH = ['อาทิตย์', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์'];

// Break a seen number into the parts people usually read from it.
function readNumber(n) {
  const ds = n.split('').map(Number);
  const cnt = {}; for (const x of ds) cnt[x] = (cnt[x] || 0) + 1;
  const max = Math.max(...Object.values(cnt));
  const lead = max > 1 ? Number(Object.keys(cnt).find((k) => cnt[k] === max)) : ds[ds.length - 1];
  const sum = ds.reduce((x, y) => x + y, 0) % 10;
  return { n, lead, sum, opp: n.split('').map((x) => OPP[x]).join('') };
}

function dreamNumbers(text, items, day = new Date(Date.now() + 7 * 3600 * 1000).getUTCDay()) {
  const toArabic = (t) => t.replace(/[๐-๙]/g, (c) => String('๐๑๒๓๔๕๖๗๘๙'.indexOf(c)));
  const clean = toArabic(text);
  const seen = (clean.match(/\d+/g) || []).filter((n) => n.length >= 2).slice(0, 3).map(readNumber);
  const words = findWords(clean, items);
  const dayDigit = DAY_NUM[day] % 10;
  const two = []; const three = [];
  const add = (arr, n, max = 6) => { if (n && !arr.includes(n) && arr.length < max) arr.push(n); };

  const wordPairs = words.map((w) => w.nums.find((x) => x.length === 2)).filter(Boolean);
  const wordDigits = [...new Set(words.flatMap((w) => w.nums.filter((x) => x.length === 1).map(Number)))];
  // Main digits, in the order people weigh them: the seen number's lead digit,
  // the things in the story, the number's digit sum, then the day.
  const core = [...new Set([...seen.map((r) => r.lead), ...wordDigits, ...seen.map((r) => r.sum), dayDigit])];

  // 2 ตัว
  for (const r of seen) for (const w of wordDigits.slice(0, 2)) add(two, `${r.lead}${w}`);
  for (const pr of wordPairs.slice(0, 2)) add(two, pr);
  for (const r of seen) add(two, `${r.lead}${r.sum}`);
  for (let i = 0; i < core.length; i++) for (let j = 0; j < core.length; j++) if (i !== j) add(two, `${core[i]}${core[j]}`);
  for (const r of seen) add(two, r.n.slice(-2), 8); // the literal number stays, but last

  // 3 ตัว
  for (const r of seen) for (const pr of wordPairs.slice(0, 2)) add(three, `${r.lead}${pr}`);
  for (const r of seen) add(three, `${r.lead}${r.sum}${dayDigit}`);
  for (const pr of wordPairs) for (const d of core) if (!pr.includes(String(d))) add(three, pr + d);
  for (let i = 0; i + 2 < core.length; i++) add(three, core.slice(i, i + 3).join(''));
  for (const r of seen) if (r.n.length >= 3) add(three, r.n.slice(-3), 8);

  // keep the literal number out of the top spot when there is anything else
  const demote = (arr, lits) => { const rest = arr.filter((x) => !lits.includes(x)); const lit = arr.filter((x) => lits.includes(x)); return [...rest.slice(0, 4), ...lit.slice(0, 1), ...rest.slice(4)].slice(0, 5); };
  return {
    seen, words, day, dayDigit,
    two: demote(two, seen.map((r) => r.n.slice(-2))),
    three: demote(three, seen.map((r) => r.n.slice(-3))),
  };
}

const DREAM_KEY = 'dream-log-v1';
const readLog = () => { try { return JSON.parse(localStorage.getItem(DREAM_KEY) || '[]'); } catch { return []; } };
const writeLog = (l) => { try { localStorage.setItem(DREAM_KEY, JSON.stringify(l.slice(0, 30))); } catch { /* storage off */ } };

async function viewDream() {
  const p = await load('latest');
  const target = p?.target?.date;
  return `<h1>ทำนายจากฝันหรือสิ่งที่พบเจอ</h1>
    <p class="sub">พิมพ์ความฝันหรือเหตุการณ์ที่เจอ เช่น "ฝันเห็นงูใหญ่สีทองในวัด" หรือ "คืนนี้นอนห้องพัก 211" ระบบจะแตกตัวเลขที่เห็นเป็นเลขเด่นและผลรวม แล้วผสมกับเลขของสิ่งในเรื่องและเลขประจำวัน</p>
    <form id="dreamForm" class="dream">
      <textarea id="dreamText" rows="4" maxlength="500" placeholder="เล่ารายละเอียดที่นี่" aria-label="รายละเอียดความฝันหรือสิ่งที่พบเจอ"></textarea>
      <button type="submit" class="btn primary">ตีเลข</button>
    </form>
    <div id="dreamOut"></div>
    <div id="dreamLog"></div>
    <p class="tiny">เลขจากฝันมาจากความเชื่อ ไม่ใช่สถิติ ไม่ได้ทดสอบใน Backtest ตารางคำแก้ได้ที่ไฟล์ public/dreams.json${target ? '' : ''}</p>`;
}

function renderDreamOut(res, text, target) {
  const out = document.getElementById('dreamOut');
  if (!res.words.length && !res.seen.length) {
    out.innerHTML = `<p class="waiting">ไม่พบคำที่อยู่ในตาราง ลองใช้คำง่าย ๆ เช่น งู ช้าง พระ ทอง น้ำ รถ เด็ก หรือพิมพ์ตัวเลขที่เห็น</p>`;
    return;
  }
  out.innerHTML = `<section class="sealed dream-res">
      <div class="row"><span>2 ตัว</span>${nums(res.two.slice(0, 5))}</div>
      <div class="row"><span>3 ตัว</span>${nums(res.three.slice(0, 5))}</div>
      <p class="f-title">ที่มาของเลข</p>
      <ul class="notes tight">
        ${res.seen.map((r) => `<li>${esc(r.n)} → เลขเด่น <b class="n">${r.lead}</b> · ผลรวม <b class="n">${r.sum}</b> · คู่ตรงข้าม <b class="n">${esc(r.opp)}</b></li>`).join('')}
        ${res.words.map((w) => `<li>${esc(w.word)}${w.word === w.name ? '' : ` (${esc(w.name)})`} <b class="n">${w.nums.map(esc).join(' ')}</b></li>`).join('')}
        <li>วัน${esc(DAY_TH[res.day])} เลขประจำวัน <b class="n">${res.dayDigit}</b></li>
      </ul>
      ${target ? `<button type="button" id="dreamSave" class="btn">บันทึกไว้ตรวจกับงวด ${esc(fmtDate(target))}</button>` : '<p class="tiny">ปิดรับงวดนี้แล้ว บันทึกได้อีกครั้งเมื่อระบบล็อกงวดถัดไป</p>'}
    </section>`;
  const btn = document.getElementById('dreamSave');
  if (btn) btn.onclick = () => {
    const log = readLog();
    log.unshift({ market, target, text: text.slice(0, 200), two: res.two.slice(0, 5), three: res.three.slice(0, 5), at: new Date().toISOString() });
    writeLog(log);
    btn.textContent = 'บันทึกแล้ว'; btn.disabled = true;
    renderDreamLog();
  };
}

async function renderDreamLog() {
  const el = document.getElementById('dreamLog');
  if (!el) return;
  const log = readLog().filter((e) => e.market === market);
  if (!log.length) { el.innerHTML = ''; return; }
  const res = await load('results');
  const byDate = Object.fromEntries((res?.draws || []).filter((d) => d.usable).map((d) => [d.date, d]));
  el.innerHTML = `<details class="fold" open>
      <summary>ที่บันทึกไว้ (${log.length})</summary>
      ${log.map((e) => {
        const d = byDate[e.target];
        const win2 = d ? [d.top2, d.bottom2] : [];
        const win3 = d ? [d.top3, ...vals(d.bottom3)] : [];
        const hit = d && (e.two.some((n) => win2.includes(n)) || e.three.some((n) => win3.includes(n)));
        return `<div class="prev">
          <div class="p-head"><b>งวด ${esc(fmtDate(e.target))}</b>${d ? `<span class="p-res">ผล ${esc(d.top3)} / ${esc(d.bottom2)}</span><span class="${hit ? 'hit' : 'miss'}">${hit ? 'ถูก' : 'ไม่ถูก'}</span>` : badge('pending')}</div>
          <p class="tiny q">"${esc(e.text)}"</p>
          <div class="cmp-row"><span class="lbl">2 ตัว</span><span class="mark"></span>${e.two.map((n) => `<span class="pick${win2.includes(n) ? ' on' : ''}">${esc(n)}</span>`).join('')}</div>
          <div class="cmp-row"><span class="lbl">3 ตัว</span><span class="mark"></span>${e.three.map((n) => `<span class="pick${win3.includes(n) ? ' on' : ''}">${esc(n)}</span>`).join('')}</div>
        </div>`;
      }).join('')}
      <p class="tiny">เก็บไว้ในเครื่องนี้เท่านั้น 2 ตัวตรวจกับ 2 ตัวบนและล่าง · 3 ตัวตรวจกับ 3 ตัวบน${market === 'thai' ? 'และ 3 ตัวล่าง' : ''} · <a href="#" id="dreamClear">ล้างทั้งหมด</a></p>
    </details>`;
  document.getElementById('dreamClear').onclick = (ev) => {
    ev.preventDefault();
    writeLog(readLog().filter((e) => e.market !== market));
    renderDreamLog();
  };
}

async function afterDream() {
  const form = document.getElementById('dreamForm');
  if (!form) return;
  const dict = await loadDreams();
  form.onsubmit = async (ev) => {
    ev.preventDefault();
    const text = document.getElementById('dreamText').value.trim();
    if (!text) return;
    const st = await load('status');
    const p = await load('latest');
    const res = await load('results');
    const close = res?.market?.close || (market === 'thai' ? '14:00' : '20:15');
    const t = st ? st.target?.date : p?.target?.date;
    const closeAt = st?.closeAt ? new Date(st.closeAt).getTime() : t ? new Date(`${t}T${close}:00+07:00`).getTime() : 0;
    const open = t && Date.now() < closeAt;
    renderDreamOut(dreamNumbers(text, dict.items || []), text, open ? t : null);
  };
  renderDreamLog();
}

// ---------- ตรวจความสุ่ม: is each digit / number drawn evenly, and independently of the last draw? ----------
// Regularized upper incomplete gamma Q(a, x) → chi-square p-value = Q(df/2, x/2)
function lnGamma(z) {
  const c = [76.18009172947146, -86.50532032941677, 24.01409824083091, -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5];
  let x = z; let y = z; let t = x + 5.5; t -= (x + 0.5) * Math.log(t);
  let ser = 1.000000000190015; for (const ci of c) ser += ci / ++y;
  return -t + Math.log(2.5066282746310005 * ser / x);
}
function gammaQ(a, x) {
  if (x <= 0) return 1;
  if (x < a + 1) { // series for P
    let sum = 1 / a; let del = sum; let ap = a;
    for (let n = 0; n < 500; n++) { ap++; del *= x / ap; sum += del; if (Math.abs(del) < Math.abs(sum) * 1e-12) break; }
    return 1 - sum * Math.exp(-x + a * Math.log(x) - lnGamma(a));
  }
  let b = x + 1 - a; let c = 1e300; let d = 1 / b; let h = d; // continued fraction for Q
  for (let i = 1; i < 500; i++) {
    const an = -i * (i - a); b += 2;
    d = an * d + b; if (Math.abs(d) < 1e-300) d = 1e-300;
    c = b + an / c; if (Math.abs(c) < 1e-300) c = 1e-300;
    d = 1 / d; const del = d * c; h *= del; if (Math.abs(del - 1) < 1e-12) break;
  }
  return Math.exp(-x + a * Math.log(x) - lnGamma(a)) * h;
}
const chiP = (stat, df) => gammaQ(df / 2, stat / 2);
function chiSquare(counts) {
  const n = counts.reduce((a, b) => a + b, 0); const e = n / counts.length;
  const stat = counts.reduce((s, o) => s + (o - e) ** 2 / e, 0);
  return { n, expected: e, stat, df: counts.length - 1, p: chiP(stat, counts.length - 1) };
}
// two-sided normal approximation to a binomial count
function binomZ(k, n, p) {
  const mu = n * p; const sd = Math.sqrt(n * p * (1 - p)); const z = sd ? (k - mu) / sd : 0;
  const erfc = (x) => { const t = 1 / (1 + 0.5 * Math.abs(x)); const r = t * Math.exp(-x * x - 1.26551223 + t * (1.00002368 + t * (0.37409196 + t * (0.09678418 + t * (-0.18628806 + t * (0.27886807 + t * (-1.13520398 + t * (1.48851587 + t * (-0.82215223 + t * 0.17087277))))))))); return x >= 0 ? r : 2 - r; };
  return { mu, z, p: erfc(Math.abs(z) / Math.SQRT2) };
}

function randomnessData(draws) {
  const rows = draws.filter((d) => d.usable).slice().reverse(); // oldest first
  if (market === 'lao') {
    const seq = rows.map((d) => d.last4 || (d.bottom2 && d.top3 ? d.bottom2[0] + d.top3 : null)).filter((x) => /^\d{4}$/.test(x || ''));
    return { label: 'เลขท้าย 4 ตัว', positions: ['หลักพัน', 'หลักร้อย', 'หลักสิบ', 'หลักหน่วย'], digits: seq, pairs: { '2 ตัวบน': rows.map((d) => d.top2), '2 ตัวล่าง': rows.map((d) => d.bottom2) }, n: seq.length };
  }
  const seq = rows.map((d) => d.first).filter((x) => /^\d{6}$/.test(x || ''));
  return { label: 'รางวัลที่ 1', positions: ['หลักแสน', 'หลักหมื่น', 'หลักพัน', 'หลักร้อย', 'หลักสิบ', 'หลักหน่วย'], digits: seq, pairs: { '2 ตัวบน': rows.map((d) => d.top2), '2 ตัวล่าง (เลขท้าย 2 ตัว)': rows.map((d) => d.bottom2) }, n: seq.length };
}

function bars(counts, expected) {
  const max = Math.max(...counts, expected) * 1.08;
  return `<div class="bars" role="img" aria-label="จำนวนครั้งที่เลข 0 ถึง 9 ออก เทียบค่าที่คาด ${expected.toFixed(1)} ครั้ง">
      <span class="exp" style="bottom:${(expected / max) * 100}%"></span>
      ${counts.map((c, d) => `<span class="bar" style="height:${(c / max) * 100}%" title="เลข ${d}: ${c} ครั้ง (คาด ${expected.toFixed(1)})"><i>${d}</i></span>`).join('')}
    </div>`;
}

async function viewRandom() {
  const r = await load('results');
  if (!r) return '<p class="empty">ไม่มีข้อมูล</p>';
  const D = randomnessData(r.draws);
  const tests = [];
  // 1) each digit position: are 0–9 equally common?
  const posTests = D.positions.map((name, i) => {
    const c = Array(10).fill(0); for (const s of D.digits) c[Number(s[i])]++;
    const t = { kind: 'pos', name: `${D.label} ${name}`, counts: c, ...chiSquare(c) };
    tests.push(t); return t;
  });
  // 2) 2-digit numbers: are 00–99 equally common?
  for (const [name, list] of Object.entries(D.pairs)) {
    const c = Array(100).fill(0); for (const x of list) if (/^\d{2}$/.test(x || '')) c[Number(x)]++;
    const hot = c.map((v, i) => [String(i).padStart(2, '0'), v]).sort((a, b) => b[1] - a[1]);
    tests.push({ kind: 'pair', name: `${name} 00–99`, hot: hot.slice(0, 3), cold: hot.filter(([, v]) => v === 0).length, ...chiSquare(c) });
  }
  // 3) memory: does a digit repeat the previous draw's digit in the same position more than 1 in 10?
  D.positions.forEach((name, i) => {
    let k = 0; for (let j = 1; j < D.digits.length; j++) if (D.digits[j][i] === D.digits[j - 1][i]) k++;
    const b = binomZ(k, D.digits.length - 1, 0.1);
    tests.push({ kind: 'rep', name: `${name} ซ้ำงวดก่อน`, k, n: D.digits.length - 1, ...b });
  });
  const m = tests.length;
  for (const t of tests) t.pAdj = Math.min(1, t.p * m);
  const flagged = tests.filter((t) => t.pAdj < 0.05);
  const rawLow = tests.filter((t) => t.p < 0.05).length;
  const verdict = (t) => (t.pAdj < 0.05 ? '<span class="badge b-conflict">ผิดปกติ</span>' : t.p < 0.05 ? '<span class="badge b-majority">ต้องดูต่อ</span>' : '<span class="hit">ปกติ</span>');
  const fmtP = (p) => (p < 0.001 ? '<0.001' : p.toFixed(3));

  return `<a class="back" href="#${market}/predict">‹ กลับไปคำทำนาย</a>
    <h1>ตรวจความสุ่ม</h1>
    <div class="callout">${flagged.length
      ? `พบ ${flagged.length} รายการที่ผิดปกติแม้ปรับการทดสอบหลายรายการแล้ว: ${flagged.map((t) => esc(t.name)).join(', ')} ควรดูต่อเมื่อมีข้อมูลเพิ่ม`
      : `ทดสอบ ${m} รายการจาก ${D.n} งวด ไม่พบความเอียงที่ผิดปกติ ผลเข้ากับการสุ่มที่ยุติธรรม${rawLow ? ` (มี ${rawLow} รายการที่ p ต่ำกว่า 0.05 ก่อนปรับ ซึ่งเกิดโดยบังเอิญได้ราว ${(m * 0.05).toFixed(1)} รายการ)` : ''}`}</div>

    <h2>1. เลข 0–9 ในแต่ละหลักออกเท่ากันไหม</h2>
    <p class="sub">${esc(D.label)} ${D.n} งวด แต่ละเลขควรออกราว ${(D.n / 10).toFixed(1)} ครั้งต่อหลัก (เส้นประ) ความสูงต่างกันบ้างเป็นเรื่องปกติ ค่า p ยิ่งเล็กยิ่งผิดปกติ</p>
    <div class="pos-grid">${posTests.map((t) => `<div class="pos">
        <div class="pos-h"><b>${esc(t.name.replace(`${D.label} `, ''))}</b><span>p ${fmtP(t.p)} ${verdict(t)}</span></div>
        ${bars(t.counts, t.expected)}
      </div>`).join('')}</div>

    <h2>2. เลข 2 ตัว 00–99 ออกเท่ากันไหม</h2>
    <table class="tbl compact"><thead><tr><th>หมวด</th><th>ออกบ่อยสุด</th><th>ไม่เคยออก</th><th>p</th><th></th></tr></thead><tbody>
      ${tests.filter((t) => t.kind === 'pair').map((t) => `<tr><td>${esc(t.name)}</td><td class="n">${t.hot.map(([n, v]) => `${n}×${v}`).join(' ')}</td><td class="n">${t.cold} เลข</td><td class="n">${fmtP(t.p)}</td><td>${verdict(t)}</td></tr>`).join('')}
    </tbody></table>
    <p class="tiny">แต่ละเลขควรออกราว ${(D.n / 100).toFixed(1)} ครั้ง การสุ่มจริงมักมีบางเลขออกบ่อยเกือบ 2–3 เท่าของค่านี้ และบางเลขแทบไม่ออก เป็นเรื่องปกติ</p>

    <h2>3. งวดก่อนมีผลกับงวดถัดไปไหม</h2>
    <p class="sub">ถ้าแต่ละงวดไม่เกี่ยวกัน เลขในหลักเดียวกันจะซ้ำงวดก่อนราว 1 ใน 10 ครั้ง</p>
    <table class="tbl compact"><thead><tr><th>หลัก</th><th>ซ้ำจริง</th><th>คาดไว้</th><th>p</th><th></th></tr></thead><tbody>
      ${tests.filter((t) => t.kind === 'rep').map((t) => `<tr><td>${esc(t.name.replace(' ซ้ำงวดก่อน', ''))}</td><td class="n">${t.k}</td><td class="n">${t.mu.toFixed(1)}</td><td class="n">${fmtP(t.p)}</td><td>${verdict(t)}</td></tr>`).join('')}
    </tbody></table>

    <details class="fold">
      <summary>อ่านผลอย่างไร</summary>
      <ul class="notes">
        <li>ค่า p คือโอกาสที่การสุ่มยุติธรรมจะให้ผลเอียงเท่านี้หรือมากกว่า ค่าเล็กกว่า 0.05 เกิดได้ 1 ใน 20 ครั้งแม้สุ่มจริง</li>
        <li>หน้านี้ทดสอบ ${m} รายการพร้อมกัน จึงตัดสินว่า "ผิดปกติ" เมื่อ p × ${m} ยังต่ำกว่า 0.05 (Bonferroni) ส่วน "ต้องดูต่อ" คือ p ต่ำแต่ยังอธิบายได้ด้วยความบังเอิญ</li>
        <li>ใช้ chi-square สำหรับข้อ 1–2 และการทดสอบสัดส่วนสำหรับข้อ 3 ผลอัปเดตเองทุกครั้งที่มีงวดใหม่</li>
        <li>ถ้าไม่พบความผิดปกติ แปลว่าไม่มีสูตรไหนใช้ประโยชน์จากข้อมูลชุดนี้ได้ ถ้าพบ ต้องรอดูว่ายังอยู่เมื่อมีข้อมูลเพิ่มหรือเปล่า</li>
      </ul>
    </details>`;
}

const VIEWS = { predict: viewPredict, models: viewModels, backtest: viewBacktest, dream: viewDream, history: viewHistory, random: viewRandom, quality: viewQuality, archive: viewArchive };

let currentView = 'predict';
async function render() {
  const view = currentView;
  try {
    $app.innerHTML = await VIEWS[view]();
    if (view === 'dream') afterDream();
    if (view === 'predict') afterPredict();
  } catch (e) { $app.innerHTML = `<p class="empty">แสดงหน้านี้ไม่ได้: ${esc(e.message)}</p>`; }
  const r = await load('results');
  document.getElementById('built').textContent = r ? `อัปเดตข้อมูล ${fmtTime(r.builtAt)}` : '';
}

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
    const tab = view === 'history' || view === 'dream' ? view : 'predict';
    if (a.dataset.view === tab) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  });
  document.getElementById('legal').hidden = mk !== 'lao';
  currentView = view;
  await render();
  refreshMarket(mk);
}

window.addEventListener('hashchange', () => { route(); window.scrollTo(0, 0); });
route();
