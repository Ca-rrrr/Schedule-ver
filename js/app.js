// ====== 설정 ======
const GAS_URL = "https://script.google.com/macros/s/AKfycbytp3QXntGIHigIJWWN2sKnhVyoZX6hXz1t9Y-PQ4JrFgp9W30Uc_I0WAljiQjr0UaL/exec";

// 깃허브페이지 하위경로(/Schedule-ver) 포함 origin 전송
function repoBase() {
  const p = location.pathname;
  return p.startsWith('/Schedule-ver') ? (location.origin + '/Schedule-ver') : location.origin;
}
function withOrigin(params = {}) {
  return new URLSearchParams({ ...params, origin: repoBase() }).toString();
}
async function apiGet(params) {
  const res = await fetch(GAS_URL + "?" + withOrigin(params));
  return res.json();
}
async function apiPost(body) {
  const res = await fetch(GAS_URL + "?" + withOrigin(), {
    method: "POST",
    body: JSON.stringify(body)
  });
  return res.json();
}

// ====== 로컬 캐시 (stale-while-revalidate) ======
const LS_TTL = 30_000; // 30초
const KEY_MEM = "members:v1";
const keyMonth = (y, m) => `month:${y}-${String(m).padStart(2,"0")}:v1`;

function saveCache(key, value) {
  try { localStorage.setItem(key, JSON.stringify({ t: Date.now(), v: value })); } catch {}
}
function loadCache(key) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const { t, v } = JSON.parse(raw);
    if (Date.now() - (t||0) > LS_TTL) return null;
    return v;
  } catch { return null; }
}
function invalidateCache(key) { try { localStorage.removeItem(key); } catch {} }

// ====== 상태 ======
const EMOJI_CHOICES = ["🩷","💛","💙","💜","💚","🧡","🩵","🤍","🖤","💗","💖","⭐","🌙","🌸","🍑","🫧","🍀"];
let members = [];          // [{member_id,name,color,joined_at}]
let monthRows = [];        // [{date, member_name, status, note}]
let selectedMember = "";   // name
let cur = new Date();      // 현재 표시 월(1일 기준으로 사용)

// 파생 상태
let totalMembers = 0;
let dateSummary = new Map(); // key: 'YYYY-MM-DD' -> {unavail, notes, rows:[]}
let confirmedDates = new Set(); // 확정 날짜(이 달)

// ====== 연/월 드롭다운 범위 설정 ======
// 이 값만 바꾸면 드롭다운/화살표가 이동 가능한 범위가 바뀜
const YM_MIN   = '2025-08'; // 시작 월(포함) 'YYYY-MM'
const YM_COUNT = 24;        // 앞으로 보여줄 개월 수

// ====== 엘리먼트 ======
const monthLabel = document.getElementById('monthLabel');
const grid = document.getElementById('grid');
grid && grid.classList.add('grid');
const sel = document.getElementById('memberSelect');
const ymSelect = document.getElementById('ymSelect'); // 연/월 드롭다운

// (있다면) 확정모드 버튼
const confirmModeBtn = document.getElementById('confirmModeBtn');
let confirmModeOn = false;

