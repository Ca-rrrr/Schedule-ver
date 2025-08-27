// ====== 설정 ======
const GAS_URL = "https://script.google.com/macros/s/AKfycbzOamUTMwYZhqwiKhxTelQtzpItWh7-dTKqLClrDn8PBdJAmDbD7MAYg33KK-Qu8kfn/exec";

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

// ====== 상태 ======
const EMOJI_CHOICES = ["🩷","💛","💙","💜","💚","🧡","🩵","🤍","🖤","💗","💖","⭐","🌙","🌸","🍑","🫧","🍀"];
let members = [];          // [{member_id,name,color,joined_at}]
let monthRows = [];        // [{date, member_name, status, note}]
let selectedMember = "";   // name
let cur = new Date();      // 현재 표시 월

// 디자인용 파생 상태
let totalMembers = 0;
let dateSummary = new Map(); // key: 'YYYY-MM-DD' -> {unavail, notes, rows:[]}

// ====== 엘리먼트 ======
const monthLabel = document.getElementById('monthLabel');
const grid = document.getElementById('grid');
grid && grid.classList.add('grid'); // CSS grid 적용 보장

const sel = document.getElementById('memberSelect');

const dayDlg = document.getElementById('dayDlg');
const dayTitle = document.getElementById('dayTitle');
const chkUnavail = document.getElementById('chkUnavail');
const noteBox = document.getElementById('noteBox');
const btnSaveNote = document.getElementById('btnSaveNote');
const btnCloseDay = document.getElementById('btnCloseDay');

const memDlg = document.getElementById('memDlg');
const memList = document.getElementById('memList');
const newEmoji = document.getElementById('newEmoji');
const newName = document.getElementById('newName');
const btnAddMem = document.getElementById('btnAddMem');
const btnCloseMem = document.getElementById('btnCloseMem');

// ====== 유틸 ======
function ymd(d){ return d.toISOString().slice(0,10); }
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

function applyToggleLocal(dateStr, name, isUnavail) {
  const idx = monthRows.findIndex(r => r.date === dateStr && r.member_name === name);
  if (isUnavail) {
    if (idx >= 0) { monthRows[idx].status = '❌'; }
    else { monthRows.push({ date: dateStr, member_name: name, status:'❌', note:'' }); }
  } else {
    if (idx >= 0) {
      const note = (monthRows[idx].note || '').trim();
      if (note === '') monthRows.splice(idx, 1);   // 모두 빈값이면 행 삭제(서버 로직과 동일)
      else monthRows[idx].status = '';
    }
  }
  dateSummary = summarizeByDate(monthRows);
}

// ---- [추가] 메모+토글 로컬 반영 유틸 ----
function applySaveDayLocal(dateStr, name, isUnavail, note) {
  const idx = monthRows.findIndex(r => r.date === dateStr && r.member_name === name);
  const trimmed = (note || '').trim();

  if (idx >= 0) {
    monthRows[idx].status = isUnavail ? '❌' : '';
    monthRows[idx].note = trimmed;
    // 둘 다 빈 값이면 행 삭제(서버 로직과 동일)
    if (!isUnavail && trimmed === '') monthRows.splice(idx, 1);
  } else {
    // 없던 행인데 뭔가 값이 있으면 추가
    if (isUnavail || trimmed !== '') {
      monthRows.push({ date: dateStr, member_name: name, status: isUnavail ? '❌' : '', note: trimmed });
    }
  }
  dateSummary = summarizeByDate(monthRows);
}


