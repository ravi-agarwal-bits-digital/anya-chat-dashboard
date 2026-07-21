const $=id=>document.getElementById(id);
const DEFAULT_DATA_FILE='data/chat_analytics.xlsx';
const DEFAULT_SHEET='Chats Export';
const CONFIG_FILE='data/dashboard-config.json';
let DATA_FILE=DEFAULT_DATA_FILE;
let SHEET=DEFAULT_SHEET;
let PUBLISHED_AT='';
let CONFIG_META={schemaVersion:0,sourceFile:'',recordCount:0,fileSize:0};
const SECURITY={PASSWORD_HASH:"2f8f998b75f4bfd79e4b9a0760d82905cfbe1fccb942ecfd6d1e8999e04c021f",SESSION_TIMEOUT_MINS:30};
const COMMERCIAL_PLAN=Object.freeze({includedConversations:65000,bundleCost:200000,platformCost:200000,overageBlockConversations:25000,overageBlockCost:100000,agentMessagesPerConversation:5});

/* ---------- crypto / auth ---------- */
async function sha256(t){const h=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(t));return Array.from(new Uint8Array(h)).map(b=>b.toString(16).padStart(2,'0')).join('');}
async function checkPassword(){
  const pwd=$("loginPassword").value;
  if(!pwd){$("loginError").textContent="Enter the access password.";return;}
  if(await sha256(pwd)===SECURITY.PASSWORD_HASH){
    window.DECRYPT_PASSPHRASE=pwd;
    sessionStorage.setItem('auth_time',Date.now().toString());
    unlockDashboard();
  }else{$("loginError").textContent="Incorrect password.";$("loginPassword").value="";}
}
function unlockDashboard(){
  $("loginGate").style.display='none';$("dashboardContent").style.display='block';startSessionTimer();
  if(!window.DATA_LOADED)loadDashboardConfig().finally(autoLoadExcel);
}
let sessionTimer,activityBound=false;
function startSessionTimer(){
  clearInterval(sessionTimer);const t=SECURITY.SESSION_TIMEOUT_MINS*60*1000;
  if(!activityBound){const reset=()=>sessionStorage.setItem('auth_time',Date.now().toString());['click','keydown','scroll','mousemove'].forEach(e=>document.addEventListener(e,reset,{passive:true}));activityBound=true;}
  sessionTimer=setInterval(()=>{if(Date.now()-Number(sessionStorage.getItem('auth_time')||0)>t)lockDashboard();},30000);
}
function clearDashboardSession(){window.DECRYPT_PASSPHRASE='';sessionStorage.removeItem('auth_time');sessionStorage.removeItem('auth_user');sessionStorage.removeItem('dk');}
function lockDashboard(){clearInterval(sessionTimer);clearDashboardSession();closeDrill();$("loginGate").style.display='flex';$("dashboardContent").style.display='none';$("loginError").textContent="Session locked. Enter the password to continue.";}
function checkExistingSession(){
  clearDashboardSession();
  return false;
}
function bindDashboardEvents(){
  $('unlockDashboardBtn')?.addEventListener('click',checkPassword);
  $('loginPassword')?.addEventListener('keydown',e=>{if(e.key==='Enter')checkPassword();});
  $('retryDataLoadBtn')?.addEventListener('click',retryDataLoad);
  document.querySelectorAll('.chip[data-range]').forEach(el=>el.addEventListener('click',()=>setRange(el.dataset.range,el)));
  $('applyCustomRangeBtn')?.addEventListener('click',applyCustom);
  const globalSearch=$('globalSearch');
  globalSearch?.addEventListener('input',e=>onGlobalSearch(e.target.value));
  globalSearch?.addEventListener('focus',e=>onGlobalSearch(e.target.value));
  globalSearch?.addEventListener('keydown',onGlobalSearchKeydown);
  document.querySelector('.drawer-bg')?.addEventListener('click',closeDrill);
  document.querySelector('.drawer-close')?.addEventListener('click',closeDrill);
  document.addEventListener('input',e=>{if(e.target.matches('[data-action="explorer-search"]'))onSearch(e.target.value);});
  document.addEventListener('click',e=>{
    const action=e.target.closest('[data-action]');if(!action)return;
    if(action.dataset.action==='export-management-summary')exportManagementSummaryPDF();
    else if(action.dataset.action==='export-leads')exportLeads();
    else if(action.dataset.action==='export-callbacks')exportCallbacks();
    else if(action.dataset.action==='export-csv')exportCSV();
    else if(action.dataset.action==='export-drill')exportDrill();
  });
}
window.addEventListener('DOMContentLoaded',()=>{
  const brandLogo=document.querySelector('.login-logo-img')?.getAttribute('src')||'';
  if(brandLogo)document.querySelectorAll('[data-brand-logo]').forEach(img=>img.setAttribute('src',brandLogo));
  bindDashboardEvents();
  checkExistingSession();
  document.addEventListener('keydown',e=>{if(e.key==='Escape')closeDrill();else if(e.key==='Tab')trapDrawerFocus(e);});
});

/* ---------- decryption ---------- */
const ENC_MAGIC="AANYAENC1";
function isEncrypted(b){if(b.length<ENC_MAGIC.length)return false;for(let i=0;i<ENC_MAGIC.length;i++)if(b[i]!==ENC_MAGIC.charCodeAt(i))return false;return true;}
async function deriveKey(pass,salt){const base=await crypto.subtle.importKey('raw',new TextEncoder().encode(pass),'PBKDF2',false,['deriveKey']);return crypto.subtle.deriveKey({name:'PBKDF2',salt,iterations:150000,hash:'SHA-256'},base,{name:'AES-GCM',length:256},false,['decrypt']);}
async function decryptData(bytes,pass){const off=ENC_MAGIC.length;const salt=bytes.slice(off,off+16),iv=bytes.slice(off+16,off+28),ct=bytes.slice(off+28);const key=await deriveKey(pass,salt);return new Uint8Array(await crypto.subtle.decrypt({name:'AES-GCM',iv},key,ct));}

/* ---------- data load ---------- */
window.DATA_LOADED=false;

let CONFIG_PROMISE=null;
async function loadDashboardConfig(){
  if(CONFIG_PROMISE)return CONFIG_PROMISE;
  DATA_FILE=DEFAULT_DATA_FILE;SHEET=DEFAULT_SHEET;PUBLISHED_AT='';
  CONFIG_META={schemaVersion:0,sourceFile:'',recordCount:0,fileSize:0};
  CONFIG_PROMISE=fetch(CONFIG_FILE,{cache:'no-store'}).then(r=>r.ok?r.json():null).then(cfg=>{
    if(!cfg||typeof cfg!=='object')return;
    const version=Number(cfg.schemaVersion||1);
    if(version!==1)console.warn('Unsupported dashboard config schema:',version);
    if(typeof cfg.dataFile==='string'&&cfg.dataFile.trim())DATA_FILE=cfg.dataFile.trim();
    if(typeof cfg.sheetName==='string'&&cfg.sheetName.trim())SHEET=cfg.sheetName.trim();
    if(typeof cfg.lastPublishedAt==='string')PUBLISHED_AT=cfg.lastPublishedAt.trim();
    CONFIG_META={
      schemaVersion:version,
      sourceFile:typeof cfg.sourceFile==='string'?cfg.sourceFile.trim():'',
      recordCount:Number(cfg.recordCount)||0,
      fileSize:Number(cfg.fileSize)||0
    };
  }).catch(()=>{});
  return CONFIG_PROMISE;
}
function show(el){['dataLoading','dataPlaceholder','mainWrap'].forEach(i=>$(i).style.display=i===el?(i==='mainWrap'?'block':'flex'):'none');}
function autoLoadExcel(){
  show('dataLoading');
  fetch(DATA_FILE,{cache:'no-store'}).then(r=>{if(r.ok)return r.arrayBuffer();throw new Error('nf');}).then(async buf=>{
    let bytes=new Uint8Array(buf);
    if(!isEncrypted(bytes)){show('dataPlaceholder');return;}
    try{bytes=await decryptData(bytes,window.DECRYPT_PASSPHRASE||'');}
    catch(e){$("dataLoading").style.display='none';$("loginError").textContent="Could not decrypt — wrong password. Re-enter.";$("loginGate").style.display='flex';$("dashboardContent").style.display='none';clearDashboardSession();return;}
    parseWorkbook(bytes);
  }).catch(()=>show('dataPlaceholder'));
}
function retryDataLoad(){window.DATA_LOADED=false;CONFIG_PROMISE=null;loadDashboardConfig().finally(autoLoadExcel);}
function parseWorkbook(bytes){
  try{
    const wb=XLSX.read(bytes,{type:'array'});
    if(!wb.SheetNames.includes(SHEET)){show('dataPlaceholder');return;}
    buildRecords(XLSX.utils.sheet_to_json(wb.Sheets[SHEET],{defval:""}));
    window.DATA_LOADED=true;show('mainWrap');initRangeBounds();render();renderMethod();
  }catch(e){show('dataPlaceholder');}
}

