/* LumaLedger v1.1 — offline-first dual-currency ledger.
   Local data lives in IndexedDB. Encrypted exports use Web Crypto (AES-GCM/PBKDF2). */
'use strict';

const DB_NAME = 'LumaLedgerDB';
const DB_VERSION = 1;
const DATA_STORE = 'appData';
const RECOVERY_STORE = 'recovery';
const LEGACY_KEY = 'lumaledger_data_v1';
const DEFAULT_RATE = 190;
const BACKUP_FORMAT = 'lumaledger-encrypted-backup';
let db;
let state;
let cashflowChart = null;
let toastTimer = null;
let saveQueue = Promise.resolve();

function makeId(){return 'id_'+Date.now().toString(36)+Math.random().toString(36).slice(2,8);}
function defaultState(){const id=makeId();return {schemaVersion:2,activeProfileId:id,profiles:[{id,name:'My Business',rate:DEFAULT_RATE,transactions:[]}]};}
function openDatabase(){return new Promise((resolve,reject)=>{const request=indexedDB.open(DB_NAME,DB_VERSION);request.onupgradeneeded=()=>{const database=request.result;if(!database.objectStoreNames.contains(DATA_STORE))database.createObjectStore(DATA_STORE);if(!database.objectStoreNames.contains(RECOVERY_STORE))database.createObjectStore(RECOVERY_STORE,{keyPath:'id',autoIncrement:true});};request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error||new Error('Could not open local database.'));request.onblocked=()=>reject(new Error('Database upgrade is blocked by another open LumaLedger tab. Close other tabs and reload.'));});}
function dbGet(store,key){return new Promise((resolve,reject)=>{const tx=db.transaction(store,'readonly');const req=tx.objectStore(store).get(key);req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});}
function dbPut(store,key,value){return new Promise((resolve,reject)=>{const tx=db.transaction(store,'readwrite');const req=key===undefined?tx.objectStore(store).add(value):tx.objectStore(store).put(value,key);req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);tx.onabort=()=>reject(tx.error||new Error('Database write failed.'));});}
function dbAll(store){return new Promise((resolve,reject)=>{const req=db.transaction(store,'readonly').objectStore(store).getAll();req.onsuccess=()=>resolve(req.result||[]);req.onerror=()=>reject(req.error);});}
function dbClear(store){return new Promise((resolve,reject)=>{const tx=db.transaction(store,'readwrite');tx.objectStore(store).clear();tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});}
function validateState(value){
  if(!value||typeof value!=='object'||!Array.isArray(value.profiles)||value.profiles.length<1||value.profiles.length>500)throw new Error('Backup must contain between 1 and 500 business profiles.');
  const ids=new Set();
  for(const p of value.profiles){
    if(!p||typeof p!=='object'||typeof p.id!=='string'||!p.id||ids.has(p.id))throw new Error('A business profile has a missing or duplicate ID.');
    ids.add(p.id);
    if(typeof p.name!=='string'||!p.name.trim()||p.name.length>100)throw new Error('A business profile name is invalid.');
    if(!Number.isFinite(Number(p.rate))||Number(p.rate)<=0)throw new Error('A business profile has an invalid exchange rate.');
    if(!Array.isArray(p.transactions)||p.transactions.length>100000)throw new Error('A profile contains an invalid transaction list.');
    const txIds=new Set();
    for(const t of p.transactions){
      if(!t||typeof t!=='object'||typeof t.id!=='string'||!t.id||txIds.has(t.id))throw new Error('A transaction has a missing or duplicate ID.');
      txIds.add(t.id);
      if(!['income','expense'].includes(t.type))throw new Error('A transaction type is invalid.');
      if(!['LRD','USD'].includes(t.currency))throw new Error('A transaction currency is invalid.');
      if(!Number.isFinite(Number(t.amount))||Number(t.amount)<=0)throw new Error('A transaction amount is invalid.');
      if(typeof t.date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(t.date))throw new Error('A transaction date is invalid.');
      if(typeof t.description!=='string'||t.description.length>200)throw new Error('A transaction description is invalid.');
    }
  }
  const active=ids.has(value.activeProfileId)?value.activeProfileId:value.profiles[0].id;
  return {...value,schemaVersion:2,activeProfileId:active,profiles:value.profiles.map(p=>({...p,rate:Number(p.rate),transactions:p.transactions.map(t=>({...t,amount:Number(t.amount),rateAtEntry:Number(t.rateAtEntry)>0?Number(t.rateAtEntry):Number(p.rate),createdAt:Number(t.createdAt)||Date.now()}))}))};
}
async function boot(){
  try{
    if(!('indexedDB' in window))throw new Error('This browser does not support IndexedDB. Use an updated Chrome, Edge, Firefox, or Safari browser.');
    db=await openDatabase();
    const stored=await dbGet(DATA_STORE,'state');
    if(stored){state=validateState(stored);}
    else{
      let migrated=false;
      try{const legacy=localStorage.getItem(LEGACY_KEY);if(legacy){const parsed=JSON.parse(legacy);parsed.profiles?.forEach(p=>p.transactions?.forEach(t=>{if(!t.rateAtEntry)t.rateAtEntry=Number(p.rate)||DEFAULT_RATE;}));state=validateState(parsed);migrated=true;}}catch(err){console.warn('Legacy data could not be migrated automatically:',err);}
      if(!state)state=defaultState();
      await dbPut(DATA_STORE,'state',state);
      await createRecoverySnapshot(migrated?'Imported v1.0 data':'Initial setup');
      if(migrated)showToast('Your v1.0 records were safely copied. The old browser data was left untouched.');
    }
    document.getElementById('storageStatus').textContent='Local database active';
    document.getElementById('recoveryStatus').textContent='Recovery copy saved on this device.';
    initUI();
  }catch(error){
    console.error(error);
    const status=document.getElementById('storageStatus');if(status)status.textContent='Storage unavailable';
    document.body.insertAdjacentHTML('afterbegin',`<div style="position:sticky;top:0;z-index:9999;background:#7b2020;color:#fff;padding:14px 18px;font:14px/1.5 Arial">LumaLedger could not safely open its local database: ${escapeHTML(error.message)}. Your old v1.0 browser data has not been deleted. Do not enter transactions until storage is working.</div>`);
  }
}
function saveState(){
  saveQueue=saveQueue.then(async()=>{const previous=await dbGet(DATA_STORE,'state');if(previous)await createRecoverySnapshot('Before automatic save',previous);await dbPut(DATA_STORE,'state',state);await createRecoverySnapshot('After automatic save',state);}).catch(error=>{console.error('Save failed:',error);showToast('Save failed. Stop entering records and check browser storage.');throw error;});
  return saveQueue;
}
async function createRecoverySnapshot(reason,dataOverride){
  if(!db||!state)return;
  const snapshotData=dataOverride||state;
  await dbPut(RECOVERY_STORE,undefined,{createdAt:new Date().toISOString(),reason,data:JSON.parse(JSON.stringify(snapshotData))});
  const all=await dbAll(RECOVERY_STORE);
  if(all.length>10){const remove=all.sort((a,b)=>a.id-b.id).slice(0,all.length-10);for(const item of remove)await new Promise((resolve,reject)=>{const tx=db.transaction(RECOVERY_STORE,'readwrite');tx.objectStore(RECOVERY_STORE).delete(item.id);tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});}
  const label=document.getElementById('recoveryStatus');if(label)label.textContent=`Last recovery copy: ${new Date().toLocaleTimeString()} · ${all.length>10?10:all.length} retained`;
}
function activeProfile(){return state.profiles.find(p=>p.id===state.activeProfileId)||state.profiles[0];}
function money(value,currency){return (currency==='LRD'?'L$ ':'$')+Number(value||0).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});}
function toLRD(amount,currency,rate){return currency==='USD'?Number(amount)*Number(rate):Number(amount);}
function escapeHTML(value){return String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function todayISO(){const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;}
function currentMonth(){return todayISO().slice(0,7);}
function formatDate(date){if(!date)return '—';return new Date(date+'T00:00:00').toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'});}
function showToast(message){const el=document.getElementById('toast');el.textContent=message;el.classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.classList.remove('show'),3000);}
function profileTransactions(){return activeProfile().transactions.slice().sort((a,b)=>b.date.localeCompare(a.date)||(b.createdAt||0)-(a.createdAt||0));}
function getMonthTransactions(month=currentMonth()){return activeProfile().transactions.filter(t=>t.date.startsWith(month));}
function txRate(t){return Number(t.rateAtEntry)>0?Number(t.rateAtEntry):activeProfile().rate;}
function totals(transactions){const result={lrdIncome:0,lrdExpense:0,usdIncome:0,usdExpense:0};transactions.forEach(t=>{const key=(t.currency==='LRD'?'lrd':'usd')+(t.type==='income'?'Income':'Expense');result[key]+=Number(t.amount);});return result;}
function initUI(){document.getElementById('todayLabel').textContent=new Date().toLocaleDateString('en-US',{weekday:'short',month:'short',day:'numeric'});document.getElementById('txDate').value=todayISO();document.getElementById('reportMonth').value=currentMonth();renderAll();bindEvents();}
function renderAll(){renderProfiles();renderDashboard();renderTransactions();renderReports();renderSettings();}
function renderProfiles(){const select=document.getElementById('profileSelect');select.innerHTML=state.profiles.map(p=>`<option value="${escapeHTML(p.id)}" ${p.id===state.activeProfileId?'selected':''}>${escapeHTML(p.name)}</option>`).join('');}
function renderDashboard(){
  const p=activeProfile(),monthTx=getMonthTransactions(),all=totals(p.transactions),m=totals(monthTx);
  const lrdBalance=all.lrdIncome-all.lrdExpense,usdBalance=all.usdIncome-all.usdExpense;
  const equivalent=p.transactions.reduce((sum,t)=>sum+(t.type==='income'?1:-1)*toLRD(t.amount,t.currency,txRate(t)),0);
  const incomeLRD=monthTx.filter(t=>t.type==='income').reduce((s,t)=>s+toLRD(t.amount,t.currency,txRate(t)),0);
  const expenseLRD=monthTx.filter(t=>t.type==='expense').reduce((s,t)=>s+toLRD(t.amount,t.currency,txRate(t)),0);
  document.getElementById('welcomeName').textContent=p.name;document.getElementById('rateDisplay').textContent=`1 USD = ${money(p.rate,'LRD')}`;document.getElementById('snapshotRate').textContent=`1 USD = ${money(p.rate,'LRD')}`;
  document.getElementById('totalBalance').textContent=money(equivalent,'LRD');document.getElementById('lrdBalance').textContent=money(lrdBalance,'LRD');document.getElementById('usdBalance').textContent=money(usdBalance,'USD');
  document.getElementById('monthIncome').textContent=money(incomeLRD,'LRD');document.getElementById('monthExpenses').textContent=money(expenseLRD,'LRD');document.getElementById('monthCount').textContent=monthTx.length;
  document.getElementById('monthIncomeSub').textContent=`LRD ${money(m.lrdIncome,'LRD')} · USD ${money(m.usdIncome,'USD')}`;document.getElementById('monthExpenseSub').textContent=`LRD ${money(m.lrdExpense,'LRD')} · USD ${money(m.usdExpense,'USD')}`;
  const recent=profileTransactions().slice(0,5);document.getElementById('recentTable').innerHTML=recent.map(t=>`<tr><td>${escapeHTML(t.description)}</td><td><span class="type-chip ${t.type}">${t.type}</span></td><td>${formatDate(t.date)}</td><td class="amount-${t.type}">${t.type==='income'?'+':'−'}${money(t.amount,t.currency)}</td></tr>`).join('');document.getElementById('recentEmpty').style.display=recent.length?'none':'block';drawCashflowChart();
}
function drawCashflowChart(){
  const canvas=document.getElementById('cashflowChart');if(!canvas)return;const ctx=canvas.getContext('2d');const rect=canvas.getBoundingClientRect();if(!rect.width||!rect.height)return;
  const dpr=window.devicePixelRatio||1;canvas.width=Math.round(rect.width*dpr);canvas.height=Math.round(rect.height*dpr);ctx.scale(dpr,dpr);ctx.clearRect(0,0,rect.width,rect.height);
  const labels=[],income=[],expenses=[],p=activeProfile();for(let i=6;i>=0;i--){const d=new Date();d.setDate(d.getDate()-i);const iso=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;labels.push(d.toLocaleDateString('en-US',{weekday:'short'}));const day=p.transactions.filter(t=>t.date===iso);income.push(day.filter(t=>t.type==='income').reduce((s,t)=>s+toLRD(t.amount,t.currency,txRate(t)),0));expenses.push(day.filter(t=>t.type==='expense').reduce((s,t)=>s+toLRD(t.amount,t.currency,txRate(t)),0));}
  const max=Math.max(1,...income,...expenses),left=42,right=10,top=12,bottom=28,chartH=rect.height-top-bottom,chartW=rect.width-left-right;ctx.font='10px Arial';ctx.textAlign='right';ctx.fillStyle='#9299a4';
  for(let i=0;i<4;i++){const y=top+chartH-(chartH*i/3);ctx.strokeStyle='rgba(140,148,160,.18)';ctx.beginPath();ctx.moveTo(left,y);ctx.lineTo(rect.width-right,y);ctx.stroke();ctx.fillText(Math.round(max*i/3).toLocaleString(),left-7,y+3);}
  const group=chartW/7,barW=Math.min(13,group*.27);labels.forEach((label,i)=>{const center=left+group*(i+.5);const ih=income[i]/max*chartH,eh=expenses[i]/max*chartH;ctx.fillStyle='#ffcc00';ctx.fillRect(center-barW-2,top+chartH-ih,barW,ih);ctx.fillStyle='#aeb6c2';ctx.fillRect(center+2,top+chartH-eh,barW,eh);ctx.textAlign='center';ctx.fillStyle='#9299a4';ctx.fillText(label,center,rect.height-8);});
  ctx.textAlign='left';ctx.fillStyle='#ffcc00';ctx.fillRect(left,3,7,7);ctx.fillStyle='#9299a4';ctx.fillText('Income',left+11,11);ctx.fillStyle='#aeb6c2';ctx.fillRect(left+72,3,7,7);ctx.fillStyle='#9299a4';ctx.fillText('Expenses',left+83,11);
}
function renderTransactions(){const search=(document.getElementById('transactionSearch').value||'').toLowerCase(),filter=document.getElementById('typeFilter').value;const list=profileTransactions().filter(t=>(filter==='all'||t.type===filter)&&(`${t.description} ${t.category} ${t.currency}`.toLowerCase().includes(search)));document.getElementById('transactionsTable').innerHTML=list.map(t=>`<tr><td>${escapeHTML(t.description)}</td><td>${escapeHTML(t.category||'Other')}</td><td><span class="type-chip ${t.type}">${t.type}</span></td><td>${formatDate(t.date)}</td><td class="amount-${t.type}">${t.type==='income'?'+':'−'}${money(t.amount,t.currency)}</td><td><button class="delete-button" data-delete="${escapeHTML(t.id)}" title="Delete transaction" aria-label="Delete transaction">×</button></td></tr>`).join('');document.getElementById('transactionsEmpty').style.display=list.length?'none':'block';}
function renderReports(){const month=document.getElementById('reportMonth').value||currentMonth(),tx=getMonthTransactions(month),t=totals(tx);const income=tx.filter(x=>x.type==='income').reduce((s,x)=>s+toLRD(x.amount,x.currency,txRate(x)),0),expense=tx.filter(x=>x.type==='expense').reduce((s,x)=>s+toLRD(x.amount,x.currency,txRate(x)),0);document.getElementById('reportIncome').textContent=money(income,'LRD');document.getElementById('reportExpenses').textContent=money(expense,'LRD');document.getElementById('reportNet').textContent=money(income-expense,'LRD');document.getElementById('reportCount').textContent=tx.length;document.getElementById('reportLrdIncome').textContent=money(t.lrdIncome,'LRD');document.getElementById('reportLrdExpense').textContent=money(t.lrdExpense,'LRD');document.getElementById('reportUsdIncome').textContent=money(t.usdIncome,'USD');document.getElementById('reportUsdExpense').textContent=money(t.usdExpense,'USD');}
function renderSettings(){const p=activeProfile();document.getElementById('businessName').value=p.name;document.getElementById('exchangeRate').value=p.rate;document.getElementById('profileList').innerHTML=state.profiles.map(profile=>`<div class="profile-list-item"><span>${escapeHTML(profile.name)} ${profile.id===state.activeProfileId?'· ACTIVE':''}</span>${state.profiles.length>1?`<button data-remove-profile="${escapeHTML(profile.id)}">Remove</button>`:''}</div>`).join('');}
function openModal(id){document.getElementById(id).classList.add('show');}function closeModal(id){document.getElementById(id).classList.remove('show');}
function openTransactionModal(){document.getElementById('transactionForm').reset();document.getElementById('txDate').value=todayISO();updateConversionPreview();openModal('transactionModal');}
function updateConversionPreview(){const amount=Number(document.getElementById('txAmount').value||0),currency=document.getElementById('txCurrency').value,rate=activeProfile().rate;const converted=currency==='USD'?money(amount*rate,'LRD'):money(amount/rate,'USD');document.getElementById('conversionPreview').textContent=amount>0?`Approximate equivalent: ${converted}`:'Converted amount will appear here.';}
function switchView(view){document.querySelectorAll('.view').forEach(el=>el.classList.remove('active'));document.getElementById(view+'View').classList.add('active');document.querySelectorAll('.nav-link').forEach(el=>el.classList.toggle('active',el.dataset.view===view));const titles={overview:['YOUR BUSINESS AT A GLANCE','Overview'],transactions:['RECORDS & ACTIVITY','Transactions'],reports:['UNDERSTAND YOUR NUMBERS','Reports'],settings:['PREFERENCES & WORKSPACE','Settings']};document.getElementById('pageEyebrow').textContent=titles[view][0];document.getElementById('pageTitle').textContent=titles[view][1];document.getElementById('sidebar').classList.remove('open');if(view==='overview')drawCashflowChart();}
async function addProfile(name,rate){const p={id:makeId(),name:name.trim(),rate:Number(rate),transactions:[]};state.profiles.push(p);state.activeProfileId=p.id;await saveState();renderAll();showToast('Business profile created.');}
function exportCSV(){const p=activeProfile(),rows=[['Date','Description','Category','Type','Amount','Currency','Rate used (LRD per USD)','LRD equivalent']];p.transactions.slice().sort((a,b)=>a.date.localeCompare(b.date)).forEach(t=>rows.push([t.date,t.description,t.category||'Other',t.type,t.amount,t.currency,txRate(t),toLRD(t.amount,t.currency,txRate(t)).toFixed(2)]));const csv=rows.map(row=>row.map(value=>`"${String(value??'').replace(/"/g,'""')}"`).join(',')).join('\r\n');downloadBlob(new Blob(['\ufeff'+csv],{type:'text/csv;charset=utf-8;'}),`${p.name.replace(/[^a-z0-9]/gi,'_')}_transactions.csv`);}
function downloadBlob(blob,name){const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);}
function bytesToBase64(bytes){let binary='';bytes.forEach(b=>binary+=String.fromCharCode(b));return btoa(binary);}
function base64ToBytes(value){const binary=atob(value);return Uint8Array.from(binary,c=>c.charCodeAt(0));}
async function deriveKey(password,salt){const material=await crypto.subtle.importKey('raw',new TextEncoder().encode(password),'PBKDF2',false,['deriveKey']);return crypto.subtle.deriveKey({name:'PBKDF2',salt,iterations:310000,hash:'SHA-256'},material,{name:'AES-GCM',length:256},false,['encrypt','decrypt']);}
async function exportEncryptedBackup(){
  const password=prompt('Create a password for this backup (at least 10 characters). You will need it to import the file.');if(password===null)return;if(password.length<10){showToast('Use a backup password with at least 10 characters.');return;}const confirmPassword=prompt('Enter the backup password again to confirm.');if(password!==confirmPassword){showToast('The passwords did not match. No backup was created.');return;}
  try{await saveQueue;const salt=crypto.getRandomValues(new Uint8Array(16)),iv=crypto.getRandomValues(new Uint8Array(12)),key=await deriveKey(password,salt),plain=new TextEncoder().encode(JSON.stringify({format:'lumaledger-data',version:2,exportedAt:new Date().toISOString(),data:state})),cipher=await crypto.subtle.encrypt({name:'AES-GCM',iv},key,plain);const envelope={format:BACKUP_FORMAT,version:1,kdf:'PBKDF2-SHA-256',iterations:310000,cipher:'AES-256-GCM',salt:bytesToBase64(salt),iv:bytesToBase64(iv),payload:bytesToBase64(new Uint8Array(cipher))};downloadBlob(new Blob([JSON.stringify(envelope)],{type:'application/json'}),'lumaledger-encrypted-backup.json');showToast('Encrypted backup exported. Keep the password safe.');}catch(error){console.error(error);showToast('Could not create encrypted backup in this browser.');}
}
async function decodeBackup(file,password){const parsed=JSON.parse(await file.text());if(parsed?.format===BACKUP_FORMAT){if(!password)throw new Error('A password is required for this encrypted backup.');const key=await deriveKey(password,base64ToBytes(parsed.salt));let decrypted;try{decrypted=await crypto.subtle.decrypt({name:'AES-GCM',iv:base64ToBytes(parsed.iv)},key,base64ToBytes(parsed.payload));}catch{throw new Error('Password is incorrect or this backup is damaged.');}const body=JSON.parse(new TextDecoder().decode(decrypted));if(body.format!=='lumaledger-data')throw new Error('Backup contents are not recognized.');return validateState(body.data);}
  // Compatibility path for the original v1.0 plain JSON export.
  if(Array.isArray(parsed?.profiles)){parsed.profiles.forEach(p=>p.transactions?.forEach(t=>{if(!t.rateAtEntry)t.rateAtEntry=Number(p.rate)||DEFAULT_RATE;}));return validateState(parsed);}
  throw new Error('This file is not a recognized LumaLedger backup.');
}
async function importBackup(file){
  try{if(file.size>25*1024*1024)throw new Error('Backup file is larger than 25 MB.');const preview=JSON.parse(await file.text());let password=null;if(preview?.format===BACKUP_FORMAT){password=prompt('Enter the password used when this backup was created.');if(password===null)return;}
    const imported=await decodeBackup(file,password);const count=imported.profiles.reduce((sum,p)=>sum+p.transactions.length,0);const summary=imported.profiles.map(p=>`${p.name}: ${p.transactions.length} transactions`).join('\n');
    if(!confirm(`Backup preview\n${imported.profiles.length} business profile(s)\n${count} total transaction(s)\n\n${summary}\n\nBefore importing, LumaLedger will save a recovery copy of the current records. Importing will REPLACE the current records on this device. Continue?`))return;
    await saveQueue;await createRecoverySnapshot('Before backup import');await dbPut(DATA_STORE,'state',imported);state=imported;renderAll();showToast('Backup imported. Previous records are in local recovery history.');
  }catch(error){console.error(error);showToast(error.message||'Backup could not be imported.');}
}
function bindEvents(){
  document.querySelectorAll('.nav-link').forEach(btn=>btn.addEventListener('click',()=>switchView(btn.dataset.view)));document.querySelectorAll('[data-goto]').forEach(btn=>btn.addEventListener('click',()=>switchView(btn.dataset.goto)));
  document.getElementById('menuBtn').addEventListener('click',()=>document.getElementById('sidebar').classList.toggle('open'));
  document.getElementById('profileSelect').addEventListener('change',async e=>{state.activeProfileId=e.target.value;await saveState();renderAll();});
  ['addProfileBtn','addProfileSettings'].forEach(id=>document.getElementById(id).addEventListener('click',()=>openModal('profileModal')));['quickAddBtn','addTransactionBtn'].forEach(id=>document.getElementById(id).addEventListener('click',openTransactionModal));
  document.querySelectorAll('[data-close]').forEach(btn=>btn.addEventListener('click',()=>closeModal(btn.dataset.close)));document.querySelectorAll('.modal-backdrop').forEach(backdrop=>backdrop.addEventListener('click',e=>{if(e.target===backdrop)closeModal(backdrop.id);}));
  ['txAmount','txCurrency'].forEach(id=>document.getElementById(id).addEventListener('input',updateConversionPreview));
  document.getElementById('transactionForm').addEventListener('submit',async e=>{e.preventDefault();const amount=Number(document.getElementById('txAmount').value);if(!Number.isFinite(amount)||amount<=0){showToast('Enter an amount greater than zero.');return;}const t={id:makeId(),description:document.getElementById('txDescription').value.trim(),type:document.getElementById('txType').value,category:document.getElementById('txCategory').value,amount,currency:document.getElementById('txCurrency').value,date:document.getElementById('txDate').value,rateAtEntry:activeProfile().rate,createdAt:Date.now()};if(!t.description||!t.date){showToast('Complete the description and date.');return;}activeProfile().transactions.push(t);try{await saveState();closeModal('transactionModal');renderAll();showToast('Transaction saved.');}catch{}});
  document.getElementById('profileCreateForm').addEventListener('submit',async e=>{e.preventDefault();const name=document.getElementById('newBusinessName').value,rate=Number(document.getElementById('newBusinessRate').value);if(!name.trim()||!Number.isFinite(rate)||rate<=0){showToast('Enter a valid business name and rate.');return;}await addProfile(name,rate);e.target.reset();closeModal('profileModal');});
  document.getElementById('transactionSearch').addEventListener('input',renderTransactions);document.getElementById('typeFilter').addEventListener('change',renderTransactions);
  document.getElementById('transactionsTable').addEventListener('click',async e=>{const btn=e.target.closest('[data-delete]');if(!btn)return;if(confirm('Delete this transaction? A recovery copy will be saved first.')){activeProfile().transactions=activeProfile().transactions.filter(t=>t.id!==btn.dataset.delete);await saveState();renderAll();showToast('Transaction deleted.');}});
  document.getElementById('reportMonth').addEventListener('change',renderReports);document.getElementById('exportCsvBtn').addEventListener('click',exportCSV);
  document.getElementById('profileForm').addEventListener('submit',async e=>{e.preventDefault();const name=document.getElementById('businessName').value.trim();if(!name)return;activeProfile().name=name;await saveState();renderAll();showToast('Business name updated.');});
  document.getElementById('rateForm').addEventListener('submit',async e=>{e.preventDefault();const rate=Number(document.getElementById('exchangeRate').value);if(!Number.isFinite(rate)||rate<=0){showToast('Enter a valid exchange rate.');return;}activeProfile().rate=rate;await saveState();renderAll();updateConversionPreview();showToast('Exchange rate updated. Older transactions keep their original rate.');});
  document.getElementById('editRateQuick').addEventListener('click',()=>{switchView('settings');document.getElementById('exchangeRate').focus();});
  document.getElementById('backupBtn').addEventListener('click',exportEncryptedBackup);document.getElementById('restoreInput').addEventListener('change',async e=>{const file=e.target.files[0];if(file)await importBackup(file);e.target.value='';});
  document.getElementById('profileList').addEventListener('click',async e=>{const btn=e.target.closest('[data-remove-profile]');if(!btn)return;if(state.profiles.length<=1){showToast('At least one profile is required.');return;}const profile=state.profiles.find(p=>p.id===btn.dataset.removeProfile);if(confirm(`Remove "${profile.name}" and all its transactions? A recovery copy will be saved.`)){state.profiles=state.profiles.filter(p=>p.id!==profile.id);if(state.activeProfileId===profile.id)state.activeProfileId=state.profiles[0].id;await saveState();renderAll();showToast('Business profile removed.');}});
  window.addEventListener('resize',()=>{if(document.getElementById('overviewView').classList.contains('active'))drawCashflowChart();});
}

boot();