// ====== 멤버 로드 & 드롭다운 ======
async function loadMembers(){
  const r = await apiGet({ action: "members" });
  if (!r.ok) throw new Error(r.error || "members failed");
  members = r.data || [];
  totalMembers = members.length || 0;

  // 옵션 채우기
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

// ====== 월 데이터 로드 & 그리드 ======
async function loadMonth(){
  const y = cur.getFullYear();
  const m = cur.getMonth()+1;
  const r = await apiGet({ action:"month", year:y, month:m });
  if (!r.ok) throw new Error(r.error || "month failed");
  monthRows = r.data || [];
  dateSummary = summarizeByDate(monthRows);
  renderGrid();
}

// ====== 타일 생성 (디자인 적용) ======
function buildDayTile(d, inMonth){
  const dStr = ymd(d);
  const sum = dateSummary.get(dStr) || {unavail:0, notes:0, rows:[]};
  const yesCount = Math.max(totalMembers - sum.unavail, 0);
  const myRow = findRow(dStr, selectedMember);

  // 루트
  const el = document.createElement('div');
  el.className = 'day';
  if (!inMonth) el.classList.add('muted');
  if (inMonth && sum.unavail === 0) el.classList.add('ok');               // ✅ 모두 가능
  if (myRow?.status === '❌') el.classList.add('unavail-me');             // 내가 ❌
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
    </div>
  `;
  el.appendChild(head);

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

  cb.addEventListener('change', () => {
    const newVal = cb.checked;
  
    // 1) 즉시 반영(화면 먼저 업데이트)
    applyToggleLocal(dStr, selectedMember, newVal);
    renderGrid();
  
    // 2) 백그라운드 저장(실패 시 되돌림)
    apiPost({ action:'toggleUnavailable', date: dStr, member_name:selectedMember, is_unavail: newVal })
      .catch(err => {
        applyToggleLocal(dStr, selectedMember, !newVal); // 되돌리기
        renderGrid();
        alert('불가 저장 실패: ' + (err?.message || err));
      });
  });

  btn.addEventListener('click', () => openDayDialog(d));

  actions.append(wrap, btn);
  el.appendChild(actions);

  return el;
}

// ====== 그리드 렌더 ======
function renderGrid(){
  monthLabel.textContent = `${cur.getFullYear()}년 ${cur.getMonth()+1}월`;
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
function openDayDialog(d){
  dayTitle.textContent = formatK(d);
  const row = findRow(ymd(d), selectedMember);
  chkUnavail.checked = row?.status === '❌';
  noteBox.value = row?.note || '';
  dayDlg.dataset.date = ymd(d);
  dayDlg.showModal();
}
btnCloseDay.onclick = () => dayDlg.close();
// ---- [교체] 저장 버튼 핸들러 (즉시 반영 + 병렬 저장) ----
btnSaveNote.onclick = () => {
  const date = dayDlg.dataset.date;
  const isUnavail = chkUnavail.checked;
  const note = noteBox.value;

  // 1) 로컬 즉시 반영 + UI 업데이트
  applySaveDayLocal(date, selectedMember, isUnavail, note);
  renderGrid();

  // 2) 버튼 상태 표시 & 다이얼로그 닫기
  btnSaveNote.disabled = true;
  btnSaveNote.textContent = '저장중…';
  dayDlg.close();

  // 3) 서버 저장을 병렬로 수행
  Promise.all([
    apiPost({ action:'toggleUnavailable', date, member_name: selectedMember, is_unavail: isUnavail }),
    apiPost({ action:'saveNote', date, member_name: selectedMember, note })
  ])
  .catch(err => {
    alert('메모 저장 실패: ' + (err?.message || err));
    // 서버와 차이가 생겼을 수 있으니 동기화
    loadMonth();
  })
  .finally(() => {
    btnSaveNote.disabled = false;
    btnSaveNote.textContent = '저장';
  });
};


// ====== 멤버 관리 모달 ======
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
      await loadMembers(); await loadMonth();
    };
    del.onclick = async () => {
      if (!confirm(`'${m.name}' 삭제할까요?`)) return;
      const r = await apiPost({ action:"deleteMember", member_id:m.member_id });
      if (!r.ok && r.error){ alert(r.error); return; }
      if (selectedMember === m.name) selectedMember = "";
      await loadMembers(); await loadMonth();
    };

    row.append(em,nm,save,del);
    memList.append(row);
  }
}
document.getElementById('manageBtn').onclick = async () => {
  fillEmojiSelect(newEmoji, EMOJI_CHOICES[0]);
  newName.value = "";
  rebuildMemberList();
  memDlg.showModal();
};
btnCloseMem.onclick = () => memDlg.close();
btnAddMem.onclick = async () => {
  const name = newName.value.trim();
  if (!name){ alert("이름을 입력하세요"); return; }
  const r = await apiPost({ action:"addMember", name, color:newEmoji.value });
  if (!r.ok && r.error){ alert(r.error); return; }
  selectedMember = name;
  await loadMembers(); await loadMonth();
  rebuildMemberList();
};

// ====== 상단 버튼 & 드롭다운 ======
document.getElementById('prevBtn').onclick = async () => { cur = addMonths(cur, -1); await loadMonth(); };
document.getElementById('nextBtn').onclick = async () => { cur = addMonths(cur, 1); await loadMonth(); };
document.getElementById('reloadBtn').onclick = async () => { await loadMembers(); await loadMonth(); };
sel.onchange = async (e) => { selectedMember = e.target.value || ""; await loadMonth(); };

// ====== 초기 로드 ======
(async function init(){
  try{
    await loadMembers();
    await loadMonth();
  }catch(err){
    console.error(err);
    alert("초기 로드 실패: " + err.message);
  }
})();
