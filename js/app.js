// ===== 설정 =====
const GAS_URL = "https://script.google.com/macros/s/AKfycbz1iIRSQrBVuKeN3Y-39qwYxeTtonZKMQ4DUYY-lk_rQfFMPRQ6tVHUZsSHuqxECJir/exec";

const WEEK = ["월","화","수","목","금","토","일"];
let today = new Date();
let curYear = today.getFullYear();
let curMonth = today.getMonth()+1;
let members = [];
let avday = [];
let memberName = null;
let modalDate = null;

// ===== API =====
async function apiGet(params){
  const url = GAS_URL + "?" + new URLSearchParams(params);
  const res = await fetch(url);
  return res.json();
}
async function apiPost(body){
  const res = await fetch(GAS_URL,{
    method:"POST", headers:{'Content-Type':'application/json'},
    body:JSON.stringify(body)
  });
  return res.json();
}

// ===== 데이터 로드 =====
async function loadMembers(){
  const r = await apiGet({action:"members"});
  members = r.data||[];
}
async function loadMonth(){
  const r = await apiGet({action:"month",year:curYear,month:curMonth});
  avday = r.data||[];
}

// ===== 렌더 =====
function setYM(){
  document.getElementById("ym").textContent = `${curYear}년 ${curMonth}월`;
}
function fmt(d){ return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`; }
function getStatusNote(dateStr,name){
  const row=avday.find(r=>r.date===dateStr && r.member_name===name);
  return {status:row?.status||"", note:row?.note||""};
}
function buildMonthMatrix(y,m){
  const first=new Date(y,m-1,1);
  const firstDow=(first.getDay()+6)%7;
  const start=new Date(y,m-1,1-firstDow);
  const weeks=[]; let d=new Date(start);
  for(let w=0;w<6;w++){
    const row=[];
    for(let i=0;i<7;i++){ row.push(new Date(d)); d.setDate(d.getDate()+1); }
    weeks.push(row);
    if(d.getMonth()!==m-1 && d.getDay()===1) break;
  }
  return weeks;
}
async function render(){
  setYM();
  const cal=document.getElementById("cal"); cal.innerHTML="";
  const weeks=buildMonthMatrix(curYear,curMonth);
  weeks.flat().forEach(d=>{
    const dateStr=fmt(d);
    const {status}=getStatusNote(dateStr,memberName||"");
    const tile=document.createElement("div");
    tile.className="tile"+((d.getMonth()+1)!==curMonth?" dim":"")+(status?"":"");
    const wd=WEEK[(d.getDay()+6)%7];
    const head=document.createElement("header");
    head.innerHTML=`<div>${d.getDate()}</div><div style="font-size:12px;color:#888">(${wd})</div>`;
    tile.appendChild(head);

    const cb=document.createElement("input");
    cb.type="checkbox"; cb.checked=(status==="❌");
    cb.addEventListener("change",async()=>{
      await apiPost({action:"toggleUnavailable",date:dateStr,member_name:memberName,is_unavail:cb.checked});
      await loadMonth(); render();
    });
    const btn=document.createElement("button"); btn.textContent="메모";
    btn.onclick=()=>openModal(dateStr);

    const actions=document.createElement("div");
    actions.className="day-actions"; actions.append(cb,"불가",btn);
    tile.appendChild(actions);

    cal.appendChild(tile);
  });
}

// ===== 모달 =====
function openModal(dateStr){
  modalDate=dateStr;
  const {status,note}=getStatusNote(dateStr,memberName||"");
  document.getElementById("md-title").textContent=dateStr;
  document.getElementById("md-unavail").checked=(status==="❌");
  document.getElementById("md-note").value=note||"";
  document.getElementById("mbg").style.display="block";
  document.getElementById("modal").style.display="block";
  renderAllNotes(dateStr);
}
function closeModal(){
  document.getElementById("mbg").style.display="none";
  document.getElementById("modal").style.display="none";
}
function renderAllNotes(dateStr){
  const wrap=document.getElementById("md-allnotes");
  wrap.innerHTML="";
  avday.filter(r=>r.date===dateStr && r.note.trim()).forEach(r=>{
    const div=document.createElement("div");
    div.textContent=`${r.member_name} ${r.status==="❌"?"(❌)":""}: ${r.note}`;
    wrap.appendChild(div);
  });
}

// ===== 이벤트 =====
document.getElementById("prevBtn").onclick=async()=>{
  curMonth--; if(curMonth<1){curMonth=12; curYear--;}
  await loadMonth(); render();
};
document.getElementById("nextBtn").onclick=async()=>{
  curMonth++; if(curMonth>12){curMonth=1; curYear++;}
  await loadMonth(); render();
};
document.getElementById("reloadBtn").onclick=async()=>{
  await loadMembers(); await loadMonth(); fillMemberSel(); render();
};
document.getElementById("md-close").onclick=closeModal;
document.getElementById("md-save").onclick=async()=>{
  await apiPost({action:"toggleUnavailable",date:modalDate,member_name:memberName,is_unavail:document.getElementById("md-unavail").checked});
  await apiPost({action:"saveNote",date:modalDate,member_name:memberName,note:document.getElementById("md-note").value});
  await loadMonth(); render(); closeModal();
};

// ===== 멤버 선택 =====
function fillMemberSel(){
  const sel=document.getElementById("memberSel"); sel.innerHTML="";
  members.forEach(m=>{
    const opt=document.createElement("option");
    opt.value=m.name; opt.textContent=`${(m.color||"")} ${m.name}`;
    sel.appendChild(opt);
  });
  if(!memberName) memberName=members[0]?.name||"";
  sel.value=memberName;
  sel.onchange=()=>{memberName=sel.value; render();};
}

// ===== 초기 부트 =====
(async()=>{
  await loadMembers(); await loadMonth(); fillMemberSel(); render();
})();
