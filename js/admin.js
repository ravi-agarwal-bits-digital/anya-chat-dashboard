const ADMIN_PASSWORD_HASH='2f8f998b75f4bfd79e4b9a0760d82905cfbe1fccb942ecfd6d1e8999e04c021f';
const DATA_MAGIC='AANYAENC1';
const DEFAULT_DATA_PATH='data/chat_analytics.xlsx';
const DEFAULT_REQUIRED_SHEET='Chats Export';
const DEFAULT_CONFIG_PATH='data/dashboard-config.json';
const CONFIG_SCHEMA_VERSION=1;
const MAX_FILE_BYTES=90*1024*1024;
const REQUIRED_COLS=['Chat Created At (IST)','Chat ID','Agent Messages','Total Tokens','Summary','Full Conversation'];
const REPO_SETTINGS_KEY='anya_chat_admin_repo_settings_v2';
const SESSION_TOKEN_KEY='anya_chat_admin_github_token_session_v2';
const ADMIN_SESSION_MINS=720;
const ADMIN_AUTH_TIME_KEY='anya_chat_admin_auth_time_v2';
const ADMIN_PASSPHRASE_KEY='anya_chat_admin_passphrase_session_v2';
let ADMIN_PASSPHRASE='';
let selectedFile=null;
let selectedFileBytes=null;
let validationInfo=null;
const $=id=>document.getElementById(id);
function showStatus(id,msg,type='warn'){const el=$(id);if(!el)return;el.className='status '+type;el.innerHTML=msg;el.classList.remove('hidden');}
function hideStatus(id){const el=$(id);if(el)el.classList.add('hidden');}
function escapeHtml(s){return String(s||'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));}
async function sha256(text){const data=new TextEncoder().encode(text);const hash=await crypto.subtle.digest('SHA-256',data);return Array.from(new Uint8Array(hash)).map(b=>b.toString(16).padStart(2,'0')).join('');}
function showAdminApp(){
  $('adminGate').classList.add('hidden');
  $('adminApp').classList.remove('hidden');
  loadConnectionSettings();
  loadSessionToken();
  refreshVaultState();
}
function rememberAdminSession(passphrase){sessionStorage.setItem(ADMIN_AUTH_TIME_KEY,Date.now().toString());sessionStorage.setItem(ADMIN_PASSPHRASE_KEY,passphrase);}
function checkExistingAdminSession(){
  const pass=sessionStorage.getItem(ADMIN_PASSPHRASE_KEY)||'';
  const authTime=Number(sessionStorage.getItem(ADMIN_AUTH_TIME_KEY)||0);
  const timeout=ADMIN_SESSION_MINS*60*1000;
  if(pass&&authTime&&Date.now()-authTime<timeout){ADMIN_PASSPHRASE=pass;rememberAdminSession(pass);showAdminApp();return true;}
  sessionStorage.removeItem(ADMIN_AUTH_TIME_KEY);sessionStorage.removeItem(ADMIN_PASSPHRASE_KEY);return false;
}
async function unlockAdmin(){
  const pwd=$('adminPassword').value||'';
  if(!pwd){showStatus('gateStatus','Please enter the admin password.','err');return;}
  if(await sha256(pwd)!==ADMIN_PASSWORD_HASH){showStatus('gateStatus','Incorrect password.','err');$('adminPassword').value='';return;}
  ADMIN_PASSPHRASE=pwd;rememberAdminSession(pwd);showAdminApp();
}
function bytesToBase64(bytes){let binary='';const chunk=0x8000;for(let i=0;i<bytes.length;i+=chunk){binary+=String.fromCharCode(...bytes.subarray(i,i+chunk));}return btoa(binary);}
function base64ToBytes(b64){const bin=atob(b64);const out=new Uint8Array(bin.length);for(let i=0;i<bin.length;i++)out[i]=bin.charCodeAt(i);return out;}
async function deriveKey(passphrase,salt,usage){const baseKey=await crypto.subtle.importKey('raw',new TextEncoder().encode(passphrase),'PBKDF2',false,['deriveKey']);return crypto.subtle.deriveKey({name:'PBKDF2',salt,iterations:150000,hash:'SHA-256'},baseKey,{name:'AES-GCM',length:256},false,usage);}
async function encryptBytes(bytes,passphrase,magic=DATA_MAGIC){const salt=crypto.getRandomValues(new Uint8Array(16));const iv=crypto.getRandomValues(new Uint8Array(12));const key=await deriveKey(passphrase,salt,['encrypt']);const ct=new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv},key,bytes));const head=new TextEncoder().encode(magic);const out=new Uint8Array(head.length+salt.length+iv.length+ct.length);out.set(head,0);out.set(salt,head.length);out.set(iv,head.length+salt.length);out.set(ct,head.length+salt.length+iv.length);return out;}
async function decryptBytes(payload,passphrase,magic='ANYATOKEN1'){const magicBytes=new TextEncoder().encode(magic);for(let i=0;i<magicBytes.length;i++){if(payload[i]!==magicBytes[i])throw new Error('Saved token header not recognized');}const off=magicBytes.length;const salt=payload.slice(off,off+16);const iv=payload.slice(off+16,off+28);const ct=payload.slice(off+28);const key=await deriveKey(passphrase,salt,['decrypt']);return new Uint8Array(await crypto.subtle.decrypt({name:'AES-GCM',iv},key,ct));}
function formatSize(n){if(!n)return '—';if(n<1024)return n+' B';if(n<1024*1024)return (n/1024).toFixed(1)+' KB';return (n/1024/1024).toFixed(2)+' MB';}
function setupUpload(){
  const dz=$('dropZone'),fi=$('fileInput');
  fi.addEventListener('change',e=>setFile(e.target.files[0]));
  $('publishConfirm').addEventListener('change',updatePublishReady);
  ['dragover','dragenter'].forEach(ev=>dz.addEventListener(ev,e=>{e.preventDefault();dz.classList.add('over');}));
  ['dragleave','drop'].forEach(ev=>dz.addEventListener(ev,e=>{e.preventDefault();dz.classList.remove('over');}));
  dz.addEventListener('drop',e=>{if(e.dataTransfer.files[0])setFile(e.dataTransfer.files[0]);});
  ['sheet','path','configPath'].forEach(id=>{const el=$(id);if(el)el.addEventListener('change',()=>{if(selectedFile)setFile(selectedFile);});});
}
function updatePublishReady(){$('publishBtn').disabled=!(selectedFile&&selectedFileBytes&&validationInfo&&$('publishConfirm').checked);}
const DASHBOARD_MONTHS=new Set(['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']);
function hasDashboardDate(value){
  const m=String(value||'').match(/(\d{1,2})\s+(\w{3})\s+(\d{4}),\s+(\d{1,2}):(\d{2}):(\d{2})\s*(AM|PM)/i);
  return !!(m&&DASHBOARD_MONTHS.has(m[2].slice(0,1).toUpperCase()+m[2].slice(1,3).toLowerCase()));
}
function assessWorkbookQuality(rows){
  const quality={validDates:0,invalidDates:0,nonBlankConversations:0,blankConversations:0,usableRows:0,duplicates:0};
  const seen=new Set();
  rows.forEach(row=>{
    const created=String(row['Chat Created At (IST)']||''),conversation=String(row['Full Conversation']||''),chatId=String(row['Chat ID']||'').trim();
    const validDate=hasDashboardDate(created),hasConversation=!!conversation.trim();
    if(validDate)quality.validDates++;else quality.invalidDates++;
    if(hasConversation)quality.nonBlankConversations++;else quality.blankConversations++;
    if(validDate&&hasConversation)quality.usableRows++;
    const fingerprint=(chatId||conversation.slice(0,160))+'|'+created;
    if(seen.has(fingerprint))quality.duplicates++;else seen.add(fingerprint);
  });
  return quality;
}
function qualityStatus(quality){
  return 'Data quality: <b>'+quality.usableRows.toLocaleString('en-IN')+'</b> usable chats · '+quality.invalidDates.toLocaleString('en-IN')+' unrecognised timestamp'+(quality.invalidDates===1?'':'s')+' · '+quality.blankConversations.toLocaleString('en-IN')+' blank conversation'+(quality.blankConversations===1?'':'s')+' · '+quality.duplicates.toLocaleString('en-IN')+' duplicate row'+(quality.duplicates===1?'':'s')+' (dashboard skips duplicates).';
}
async function setFile(file){
  selectedFile=file||null;selectedFileBytes=null;validationInfo=null;$('publishConfirm').checked=false;$('publishConfirm').disabled=true;updatePublishReady();hideStatus('publishStatus');hideStatus('fileStatus');
  $('fileName').textContent='';$('fileName').classList.add('hidden');$('fileSize').textContent='—';$('sheetStatus').textContent='—';$('rowCount').textContent='—';
  if(!file)return;
  $('fileName').textContent=file.name;$('fileName').classList.remove('hidden');$('fileSize').textContent=formatSize(file.size);
  try{
    validationInfo=await validateWorkbook(file);
    $('sheetStatus').textContent='OK';$('rowCount').textContent=String(validationInfo.rows);
    $('publishConfirm').disabled=false;
    const quality=validationInfo.quality;
    showStatus('fileStatus','Valid chat export: <b>'+escapeHtml(validationInfo.sheet)+'</b> · '+validationInfo.rows.toLocaleString('en-IN')+' rows found.<br>'+qualityStatus(quality),quality.invalidDates||quality.blankConversations||quality.duplicates?'warn':'ok');
  }catch(e){
    $('sheetStatus').textContent='Fix';$('rowCount').textContent='—';selectedFileBytes=null;
    showStatus('fileStatus',escapeHtml(e.message||String(e)),'err');
  }
}
async function validateWorkbook(file){
  if(!/\.(xlsx|xls)$/i.test(file.name))throw new Error('Please select an .xlsx or .xls Excel export.');
  if(file.size>MAX_FILE_BYTES)throw new Error('This workbook is too large to publish safely. GitHub supports files under 100 MB; use an export below 90 MB.');
  const raw=new Uint8Array(await file.arrayBuffer());
  if(typeof XLSX==='undefined')throw new Error('Spreadsheet validator did not load. Check internet/CDN access and refresh.');
  const wb=XLSX.read(raw,{type:'array'});
  const sheet=($('sheet').value||DEFAULT_REQUIRED_SHEET).trim()||DEFAULT_REQUIRED_SHEET;
  if(!wb.SheetNames.includes(sheet))throw new Error('Missing "'+sheet+'" sheet. Found: '+(wb.SheetNames.join(', ')||'(none)'));
  const rows=XLSX.utils.sheet_to_json(wb.Sheets[sheet],{defval:''});
  if(!rows.length)throw new Error('"'+sheet+'" sheet is empty.');
  const headers=Object.keys(rows[0]||{});
  const missing=REQUIRED_COLS.filter(c=>!headers.includes(c));
  if(missing.length)throw new Error('Missing required column(s): '+missing.join(', '));
  const quality=assessWorkbookQuality(rows);
  if(!quality.validDates)throw new Error('No timestamps match the dashboard format in "Chat Created At (IST)". Upload an export with recognised chat timestamps.');
  if(!quality.nonBlankConversations)throw new Error('Every "Full Conversation" value is blank. Upload an export with chat conversations.');
  if(!quality.usableRows)throw new Error('No usable chats were found. At least one row needs both a recognised chat timestamp and a non-blank conversation.');
  selectedFileBytes=raw;
  return {rows:rows.length,sheet,headers:headers.length,quality};
}
function currentMode(){return document.querySelector('input[name="tokenMode"]:checked')?.value||'session';}
function getConnectionSettings(){return {owner:$('owner').value.trim(),repo:$('repo').value.trim(),branch:$('branch').value.trim()||'main',path:$('path').value.trim()||DEFAULT_DATA_PATH,sheet:($('sheet').value||DEFAULT_REQUIRED_SHEET).trim()||DEFAULT_REQUIRED_SHEET,configPath:($('configPath').value||DEFAULT_CONFIG_PATH).trim()||DEFAULT_CONFIG_PATH,writeConfig:!!$('writeConfig').checked};}
function saveConnectionSettings(){
  if($('rememberRepo').checked)localStorage.setItem(REPO_SETTINGS_KEY,JSON.stringify(getConnectionSettings()));
  const token=$('token').value.trim();const mode=currentMode();
  if(token&&mode==='session'){sessionStorage.setItem(SESSION_TOKEN_KEY,token);showStatus('tokenStatus','Token remembered for this browser session.','ok');}
  else if(mode==='never'){sessionStorage.removeItem(SESSION_TOKEN_KEY);showStatus('tokenStatus','Settings saved. Token will not be remembered.','warn');}
  else showStatus('tokenStatus','Repository settings saved.','ok');
}
function loadConnectionSettings(){
  $('path').value=DEFAULT_DATA_PATH;$('sheet').value=DEFAULT_REQUIRED_SHEET;$('configPath').value=DEFAULT_CONFIG_PATH;$('branch').value=$('branch').value||'main';
  try{const s=JSON.parse(localStorage.getItem(REPO_SETTINGS_KEY)||'null');if(s){$('owner').value=s.owner||'';$('repo').value=s.repo||'';$('branch').value=s.branch||'main';$('path').value=s.path||DEFAULT_DATA_PATH;$('sheet').value=s.sheet||DEFAULT_REQUIRED_SHEET;$('configPath').value=s.configPath||DEFAULT_CONFIG_PATH;$('writeConfig').checked=s.writeConfig!==false;}}catch(e){}
}
function loadSessionToken(){const t=sessionStorage.getItem(SESSION_TOKEN_KEY);if(t){$('token').value=t;showStatus('tokenStatus','Session token loaded.','ok');}}
function clearSessionToken(){sessionStorage.removeItem(SESSION_TOKEN_KEY);$('token').value='';showStatus('tokenStatus','Session token cleared.','warn');}
function clearLegacyTokenVault(){localStorage.removeItem('anya_chat_admin_token_vault_v2');}
function setupTokenMode(){}
function refreshVaultState(){}
function requireSettings(){
  const s=getConnectionSettings();
  if(!s.owner||!s.repo||!s.branch||!s.path)throw new Error('Please complete GitHub owner, repository, branch and live data path.');
  if(s.writeConfig&&!s.configPath)throw new Error('Enter the dashboard config path or turn off config publishing.');
  if(s.writeConfig&&!/\.json$/i.test(s.configPath))throw new Error('Dashboard config path must end in .json.');
  return s;
}
function buildDashboardConfig(settings){
  return {
    schemaVersion:CONFIG_SCHEMA_VERSION,
    dataFile:settings.path,
    sheetName:settings.sheet,
    lastPublishedAt:new Date().toISOString(),
    sourceFile:selectedFile?selectedFile.name:'',
    recordCount:validationInfo?validationInfo.rows:0,
    fileSize:selectedFile?selectedFile.size:0
  };
}
function jsonToBase64(value){return bytesToBase64(new TextEncoder().encode(JSON.stringify(value,null,2)+'\n'));}
function encodePath(path){return String(path).split('/').map(encodeURIComponent).join('/');}
async function putGithubFile(settings,path,contentBase64,token,message){
  const apiBase='https://api.github.com/repos/'+encodeURIComponent(settings.owner)+'/'+encodeURIComponent(settings.repo)+'/contents/'+encodePath(path);
  let sha=null;
  const getResp=await fetch(apiBase+'?ref='+encodeURIComponent(settings.branch)+'&t='+Date.now(),{cache:'no-store',headers:{Authorization:'Bearer '+token,Accept:'application/vnd.github+json'}});
  if(getResp.ok){const data=await getResp.json();sha=data.sha||null;}
  else if(getResp.status!==404){const txt=await getResp.text();throw new Error('Could not check existing '+path+': '+txt.slice(0,220));}
  const body={message,content:contentBase64,branch:settings.branch};if(sha)body.sha=sha;
  const putResp=await fetch(apiBase,{method:'PUT',headers:{Authorization:'Bearer '+token,Accept:'application/vnd.github+json','Content-Type':'application/json'},body:JSON.stringify(body)});
  if(!putResp.ok){const txt=await putResp.text();throw new Error('GitHub publish failed for '+path+': '+txt.slice(0,260));}
  const written=await putResp.json(),writtenSha=written?.content?.sha||'';
  if(written?.content?.path!==path||!writtenSha)throw new Error('GitHub did not confirm the saved file metadata for '+path+'.');
  const verifyResp=await fetch(apiBase+'?ref='+encodeURIComponent(settings.branch)+'&t='+Date.now(),{cache:'no-store',headers:{Authorization:'Bearer '+token,Accept:'application/vnd.github+json'}});
  if(!verifyResp.ok)throw new Error('GitHub could not verify the published '+path+'.');
  const verified=await verifyResp.json();
  if(verified.sha!==writtenSha)throw new Error('GitHub verification did not match the saved '+path+'.');
  return {sha:writtenSha};
}
async function publishData(){
  const uploaded=[];
  try{
    if(!selectedFile||!selectedFileBytes)throw new Error('Select and validate a chat Excel file first.');
    if(!$('publishConfirm').checked)throw new Error('Review the validation summary and confirm the production replacement first.');
    const s=requireSettings();
    let token=$('token').value.trim()||sessionStorage.getItem(SESSION_TOKEN_KEY)||'';
    if(!token)throw new Error('Enter a GitHub fine-grained token or unlock a saved encrypted token.');
    $('publishBtn').disabled=true;showStatus('publishStatus','Encrypting validated chat export locally…','warn');
    saveConnectionSettings();
    const encrypted=await encryptBytes(selectedFileBytes,ADMIN_PASSPHRASE,DATA_MAGIC);
    const content=bytesToBase64(encrypted);
    showStatus('publishStatus','Publishing live dashboard data file…','warn');
    await putGithubFile(s,s.path,content,token,'Update Anya chat analytics data');uploaded.push('Live file updated and verified: '+s.path);
    if(s.writeConfig){
      showStatus('publishStatus','Data published. Synchronising dashboard configuration…','warn');
      const config=buildDashboardConfig(s);
      await putGithubFile(s,s.configPath,jsonToBase64(config),token,'Update Anya dashboard configuration');
      uploaded.push('Dashboard config updated and verified: '+s.configPath);
    }
    showStatus('publishStatus','Published successfully.<br><br>'+uploaded.map(x=>'• '+escapeHtml(x)).join('<br>')+'<br><br>The dashboard will use the published path, sheet and timestamp on refresh.','ok');
    $('publishConfirm').checked=false;updatePublishReady();
  }catch(e){
    const partial=uploaded.length?'<br><br>Verified before this error:<br>'+uploaded.map(x=>'• '+escapeHtml(x)).join('<br>')+'<br><br>Check the dashboard configuration before retrying.':'';
    showStatus('publishStatus',escapeHtml(e.message||String(e))+partial,'err');
  }
  finally{updatePublishReady();}
}
window.addEventListener('DOMContentLoaded',()=>{
  const brandLogo=document.querySelector('#adminGate .logoBox img')?.getAttribute('src')||'';
  if(brandLogo)document.querySelectorAll('[data-brand-logo]').forEach(img=>img.setAttribute('src',brandLogo));
  clearLegacyTokenVault();setupUpload();setupTokenMode();checkExistingAdminSession();
});