// ====== 유틸 ======
function ymd(d){ return d.toISOString().slice(0,10); }
function ymKey(d){ return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`; }
function formatK(d){
  const w = ['일','월','화','수','목','금','토'][d.getDay()];
  return `${d.getFullYear()}년 ${d.getMonth()+1}월 ${d.getDate()}일 (${w})`;
}
function firstOfMonth(d){ return new Date(d.getFullYear(), d.getMonth(), 1); }
function addMonths(d, n){ return new Date(d.getFullYear(), d.getMonth()+n, 1); }
function monthDates(d){
  const first = firstOfMonth(d);
  const month = first.getMonth();
  const start = new Date(first); start.setDate(1 - start.getDay()); // 일요일 시작
  const weeks = [];
  for(let i=0;i<6;i++){
    const row = [];
    for(let j=0;j<7;j++){
      const dd = new Date(start); dd.setDate(start.getDate() + (i*7+j));
      row.push(dd);
    }
    weeks.push(row);
    if (row.some(x => x.getMonth() === month) && weeks.length>=5 && weeks[weeks.length-1].every(x=>x.getMonth()!==month)) break;
  }
  return weeks;
}
function findRow(dateStr, name){
  return monthRows.find(r => r.date === dateStr && r.member_name === name);
}

// ---- YM 범위 유틸 ----
function ymToDate(ym){ const [y,m]=ym.split('-').map(Number); return new Date(y, m-1, 1); }
const YM_MIN_DATE = ymToDate(YM_MIN);
const YM_MAX_DATE = addMonths(YM_MIN_DATE, YM_COUNT-1);
function ymNum(d){ return d.getFullYear()*100 + (d.getMonth()+1); }
function clampCurToRange(){
  const n = ymNum(cur);
  if (n < ymNum(YM_MIN_DATE)) cur = new Date(YM_MIN_DATE);
  if (n > ymNum(YM_MAX_DATE)) cur = new Date(YM_MAX_DATE);
}

// ---- 다른 멤버 메모/상태 헬퍼 + escape ----
function getOthersForDate(dateStr, exceptName){
  const colorMap = new Map(members.map(m => [m.name, m.color || ""]));
  const rows = (monthRows || []).filter(r => r.date === dateStr && r.member_name !== exceptName);

  // 멤버별 1개로 합치기
  const by = new Map();
  for (const r of rows){
    const name = r.member_name;
       const note = String(r.note || '').trim();
    const isUnavail = String(r.status || '') === '❌';

    const prev = by.get(name) || { name, emoji: colorMap.get(name) || "", note: "", isUnavail: false };
    prev.isUnavail = prev.isUnavail || isUnavail;
    if (note && note.length > prev.note.length) prev.note = note;
    by.set(name, prev);
  }

  return [...by.values()]
    .filter(x => x.note || x.isUnavail)
    .sort((a,b) => (b.isUnavail - a.isUnavail) || a.name.localeCompare(b.name));
}

function notePreviewForDate(dateStr){
  const rows = (dateSummary.get(dateStr)?.rows) || [];
  const emojiMap = new Map(members.map(m => [m.name, m.color || ""]));

  const by = new Map();
  for (const r of rows){
    const name = r.member_name;
    const note = String(r.note || '').trim();
    const isUnavail = String(r.status || '') === '❌';

    const prev = by.get(name) || { name, emoji: emojiMap.get(name) || "", text: "", isUnavail: false };
    prev.isUnavail = prev.isUnavail || isUnavail;
    if (note && note.length > prev.text.length) prev.text = note;
    by.set(name, prev);
  }

  return [...by.values()]
    .filter(p => p.text || p.isUnavail)
    .sort((a,b) => (b.isUnavail - a.isUnavail) || a.name.localeCompare(b.name));
}

function escapeHtml(s){
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

// 월 데이터 집계(디자인/뱃지용)
function summarizeByDate(rows){
  const map = new Map();
  for(const r of rows){
    const d = String(r.date).slice(0,10);
    if(!map.has(d)) map.set(d, {unavail:0, notes:0, rows:[]});
    const s = map.get(d);
    s.rows.push(r);
    if ((r.status || '') === '❌') s.unavail++;
    if ((r.note || '').trim() !== '') s.notes++;
  }
  return map;
}

// ====== OK 집계 + 미니 달력 렌더 ======
function okDateSet(){
  const set = new Set();
  if (totalMembers <= 0) return set;

  const first = firstOfMonth(cur);
  const month = first.getMonth();
  const start = new Date(first); start.setDate(1 - start.getDay()); // 일요일 시작 기준 6주(42칸)
  for (let i=0; i<42; i++){
    const d = new Date(start); d.setDate(start.getDate() + i);
    if (d.getMonth() !== month) continue;
    const key = ymd(d);
    const s = dateSummary.get(key);
    if (!s || s.unavail === 0) set.add(key); // 아무도 ❌ 없으면 OK
  }
  return set;
}

function renderMiniCal(){
  const wrap = document.getElementById('miniCal');
  if (!wrap) return;

  const weeks = monthDates(cur);
  const month = cur.getMonth();
  const today = new Date(); today.setHours(0,0,0,0);

  const ok = okDateSet();

  // 요일 헤더
  const dows = ['일','월','화','수','목','금','토'];
  wrap.innerHTML = '';
  for (const d of dows){
    const h = document.createElement('div');
    h.className = 'mc-dow';
    h.textContent = d;
    wrap.appendChild(h);
  }

  // 날짜 셀
  for (const wk of weeks){
    for (const d of wk){
      const dStr = ymd(d);
      const cell = document.createElement('div');
      cell.className = 'mc-cell';
      if (d.getMonth() !== month) cell.classList.add('dim');
      if (d.getTime() === today.getTime()) cell.classList.add('today');

      cell.textContent = d.getDate();

      if (ok.has(dStr)) cell.classList.add('ok');               // 전원 가능(연녹)
      if (confirmedDates.has(dStr)) {                           // 확정(파란 테두리 + 점)
        cell.classList.add('confirmed');
        const dot = document.createElement('i');
        dot.className = 'dot';
        cell.appendChild(dot);
      }

      // 클릭
      cell.addEventListener('click', () => {
        // 확정모드 → OK인 날만 토글
        if (confirmModeOn) {
          if (!ok.has(dStr)) return;
          const wantOn = !confirmedDates.has(dStr);

          // 낙관적 업데이트
          if (wantOn) confirmedDates.add(dStr); else confirmedDates.delete(dStr);
          renderMiniCal(); renderGrid();

          apiPost({ action:'toggleConfirm', date: dStr, confirm: wantOn })
            .catch(err => {
              // 롤백
              if (wantOn) confirmedDates.delete(dStr); else confirmedDates.add(dStr);
              renderMiniCal(); renderGrid();
              alert('확정 토글 실패: ' + (err?.message || err));
            });
          return;
        }

        // 기본: 메인 캘린더 스크롤
        const target = document.querySelector(`.day[data-date="${dStr}"]`);
        target?.scrollIntoView({ behavior:'smooth', block:'center', inline:'center' });
      });

      wrap.appendChild(cell);
    }
  }
}

// ====== 멤버 셀렉트 채우기 ======
function populateMemberSelect() {
  sel.innerHTML = "";
  for (const m of members){
    const opt = document.createElement('option');
    opt.value = m.name;
    opt.textContent = `${m.color || ''} ${m.name}`.trim();
    sel.appendChild(opt);
  }
  if (!selectedMember && members.length) selectedMember = members[0].name;
  sel.value = selectedMember || "";
}

// ====== 연/월 드롭다운 ======
function buildYMOptions(){
  if (!ymSelect) return;
  ymSelect.innerHTML = '';
  for (let i=0; i<YM_COUNT; i++){
    const d = addMonths(YM_MIN_DATE, i);
    const opt = document.createElement('option');
    opt.value = ymKey(d);
    opt.textContent = `${d.getFullYear()}년 ${d.getMonth()+1}월`;
    ymSelect.appendChild(opt);
  }
  // 현재가 범위 밖이면 보정
  clampCurToRange();
  ymSelect.value = ymKey(cur);
}
function ensureYMOptionHasCurrent(){
  if (!ymSelect) return;
  clampCurToRange();
  const v = ymKey(cur);
  if (![...ymSelect.options].some(o => o.value === v)) {
    buildYMOptions();
  }
  ymSelect.value = v;
}
ymSelect && (ymSelect.onchange = async (e) => {
  const v = String(e.target.value || '');
  const m = v.match(/^(\d{4})-(\d{2})$/);
  if (!m) return;
  cur = new Date(Number(m[1]), Number(m[2])-1, 1);
  clampCurToRange();
  await loadMonth();
  refreshVersionBaseline();
});

// ====== 타일 생성 ======
function buildDayTile(d, inMonth){
  const dStr = ymd(d);
  const sum = dateSummary.get(dStr) || {unavail:0, notes:0, rows:[]};
  const yesCount = Math.max(totalMembers - sum.unavail, 0);
  const myRow = findRow(dStr, selectedMember);

  const el = document.createElement('div');
  el.className = 'day';
  el.dataset.date = dStr;

  if (!inMonth) el.classList.add('muted');

  const isOk = inMonth && sum.unavail === 0;
  if (isOk) el.classList.add('ok');

  const isConfirmed = isOk && confirmedDates.has(dStr);
  if (isConfirmed) el.classList.add('confirmed');

  if (myRow?.status === '❌') el.classList.add('unavail-me');
  const today = new Date(); today.setHours(0,0,0,0);
  if (d.getTime() === today.getTime()) el.classList.add('today');

  // 헤더
  const head = document.createElement('div');
  head.className = 'day__head';
  head.innerHTML = `
    <div class="day__num">${d.getDate()}</div>
    <div class="day__dow">(${['일','월','화','수','목','금','토'][d.getDay()]})</div>
    <div class="badges">
      <span class="badge ok">☺️${yesCount}</span>
      ${sum.notes > 0 ? `<span class="badge note">📝${sum.notes}</span>` : ''}
      ${isConfirmed ? `<span class="badge confirm">확정</span>` : ''}
    </div>
  `;
  el.appendChild(head);

  // 메모 미리보기
  const previews = notePreviewForDate(dStr);
  if (previews.length) {
    const pv = document.createElement('div');
    pv.className = 'day__preview';

    const limit = (window.innerWidth <= 560) ? 2 : 3;
    previews.slice(0, limit).forEach(p => {
      const line = document.createElement('div');
      line.className = 'pvline';
      const who = `${p.emoji ? (p.emoji + ' ') : ''}${escapeHtml(p.name)}`;
      line.innerHTML = `
        <span class="pv-who">${who}${p.isUnavail ? ' <span class="pv-tag">❌</span>' : ''}</span>
        ${p.text ? `<span class="pv-text">${escapeHtml(p.text)}</span>` : ''}
      `;
      pv.appendChild(line);
    });

    if (previews.length > limit) {
      const more = document.createElement('div');
      more.className = 'pv-more';
      more.textContent = `외 ${previews.length - limit}건`;
      pv.appendChild(more);
    }

    el.appendChild(pv);
  }

  // 하단 액션
  const actions = document.createElement('div');
  actions.className = 'day__actions';
  const wrap = document.createElement('label');
  wrap.className = 'checkbox';
  const cb = document.createElement('input');
  cb.type = 'checkbox';
  cb.checked = myRow?.status === '❌';
  const lb = document.createElement('span'); lb.textContent = '불가';
  wrap.append(cb, lb);

  const btn = document.createElement('button');
  btn.className = 'thin';
  btn.textContent = '메모';

  // 로컬 반영 유틸
  function applyToggleLocal(dateStr, name, isUnavail) {
    const idx = monthRows.findIndex(r => r.date === dateStr && r.member_name === name);
    if (isUnavail) {
      if (idx >= 0) { monthRows[idx].status = '❌'; }
      else { monthRows.push({ date: dateStr, member_name: name, status:'❌', note:'' }); }
    } else {
      if (idx >= 0) {
        const note = (monthRows[idx].note || '').trim();
        if (note === '') monthRows.splice(idx, 1);
        else monthRows[idx].status = '';
      }
    }
    dateSummary = summarizeByDate(monthRows);
  }

  cb.addEventListener('change', () => {
    const newVal = cb.checked;
    cb.disabled = true;

    // 1) 즉시 반영
    applyToggleLocal(dStr, selectedMember, newVal);
    renderGrid(); renderMiniCal();

    // 2) 서버 저장
    apiPost({ action:'toggleUnavailable', date: dStr, member_name:selectedMember, is_unavail: newVal })
      .then(() => {
        saveCache(keyMonth(d.getFullYear(), d.getMonth()+1), monthRows);
        refreshVersionBaseline();
      })
      .catch(err => {
        applyToggleLocal(dStr, selectedMember, !newVal);
        renderGrid(); renderMiniCal();
        alert('불가 저장 실패: ' + (err?.message || err));
      })
      .finally(() => { cb.disabled = false; });
  });

  btn.addEventListener('click', () => openDayDialog(d));

  actions.append(wrap, btn);
  el.appendChild(actions);

  return el;
}

// ====== 그리드 렌더 ======
function renderGrid(){
  monthLabel.textContent = `${cur.getFullYear()}년 ${cur.getMonth()+1}월`;
  ensureYMOptionHasCurrent();

  grid.innerHTML = "";
  const weeks = monthDates(cur);
  for (const wk of weeks){
    for (const d of wk){
      const inMonth = (d.getMonth() === cur.getMonth());
      grid.appendChild(buildDayTile(d, inMonth));
    }
  }
}

// ====== 날짜 상세 모달 ======
const dayDlg = document.getElementById('dayDlg');
const dayTitle = document.getElementById('dayTitle');
const chkUnavail = document.getElementById('chkUnavail');
const noteBox = document.getElementById('noteBox');
const btnSaveNote = document.getElementById('btnSaveNote');
const btnCloseDay = document.getElementById('btnCloseDay');
const chkConfirm = document.getElementById('chkConfirmed');

function openDayDialog(d){
  const dateStr = ymd(d);
  dayTitle.textContent = formatK(d);
  const row = findRow(dateStr, selectedMember);
  chkUnavail.checked = row?.status === '❌';
  noteBox.value = row?.note || '';
  dayDlg.dataset.date = dateStr;

// ✅ 여기부터 추가
  if (chkConfirmed) {
    // 이 날짜가 전원 OK(❌ 0명)인지
    const isOk = (dateSummary.get(dateStr)?.unavail || 0) === 0;

    // 확정 체크 상태를 현재 확정 데이터와 동기화
    chkConfirmed.checked  = confirmedDates.has(dateStr);
    // OK가 아닌 날은 확정 불가(원치 않으면 이 줄 삭제)
    chkConfirmed.disabled = !isOk;

    // 모달에서 바로 확정 토글 (원치 않으면 이 onchange 블록 통째로 삭제)
    chkConfirmed.onchange = async () => {
      const wantOn = chkConfirmed.checked;
      if (!isOk) { chkConfirmed.checked = false; return; } // 안전장치

      // 낙관적 업데이트
      if (wantOn) confirmedDates.add(dateStr);
      else confirmedDates.delete(dateStr);
      renderMiniCal(); renderGrid();

      try {
        await apiPost({ action: 'toggleConfirm', date: dateStr, confirm: wantOn });
      } catch (err) {
        // 실패 시 롤백
        if (wantOn) confirmedDates.delete(dateStr);
        else confirmedDates.add(dateStr);
        chkConfirmed.checked = !wantOn;
        renderMiniCal(); renderGrid();
        alert('확정 토글 실패: ' + (err?.message || err));
      }
    };
  }
// ✅ 여기까지 추가


  // 다른 멤버 메모/상태
  const wrapDetails = document.getElementById('othersWrap');
  const list = document.getElementById('othersList');
  if (list){
    const others = getOthersForDate(dateStr, selectedMember);
    list.innerHTML = "";
    if (others.length === 0){
      list.innerHTML = `<div class="onote"><div class="onote__text">다른 멤버 메모 없음</div></div>`;
      if (wrapDetails) wrapDetails.open = false;
    } else {
      for (const o of others){
        const item = document.createElement('div');
        item.className = 'onote';
        item.innerHTML = `
          <div class="onote__who">${o.emoji} ${escapeHtml(o.name)}${o.isUnavail ? ' — ❌' : ''}</div>
          ${o.note ? `<div class="onote__text">${escapeHtml(o.note).replace(/\n/g,'<br>')}</div>` : ''}
        `;
        list.appendChild(item);
      }
      if (wrapDetails) wrapDetails.open = true;
    }
  }

  dayDlg.showModal();
}

btnCloseDay && (btnCloseDay.onclick = () => dayDlg.close());

// 메모 저장
btnSaveNote && (btnSaveNote.onclick = async () => {
  const date = dayDlg.dataset.date;
  const isUnavail = chkUnavail.checked;
  const note = noteBox.value;

  // 즉시 반영 + 닫기
  applySaveDayLocal(date, selectedMember, isUnavail, note);
  renderGrid(); renderMiniCal();
  btnSaveNote.disabled = true; btnSaveNote.textContent = '저장중…';
  dayDlg.close();

  try {
    await apiPost({ action:'toggleUnavailable', date, member_name:selectedMember, is_unavail: isUnavail });
    await apiPost({ action:'saveNote', date, member_name:selectedMember, note });

    const d = new Date(date + "T00:00:00");
    saveCache(keyMonth(d.getFullYear(), d.getMonth()+1), monthRows);
    refreshVersionBaseline();
  } catch (err){
    alert('메모 저장 실패: ' + (err?.message || err));
    await loadMonth();
  } finally {
    btnSaveNote.disabled = false; btnSaveNote.textContent = '저장';
  }
});
function applySaveDayLocal(dateStr, name, isUnavail, note) {
  const idx = monthRows.findIndex(r => r.date === dateStr && r.member_name === name);
  const trimmed = (note || '').trim();

  if (idx >= 0) {
    monthRows[idx].status = isUnavail ? '❌' : '';
    monthRows[idx].note = trimmed;
    if (!isUnavail && trimmed === '') monthRows.splice(idx, 1);
  } else {
    if (isUnavail || trimmed !== '') {
      monthRows.push({ date: dateStr, member_name: name, status: isUnavail ? '❌' : '', note: trimmed });
    }
  }
  dateSummary = summarizeByDate(monthRows);
}

// ====== 멤버 관리 모달 ======
const memDlg = document.getElementById('memDlg');
const memList = document.getElementById('memList');
const newEmoji = document.getElementById('newEmoji');
const newName = document.getElementById('newName');
const btnAddMem = document.getElementById('btnAddMem');
const btnCloseMem = document.getElementById('btnCloseMem');

function fillEmojiSelect(selEl, val){
  selEl.innerHTML = "";
  for (const e of EMOJI_CHOICES){
    const o = document.createElement('option'); o.value=e; o.textContent=e;
    if (val===e) o.selected = true;
    selEl.appendChild(o);
  }
}
function rebuildMemberList(){
  memList.innerHTML = "";
  for (const m of members){
    const row = document.createElement('div'); row.className='mem-row';

    const em = document.createElement('select'); fillEmojiSelect(em, m.color || "");
    const nm = document.createElement('input'); nm.value = m.name; nm.style.flex='1 1 240px';
    const save = document.createElement('button'); save.textContent='저장';
    const del  = document.createElement('button'); del.textContent='삭제';

    save.onclick = async () => {
      const r = await apiPost({ action:"updateMember", member_id:m.member_id, name:nm.value.trim(), color:em.value });
      if (!r.ok && r.error){ alert(r.error); return; }
      invalidateCache(KEY_MEM);
      await loadMembers(); await loadMonth();
      refreshVersionBaseline();
    };
    del.onclick = async () => {
      if (!confirm(`'${m.name}' 삭제할까요?`)) return;
      const r = await apiPost({ action:"deleteMember", member_id:m.member_id });
      if (!r.ok && r.error){ alert(r.error); return; }
      if (selectedMember === m.name) selectedMember = "";
      invalidateCache(KEY_MEM);
      await loadMembers(); await loadMonth();
      refreshVersionBaseline();
    };

    row.append(em,nm,save,del);
    memList.append(row);
  }
}
document.getElementById('manageBtn')?.addEventListener('click', () => {
  fillEmojiSelect(newEmoji, EMOJI_CHOICES[0]);
  newName.value = "";
  rebuildMemberList();
  memDlg.showModal();
});
btnCloseMem && (btnCloseMem.onclick = () => memDlg.close());
btnAddMem && (btnAddMem.onclick = async () => {
  const name = newName.value.trim();
  if (!name){ alert("이름을 입력하세요"); return; }
  const r = await apiPost({ action:"addMember", name, color:newEmoji.value });
  if (!r.ok && r.error){ alert(r.error); return; }
  selectedMember = name;
  invalidateCache(KEY_MEM);
  await loadMembers(); await loadMonth();
  rebuildMemberList();
  refreshVersionBaseline();
});

// ====== 라이브 동기화(버전 폴링) ======
let curVer = { members: null, month: null };
let liveTimer = null;

async function fetchVersion(){
  clampCurToRange();
  const y = cur.getFullYear();
  const m = cur.getMonth()+1;
  const r = await apiGet({ action:'version', year:y, month:m });
  if (!r.ok) throw new Error(r.error || 'version failed');
  return { members: String(r.members||''), month: String(r.month||'') };
}
async function refreshVersionBaseline(){
  try {
    const v = await fetchVersion();
    curVer = v;
  } catch(_) {}
}
async function checkLiveOnce(){
  try{
    const v = await fetchVersion();
    if (curVer.members && v.members !== curVer.members) {
      await loadMembers();
    }
    if (curVer.month && v.month !== curVer.month) {
      await loadMonth();
    }
    curVer = v;
  }catch(_){ /* 네트워크 에러 무시 */ }
}
function startLive(){
  if (liveTimer) { clearTimeout(liveTimer); liveTimer = null; }
  refreshVersionBaseline();
  const loop = async () => {
    const interval = document.hidden ? 15000 : 6000;
    await checkLiveOnce();
    liveTimer = setTimeout(loop, interval);
  };
  liveTimer = setTimeout(loop, document.hidden ? 15000 : 6000);
}
document.addEventListener('visibilitychange', () => {
  if (liveTimer) { clearTimeout(liveTimer); liveTimer = null; startLive(); }
});

// ====== 상단 버튼 & 드롭다운 ======
document.getElementById('prevBtn')?.addEventListener('click', async () => {
  cur = addMonths(cur, -1);
  clampCurToRange();                 // ← 범위 밖 이동 방지
  await loadMonth();
  refreshVersionBaseline();
});
document.getElementById('nextBtn')?.addEventListener('click', async () => {
  cur = addMonths(cur, 1);
  clampCurToRange();                 // ← 범위 밖 이동 방지
  await loadMonth();
  refreshVersionBaseline();
});
document.getElementById('reloadBtn')?.addEventListener('click', async () => {
  await loadMembers();
  await loadMonth();
  refreshVersionBaseline();
});
sel.onchange = async (e) => { selectedMember = e.target.value || ""; await loadMonth(); };

// 확정모드 토글(있을 때만)
confirmModeBtn && (confirmModeBtn.onclick = () => {
  confirmModeOn = !confirmModeOn;
  confirmModeBtn.classList.toggle('on', confirmModeOn);
  confirmModeBtn.textContent = confirmModeOn ? '확정모드(ON)' : '확정모드';
});

// ====== 데이터 로더 ======
async function loadMembers(){
  const r = await apiGet({ action: "members" });
  if (!r.ok) throw new Error(r.error || "members failed");
  members = r.data || [];
  totalMembers = members.length || 0;
  populateMemberSelect();
  saveCache(KEY_MEM, members);
}

async function loadMonth(){
  clampCurToRange();
  const y = cur.getFullYear();
  const m = cur.getMonth()+1;

  // 월 데이터와 확정 날짜를 함께 가져옴
  const [rMonth, rConf] = await Promise.all([
    apiGet({ action:"month", year:y, month:m }),
    apiGet({ action:"confirmed", year:y, month:m })
  ]);

  if (!rMonth.ok) throw new Error(rMonth.error || "month failed");
  monthRows = rMonth.data || [];
  dateSummary = summarizeByDate(monthRows);

  confirmedDates = new Set((rConf.ok ? (rConf.data || []) : []));

  // 렌더
  renderGrid(); renderMiniCal();
  saveCache(keyMonth(y,m), monthRows);

  // 드롭다운 보정
  ensureYMOptionHasCurrent();
}

// ====== 최초 부팅 (병렬 + 캐시 우선) ======
(async function boot(){
  try{
    // 현재 월을 드롭다운 범위로 보정
    clampCurToRange();

    // 드롭다운 초기 구성(범위 기반)
    buildYMOptions();

    const y = cur.getFullYear();
    const m = cur.getMonth()+1;

    // 1) 캐시 있으면 즉시 그리기
    const memCached = loadCache(KEY_MEM);
    const monCached = loadCache(keyMonth(y,m));
    if (memCached) {
      members = memCached; totalMembers = members.length || 0;
      if (!selectedMember && members.length) selectedMember = members[0].name;
      populateMemberSelect();
    }
    if (monCached) {
      monthRows = monCached; dateSummary = summarizeByDate(monthRows);
      renderGrid(); renderMiniCal();
    }

    // 2) 최신 데이터 병렬로 가져와서 교체
    const [r1, r2, r3] = await Promise.all([
      apiGet({ action: "members" }),
      apiGet({ action: "month", year: y, month: m }),
      apiGet({ action: "confirmed", year: y, month: m })
    ]);

    if (r1.ok) {
      members = r1.data || [];
      totalMembers = members.length || 0;
      if (!selectedMember && members.length) selectedMember = members[0].name;
      populateMemberSelect();
      saveCache(KEY_MEM, members);
    }
    if (r2.ok) {
      monthRows = r2.data || [];
      dateSummary = summarizeByDate(monthRows);
      saveCache(keyMonth(y,m), monthRows);
    }
    confirmedDates = new Set((r3.ok ? (r3.data || []) : []));
    renderGrid(); renderMiniCal();

  }catch(err){
    console.error(err);
    alert("초기 로드 실패: " + err.message);
  } finally {
    startLive();
  }
})();