/* ---------- helpers ---------- */
function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function escCSV(v){
  let s=String(v==null?'':v);
  if(/^[\t\r\n ]*[=+\-@]/.test(s))s="'"+s;
  s=s.replace(/"/g,'""');
  return /[",\n\r]/.test(s)?`"${s}"`:s;
}
function pct(n,d){return d>0?Math.round(100*n/d):0;}
const MON={Jan:1,Feb:2,Mar:3,Apr:4,May:5,Jun:6,Jul:7,Aug:8,Sep:9,Oct:10,Nov:11,Dec:12};
const MONN=['','Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
function parseIST(s){s=String(s||'');const m=s.match(/(\d{1,2})\s+(\w{3})\s+(\d{4}),\s+(\d{1,2}):(\d{2}):(\d{2})\s*(AM|PM)/i);if(!m)return null;let h=parseInt(m[4],10)%12;if(/pm/i.test(m[7]))h+=12;const mon=MON[m[2].slice(0,1).toUpperCase()+m[2].slice(1,3).toLowerCase()];if(!mon)return null;return {year:+m[3],mon,day:+m[1],hour:h,min:+m[5],key:(+m[3])*10000+mon*100+(+m[1])};}
// Signed-in admin sees full values — no masking or truncation anywhere on screen.
function maskPhone(p){return String(p==null?'':p);}
function maskEmail(e){return String(e==null?'':e);}
function maskId(id){return String(id==null?'':id);}
// 12-hour time to match the source export exactly (e.g. "09:19 PM")
function fmtTime(o){const h=o.hour%12||12;return `${String(h).padStart(2,'0')}:${String(o.min).padStart(2,'0')} ${o.hour<12?'AM':'PM'}`;}


function extractFormValue(text,label){
  const target=String(label||'').trim().toLowerCase();
  for(const rawLine of String(text||'').split(/\r?\n/)){
    const line=rawLine.replace(/^\s*(?:User|Agent)\s*:\s*/i,'').trim();
    const pos=line.indexOf(':');if(pos<0)continue;
    if(line.slice(0,pos).trim().toLowerCase()===target)return line.slice(pos+1).trim();
  }
  return '';
}
function normalizeEmail(v){const s=String(v||'').trim().toLowerCase();return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)?s:'';}
function normalizePhone(raw,countryCode=''){
  let p=String(raw||'').trim();if(!p)return '';
  let digits=p.replace(/\D/g,'');let cc=String(countryCode||'').replace(/\D/g,'');
  if(/^0[6-9]\d{9}$/.test(digits))digits=digits.slice(1);
  if(/^[6-9]\d{9}$/.test(digits))return '+91'+digits;
  if(/^91[6-9]\d{9}$/.test(digits))return '+'+digits;
  if(cc&&digits&&!digits.startsWith(cc))digits=cc+digits;
  if(digits.length>=8&&digits.length<=15)return '+'+digits;
  return '';
}
function isAnswerGapQuestion(q){return !!(q&&(q.gated||q.deflected));}
function recordGapCount(r){return r.questions.filter(isAnswerGapQuestion).length;}
function keyToUTCDate(key){if(!validDateKey(key))return null;const o=keyToDate(key);return new Date(Date.UTC(o.y,o.m-1,o.d));}
function utcDateToKey(dt){return dt.getUTCFullYear()*10000+(dt.getUTCMonth()+1)*100+dt.getUTCDate();}
function addDaysToKey(key,days){const dt=keyToUTCDate(key);if(!dt)return 0;dt.setUTCDate(dt.getUTCDate()+days);return utcDateToKey(dt);}
function daysInclusive(from,to){const a=keyToUTCDate(from),b=keyToUTCDate(to);if(!a||!b)return 0;return Math.floor((b-a)/86400000)+1;}
function metricDelta(current,previous,kind='count'){
  if(previous==null)return {text:'No prior period',cls:'flat'};
  const d=current-previous;
  if(kind==='rate')return {text:`${d>0?'+':''}${d.toFixed(1)} pp vs prior`,cls:d>0?'up':d<0?'down':'flat'};
  if(previous===0)return {text:current?'+100% vs prior':'No change',cls:current?'up':'flat'};
  const pc=Math.round((d/previous)*100);return {text:`${pc>0?'+':''}${pc}% vs prior`,cls:pc>0?'up':pc<0?'down':'flat'};
}
/* ---------- conversation parsing ---------- */
const RE_FORM=/^(full name|email address|country code|mobile number|program type|interested program|state|city|preferred callback date|preferred callback time|privacy notice)\s*:/i;
const GATE="may i quickly take your details";
const DEFLECT="here to help with questions related to";
function splitTurns(text){
  text=String(text||'');const re=/^(User|Agent):[ \t]*/gm;const idx=[];let m;
  while((m=re.exec(text))!==null){idx.push({role:m[1],start:m.index+m[0].length,labelStart:m.index});}
  const out=[];for(let i=0;i<idx.length;i++){const end=i+1<idx.length?idx[i+1].labelStart:text.length;out.push({role:idx[i].role,text:text.slice(idx[i].start,end).trim()});}
  return out;
}
const THEMES=[
  ['Fees / cost',/\bfee|cost|price|how much|charges|expensive|\bpay\b|payment/i],
  ['Scholarship / EMI',/scholarship|\bemi\b|install|\bloan|financial aid|discount|concession/i],
  ['Eligibility',/eligib|qualif|criteria|can i apply|am i eligible|requirement|percentage|\bmarks\b|gap year|backlog|12th|graduation/i],
  ['Curriculum',/curricul|syllabus|subject|course structure|\bmodule|what will i (study|learn)|topics/i],
  ['How to apply',/how (do|can|to)\b.{0,14}apply|application|admission process|enroll|register|deadline|last date|how to join|sign ?up/i],
  ['Duration / schedule',/duration|how long|how many years|months|timeline|class tim|schedule|weekend|live class|recorded|self ?paced/i],
  ['Placement / jobs',/placement|\bjob|career|salary|\bcompan|internship|hiring|package/i],
  ['Recognition / validity',/\bvalid|recogni|\bugc\b|accredit|approved|government|same as|on ?campus|degree worth/i],
  ['Math / bridge',/\bmath|bridge course|maths requirement|without math/i],
];
const PROGRAMS=[
  ['Data Science & AI',/data science/i],
  ['AI / ML',/machine learning|artificial intelligence|\bai engineering|\bai\b|\bml\b/i],
  ['Business / MBA',/\bmba|business analytics|management/i],
  ['Cyber / Software',/cyber|software|computer science|\bcs\b/i],
];
const OUTCOMES={
  CALLBACK:'Callback requested',
  CONTACT:'Contact captured, no callback request',
  GATE:'Left at the details gate',
  RECOVERY:'High-intent, no contact captured',
  ENGAGED:'Engaged then exited (no contact)',
  LOW:'Low-engagement exit'
};
function tagThemes(t){const o=[];for(const[l,re]of THEMES)if(re.test(t))o.push(l);return o;}
function tagPrograms(t){const o=[];for(const[l,re]of PROGRAMS)if(re.test(t))o.push(l);return o;}
function levelOf(t){if(/\bmsc|m\.sc|mtech|m\.tech|master|post.?grad|\bpg\b/i.test(t))return'PG';if(/\bbsc|b\.sc|\bbs\b|bachelor|undergrad|\bug\b|class 12|12th/i.test(t))return'UG';return null;}

let RECORDS=[],VIEW=[],PEOPLE=[],DATA_MIN=0,DATA_MAX=0,GEN_AT="";

function buildRecords(rows){
  const quality={sourceRows:rows.length,validRows:0,invalidDates:0,duplicates:0,blankIds:0,blankConversations:0};
  const seenRows=new Set();
  const built=[];
  rows.forEach((r,i)=>{
    const created=parseIST(r["Chat Created At (IST)"]);
    const conv=String(r["Full Conversation"]||"");
    const chatId=String(r["Chat ID"]||'').trim();
    if(!created){quality.invalidDates++;return;}
    if(!chatId)quality.blankIds++;
    if(!conv.trim())quality.blankConversations++;
    const fingerprint=(chatId||conv.slice(0,160))+'|'+String(r["Chat Created At (IST)"]||'');
    if(seenRows.has(fingerprint)){quality.duplicates++;return;}seenRows.add(fingerprint);

    const turns=splitTurns(conv);
    const questions=[];let gated=0,deflected=0,repeated=0;const seen=new Set();let gateCount=0;
    let lastAgentLow="",meaningfulUserMessages=0,exchangeCount=0;
    for(let j=0;j<turns.length;j++){
      const tn=turns[j];
      if(tn.role==='User'){
        const txt=tn.text;
        if(RE_FORM.test(txt))continue;
        const norm=txt.toLowerCase().replace(/[^a-z0-9 ]/g,'').replace(/\s+/g,' ').trim();
        if(!norm)continue;
        meaningfulUserMessages++;
        if(seen.has(norm))repeated++;seen.add(norm);
        let isGated=false,isDef=false;const next=turns[j+1];
        if(next&&next.role==='Agent'){
          exchangeCount++;
          const na=next.text.toLowerCase();
          if(na.includes(GATE)){isGated=true;gated++;}
          else if(na.includes(DEFLECT)){isDef=true;deflected++;}
        }
        questions.push({text:txt,themes:tagThemes(txt),gated:isGated,deflected:isDef});
      }else{
        if(tn.text.toLowerCase().includes(GATE))gateCount++;
        lastAgentLow=tn.text.toLowerCase();
      }
    }

    const agentMsgs=Number(r["Agent Messages"]||0),tokens=Number(r["Total Tokens"]||0);
    const cbDate=extractFormValue(conv,'preferred callback date');
    const cbTime=extractFormValue(conv,'preferred callback time');
    const countryCode=extractFormValue(conv,'country code');
    const mobile=extractFormValue(conv,'mobile number');
    const rawName=extractFormValue(conv,'full name');
    const formEmail=extractFormValue(conv,'email address');
    const allUserText=turns.filter(t=>t.role==='User').map(t=>t.text).join(' ');
    const emailMatch=allUserText.match(/[\w.\-+]+@[\w.\-]+\.\w+/);
    const canonicalEmail=normalizeEmail(formEmail||(emailMatch?emailMatch[0]:''));
    const canonicalPhone=normalizePhone(mobile,countryCode);
    const rawPhone=canonicalPhone;
    const rawEmail=canonicalEmail;
    const contactCaptured=Boolean(canonicalPhone||canonicalEmail);
    const userText=questions.map(q=>q.text).join(' ');
    const explicitCallbackIntent=/\b(call\s*back|callback|call me|please call|contact me|get back to me|speak to (a |an )?counsellor)\b/i.test(userText);
    const callbackBooked=contactCaptured&&Boolean(cbDate||cbTime||explicitCallbackIntent);
    const blob=(r["Title"]||'')+' '+conv;
    const programs=tagPrograms(blob),level=levelOf(blob);
    const engaged=meaningfulUserMessages>=2||exchangeCount>=2;
    const bounce=!engaged&&meaningfulUserMessages<=1;
    const highIntent=!contactCaptured&&(explicitCallbackIntent||meaningfulUserMessages>=3||repeated>0||(programs.length>0&&questions.length>0)||questions.some(q=>q.themes.some(th=>['Fees / cost','Scholarship / EMI','Eligibility','How to apply','Placement / jobs','Recognition / validity'].includes(th))));

    let outcome;
    if(callbackBooked)outcome=OUTCOMES.CALLBACK;
    else if(contactCaptured)outcome=OUTCOMES.CONTACT;
    else if(lastAgentLow.includes(GATE))outcome=OUTCOMES.GATE;
    else if(bounce)outcome=OUTCOMES.LOW;
    else if(highIntent)outcome=OUTCOMES.RECOVERY;
    else outcome=OUTCOMES.ENGAGED;

    built.push({
      idx:i,id:chatId,title:String(r["Title"]||'(untitled)'),
      created,key:created.key,hour:created.hour,createdRaw:String(r["Chat Created At (IST)"]||''),
      agentMsgs,tokens,depth:agentMsgs,userMsgCount:meaningfulUserMessages,exchangeCount,engaged,bounce,
      questions,gated,deflected,gapCount:gated+deflected,repeated,gateCount,loop:gateCount>=2,
      contactCaptured,callbackBooked,explicitCallbackIntent,cbDate,cbTime,outcome,highIntent,
      programs,level,summary:String(r["Summary"]||''),conv,
      rawName:rawName.trim(),rawEmail,rawPhone,
      personKey:canonicalPhone||canonicalEmail
    });
  });
  RECORDS=built;
  quality.validRows=RECORDS.length;window.DATA_QUALITY=quality;
  const keys=RECORDS.map(r=>r.key).filter(Boolean).sort((a,b)=>a-b);
  DATA_MIN=keys[0]||0;DATA_MAX=keys[keys.length-1]||0;
}

/* ---------- people grouping (computed per view) ---------- */
function buildPeople(records){
  const map={};
  records.forEach(r=>{
    if(!r.personKey)return;
    if(!map[r.personKey])map[r.personKey]={key:r.personKey,idxs:[],name:'',email:'',phone:'',q:0,maxDepth:0,callback:false,programs:new Set(),lastKey:0};
    const p=map[r.personKey];p.idxs.push(r.idx);p.q+=r.questions.length;p.maxDepth=Math.max(p.maxDepth,r.depth);if(r.callbackBooked)p.callback=true;r.programs.forEach(x=>p.programs.add(x));if(r.rawName&&!p.name)p.name=r.rawName;if(r.rawEmail&&!p.email)p.email=r.rawEmail;if(r.rawPhone&&!p.phone)p.phone=r.rawPhone;if(r.key>p.lastKey)p.lastKey=r.key;
  });
  return Object.values(map).map(p=>{
    const chats=p.idxs.length;let score=0;if(p.callback)score+=45;score+=Math.min(p.maxDepth,12)*3;score+=Math.min(p.q,15)*2;if(chats>1)score+=15;if(p.programs.size)score+=8;score=Math.min(100,score);
    const temp=score>=65?'High':score>=38?'Medium':'Low',tempClass=score>=65?'hot':score>=38?'warm':'cold';
    return {...p,chats,score,temp,tempClass,programs:[...p.programs]};
  });
}

/* ---------- date range ---------- */
let RANGE={mode:'all',from:null,to:null};
function validDateKey(k){return Number.isFinite(Number(k))&&Number(k)>=19000101&&Number(k)<=21001231;}
function keyToDate(k){k=Number(k)||0;return {y:Math.floor(k/10000),m:Math.floor(k/100)%100,d:k%100};}
function keyToInput(k){if(!validDateKey(k))return '';const o=keyToDate(k);return `${o.y}-${String(o.m).padStart(2,'0')}-${String(o.d).padStart(2,'0')}`;}
function inputToKey(s){const m=String(s).match(/(\d{4})-(\d{2})-(\d{2})/);return m?(+m[1])*10000+(+m[2])*100+(+m[3]):0;}
function fromKeyLabel(k){if(!validDateKey(k))return 'No valid date';const o=keyToDate(k);return `${o.d} ${MONN[o.m]||''} ${o.y}`.replace(/\s+/g,' ').trim();}
function initRangeBounds(){
  if(!validDateKey(DATA_MIN)||!validDateKey(DATA_MAX))return;
  RANGE={mode:'all',from:DATA_MIN,to:DATA_MAX};
  $("fromDate").value=keyToInput(DATA_MIN);$("toDate").value=keyToInput(DATA_MAX);
  $("fromDate").min=$("toDate").min=keyToInput(DATA_MIN);$("fromDate").max=$("toDate").max=keyToInput(DATA_MAX);GEN_AT=keyToInput(DATA_MAX);
}
function ensureValidRange(){
  if(!validDateKey(DATA_MIN)||!validDateKey(DATA_MAX))return false;
  if(!validDateKey(RANGE.from)||!validDateKey(RANGE.to)||RANGE.from>RANGE.to){RANGE={mode:'all',from:DATA_MIN,to:DATA_MAX};}
  return true;
}
function localDateKey(offsetDays=0){
  const dt=new Date();dt.setHours(0,0,0,0);dt.setDate(dt.getDate()+offsetDays);
  return dt.getFullYear()*10000+(dt.getMonth()+1)*100+dt.getDate();
}
function keyMinusDays(key,days){
  const o=keyToDate(key);const dt=new Date(Date.UTC(o.y,o.m-1,o.d));dt.setUTCDate(dt.getUTCDate()-days);
  return dt.getUTCFullYear()*10000+(dt.getUTCMonth()+1)*100+dt.getUTCDate();
}
function setActiveRange(mode,el){
  document.querySelectorAll('.chip[data-range]').forEach(c=>c.classList.remove('active'));
  if(el)el.classList.add('active');else{const c=document.querySelector(`.chip[data-range="${mode}"]`);if(c)c.classList.add('active');}
  const panel=$("customRangePanel");if(panel)panel.style.display=mode==='custom'?'flex':'none';
}
function setRange(mode,el){
  if(!ensureValidRange())return;
  setActiveRange(mode,el);
  if(mode==='today')RANGE={mode,from:localDateKey(0),to:localDateKey(0)};
  else if(mode==='yesterday')RANGE={mode,from:localDateKey(-1),to:localDateKey(-1)};
  else if(mode==='7')RANGE={mode,from:localDateKey(-6),to:localDateKey(0)};
  else if(mode==='30')RANGE={mode,from:localDateKey(-29),to:localDateKey(0)};
  else if(mode==='all')RANGE={mode,from:DATA_MIN,to:DATA_MAX};
  else{setActiveRange('custom',el);return;}
  render();
}
function applyCustom(){
  if(!ensureValidRange())return;
  let f=inputToKey($("fromDate").value),t=inputToKey($("toDate").value);
  if(!f)f=DATA_MIN;if(!t)t=DATA_MAX;if(f>t)[f,t]=[t,f];
  RANGE={mode:'custom',from:f,to:t};setActiveRange('custom');render();
}
function filterRecords(){if(!ensureValidRange())return [];return RECORDS.filter(r=>r.key>=RANGE.from&&r.key<=RANGE.to);}

/* =================== RENDER =================== */
let SORT={col:'key',dir:-1},SEARCH='',EXPANDED=new Set();
function render(){
  if(!ensureValidRange()){
    $("rangeSummary").textContent="Anya's chat conversations";
    $("freshness").textContent="No valid chat dates found in the uploaded export";
    $("report").innerHTML=`<div class="panel empty" style="margin-top:30px">No valid dated chats were found in the uploaded export.</div>`;
    return;
  }
  VIEW=filterRecords();PEOPLE=buildPeople(VIEW);
  const rangeName=currentRangeName();
  $("rangeSummary").textContent=`Anya's chat conversations · ${rangeName} · ${fromKeyLabel(RANGE.from)} – ${fromKeyLabel(RANGE.to)}`;
  const q=window.DATA_QUALITY||{};
  const publish=PUBLISHED_AT?`published ${new Date(PUBLISHED_AT).toLocaleString('en-IN',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'})}`:`data through ${GEN_AT||keyToInput(DATA_MAX)}`;
  const excluded=(q.invalidDates||0)+(q.duplicates||0);
  const sourceMeta=CONFIG_META.sourceFile?` · source ${CONFIG_META.sourceFile}`:'';
  const rowMismatch=CONFIG_META.recordCount&&q.sourceRows&&CONFIG_META.recordCount!==q.sourceRows?` · config expected ${CONFIG_META.recordCount.toLocaleString()} rows`:'';
  $("freshness").textContent=`Showing ${VIEW.length.toLocaleString()} of ${RECORDS.length.toLocaleString()} chats · ${publish}${sourceMeta}${excluded?` · ${excluded} excluded in quality checks`:''}${rowMismatch}`;
  if(!VIEW.length){$("report").innerHTML=`<div class="panel empty" style="margin-top:30px">No chats in this range. The data runs ${fromKeyLabel(DATA_MIN)} to ${fromKeyLabel(DATA_MAX)}.</div>`;return;}
  $("report").innerHTML=[secManagementSummary(),secCommercialUsage(),secActionQueue(),secAnswerGap(),secFunnel(),secKPIs(),secQuestions(),secLeads(),secSerial(),secCallbacks(),secDropoff(),secVolume(),secPrograms(),secDepth(),secExplorer()].join('');
  bindInteractions();syncChatShellNav();decorateResponsiveTables();makeDashboardInteractive();
}


function currentRangeName(){return {today:'Today',yesterday:'Yesterday','7':'Last 7 Days','30':'Last 30 Days',all:'All',custom:'Custom Range'}[RANGE.mode]||'Selected Range';}
function selectedRangeText(){return `${currentRangeName()} · ${fromKeyLabel(RANGE.from)} – ${fromKeyLabel(RANGE.to)}`;}
function computeMetricsFor(records){
  const people=buildPeople(records),n=records.length,eng=records.filter(r=>r.engaged).length,con=records.filter(r=>r.contactCaptured).length,cb=records.filter(r=>r.callbackBooked).length;
  let tQ=0,gQ=0;const tm={};THEMES.forEach(t=>tm[t[0]]={asked:0,gap:0});
  records.forEach(r=>r.questions.forEach(q=>{tQ++;if(isAnswerGapQuestion(q))gQ++;q.themes.forEach(th=>{tm[th].asked++;if(isAnswerGapQuestion(q))tm[th].gap++;});}));
  const topTheme=Object.entries(tm).sort((a,b)=>b[1].asked-a[1].asked)[0]||['—',{asked:0,gap:0}];
  const topGap=Object.entries(tm).sort((a,b)=>b[1].gap-a[1].gap)[0]||['—',{asked:0,gap:0}];
  const hot=people.filter(p=>(p.phone||p.email)&&p.score>=65).length;
  const warm=people.filter(p=>(p.phone||p.email)&&p.score>=38&&p.score<65).length;
  const serial=people.filter(p=>p.chats>1).length;
  const noContact=n-con;
  const recoverable=records.filter(r=>r.highIntent&&!r.contactCaptured).length;
  const avgDepth=n?(records.reduce((a,r)=>a+r.depth,0)/n):0;
  const days=new Set(records.map(r=>r.key)).size;
  const highestRisk=gQ?`${topGap[0]} (${topGap[1].gap} gated/deflected)`:'No major answer gap detected';
  return {records,people,n,eng,con,cb,tQ,gQ,topTheme,topGap,hot,warm,serial,noContact,recoverable,avgDepth,days,engagedPct:pct(eng,n),contactPct:pct(con,n),callbackPct:pct(cb,n),dropPct:pct(noContact,n),gapPct:pct(gQ,tQ),highestRisk};
}
function previousPeriodRecords(){
  if(RANGE.mode==='all')return null;
  const span=daysInclusive(RANGE.from,RANGE.to);if(!span)return null;
  const prevTo=addDaysToKey(RANGE.from,-1),prevFrom=addDaysToKey(prevTo,-span+1);
  return RECORDS.filter(r=>r.key>=prevFrom&&r.key<=prevTo);
}
function computeManagementMetrics(){
  const current=computeMetricsFor(VIEW),prevRecords=previousPeriodRecords(),previous=prevRecords?computeMetricsFor(prevRecords):null;
  current.previous=previous;
  current.deltas={
    chats:metricDelta(current.n,previous?.n,'count'),
    engaged:metricDelta(current.engagedPct,previous?.engagedPct,'rate'),
    contact:metricDelta(current.contactPct,previous?.contactPct,'rate'),
    callbacks:metricDelta(current.cb,previous?.cb,'count'),
    gap:metricDelta(current.gapPct,previous?.gapPct,'rate')
  };
  if(current.deltas.gap.cls==='up')current.deltas.gap.cls='down';else if(current.deltas.gap.cls==='down')current.deltas.gap.cls='up';
  return current;
}
function computeCommercialUsage(records=VIEW){
  const plan=COMMERCIAL_PLAN;
  const billableConversations=records.reduce((total,r)=>total+Math.ceil(Math.max(0,Number(r.agentMsgs)||0)/plan.agentMessagesPerConversation),0);
  const rawSessions=records.length;
  const agentMessages=records.reduce((total,r)=>total+Math.max(0,Number(r.agentMsgs)||0),0);
  const coverageDays=daysInclusive(RANGE.from,RANGE.to);
  const usedPct=plan.includedConversations?billableConversations/plan.includedConversations:0;
  const remaining=Math.max(0,plan.includedConversations-billableConversations);
  const projectedAnnual=coverageDays?Math.round(billableConversations/coverageDays*365):0;
  const projectedOverage=Math.max(0,projectedAnnual-plan.includedConversations);
  const projectedTopUps=projectedOverage?Math.ceil(projectedOverage/plan.overageBlockConversations):0;
  return {
    ...plan,rawSessions,agentMessages,billableConversations,coverageDays,usedPct,remaining,projectedAnnual,projectedOverage,projectedTopUps,
    bundleAllocation:billableConversations/plan.includedConversations*plan.bundleCost,
    effectiveAllocation:billableConversations/plan.includedConversations*(plan.bundleCost+plan.platformCost)
  };
}
function secManagementSummary(){
  const m=computeManagementMetrics(),riskClass=m.gapPct>=30?'risk':'good',priority=m.hot+m.warm;
  const d=m.deltas;
  return `<section id="sec-management"><div class="panel management-panel">
    <div class="management-head"><div><div class="management-kicker">Management Summary</div><div class="management-title">CEO-ready view of chat demand</div><div class="management-range">${esc(selectedRangeText())} · ${m.n.toLocaleString()} chats across ${m.days} active day${m.days===1?'':'s'} · ${(window.DATA_QUALITY?.validRows||RECORDS.length).toLocaleString()} analysed</div></div><button class="management-export" data-action="export-management-summary">Export CEO Summary</button></div>
    <div class="management-kpi-strip">
      <div class="management-kpi"><div class="v">${m.n.toLocaleString()}</div><div class="l">Total chats</div><div class="delta ${d.chats.cls}">${d.chats.text}</div></div>
      <div class="management-kpi good"><div class="v">${m.engagedPct}%</div><div class="l">Engaged rate</div><div class="delta ${d.engaged.cls}">${d.engaged.text}</div></div>
      <div class="management-kpi good"><div class="v">${m.contactPct}%</div><div class="l">Contact capture</div><div class="delta ${d.contact.cls}">${d.contact.text}</div></div>
      <div class="management-kpi gold"><div class="v">${m.cb.toLocaleString()}</div><div class="l">Callback requests</div><div class="delta ${d.callbacks.cls}">${d.callbacks.text}</div></div>
      <div class="management-kpi ${m.gapPct>=30?'risk':''}"><div class="v">${m.gapPct}%</div><div class="l">Answer gap</div><div class="delta ${d.gap.cls}">${d.gap.text}</div></div>
    </div>
    <div class="management-grid"><div class="management-story">Anya handled <b>${m.n.toLocaleString()} conversations</b>. Immediate operating priorities are <b>${m.cb.toLocaleString()} callback requests</b>, <b>${m.recoverable.toLocaleString()} high-intent chats without captured contact</b>, and <b>${priority} high-priority prospects</b>. Top demand is <b>${esc(m.topTheme[0])}</b>; the first knowledge improvement area is <span class="${riskClass}">${esc(m.highestRisk)}</span>.</div>
      <div class="management-points"><div class="management-point"><b>Call first</b><span>${m.cb.toLocaleString()} callback requests detected for counsellor review.</span></div><div class="management-point"><b>Recover next</b><span>${m.recoverable.toLocaleString()} high-intent conversations ended without usable contact details.</span></div><div class="management-point"><b>Fix knowledge</b><span>${m.gapPct}% answer-gap rate; start with ${esc(m.topGap[0])}.</span></div></div>
    </div></div></section>`;
}
function secCommercialUsage(){
  const c=computeCommercialUsage(VIEW);
  const projectedWithinPlan=c.projectedAnnual<=c.includedConversations;
  const fmtRupees=value=>`₹${Math.round(value).toLocaleString('en-IN')}`;
  const coverage=c.coverageDays?`${selectedRangeText()} · ${c.coverageDays} calendar days`:'No dated chats available';
  const projectionText=projectedWithinPlan?`${(c.includedConversations-c.projectedAnnual).toLocaleString()} projected buffer`:`${c.projectedOverage.toLocaleString()} projected over plan`;
  const bands=[['0 replies',r=>r.agentMsgs<=0],['1–5 replies',r=>r.agentMsgs>=1&&r.agentMsgs<=5],['6–10 replies',r=>r.agentMsgs>=6&&r.agentMsgs<=10],['11–15 replies',r=>r.agentMsgs>=11&&r.agentMsgs<=15],['16+ replies',r=>r.agentMsgs>=16]];
  const bandData=bands.map(([label,test])=>{const records=VIEW.filter(test),units=records.reduce((total,r)=>total+Math.ceil(r.agentMsgs/c.agentMessagesPerConversation),0);return {label,records,units};});
  const maxSessions=Math.max(1,...bandData.map(x=>x.records.length));
  return `<section id="sec-commercial"><div class="shead"><span class="n">00</span><h2>Conversation plan</h2></div><div class="sdesc">Commercial usage follows the date filter above. Choose <b>All</b> for the full published-data plan view; click any card or billing band to inspect the underlying chats.</div><div class="panel plan-panel">
    <div class="plan-head"><div><div class="plan-kicker">Commercial runway</div><h3>${projectedWithinPlan?'Within the annual plan':'Top-up likely at current run rate'}</h3><p>${esc(coverage)} · ${projectionText}.</p></div><div class="plan-contract"><b>₹4,00,000</b><span>annual commitment</span><small>65,000 conversations included</small></div></div>
    <div class="plan-kpis">
      <div class="plan-kpi clk" data-drill="commercial-all"><div class="plan-value">${c.rawSessions.toLocaleString()}</div><div class="plan-label">Raw exported sessions</div><div class="plan-note">Every dashboard chat before billing</div></div>
      <div class="plan-kpi clk" data-drill="commercial-replies"><div class="plan-value">${c.agentMessages.toLocaleString()}</div><div class="plan-label">Recorded Anya replies</div><div class="plan-note">Raw <span class="mono">Agent Messages</span> total</div></div>
      <div class="plan-kpi billable clk" data-drill="commercial-billable"><div class="plan-value">${c.billableConversations.toLocaleString()}</div><div class="plan-label">Billable conversations</div><div class="plan-note">Rounded up per session, not in total</div></div>
      <div class="plan-kpi remaining"><div class="plan-value">${c.remaining.toLocaleString()}</div><div class="plan-label">Included balance</div><div class="plan-note">Of ${c.includedConversations.toLocaleString()} annual conversations</div></div>
    </div>
    <div class="plan-progress" aria-label="${c.billableConversations.toLocaleString()} of ${c.includedConversations.toLocaleString()} included conversations used"><div><b>${Math.round(c.usedPct*1000)/10}% used</b><span>${c.billableConversations.toLocaleString()} billed · ${c.remaining.toLocaleString()} remaining</span></div><div class="track"><div class="seg one" style="width:${Math.min(100,c.usedPct*100)}%"></div></div></div>
    <div class="plan-grid"><div class="plan-breakdown"><h4>What creates billable units</h4><div class="cap">Raw sessions by reply depth. Each band opens its underlying chats and can be exported from the drawer.</div>${bandData.map((x,i)=>`<div class="plan-band clk" data-drill="commercial-band" data-arg="${i}"><div><b>${x.label}</b><span>${x.records.length.toLocaleString()} raw sessions · ${x.units.toLocaleString()} billed</span></div><div class="track"><div class="seg ${i===0?'gap':i===1?'blu':'one'}" style="width:${Math.round(x.records.length/maxSessions*100)}%"></div></div></div>`).join('')}</div><div class="plan-projection"><div class="plan-kicker">Run-rate projection</div><b>${c.projectedAnnual.toLocaleString()}</b><span>projected annual conversations</span><p>Based on ${c.coverageDays.toLocaleString()} published calendar days. ${projectedWithinPlan?`That is ${(c.includedConversations-c.projectedAnnual).toLocaleString()} below the included plan.`:`That is ${c.projectedOverage.toLocaleString()} above plan; ${c.projectedTopUps} top-up block${c.projectedTopUps===1?'':'s'} would be needed at this run rate.`}</p><dl><div><dt>Bundle allocation</dt><dd>${fmtRupees(c.bundleAllocation)}</dd></div><div><dt>Effective allocation</dt><dd>${fmtRupees(c.effectiveAllocation)}</dd></div></dl></div></div>
    <div class="plan-note-box"><b>Billing rule:</b> one conversation covers up to five user–Anya exchanges (ten messages). We calculate each exported session as <span class="mono">ceil(Anya replies ÷ 5)</span>. The projection is a run-rate estimate, not an invoice forecast.</div>
  </div></section>`;
}
function secActionQueue(){
  const m=computeManagementMetrics();
  return `<section id="sec-action"><div class="shead"><span class="n">00</span><h2>Action Queue</h2></div><div class="sdesc">A daily operating strip for admissions: who to call, which high-intent chats to recover, and what Anya should answer better.</div><div class="action-strip"><div class="action-card clk good" data-drill="callback"><div class="label">Call first</div><div class="value">${m.cb.toLocaleString()}</div><div class="note">Callback requests detected</div></div><div class="action-card clk gold" data-drill="recovery"><div class="label">Recover next</div><div class="value">${m.recoverable.toLocaleString()}</div><div class="note">High-intent chats without captured contact</div></div><div class="action-card clk hot" data-drill="gap"><div class="label">Fix knowledge</div><div class="value">${m.gapPct}%</div><div class="note">Questions gated or generically deflected</div></div><div class="action-card clk" data-drill="theme" data-arg="${esc(m.topTheme[0])}"><div class="label">Top demand</div><div class="value" style="font-size:27px">${esc(m.topTheme[0])}</div><div class="note">${m.topTheme[1].asked} classified question signal${m.topTheme[1].asked===1?'':'s'}</div></div></div><div class="queue-suggestion"><b>Suggested cadence:</b> review callbacks every morning, recover high-intent no-contact chats, and update Anya’s FAQ/knowledge base weekly from the answer-gap list.</div></section>`;
}
function exportManagementSummaryPDF(){
  if(!VIEW.length){alert('No chats in the selected range.');return;}
  const m=computeManagementMetrics(),generated=new Date().toLocaleString('en-IN',{day:'numeric',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'});
  const logo=(document.querySelector('.top-logo-img')||document.querySelector('.side-logo'))?.src||'';
  const priority=m.hot+m.warm,d=m.deltas;
  const html=`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Anya CEO Summary</title><style>@page{size:A4;margin:15mm}*{box-sizing:border-box}body{font-family:Inter,Arial,sans-serif;color:#0b1f3a;line-height:1.43;margin:0;background:#fff}.head{display:grid;grid-template-columns:155px 1fr;gap:18px;align-items:start;border-bottom:1px solid #dce4ef;padding-bottom:14px;margin-bottom:15px}.logo{width:145px;max-height:50px;object-fit:contain}.kicker{font-size:9px;text-transform:uppercase;letter-spacing:.16em;color:#b08a3c;font-weight:900}.title{font-family:Georgia,'Times New Roman',serif;font-size:31px;line-height:.98;letter-spacing:-.05em;font-weight:900;margin-top:4px}.range{color:#667085;font-size:11px;margin-top:6px}.headline{border:1px solid #dce4ef;border-radius:18px;background:#f8fbff;padding:14px 16px}.headline b{font-family:Georgia,'Times New Roman',serif;font-size:21px;letter-spacing:-.035em}.headline span{display:block;color:#667085;font-size:11.5px;margin-top:4px}.grid{display:grid;grid-template-columns:repeat(5,1fr);gap:8px;margin:12px 0}.metric{border:1px solid #dce4ef;border-radius:14px;padding:10px;background:#fff}.metric b{font-family:Georgia,'Times New Roman',serif;font-size:24px;display:block;line-height:1;letter-spacing:-.04em}.metric span{font-size:8.7px;color:#667085;text-transform:uppercase;letter-spacing:.07em;font-weight:900;display:block;margin-top:6px}.metric i{font-style:normal;font-size:8.7px;color:#667085;display:block;margin-top:5px}.story{border:1px solid #dce4ef;border-radius:16px;padding:13px 14px;font-size:12.3px;color:#445269}.story b{color:#0b1f3a}.sectionTitle{font-family:Georgia,'Times New Roman',serif;font-size:18px;letter-spacing:-.035em;margin:14px 0 7px}.actions{display:grid;grid-template-columns:repeat(3,1fr);gap:9px}.point{border:1px solid #ead7b4;background:#fbf6ec;border-radius:14px;padding:11px;color:#445269;font-size:11.4px;min-height:76px}.point b{display:block;color:#0b1f3a;font-size:12px;margin-bottom:4px}.mini{display:grid;grid-template-columns:1fr 1fr;gap:9px}.box{border:1px solid #dce4ef;border-radius:14px;padding:10px;font-size:11.3px;color:#445269}.box b{display:block;color:#0b1f3a;margin-bottom:3px}.foot{margin-top:14px;color:#667085;font-size:9px;border-top:1px solid #dce4ef;padding-top:8px}</style></head><body><div class="head"><div>${logo?`<img class="logo" src="${logo}">`:''}</div><div style="text-align:right"><div class="kicker">Management Summary</div><div class="title">Anya Chat Intelligence</div><div class="range">${esc(selectedRangeText())}<br>Generated ${esc(generated)}</div></div></div><div class="headline"><b>${m.cb.toLocaleString()} callbacks · ${m.recoverable.toLocaleString()} recoverable high-intent chats · ${m.gapPct}% answer gap</b><span>Admissions demand, conversion risk and immediate operating priorities.</span></div><div class="grid"><div class="metric"><b>${m.n.toLocaleString()}</b><span>Total chats</span><i>${d.chats.text}</i></div><div class="metric"><b>${m.engagedPct}%</b><span>Engaged</span><i>${d.engaged.text}</i></div><div class="metric"><b>${m.contactPct}%</b><span>Contact capture</span><i>${d.contact.text}</i></div><div class="metric"><b>${m.cb.toLocaleString()}</b><span>Callbacks</span><i>${d.callbacks.text}</i></div><div class="metric"><b>${m.gapPct}%</b><span>Answer gap</span><i>${d.gap.text}</i></div></div><div class="story">Anya handled <b>${m.n.toLocaleString()} conversations</b>. Management attention should focus on <b>${m.cb.toLocaleString()} callback requests</b>, <b>${m.recoverable.toLocaleString()} high-intent conversations without usable contact details</b>, and <b>${priority} high-priority prospects</b>. Top demand theme: <b>${esc(m.topTheme[0])}</b>. Primary knowledge gap: <b>${esc(m.topGap[0])}</b>.</div><div class="sectionTitle">Recommended actions</div><div class="actions"><div class="point"><b>Call first</b>Review ${m.cb.toLocaleString()} callback requests with counsellors.</div><div class="point"><b>Recover next</b>Prioritise ${m.recoverable.toLocaleString()} high-intent no-contact chats.</div><div class="point"><b>Fix knowledge</b>Start with ${esc(m.topGap[0])}; overall gap is ${m.gapPct}%.</div></div><div class="sectionTitle">What to watch</div><div class="mini"><div class="box"><b>Demand theme</b>${esc(m.topTheme[0])} generated ${m.topTheme[1].asked} classified signals.</div><div class="box"><b>Repeat interest</b>${m.serial} repeat visitor${m.serial===1?'':'s'} appeared in this period.</div></div><div class="foot">Source: ${esc(DATA_FILE)} · Sheet: ${esc(SHEET)} · Generated in-browser from the selected view.</div><script>window.onload=()=>setTimeout(()=>{window.focus();window.print();},250)<\/script></body></html>`;
  const w=window.open('','_blank');if(!w){alert('Popup blocked. Allow popups to export the CEO PDF.');return;}w.document.open();w.document.write(html);w.document.close();
}


/* 01 KPIs */
function secKPIs(){
  const m=computeMetricsFor(VIEW),avg=m.n?(VIEW.reduce((a,r)=>a+r.depth,0)/m.n).toFixed(1):'0.0';
  const k=[
    {l:'Total chats',v:m.n.toLocaleString(),note:`${m.days} active days`,cls:'neut',drill:'all'},
    {l:'Engaged rate',v:m.engagedPct+'%',note:`${m.eng} meaningful multi-turn chats`,cls:'good',drill:'engaged'},
    {l:'Contact captured',v:m.contactPct+'%',note:`${m.con} usable phone/email records`,cls:'good',drill:'contact'},
    {l:'Callback requests',v:m.cb.toLocaleString(),note:`${m.callbackPct}% of chats`,cls:'good',drill:'callback'},
    {l:'High-intent recovery',v:m.recoverable.toLocaleString(),note:'without usable contact',cls:'hot',drill:'recovery'},
    {l:'Answer gap',v:m.gapPct+'%',note:`${m.gQ} of ${m.tQ} questions`,cls:'hot',drill:'gap'},
    {l:'Avg depth',v:avg,note:'Anya replies / chat',cls:'neut',drill:'all'}
  ];
  return `<section id="sec-overview"><div class="shead"><span class="n">03</span><h2>Operating metrics</h2></div><div class="sdesc">Detailed operating measures beneath the management summary. Click any card for the underlying chats.</div><div class="strip">${k.map(x=>`<div class="kpi clk ${x.cls}" data-drill="${x.drill}"><span class="b"></span><div class="v">${x.v}</div><div class="l">${esc(x.l)} — <span>${esc(x.note)}</span></div></div>`).join('')}</div></section>`;
}

/* 02 answer gap */
function secAnswerGap(){
  let tQ=0,gQ=0;const tm={};THEMES.forEach(t=>tm[t[0]]={ans:0,gap:0});
  VIEW.forEach(r=>r.questions.forEach(q=>{tQ++;const blocked=isAnswerGapQuestion(q);if(blocked)gQ++;q.themes.forEach(th=>tm[th][blocked?'gap':'ans']++);}));
  const loop=VIEW.filter(r=>r.loop).length,fr=VIEW.filter(r=>r.repeated>0).length;
  const rows=Object.entries(tm).map(([nm,v])=>({nm,...v,tot:v.ans+v.gap})).filter(t=>t.tot>0).sort((a,b)=>b.gap-a.gap||b.tot-a.tot),mx=Math.max(1,...rows.map(t=>t.tot));
  const bars=rows.length?rows.map(t=>`<div class="bar clk" data-drill="gaptheme" data-arg="${esc(t.nm)}"><div class="top"><span class="nm">${esc(t.nm)}</span><span class="ct">${t.gap} answer gaps / ${t.tot} asked · <b style="color:var(--coral)">${pct(t.gap,t.tot)}%</b></span></div><div class="track" style="width:${Math.max(8,Math.round(100*t.tot/mx))}%"><div class="seg ans" style="width:${pct(t.ans,t.tot)}%"></div><div class="seg gap" style="width:${pct(t.gap,t.tot)}%"></div></div></div>`).join(''):`<div class="empty">No classified questions in range.</div>`;
  return `<section id="sec-gap"><div class="shead"><span class="n">01</span><h2>The answer gap</h2></div><div class="sdesc">Questions where Anya either asks for details instead of answering or gives the generic scope deflection. Every section now uses this same definition.</div><div class="grid2"><div class="panel"><h4>Answer quality by topic</h4><div class="cap">Answered versus gated/generically deflected. Bar length represents demand volume.</div><div class="legend"><span><i style="background:var(--green)"></i>answered</span><span><i style="background:var(--coral)"></i>answer gap</span></div>${bars}</div><div class="panel" style="display:flex;flex-direction:column;gap:15px"><div class="clk" data-drill="gap" style="border-radius:10px"><div class="mono" style="font-size:10.5px;color:var(--muted);text-transform:uppercase;letter-spacing:.6px">Overall gap</div><div style="font-family:Georgia,serif;font-weight:900;font-size:52px;line-height:1;color:var(--coral)">${pct(gQ,tQ)}%</div><div style="font-size:12.5px;color:var(--muted)">${gQ.toLocaleString()} of ${tQ.toLocaleString()} questions were gated or generically deflected.</div></div><div style="display:grid;grid-template-columns:1fr 1fr;gap:10px"><div class="note-box clk" data-drill="loop"><b>${loop}</b><br>chats looped the details gate 2+ times</div><div class="note-box clk" data-drill="frustrated"><b>${fr}</b><br>chats where a user repeated themselves</div></div><div class="note-box">Fix the highest-volume coral topics first: answer the question, then request details.</div></div></div></section>`;
}

/* 03 funnel */
function secFunnel(){
  const n=VIEW.length,eng=VIEW.filter(r=>r.engaged).length,con=VIEW.filter(r=>r.contactCaptured).length,cb=VIEW.filter(r=>r.callbackBooked).length;
  const stages=[['All chats started',n,'var(--blue)','all'],['Engaged (multi-turn)',eng,'#2d5b91','engaged'],['Contact captured',con,'var(--navy)','contact'],['Callback requested',cb,'#247858','callback']];
  let bars='';
  for(let i=0;i<stages.length;i++){
    const [name,v,c,drill]=stages[i];const w=Math.max(6,Math.round(100*v/Math.max(1,n)));
    let leak='';if(i>0){const prev=stages[i-1][1],drop=prev-v;leak=`<span class="leak">▼ ${drop.toLocaleString()} dropped (${pct(drop,prev)}%)</span>`;}
    bars+=`<div class="fstage"><div class="meta"><span class="name">${name}</span>${leak}</div><div class="fbar clk" data-drill="${drill}" style="width:${w}%;background:${c}">${v.toLocaleString()} · ${pct(v,n)}%</div></div>`;
  }
  return `<section id="sec-funnel"><div class="shead"><span class="n">02</span><h2>Conversion funnel</h2></div><div class="sdesc">From every chat opened to a detected callback request. Click a stage to see exactly who's in it.</div><div class="panel"><div class="funnel">${bars}</div></div></section>`;
}

/* 04 questions */
function secQuestions(){
  const tc={};THEMES.forEach(t=>tc[t[0]]=0);VIEW.forEach(r=>r.questions.forEach(q=>q.themes.forEach(t=>tc[t]++)));
  const rows=Object.entries(tc).filter(([,v])=>v>0).sort((a,b)=>b[1]-a[1]),mx=Math.max(1,...rows.map(t=>t[1]));
  const tbars=rows.length?rows.map(([nm,v])=>`<div class="bar clk" data-drill="theme" data-arg="${esc(nm)}"><div class="top"><span class="nm">${esc(nm)}</span><span class="ct">${v}</span></div><div class="track"><div class="seg one" style="width:${Math.round(100*v/mx)}%"></div></div></div>`).join(''):`<div class="empty">No classified topics.</div>`;
  const start=keyToUTCDate(RANGE.from),end=keyToUTCDate(RANGE.to);let early=[],late=[];
  if(start&&end){const midpoint=new Date(start.getTime()+Math.floor((end-start)/2));early=VIEW.filter(r=>keyToUTCDate(r.key)<=midpoint);late=VIEW.filter(r=>keyToUTCDate(r.key)>midpoint);}
  function rate(a,th){if(!a.length)return 0;let c=0;a.forEach(r=>r.questions.forEach(q=>{if(q.themes.includes(th))c++;}));return c/a.length;}
  let tr=[];if(early.length&&late.length)tr=THEMES.map(([th])=>{const e=rate(early,th),l=rate(late,th);return {th,delta:e>0?Math.round(100*(l-e)/e):(l>0?100:0),any:l>0||e>0};}).filter(t=>t.any).sort((a,b)=>b.delta-a.delta);
  const trh=tr.length?tr.map(t=>{const cls=t.delta>12?'up':t.delta<-12?'down':'flat',ar=t.delta>12?'▲':t.delta<-12?'▼':'■';return `<div class="qrow clk" data-drill="theme" data-arg="${esc(t.th)}"><span class="qtext">${esc(t.th)}</span><span class="trend ${cls}">${ar} ${t.delta>0?'+':''}${t.delta}%</span></div>`;}).join(''):`<div class="empty">Widen the range to compare its chronological halves.</div>`;
  const ctr={};VIEW.forEach(r=>r.questions.forEach(q=>{const t=q.text.trim(),low=t.toLowerCase();if(/^(hi|hello|hey|ok|okay|thanks|thank you|no|yes|yeah|yep|nope|sure|fine|hmm)\b/.test(low)||t.length<8)return;const nm=low.replace(/\s+/g,' ').replace(/[.?!]+$/,'');if(!ctr[nm])ctr[nm]={n:0,sample:t,key:nm};ctr[nm].n++;}));
  const top=Object.values(ctr).sort((a,b)=>b.n-a.n).slice(0,12),toph=top.length?top.map((q,i)=>`<div class="qrow clk" data-drill="question" data-arg="${esc(q.key)}"><span class="qrank">${i+1}</span><span class="qtext">${esc(q.sample)}</span><span class="qct">${q.n}×</span></div>`).join(''):`<div class="empty">No repeated questions.</div>`;
  return `<section id="sec-questions"><div class="shead"><span class="n">04</span><h2>What prospects ask</h2></div><div class="sdesc">Tagged from real user messages. Trending compares the actual chronological first and second halves of the selected period.</div><div class="grid-2eq"><div class="panel"><h4>Topics by volume</h4><div class="cap">How often each topic appears.</div>${tbars}</div><div class="panel"><h4>Trending versus earlier in range</h4><div class="cap">Per-chat rate, chronological early half → recent half.</div><div class="qlist">${trh}</div></div></div><div class="panel" style="margin-top:18px"><h4>Top questions, verbatim</h4><div class="cap">Most-repeated exact phrasings for FAQ and knowledge-base improvements.</div><div class="qlist">${toph}</div></div></section>`;
}

/* 05 priority prospects */
function secLeads(){
  const leads=PEOPLE.filter(p=>p.phone||p.email).sort((a,b)=>b.score-a.score).slice(0,25);
  if(!leads.length)return `<section id="sec-leads"><div class="shead"><span class="n">05</span><h2>Priority prospects</h2></div><div class="panel empty">No contactable leads in this range.</div></section>`;
  const rows=leads.map(p=>`<tr class="crow clk" data-drill="person" data-arg="${esc(p.key)}">
    <td><span class="pill ${p.tempClass}">${p.temp}</span></td>
    <td><div style="font-weight:700">${esc(p.name||'(no name)')}</div><div class="mono" style="font-size:10.5px;color:var(--faint)">${esc(p.phone?maskPhone(p.phone):maskEmail(p.email))}</div></td>
    <td class="mono">${p.score}</td>
    <td class="mono">${p.chats}</td>
    <td class="mono">${p.maxDepth}</td>
    <td>${p.callback?'<span class="pill y">requested</span>':'<span class="pill n">—</span>'}</td>
    <td>${p.programs.length?esc(p.programs[0]):'<span style="color:var(--faint)">—</span>'}</td></tr>`).join('');
  return `<section id="sec-leads"><div class="shead"><span class="n">05</span><h2>Priority prospects</h2></div>
    <div class="sdesc">Contactable people ranked by a transparent score: callback requested (+45), depth, questions asked, repeat visits (+15), known program. Click a lead to open their full history and contact. <b>High priority ≥65, Medium priority ≥38.</b></div>
    <div class="panel"><div class="tools"><div class="cap" style="margin:0">Top ${leads.length} of ${PEOPLE.filter(p=>p.phone||p.email).length} contactable leads</div><button class="exp-btn" data-action="export-leads">Export leads CSV (full contact)</button></div>
    <div class="tbl-scroll"><table><thead><tr><th>Priority</th><th>Lead</th><th>Score</th><th>Chats</th><th>Depth</th><th>Callback</th><th>Top program</th></tr></thead><tbody>${rows}</tbody></table></div></div></section>`;
}

/* 06 serial engagers */
function secSerial(){
  const ser=PEOPLE.filter(p=>p.chats>1).sort((a,b)=>b.chats-a.chats||b.score-a.score);
  const body=ser.length?`<div class="tbl-scroll"><table><thead><tr><th>Visitor</th><th>Chats</th><th>Questions</th><th>Max depth</th><th>Callback</th><th>Programs</th></tr></thead><tbody>${ser.map(p=>`<tr class="crow clk" data-drill="person" data-arg="${esc(p.key)}"><td><div style="font-weight:700">${esc(p.name||'(no name)')}</div><div class="mono" style="font-size:10.5px;color:var(--faint)">${esc(p.phone?maskPhone(p.phone):maskEmail(p.email))}</div></td><td class="mono" style="color:var(--navy);font-weight:700">${p.chats}</td><td class="mono">${p.q}</td><td class="mono">${p.maxDepth}</td><td>${p.callback?'<span class="pill y">requested</span>':'<span class="pill n">—</span>'}</td><td>${p.programs.length?esc(p.programs.join(', ')):'—'}</td></tr>`).join('')}</tbody></table></div>`:`<div class="empty">No one returned for more than one chat in this range.</div>`;
  return `<section id="sec-serial"><div class="shead"><span class="n">06</span><h2>Serial engagers</h2></div>
    <div class="sdesc">People who came back across <b>more than one chat</b> (matched by phone or email) — a strong self-selected interest signal because they self-selected to return. Click to open all their chats.</div>
    <div class="panel"><div class="cap">${ser.length} returning ${ser.length===1?'visitor':'visitors'} · matched on shared phone/email</div>${body}</div></section>`;
}

/* 07 callbacks */
function secCallbacks(){
  const cbs=VIEW.filter(r=>r.callbackBooked).sort((a,b)=>b.key-a.key);
  if(!cbs.length)return `<section id="sec-callbacks"><div class="shead"><span class="n">07</span><h2>Callback requests</h2></div><div class="panel empty">No callback requests in this range.</div></section>`;
  const rows=cbs.map(r=>`<tr class="crow clk" data-drill="chat" data-arg="${r.idx}">
    <td class="mono" style="white-space:nowrap;color:var(--navy)">${esc(r.cbDate||'—')}</td>
    <td class="mono" style="white-space:nowrap">${esc(r.cbTime||'—')}</td>
    <td><div style="font-weight:700">${esc(r.rawName||'(no name)')}</div></td>
    <td class="mono" style="font-size:11px">${esc(r.rawPhone?maskPhone(r.rawPhone):'—')}</td>
    <td class="mono" style="font-size:11px">${esc(r.rawEmail?maskEmail(r.rawEmail):'—')}</td>
    <td>${r.programs.length?esc(r.programs[0]):'<span style="color:var(--faint)">—</span>'}</td>
    <td class="mono" style="color:var(--faint);white-space:nowrap">requested ${r.created.day} ${MONN[r.created.mon]}</td></tr>`).join('');
  return `<section id="sec-callbacks"><div class="shead"><span class="n">07</span><h2>Callback requests</h2></div>
    <div class="sdesc">Every prospect who asked for a callback, with the detected callback window or explicit request. This is your call sheet — click a row to read the conversation, or export with full contact for the team.</div>
    <div class="panel"><div class="tools"><div class="cap" style="margin:0">${cbs.length} callback${cbs.length===1?'':'s'} requested</div><button class="exp-btn" data-action="export-callbacks">Export call sheet CSV (full contact)</button></div>
    <div class="tbl-scroll"><table><thead><tr><th>Detected date</th><th>Time slot</th><th>Name</th><th>Phone</th><th>Email</th><th>Program</th><th>Requested</th></tr></thead><tbody>${rows}</tbody></table></div></div></section>`;
}

/* 08 drop-offs */
function secDropoff(){
  const cats=[
    {key:OUTCOMES.CALLBACK,color:'var(--navy)',reason:'Strongest conversion signal. Ensure the requested follow-up is completed promptly.'},
    {key:OUTCOMES.CONTACT,color:'#247858',reason:'Usable contact details were captured, but no callback was requested — suitable for proactive nurture.'},
    {key:OUTCOMES.RECOVERY,color:'var(--amber)',reason:'Meaningful admissions intent was detected, but no usable contact details were captured.'},
    {key:OUTCOMES.GATE,color:'var(--coral)',reason:'The final Anya response was the details gate and the prospect did not continue. Answer first, then request details.'},
    {key:OUTCOMES.ENGAGED,color:'#6f7f95',reason:'The prospect engaged, but the chat ended without a strong recovery signal or captured contact.'},
    {key:OUTCOMES.LOW,color:'var(--cold)',reason:'The conversation ended with very little meaningful prospect engagement.'}
  ];
  const counts={};
  VIEW.forEach(r=>{counts[r.outcome]=(counts[r.outcome]||0)+1;});
  const n=VIEW.length;
  const accounted=cats.reduce((sum,c)=>sum+(counts[c.key]||0),0);
  const unknown=Math.max(0,n-accounted);
  const visible=[...cats];
  if(unknown)visible.push({key:'Other classified outcome',color:'var(--faint)',reason:'A record used an outcome not recognised by this dashboard version.',count:unknown});
  const mx=Math.max(1,...visible.map(c=>c.count==null?(counts[c.key]||0):c.count));
  const bars=visible.map(c=>{
    const count=c.count==null?(counts[c.key]||0):c.count;
    const drill=c.count==null?` data-drill="drop" data-arg="${esc(c.key)}"`:'';
    return `<div class="bar clk"${drill} style="margin-bottom:18px"><div class="top"><span class="nm">${esc(c.key)}</span><span class="ct">${count.toLocaleString()} · ${pct(count,n)}%</span></div><div class="track"><div class="seg" style="width:${Math.round(100*count/mx)}%;background:${c.color}"></div></div><div style="font-size:11.5px;color:var(--faint);margin-top:6px">${c.reason}</div></div>`;
  }).join('');
  return `<section id="sec-dropoff"><div class="shead"><span class="n">08</span><h2>Where chats drop off &amp; why</h2></div>
    <div class="sdesc">Each chat appears once, using the furthest verified outcome reached. Exit reasons are inferred from the final interaction pattern. Click any band to read those chats.</div>
    <div class="panel"><div class="cap" style="margin-bottom:16px">${accounted.toLocaleString()} of ${n.toLocaleString()} chats classified${accounted===n?' · 100% accounted for':''}</div>${bars}</div></section>`;
}

/* 09 volume */
function secVolume(){
  const byDay={};VIEW.forEach(r=>byDay[r.key]=(byDay[r.key]||0)+1);
  const days=Object.keys(byDay).map(Number).sort((a,b)=>a-b);const dv=days.map(k=>byDay[k]);
  const byHour=new Array(24).fill(0);VIEW.forEach(r=>{if(r.hour>=0)byHour[r.hour]++;});
  return `<section id="sec-volume"><div class="shead"><span class="n">09</span><h2>Volume &amp; rhythm</h2></div>
    <div class="sdesc">When prospects show up (IST, read straight from timestamps). Click a day or an hour bar to drill in.</div>
    <div class="grid2"><div class="panel"><h4>Chats per day</h4><div class="cap">${days.length} day${days.length===1?'':'s'} in range.</div>${lineChart(days,dv)}</div>
    <div class="panel"><h4>By hour (IST)</h4><div class="cap">Peak windows for live coverage and callbacks.</div>${hourChart(byHour)}</div></div></section>`;
}
function lineChart(keys,vals){
  if(!vals.length)return `<div class="empty">No data.</div>`;
  const W=560,H=200,pl=34,pr=12,pt=14,pb=26,mx=Math.max(1,...vals),n=vals.length;
  const x=i=>pl+(n===1?(W-pl-pr)/2:i*(W-pl-pr)/(n-1)),y=v=>pt+(H-pt-pb)*(1-v/mx);
  let grid='';for(let g=0;g<=4;g++){const gy=pt+(H-pt-pb)*g/4;grid+=`<line stroke="#16242f" x1="${pl}" y1="${gy}" x2="${W-pr}" y2="${gy}"/><text fill="var(--faint)" font-size="10" font-family="IBM Plex Mono" x="${pl-6}" y="${gy+3}" text-anchor="end">${Math.round(mx*(1-g/4))}</text>`;}
  const pts=vals.map((v,i)=>`${x(i)},${y(v)}`);
  const area=`<polygon fill="url(#g1)" points="${pl},${y(0)} ${pts.join(' ')} ${x(n-1)},${y(0)}"/>`;
  const line=`<polyline fill="none" stroke="var(--navy)" stroke-width="2.5" points="${pts.join(' ')}"/>`;
  let dots='';if(n<=40)dots=vals.map((v,i)=>`<circle class="clk" data-drill="day" data-arg="${keys[i]}" cx="${x(i)}" cy="${y(v)}" r="5" fill="var(--navy)"><title>${fromKeyLabel(keys[i])}: ${v} chats</title></circle>`).join('');
  let xl='';[0,Math.floor((n-1)/2),n-1].forEach((i,k)=>{if(i>=0&&i<n){const o=keyToDate(keys[i]);xl+=`<text fill="var(--faint)" font-size="10" font-family="IBM Plex Mono" x="${x(i)}" y="${H-8}" text-anchor="${k===0?'start':k===2?'end':'middle'}">${o.d} ${MONN[o.m]}</text>`;}});
  return `<svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto"><defs><linearGradient id="g1" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="var(--navy)" stop-opacity=".26"/><stop offset="1" stop-color="var(--navy)" stop-opacity="0"/></linearGradient></defs>${grid}${area}${line}${dots}${xl}</svg>`;
}
function hourChart(hours){
  const W=560,H=200,pl=28,pr=10,pt=14,pb=28,mx=Math.max(1,...hours),bw=(W-pl-pr)/24;
  let bars='';hours.forEach((v,i)=>{const bh=(H-pt-pb)*v/mx,bx=pl+i*bw,by=H-pb-bh,peak=v===mx&&v>0;
    bars+=`<rect class="clk" data-drill="hour" data-arg="${i}" x="${bx+1}" y="${pt}" width="${bw-2}" height="${H-pt-pb}" fill="transparent"/><rect x="${bx+1.5}" y="${by}" width="${bw-3}" height="${bh}" rx="2" fill="${peak?'var(--navy)':'#9aaabd'}" pointer-events="none"><title>${i}:00 — ${v} chats</title></rect>`;});
  let labs='';[0,6,12,18,23].forEach(i=>labs+=`<text fill="var(--faint)" font-size="10" font-family="IBM Plex Mono" x="${pl+i*bw+bw/2}" y="${H-9}" text-anchor="middle">${i}h</text>`);
  return `<svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto">${bars}${labs}</svg>`;
}

/* 10 programs */
function secPrograms(){
  const prog={};PROGRAMS.forEach(p=>prog[p[0]]=0);let ug=0,pg=0;
  VIEW.forEach(r=>{r.programs.forEach(p=>prog[p]++);if(r.level==='UG')ug++;else if(r.level==='PG')pg++;});
  const rows=Object.entries(prog).filter(([,v])=>v>0).sort((a,b)=>b[1]-a[1]);const mx=Math.max(1,...rows.map(p=>p[1]));
  const bars=rows.length?rows.map(([nm,v])=>`<div class="bar clk" data-drill="program" data-arg="${esc(nm)}"><div class="top"><span class="nm">${esc(nm)}</span><span class="ct">${v} chats · ${pct(v,VIEW.length)}%</span></div><div class="track"><div class="seg one" style="width:${Math.round(100*v/mx)}%"></div></div></div>`).join(''):`<div class="empty">No program mentions.</div>`;
  const lt=ug+pg,ugw=lt?Math.round(100*ug/lt):0;
  return `<section id="sec-programs"><div class="shead"><span class="n">10</span><h2>Program interest</h2></div>
    <div class="sdesc">Which programs and which level prospects come asking about. Click to drill.</div>
    <div class="grid2"><div class="panel"><h4>By program area</h4><div class="cap">Share of chats mentioning each.</div>${bars}</div>
    <div class="panel"><h4>Undergraduate vs postgraduate</h4><div class="cap">${lt} chats expressed a clear level.</div>
    ${lt?`<div class="track" style="height:30px;border-radius:8px;margin:14px 0 12px"><div class="seg blu clk" data-drill="level" data-arg="UG" style="width:${ugw}%"></div><div class="seg one clk" data-drill="level" data-arg="PG" style="width:${100-ugw}%"></div></div>
    <div style="display:flex;justify-content:space-between;font-size:13px"><span class="clk" data-drill="level" data-arg="UG"><i style="display:inline-block;width:10px;height:10px;border-radius:2px;background:var(--blue);margin-right:5px"></i>UG <b>${ug}</b> (${ugw}%)</span><span class="clk" data-drill="level" data-arg="PG"><b>${pg}</b> (${100-ugw}%) PG <i style="display:inline-block;width:10px;height:10px;border-radius:2px;background:var(--gold);margin-left:5px"></i></span></div>`:`<div class="empty">No level signal.</div>`}</div></div></section>`;
}

/* 11 depth */
function secDepth(){
  const b={'1':0,'2-3':0,'4-6':0,'7-10':0,'11+':0};
  VIEW.forEach(r=>{const d=r.depth;if(d<=1)b['1']++;else if(d<=3)b['2-3']++;else if(d<=6)b['4-6']++;else if(d<=10)b['7-10']++;else b['11+']++;});
  const rows=Object.entries(b),mx=Math.max(1,...rows.map(r=>r[1])),bounce=VIEW.filter(r=>r.bounce).length;
  const bars=rows.map(([nm,v])=>`<div class="bar clk" data-drill="depth" data-arg="${nm}"><div class="top"><span class="nm">${nm} replies</span><span class="ct">${v} · ${pct(v,VIEW.length)}%</span></div><div class="track"><div class="seg ${nm==='1'?'gap':'one'}" style="width:${Math.round(100*v/mx)}%"></div></div></div>`).join('');
  return `<section id="sec-depth"><div class="shead"><span class="n">11</span><h2>Conversation depth</h2></div>
    <div class="sdesc">How far chats go. Single-reply chats (coral) are effective bounces — <b>${pct(bounce,VIEW.length)}%</b> ended after one Anya reply. Click a band to drill.</div>
    <div class="panel">${bars}</div></section>`;
}

/* 12 explorer */
function secExplorer(){
  return `<section id="sec-explorer"><div class="shead"><span class="n">12</span><h2>Chat explorer</h2></div><div class="sdesc">Every chat in range. Search across name, phone, email, chat ID, programme, summary and questions.</div><div class="panel"><div class="tools"><input class="search" id="explSearch" placeholder="Search person, phone, email, chat ID, topic…" data-action="explorer-search"><button class="exp-btn" data-action="export-csv">Export CSV (full values)</button></div><div class="tbl-scroll"><table id="explTable"></table></div></div></section>`;
}
function explorerRows(){
  let rows=VIEW.slice();
  if(SEARCH){const s=SEARCH.toLowerCase();rows=rows.filter(r=>([r.title,r.summary,r.id,r.rawName,r.rawEmail,r.rawPhone,r.programs.join(' '),r.questions.map(q=>q.text).join(' ')].join(' ')).toLowerCase().includes(s));}
  const d=SORT.dir;
  rows.sort((a,b)=>{let av,bv;switch(SORT.col){case'depth':av=a.depth;bv=b.depth;break;case'gated':av=a.gapCount;bv=b.gapCount;break;case'contact':av=a.contactCaptured?1:0;bv=b.contactCaptured?1:0;break;case'callback':av=a.callbackBooked?1:0;bv=b.callbackBooked?1:0;break;default:av=a.key*100+(a.hour<0?0:a.hour);bv=b.key*100+(b.hour<0?0:b.hour);}return (av-bv)*d;});
  return rows;
}
function drawTable(){
  const sortHeader=(col,label)=>`<th data-c="${col}" role="button" tabindex="0" aria-sort="${SORT.col===col?(SORT.dir===1?'ascending':'descending'):'none'}">${label}</th>`;
  const rows=explorerRows(),head=`<thead><tr>${sortHeader('key','When (IST)')}<th>Chat</th>${sortHeader('depth','Depth')}${sortHeader('gated','Answer gaps')}${sortHeader('contact','Contact')}${sortHeader('callback','Callback')}<th>Topics</th><th></th></tr></thead>`;
  if(!rows.length){$("explTable").innerHTML=head+`<tbody><tr><td colspan="8" class="empty">No chats match.</td></tr></tbody>`;decorateResponsiveTables();return;}
  let body='';rows.forEach(r=>{const o=r.created,when=`${o.day} ${MONN[o.mon]} · ${fmtTime(o)}`,topics=[...new Set(r.questions.flatMap(q=>q.themes))].slice(0,3),open=EXPANDED.has(r.idx);
    body+=`<tr class="crow" data-idx="${r.idx}"><td class="mono" style="white-space:nowrap">${esc(when)}</td><td><div style="font-weight:600">${esc(r.title)}</div><div class="mono" style="font-size:10.5px;color:var(--faint)">${esc(maskId(r.id))}</div></td><td class="mono">${r.depth}</td><td>${r.gapCount>0?`<span class="pill g">${r.gapCount}</span>`:`<span class="pill n">0</span>`}</td><td><span class="pill ${r.contactCaptured?'y':'n'}">${r.contactCaptured?'yes':'—'}</span></td><td><span class="pill ${r.callbackBooked?'y':'n'}">${r.callbackBooked?'requested':'—'}</span></td><td>${topics.length?topics.map(t=>`<span class="pill n" style="margin-right:3px">${esc(t)}</span>`).join(''):'<span class="pill n">—</span>'}</td><td><button class="exp-btn" data-idx="${r.idx}" data-act="toggle">${open?'close':'open'}</button></td></tr>`;
    if(open)body+=`<tr class="expanded-row"><td colspan="8">${transcriptHtml(r)}</td></tr>`;
  });$("explTable").innerHTML=head+`<tbody>${body}</tbody>`;decorateResponsiveTables();
}
function transcriptHtml(r){
  const turns=splitTurns(r.conv);
  let h=`<div style="font-size:12px;color:var(--muted);margin-bottom:10px">${esc(r.summary||'No summary.')}</div><div class="transcript">`;
  if(!turns.length)h+=`<div class="empty">Empty conversation.</div>`;
  turns.forEach(t=>{h+=`<div class="t-turn"><span class="t-role">${t.role==='User'?'Prospect':'Aanya'}</span><span class="${t.role==='User'?'t-user':'t-agent'}">${esc(t.text)}</span></div>`;});
  return h+`</div>`;
}
function onSearch(v){SEARCH=v;drawTable();}

/* ---------- interactions / drill ---------- */
function bindInteractions(){
  drawTable();const rep=$("report");
  rep.onclick=e=>{const drill=e.target.closest('[data-drill]');if(drill){openDrill(drill.getAttribute('data-drill'),drill.getAttribute('data-arg'));return;}const th=e.target.closest('th[data-c]');if(th){const c=th.getAttribute('data-c');if(SORT.col===c)SORT.dir*=-1;else{SORT.col=c;SORT.dir=-1;}drawTable();return;}const btn=e.target.closest('[data-act="toggle"]');if(btn){const idx=Number(btn.getAttribute('data-idx'));if(EXPANDED.has(idx))EXPANDED.delete(idx);else EXPANDED.add(idx);drawTable();}};
  rep.onkeydown=e=>{const th=e.target.closest('th[data-c]');if(th&&(e.key==='Enter'||e.key===' ')){e.preventDefault();th.click();}};
  const si=$("explSearch");if(si)si.value=SEARCH;
}

let DRILL_RECORDS=[],DRILL_LABEL="",LAST_FOCUS=null;
function setDashboardBackgroundInert(inert){const content=$("dashboardContent");if(!content)return;content.inert=!!inert;content.setAttribute('aria-hidden',inert?'true':'false');}
function trapDrawerFocus(e){
  const drawer=$("drawer");if(!drawer||!drawer.classList.contains('open'))return;
  const focusable=[...drawer.querySelectorAll('button,[href],input,select,textarea,[tabindex]:not([tabindex="-1"])')].filter(el=>!el.disabled&&el.offsetParent!==null);
  if(!focusable.length){e.preventDefault();drawer.querySelector('.drawer-panel')?.focus();return;}
  const first=focusable[0],last=focusable[focusable.length-1];
  if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}
  else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}
}
function openDrill(kind,arg){
  let recs=[],title="",sub="",opts={};
  const has=(r,th,blockedOnly)=>r.questions.some(q=>q.themes.includes(th)&&(!blockedOnly||q.gated||q.deflected));
  switch(kind){
    case'all':recs=VIEW;title="All chats";break;
    case'commercial-all':recs=VIEW;title="Raw exported sessions";sub="Sessions in the selected date range before the billing rule";break;
    case'commercial-replies':recs=VIEW.filter(r=>r.agentMsgs>0);title="Sessions with recorded Anya replies";sub="Underlying raw Agent Messages in the selected date range";break;
    case'commercial-billable':recs=VIEW.filter(r=>r.agentMsgs>0);title="Billable conversation sessions";sub="Selected-range sessions contributing ceil(Anya replies ÷ 5) units";break;
    case'commercial-band':{const bands=[r=>r.agentMsgs<=0,r=>r.agentMsgs>=1&&r.agentMsgs<=5,r=>r.agentMsgs>=6&&r.agentMsgs<=10,r=>r.agentMsgs>=11&&r.agentMsgs<=15,r=>r.agentMsgs>=16];recs=VIEW.filter(bands[Number(arg)]||(()=>false));title=['0 replies','1–5 replies','6–10 replies','11–15 replies','16+ replies'][Number(arg)]||'Billing depth';sub="Selected-range sessions in this billing-depth band";break;}
    case'engaged':recs=VIEW.filter(r=>r.engaged);title="Engaged chats";sub="Meaningful multi-turn prospect engagement";break;
    case'contact':recs=VIEW.filter(r=>r.contactCaptured);title="Contact captured";sub="A usable phone number or email was captured";break;
    case'callback':recs=VIEW.filter(r=>r.callbackBooked);title="Callback requests detected";break;
    case'hotleads':{const hotIdx=new Set(PEOPLE.filter(p=>(p.phone||p.email)&&p.score>=65).flatMap(p=>p.idxs));recs=VIEW.filter(r=>hotIdx.has(r.idx));title="High-priority prospects";sub="Priority score 65+ based on callback, depth, repeat and programme signals";break;}
    case'dropall':recs=VIEW.filter(r=>!r.contactCaptured);title="No contact captured";sub="Chats without a usable phone number or email";break;
    case'recovery':recs=VIEW.filter(r=>r.highIntent&&!r.contactCaptured);title="High-intent recovery queue";sub="Meaningful demand or callback intent without usable contact details";break;
    case'gap':recs=VIEW.filter(r=>r.gapCount>0);title="Chats with an answer gap";sub="A question was gated or generically deflected";opts.showGated=true;break;
    case'gaptheme':recs=VIEW.filter(r=>has(r,arg,true));title=`Gated: ${arg}`;sub="Questions on this topic that hit the gate";opts.showGated=true;break;
    case'theme':recs=VIEW.filter(r=>has(r,arg,false));title=`Topic: ${arg}`;break;
    case'program':recs=VIEW.filter(r=>r.programs.includes(arg));title=`Program: ${arg}`;break;
    case'level':recs=VIEW.filter(r=>r.level===arg);title=`${arg==='UG'?'Undergraduate':'Postgraduate'} interest`;break;
    case'loop':recs=VIEW.filter(r=>r.loop);title="Gate-loop chats";sub="The details gate fired 2+ times";break;
    case'frustrated':recs=VIEW.filter(r=>r.repeated>0);title="Repeated-question chats";sub="A user re-sent the same message";break;
    case'drop':recs=VIEW.filter(r=>r.outcome===arg);title=arg;break;
    case'depth':{const f={'1':r=>r.depth<=1,'2-3':r=>r.depth>=2&&r.depth<=3,'4-6':r=>r.depth>=4&&r.depth<=6,'7-10':r=>r.depth>=7&&r.depth<=10,'11+':r=>r.depth>=11}[arg];recs=VIEW.filter(f||(()=>false));title=`Depth: ${arg} replies`;break;}
    case'hour':recs=VIEW.filter(r=>r.hour===Number(arg));title=`Chats at ${String(arg).padStart(2,'0')}:00 IST`;break;
    case'day':recs=VIEW.filter(r=>r.key===Number(arg));title=`Chats on ${fromKeyLabel(Number(arg))}`;break;
    case'question':recs=VIEW.filter(r=>r.questions.some(q=>q.text.toLowerCase().replace(/\s+/g,' ').replace(/[.?!]+$/,'')===arg));title="Chats asking this";sub=`"${arg}"`;break;
    case'chat':{const r=RECORDS.find(x=>x.idx===Number(arg));recs=r?[r]:[];title=r?esc(r.title):"Chat";break;}
    case'person':{const p=PEOPLE.find(x=>x.key===arg);if(p){recs=p.idxs.map(i=>RECORDS.find(r=>r.idx===i)).filter(Boolean);title=p.name||'Lead';sub=`${p.temp} priority · score ${p.score} · ${p.chats} chat${p.chats>1?'s':''}`;opts.person=p;}break;}
    default:recs=[];
  }
  DRILL_RECORDS=recs;DRILL_LABEL=title;
  $("drawerTitle").textContent=title;
  $("drawerSub").textContent=sub||`${recs.length} chat${recs.length===1?'':'s'}`;
  let head='';
  if(opts.person){const p=opts.person;head=`<div class="card-chat" style="border-color:#d7e4f3">
    <div class="kv"><span class="k">Priority band</span><span class="v"><span class="pill ${p.tempClass}">${p.temp}</span> &nbsp;score ${p.score}/100</span></div>
    <div class="scorebar"><i style="width:${p.score}%"></i></div>
    <div class="kv"><span class="k">Name</span><span class="v">${esc(p.name||'—')}</span></div>
    <div class="kv"><span class="k">Phone</span><span class="v mono">${esc(p.phone?maskPhone(p.phone):'—')}</span></div>
    <div class="kv"><span class="k">Email</span><span class="v mono">${esc(p.email?maskEmail(p.email):'—')}</span></div>
    <div class="kv"><span class="k">Programs</span><span class="v">${p.programs.length?esc(p.programs.join(', ')):'—'}</span></div>
    <div class="kv"><span class="k">Callback</span><span class="v">${p.callback?'requested':'not detected'}</span></div>
    <div style="font-size:11px;color:var(--faint);margin-top:8px">All their chats are listed below. Use the leads / call-sheet CSV for CRM import.</div></div>`;}
  const list=recs.length?recs.slice().sort((a,b)=>b.key-a.key).map(r=>chatCard(r,opts)).join(''):`<div class="empty">No chats here.</div>`;
  $("drawerBody").innerHTML=`<div class="drawer-tools"><span class="cap" style="margin:0">${recs.length} chat${recs.length===1?'':'s'}</span>${recs.length?`<button class="exp-btn" data-action="export-drill">Export these as CSV</button>`:''}</div>${head}${list}`;
  $("drawerBody").onclick=e=>{const b=e.target.closest('[data-act="dtoggle"]');if(!b)return;const w=b.closest('.card-chat').querySelector('.dtrans');if(!w.dataset.loaded){const rec=RECORDS.find(r=>r.idx===Number(w.getAttribute('data-cidx')));if(rec){w.innerHTML=transcriptHtml(rec);w.dataset.loaded='1';}}w.style.display=w.style.display==='none'?'block':'none';b.textContent=w.style.display==='none'?'read transcript':'hide transcript';};
  LAST_FOCUS=document.activeElement;const drawer=$("drawer");setDashboardBackgroundInert(true);drawer.classList.add('open');drawer.setAttribute('aria-hidden','false');setTimeout(()=>drawer.querySelector('.drawer-panel')?.focus(),0);
}
function chatCard(r,opts){
  const o=r.created,when=`${o.day} ${MONN[o.mon]} ${o.year} · ${fmtTime(o)} IST`;
  const badges=[`<span class="pill n">${r.depth} replies</span>`,r.gapCount>0?`<span class="pill g">${r.gapCount} answer gap${r.gapCount===1?'':'s'}</span>`:'',r.contactCaptured?'<span class="pill y">contact</span>':'',r.callbackBooked?'<span class="pill y">callback request</span>':''].filter(Boolean).join(' ');
  let gq='';
  if(opts&&opts.showGated){const gs=r.questions.filter(q=>q.gated||q.deflected).slice(0,6);if(gs.length)gq=`<div style="margin:8px 0 2px">${gs.map(q=>`<span class="gq">${esc(q.text)}</span>`).join('')}</div>`;}
  return `<div class="card-chat"><div class="ch-top"><div><div class="ch-title">${esc(r.title)}</div><div class="ch-when">${esc(when)} · ${esc(maskId(r.id))}</div></div><button class="exp-btn" data-act="dtoggle">read transcript</button></div>
    <div class="ch-badges">${badges}</div>${gq}
    <div class="ch-sum">${esc(r.summary||'No summary.')}</div>
    <div class="dtrans" data-cidx="${r.idx}" style="display:none;margin-top:10px"></div></div>`;
}
function closeDrill(){
  const drawer=$("drawer");drawer.classList.remove('open');drawer.setAttribute('aria-hidden','true');setDashboardBackgroundInert(false);if(LAST_FOCUS&&typeof LAST_FOCUS.focus==='function')LAST_FOCUS.focus();
}

/* ---------- exports ---------- */
function dl(name,text){
  const b=new Blob(['\ufeff',text],{type:'text/csv;charset=utf-8'}),a=document.createElement('a');a.href=URL.createObjectURL(b);a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(a.href),0);
}
function rowsToCSV(rows){
  const cols=["When (IST)","Chat ID","Title","Anya replies","User messages","Questions asked","Answer-gap questions","Contact captured","Callback requested","Callback date","Callback time","Outcome","High-intent no contact","Name","Email","Phone","Programs","Summary"];
  const lines=[cols.join(',')];
  rows.forEach(r=>lines.push([escCSV(r.createdRaw),escCSV(r.id),escCSV(r.title),r.depth,r.userMsgCount,r.questions.length,r.gapCount,r.contactCaptured?'yes':'no',r.callbackBooked?'yes':'no',escCSV(r.cbDate),escCSV(r.cbTime),escCSV(r.outcome),r.highIntent&&!r.contactCaptured?'yes':'no',escCSV(r.rawName),escCSV(r.rawEmail),escCSV(r.rawPhone),escCSV(r.programs.join('; ')),escCSV(r.summary)].join(',')));
  return lines.join('\n');
}
function exportCSV(){if(!VIEW.length){alert("No chats to export.");return;}dl(`aanya_chats_${keyToInput(RANGE.from)}_to_${keyToInput(RANGE.to)}.csv`,rowsToCSV(explorerRows()));}
function exportDrill(){if(!DRILL_RECORDS.length)return;dl(`aanya_${DRILL_LABEL.replace(/[^a-z0-9]+/gi,'_').toLowerCase()}.csv`,rowsToCSV(DRILL_RECORDS));}
function exportCallbacks(){
  const cbs=VIEW.filter(r=>r.callbackBooked).sort((a,b)=>b.key-a.key);if(!cbs.length){alert("No callback requests detected.");return;}
  const cols=["Detected date","Detected time slot","Name","Phone","Email","Program","Requested on (IST)","Chat ID"];
  const lines=[cols.join(',')];
  cbs.forEach(r=>lines.push([escCSV(r.cbDate),escCSV(r.cbTime),escCSV(r.rawName),escCSV(r.rawPhone),escCSV(r.rawEmail),escCSV(r.programs.join('; ')),escCSV(r.createdRaw),escCSV(r.id)].join(',')));
  dl(`aanya_call_sheet_${keyToInput(RANGE.from)}_to_${keyToInput(RANGE.to)}.csv`,lines.join('\n'));
}
function exportLeads(){
  const leads=PEOPLE.filter(p=>p.phone||p.email).sort((a,b)=>b.score-a.score);if(!leads.length){alert("No leads.");return;}
  const cols=["Priority band","Priority score","Name","Phone","Email","Chats","Max depth","Questions","Callback","Programs"];
  const lines=[cols.join(',')];
  leads.forEach(p=>lines.push([p.temp,p.score,escCSV(p.name),escCSV(p.phone),escCSV(p.email),p.chats,p.maxDepth,p.q,p.callback?'yes':'no',escCSV(p.programs.join('; '))].join(',')));
  dl(`aanya_leads_${keyToInput(RANGE.from)}_to_${keyToInput(RANGE.to)}.csv`,lines.join('\n'));
}


function runAnyaRegressionChecks(){
  const saved={records:RECORDS,view:VIEW,people:PEOPLE,min:DATA_MIN,max:DATA_MAX,quality:window.DATA_QUALITY};
  const fixture=[
    {"Chat Created At (IST)":"28 Jun 2026, 09:00:00 AM","Chat ID":"fixture-1","Agent Messages":2,"Full Conversation":"User: What are the fees?\nAgent: May I quickly take your details\nUser: Privacy Notice: Accepted"},
    {"Chat Created At (IST)":"29 Jun 2026, 10:00:00 AM","Chat ID":"fixture-2","Agent Messages":2,"Full Conversation":"User: Tell me eligibility\nAgent: Here to help with questions related to BITS\nUser: Email Address: fixture@example.com\nUser: Preferred Callback Date:\nUser: Preferred Callback Time:"},
    {"Chat Created At (IST)":"30 Jun 2026, 11:00:00 AM","Chat ID":"fixture-3","Agent Messages":3,"Full Conversation":"User: I need admission help, please call me\nAgent: Sure\nUser: Country Code: +91\nUser: Mobile Number: 9876543210"}
  ];
  let result;
  try{buildRecords(fixture);const m=computeMetricsFor(RECORDS);result={ok:RECORDS.length===3&&m.gQ===2&&m.cb===1&&m.con===2&&RECORDS[0].contactCaptured===false&&RECORDS[0].outcome===OUTCOMES.GATE&&RECORDS[1].callbackBooked===false&&RECORDS[2].rawPhone==='+919876543210',metrics:{records:RECORDS.length,answerGaps:m.gQ,contacts:m.con,callbacks:m.cb},dateMath:daysInclusive(20260628,20260704)===7};}
  finally{RECORDS=saved.records;VIEW=saved.view;PEOPLE=saved.people;DATA_MIN=saved.min;DATA_MAX=saved.max;window.DATA_QUALITY=saved.quality;}
  return result;
}

/* methodology */


function onGlobalSearch(value){
  const box=$("globalSearchResults"),input=$("globalSearch");if(!box)return;const q=String(value||'').trim().toLowerCase();
  if(q.length<3){box.innerHTML='';box.classList.remove('show');input?.setAttribute('aria-expanded','false');return;}
  const people=PEOPLE.filter(p=>[p.name,p.email,p.phone].join(' ').toLowerCase().includes(q)).slice(0,5).map(p=>({type:'person',key:p.key,title:p.name||p.phone||p.email,sub:[p.phone,p.email,`${p.chats} chats`].filter(Boolean).join(' · ')}));
  const chats=VIEW.filter(r=>[r.id,r.title,r.summary,r.rawName,r.rawEmail,r.rawPhone,r.programs.join(' '),r.questions.map(x=>x.text).join(' ')].join(' ').toLowerCase().includes(q)).slice(0,7).map(r=>({type:'chat',key:r.idx,title:r.title,sub:[r.rawName,r.rawPhone||r.rawEmail,r.id].filter(Boolean).join(' · ')}));
  const items=[...people,...chats].slice(0,10);box.innerHTML=items.length?items.map((x,i)=>`<button type="button" role="option" data-global-type="${x.type}" data-global-key="${esc(x.key)}"><b>${esc(x.title)}</b><span>${esc(x.sub)}</span></button>`).join(''):`<div class="global-empty">No matches in selected date range</div>`;box.classList.add('show');input?.setAttribute('aria-expanded',items.length?'true':'false');
}
function onGlobalSearchKeydown(e){
  const box=$("globalSearchResults"),items=[...(box?.querySelectorAll('[data-global-type]')||[])];if(!items.length)return;
  if(e.key==='ArrowDown'){e.preventDefault();items[0].focus();}else if(e.key==='Escape'){box.classList.remove('show');$("globalSearch")?.setAttribute('aria-expanded','false');}
}
document.addEventListener('click',e=>{
  const item=e.target.closest('[data-global-type]');if(item){const t=item.dataset.globalType,k=item.dataset.globalKey;$("globalSearchResults")?.classList.remove('show');$("globalSearch")?.setAttribute('aria-expanded','false');if(t==='person')openDrill('person',k);else openDrill('chat',k);return;}
  if(!e.target.closest('.global-search-wrap')){$("globalSearchResults")?.classList.remove('show');$("globalSearch")?.setAttribute('aria-expanded','false');}
});
function decorateResponsiveTables(){
  document.querySelectorAll('#sec-leads table,#sec-serial table,#sec-callbacks table,#sec-explorer table').forEach(table=>{
    table.classList.add('responsive-card-table');const labels=[...table.querySelectorAll('thead th')].map(th=>th.textContent.trim());
    table.querySelectorAll('tbody tr').forEach(tr=>{if(tr.classList.contains('expanded-row'))return;[...tr.children].forEach((td,i)=>td.setAttribute('data-label',labels[i]||''));});
  });
}
function makeDashboardInteractive(){
  document.querySelectorAll('.clk').forEach(el=>{if(el.tagName==='BUTTON'||el.tagName==='A')return;el.setAttribute('role','button');el.setAttribute('tabindex','0');if(!el.dataset.keybound){el.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();el.click();}});el.dataset.keybound='1';}});
}
function syncChatShellNav(){
  const links=[...document.querySelectorAll('.side-link')];
  const sections=[...document.querySelectorAll('#report section[id]')];
  if(!links.length||!sections.length)return;
  const targetOf=a=>(a.dataset.target||String(a.getAttribute('href')||'').replace(/^#/,''));
  const cleanHash=()=>{try{if(location.hash)history.replaceState(null,document.title,location.pathname+location.search);}catch(e){}};
  const setActive=id=>links.forEach(a=>a.classList.toggle('active',targetOf(a)===id));
  if(!window.__chatNavClickBound){
    window.__chatNavClickBound=true;
    links.forEach(a=>a.addEventListener('click',e=>{
      const id=targetOf(a),target=id?document.getElementById(id):null;
      if(!target)return;
      e.preventDefault();
      setActive(id);
      const reduce=window.matchMedia&&window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      target.scrollIntoView({behavior:reduce?'auto':'smooth',block:'start'});
      cleanHash();
    }));
  }
  if(!window.__chatNavScrollBound){
    window.__chatNavScrollBound=true;
    window.addEventListener('scroll',()=>{
      const liveSections=[...document.querySelectorAll('#report section[id]')];
      if(!liveSections.length)return;
      let current=liveSections[0]?.id;
      const y=window.scrollY+160;
      liveSections.forEach(s=>{if(s.offsetTop<=y)current=s.id;});
      if(current)setActive(current);
      cleanHash();
    },{passive:true});
  }
  setActive(sections[0].id);
  cleanHash();
}

function renderMethod(){
  const q=window.DATA_QUALITY||{};
  $("methodBody").innerHTML=`<b>Source.</b> Read from <span class="mono">${esc(SHEET)}</span> in <span class="mono">${esc(DATA_FILE)}</span>, decrypted locally after login. The admin publishes <span class="mono">${CONFIG_FILE}</span> with the data path, sheet, source filename, record count and publish timestamp; built-in defaults remain as a safe fallback.<br><br>
  <b>Data quality.</b> ${q.sourceRows||0} source rows were inspected; ${q.validRows||0} analysed, ${q.invalidDates||0} excluded for invalid dates, ${q.duplicates||0} exact duplicates removed, ${q.blankIds||0} missing chat IDs and ${q.blankConversations||0} blank conversations flagged.<br><br>
  <b>Engagement.</b> Engagement is based on meaningful prospect messages and completed user–Anya exchanges, not only the number of bot replies.<br><br>
  <b>Answer gap.</b> A user question is an answer gap when the next Anya response either requests details instead of answering or gives the generic scope deflection. The same definition is used across the summary, KPIs, topic bars, drill-downs and exports.<br><br>
  <b>Contact and callbacks.</b> Contact capture requires a usable phone number or valid email. Privacy consent alone is not counted. A callback request requires usable contact plus a non-empty callback field or explicit callback language from the prospect.<br><br>
  <b>Recovery queue.</b> High-intent no-contact chats show stronger demand signals—callback language, three or more meaningful messages, repeated questions, programme interest, or an admissions-critical theme—but no usable phone/email.<br><br>
  <b>People and priority.</b> Phones are normalised to a country-code form where possible; emails are lowercased. Chats are grouped on that canonical identity. Priority score (0–100): callback +45, depth ×3 (cap 12), questions ×2 (cap 15), repeat visit +15, known programme +8. Bands are operational heuristics, not predictive admissions outcomes.<br><br>
  <b>Trends and comparisons.</b> Topic trends split the selected range at its true chronological midpoint. Management KPI comparisons use the immediately preceding period of the same length; All-time has no prior-period comparison.<br><br>
  <b>Privacy and exports.</b> Full values are visible to signed-in users. CSV exports include UTF-8 support and neutralise spreadsheet-formula prefixes such as =, +, - and @.`;
}
