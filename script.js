/* LumaLedger v1.0 — browser-based dual-currency finance tracker */
const STORAGE_KEY = "lumaledger_data_v1";
const DEFAULT_RATE = 190;
let state = loadState();
let cashflowChart = null;
let toastTimer = null;

function makeId(){ return "id_" + Date.now().toString(36) + Math.random().toString(36).slice(2,7); }
function defaultState(){
  const id = makeId();
  return {activeProfileId:id, profiles:[{id,name:"My Business",rate:DEFAULT_RATE,transactions:[]}]};
}
function loadState(){
  try{
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if(saved && Array.isArray(saved.profiles) && saved.profiles.length){
      saved.profiles.forEach(p=>{ if(!Array.isArray(p.transactions)) p.transactions=[]; if(!p.rate) p.rate=DEFAULT_RATE; });
      if(!saved.profiles.some(p=>p.id===saved.activeProfileId)) saved.activeProfileId=saved.profiles[0].id;
      return saved;
    }
  }catch(error){ console.error("Could not load saved data:",error); }
  return defaultState();
}
function saveState(){ localStorage.setItem(STORAGE_KEY,JSON.stringify(state)); }
function activeProfile(){ return state.profiles.find(p=>p.id===state.activeProfileId) || state.profiles[0]; }
function money(value,currency){ return (currency==="LRD"?"L$ ":"$")+Number(value||0).toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2}); }
function toLRD(amount,currency,rate){ return currency==="USD" ? Number(amount)*Number(rate) : Number(amount); }
function escapeHTML(value){ return String(value).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c])); }
function todayISO(){ const d=new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`; }
function currentMonth(){ return todayISO().slice(0,7); }
function formatDate(date){ if(!date)return "—"; return new Date(date+"T00:00:00").toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"}); }
function showToast(message){
  const el=document.getElementById("toast"); el.textContent=message; el.classList.add("show");
  clearTimeout(toastTimer); toastTimer=setTimeout(()=>el.classList.remove("show"),2600);
}
function profileTransactions(){ return activeProfile().transactions.slice().sort((a,b)=>b.date.localeCompare(a.date)||b.createdAt-a.createdAt); }
function getMonthTransactions(month=currentMonth()){ return activeProfile().transactions.filter(t=>t.date.startsWith(month)); }
function totals(transactions){
  const result={lrdIncome:0,lrdExpense:0,usdIncome:0,usdExpense:0};
  transactions.forEach(t=>{ const key=(t.currency==="LRD"?"lrd":"usd")+(t.type==="income"?"Income":"Expense"); result[key]+=Number(t.amount); });
  return result;
}
function init(){
  document.getElementById("todayLabel").textContent=new Date().toLocaleDateString("en-US",{weekday:"short",month:"short",day:"numeric"});
  document.getElementById("txDate").value=todayISO();
  document.getElementById("reportMonth").value=currentMonth();
  renderAll();
  bindEvents();
}
function renderAll(){ renderProfiles(); renderDashboard(); renderTransactions(); renderReports(); renderSettings(); }
function renderProfiles(){
  const select=document.getElementById("profileSelect");
  select.innerHTML=state.profiles.map(p=>`<option value="${p.id}" ${p.id===state.activeProfileId?"selected":""}>${escapeHTML(p.name)}</option>`).join("");
}
function renderDashboard(){
  const p=activeProfile(), monthTx=getMonthTransactions(), all=totals(p.transactions), m=totals(monthTx);
  const lrdBalance=all.lrdIncome-all.lrdExpense, usdBalance=all.usdIncome-all.usdExpense;
  const equivalent=lrdBalance+(usdBalance*p.rate);
  const incomeLRD=m.lrdIncome+m.usdIncome*p.rate, expenseLRD=m.lrdExpense+m.usdExpense*p.rate;
  document.getElementById("welcomeName").textContent=p.name;
  document.getElementById("rateDisplay").textContent=`1 USD = ${money(p.rate,"LRD")}`;
  document.getElementById("snapshotRate").textContent=`1 USD = ${money(p.rate,"LRD")}`;
  document.getElementById("totalBalance").textContent=money(equivalent,"LRD");
  document.getElementById("lrdBalance").textContent=money(lrdBalance,"LRD");
  document.getElementById("usdBalance").textContent=money(usdBalance,"USD");
  document.getElementById("monthIncome").textContent=money(incomeLRD,"LRD");
  document.getElementById("monthExpenses").textContent=money(expenseLRD,"LRD");
  document.getElementById("monthCount").textContent=monthTx.length;
  document.getElementById("monthIncomeSub").textContent=`LRD ${money(m.lrdIncome,"LRD")} · USD ${money(m.usdIncome,"USD")}`;
  document.getElementById("monthExpenseSub").textContent=`LRD ${money(m.lrdExpense,"LRD")} · USD ${money(m.usdExpense,"USD")}`;
  const recent=profileTransactions().slice(0,5);
  document.getElementById("recentTable").innerHTML=recent.map(t=>`<tr><td>${escapeHTML(t.description)}</td><td><span class="type-chip ${t.type}">${t.type}</span></td><td>${formatDate(t.date)}</td><td class="amount-${t.type}">${t.type==="income"?"+":"−"}${money(t.amount,t.currency)}</td></tr>`).join("");
  document.getElementById("recentEmpty").style.display=recent.length?"none":"block";
  drawCashflowChart();
}
function drawCashflowChart(){
  const canvas=document.getElementById("cashflowChart"); if(!canvas)return;
  const labels=[],income=[],expenses=[],p=activeProfile(),rate=p.rate;
  for(let i=6;i>=0;i--){
    const d=new Date(); d.setDate(d.getDate()-i);
    const iso=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
    labels.push(d.toLocaleDateString("en-US",{weekday:"short"}));
    const day=p.transactions.filter(t=>t.date===iso);
    income.push(day.filter(t=>t.type==="income").reduce((s,t)=>s+toLRD(t.amount,t.currency,rate),0));
    expenses.push(day.filter(t=>t.type==="expense").reduce((s,t)=>s+toLRD(t.amount,t.currency,rate),0));
  }
  if(cashflowChart)cashflowChart.destroy();
  if(typeof Chart==="undefined")return;
  cashflowChart=new Chart(canvas,{type:"bar",data:{labels,datasets:[{label:"Income (LRD equivalent)",data:income,backgroundColor:"#ffcc00",borderRadius:5},{label:"Expenses (LRD equivalent)",data:expenses,backgroundColor:"#d8dce2",borderRadius:5}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{position:"bottom",labels:{usePointStyle:true,boxWidth:7,font:{size:10},color:"#777f8b"}}},scales:{x:{grid:{display:false},ticks:{color:"#9299a4",font:{size:10}}},y:{beginAtZero:true,grid:{color:"#f0f1f3"},ticks:{color:"#9299a4",font:{size:9},callback:v=>Number(v).toLocaleString()}}}}});
}
function renderTransactions(){
  const search=(document.getElementById("transactionSearch").value||"").toLowerCase();
  const filter=document.getElementById("typeFilter").value;
  const list=profileTransactions().filter(t=>(filter==="all"||t.type===filter)&&(`${t.description} ${t.category} ${t.currency}`.toLowerCase().includes(search)));
  document.getElementById("transactionsTable").innerHTML=list.map(t=>`<tr><td>${escapeHTML(t.description)}</td><td>${escapeHTML(t.category)}</td><td><span class="type-chip ${t.type}">${t.type}</span></td><td>${formatDate(t.date)}</td><td class="amount-${t.type}">${t.type==="income"?"+":"−"}${money(t.amount,t.currency)}</td><td><button class="delete-button" data-delete="${t.id}" title="Delete transaction" aria-label="Delete transaction">×</button></td></tr>`).join("");
  document.getElementById("transactionsEmpty").style.display=list.length?"none":"block";
}
function renderReports(){
  const month=document.getElementById("reportMonth").value||currentMonth(), tx=getMonthTransactions(month), t=totals(tx), rate=activeProfile().rate;
  const income=t.lrdIncome+t.usdIncome*rate, expense=t.lrdExpense+t.usdExpense*rate;
  document.getElementById("reportIncome").textContent=money(income,"LRD");
  document.getElementById("reportExpenses").textContent=money(expense,"LRD");
  document.getElementById("reportNet").textContent=money(income-expense,"LRD");
  document.getElementById("reportCount").textContent=tx.length;
  document.getElementById("reportLrdIncome").textContent=money(t.lrdIncome,"LRD");
  document.getElementById("reportLrdExpense").textContent=money(t.lrdExpense,"LRD");
  document.getElementById("reportUsdIncome").textContent=money(t.usdIncome,"USD");
  document.getElementById("reportUsdExpense").textContent=money(t.usdExpense,"USD");
}
function renderSettings(){
  const p=activeProfile();
  document.getElementById("businessName").value=p.name;
  document.getElementById("exchangeRate").value=p.rate;
  document.getElementById("profileList").innerHTML=state.profiles.map(profile=>`<div class="profile-list-item"><span>${escapeHTML(profile.name)} ${profile.id===state.activeProfileId?"· ACTIVE":""}</span>${state.profiles.length>1?`<button data-remove-profile="${profile.id}">Remove</button>`:""}</div>`).join("");
}
function openModal(id){document.getElementById(id).classList.add("show");}
function closeModal(id){document.getElementById(id).classList.remove("show");}
function openTransactionModal(){
  document.getElementById("transactionForm").reset();
  document.getElementById("txDate").value=todayISO();
  updateConversionPreview(); openModal("transactionModal");
}
function updateConversionPreview(){
  const amount=Number(document.getElementById("txAmount").value||0), currency=document.getElementById("txCurrency").value, rate=activeProfile().rate;
  const converted=currency==="USD"?money(amount*rate,"LRD"):money(amount/rate,"USD");
  document.getElementById("conversionPreview").textContent=amount>0?`Approximate equivalent: ${converted}`:"Converted amount will appear here.";
}
function switchView(view){
  document.querySelectorAll(".view").forEach(el=>el.classList.remove("active"));
  document.getElementById(view+"View").classList.add("active");
  document.querySelectorAll(".nav-link").forEach(el=>el.classList.toggle("active",el.dataset.view===view));
  const titles={overview:["YOUR BUSINESS AT A GLANCE","Overview"],transactions:["RECORDS & ACTIVITY","Transactions"],reports:["UNDERSTAND YOUR NUMBERS","Reports"],settings:["PREFERENCES & WORKSPACE","Settings"]};
  document.getElementById("pageEyebrow").textContent=titles[view][0];
  document.getElementById("pageTitle").textContent=titles[view][1];
  document.getElementById("sidebar").classList.remove("open");
  if(view==="overview")drawCashflowChart();
}
function addProfile(name,rate){
  const p={id:makeId(),name:name.trim(),rate:Number(rate),transactions:[]};
  state.profiles.push(p);state.activeProfileId=p.id;saveState();renderAll();showToast("Business profile created.");
}
function exportCSV(){
  const rows=[["Date","Description","Category","Type","Amount","Currency","Exchange rate (LRD per USD)","LRD equivalent"]];
  activeProfile().transactions.slice().sort((a,b)=>a.date.localeCompare(b.date)).forEach(t=>rows.push([t.date,t.description,t.category,t.type,t.amount,t.currency,activeProfile().rate,toLRD(t.amount,t.currency,activeProfile().rate).toFixed(2)]));
  const csv=rows.map(row=>row.map(value=>`"${String(value??"").replace(/"/g,'""')}"`).join(",")).join("\r\n");
  downloadBlob(new Blob([csv],{type:"text/csv;charset=utf-8;"}),`${activeProfile().name.replace(/[^a-z0-9]/gi,"_")}_transactions.csv`);
}
function downloadBlob(blob,name){const url=URL.createObjectURL(blob),a=document.createElement("a");a.href=url;a.download=name;a.click();URL.revokeObjectURL(url);}
function bindEvents(){
  document.querySelectorAll(".nav-link").forEach(btn=>btn.addEventListener("click",()=>switchView(btn.dataset.view)));
  document.querySelectorAll("[data-goto]").forEach(btn=>btn.addEventListener("click",()=>switchView(btn.dataset.goto)));
  document.getElementById("menuBtn").addEventListener("click",()=>document.getElementById("sidebar").classList.toggle("open"));
  document.getElementById("profileSelect").addEventListener("change",e=>{state.activeProfileId=e.target.value;saveState();renderAll();});
  ["addProfileBtn","addProfileSettings"].forEach(id=>document.getElementById(id).addEventListener("click",()=>openModal("profileModal")));
  ["quickAddBtn","addTransactionBtn"].forEach(id=>document.getElementById(id).addEventListener("click",openTransactionModal));
  document.querySelectorAll("[data-close]").forEach(btn=>btn.addEventListener("click",()=>closeModal(btn.dataset.close)));
  document.querySelectorAll(".modal-backdrop").forEach(backdrop=>backdrop.addEventListener("click",e=>{if(e.target===backdrop)closeModal(backdrop.id);}));
  ["txAmount","txCurrency"].forEach(id=>document.getElementById(id).addEventListener("input",updateConversionPreview));
  document.getElementById("transactionForm").addEventListener("submit",e=>{
    e.preventDefault();const amount=Number(document.getElementById("txAmount").value);
    if(!Number.isFinite(amount)||amount<=0){showToast("Enter an amount greater than zero.");return;}
    activeProfile().transactions.push({id:makeId(),description:document.getElementById("txDescription").value.trim(),type:document.getElementById("txType").value,category:document.getElementById("txCategory").value,amount,currency:document.getElementById("txCurrency").value,date:document.getElementById("txDate").value,createdAt:Date.now()});
    saveState();closeModal("transactionModal");renderAll();showToast("Transaction saved.");
  });
  document.getElementById("profileCreateForm").addEventListener("submit",e=>{
    e.preventDefault();const name=document.getElementById("newBusinessName").value,rate=Number(document.getElementById("newBusinessRate").value);
    if(!name.trim()||!Number.isFinite(rate)||rate<=0){showToast("Enter a valid business name and rate.");return;}
    addProfile(name,rate);e.target.reset();closeModal("profileModal");
  });
  document.getElementById("transactionSearch").addEventListener("input",renderTransactions);
  document.getElementById("typeFilter").addEventListener("change",renderTransactions);
  document.getElementById("transactionsTable").addEventListener("click",e=>{
    const btn=e.target.closest("[data-delete]");if(!btn)return;
    if(confirm("Delete this transaction? This cannot be undone.")){activeProfile().transactions=activeProfile().transactions.filter(t=>t.id!==btn.dataset.delete);saveState();renderAll();showToast("Transaction deleted.");}
  });
  document.getElementById("reportMonth").addEventListener("change",renderReports);
  document.getElementById("exportCsvBtn").addEventListener("click",exportCSV);
  document.getElementById("profileForm").addEventListener("submit",e=>{e.preventDefault();const name=document.getElementById("businessName").value.trim();if(!name)return;activeProfile().name=name;saveState();renderAll();showToast("Business name updated.");});
  document.getElementById("rateForm").addEventListener("submit",e=>{e.preventDefault();const rate=Number(document.getElementById("exchangeRate").value);if(!Number.isFinite(rate)||rate<=0){showToast("Enter a valid exchange rate.");return;}activeProfile().rate=rate;saveState();renderAll();updateConversionPreview();showToast("Exchange rate updated.");});
  document.getElementById("editRateQuick").addEventListener("click",()=>{switchView("settings");document.getElementById("exchangeRate").focus();});
  document.getElementById("backupBtn").addEventListener("click",()=>downloadBlob(new Blob([JSON.stringify(state,null,2)],{type:"application/json"}),"lumaledger-backup.json"));
  document.getElementById("restoreInput").addEventListener("change",async e=>{
    const file=e.target.files[0];if(!file)return;
    try{const imported=JSON.parse(await file.text());if(!Array.isArray(imported.profiles)||!imported.profiles.length)throw new Error("Invalid backup");state=imported;if(!state.profiles.some(p=>p.id===state.activeProfileId))state.activeProfileId=state.profiles[0].id;saveState();renderAll();showToast("Backup restored.");}
    catch(error){showToast("That backup file is not valid.");}e.target.value="";
  });
  document.getElementById("profileList").addEventListener("click",e=>{
    const btn=e.target.closest("[data-remove-profile]");if(!btn)return;
    if(state.profiles.length<=1){showToast("At least one profile is required.");return;}
    const profile=state.profiles.find(p=>p.id===btn.dataset.removeProfile);
    if(confirm(`Remove "${profile.name}" and all its transactions?`)){state.profiles=state.profiles.filter(p=>p.id!==profile.id);if(state.activeProfileId===profile.id)state.activeProfileId=state.profiles[0].id;saveState();renderAll();showToast("Profile removed.");}
  });
}
init();
