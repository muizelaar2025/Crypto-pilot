// app.js
const CG_API = "https://api.coingecko.com/api/v3";
let monitorHandle = null;
let currentTop10 = [];
const TRANSACTION_FEE = 5.0;

function el(id){ return document.getElementById(id); }
function log(msg){ 
  const out = el("output"); 
  const p = document.createElement("div"); 
  p.textContent = `${new Date().toLocaleTimeString()} — ${msg}`; 
  out.prepend(p); 
}

// Tabs
function showTab(name){
  document.querySelectorAll(".tab").forEach(t=>t.classList.remove("active"));
  document.getElementById("tab-"+name).classList.add("active");
}

// ====== MARKT DATA ======
async function fetchMarkets(vs="eur", per_page=50) {
  const url = `${CG_API}/coins/markets?vs_currency=${vs}&order=market_cap_desc&per_page=${per_page}&page=1&sparkline=false&price_change_percentage=24h,7d`;
  try {
    const r = await fetch(url);
    if(!r.ok) throw new Error("HTTP "+r.status);
    return await r.json();
  } catch(e){
    console.error("fetchMarkets error", e);
    return null;
  }
}

function computeScores(coins) {
  const vols = coins.map(c => c.total_volume || 0);
  const logVols = vols.map(v => Math.log10((v||1)));
  const minV = Math.min(...logVols), maxV = Math.max(...logVols);
  return coins.map(c => {
    const ch7 = c.price_change_percentage_7d_in_currency || 0;
    const ch24 = c.price_change_percentage_24h_in_currency || 0;
    const lv = Math.log10((c.total_volume||1));
    const normVol = (maxV===minV) ? 0.5 : (lv - minV) / (maxV - minV);
    const score = (0.6 * ch7) + (0.3 * ch24) + (5 * normVol); 
    return Object.assign({}, c, { opportunity_score: score });
  });
}

function renderTop10(list) {
  const container = el("top10-list");
  container.innerHTML = "";
  list.forEach((c, i) => {
    const p = document.createElement("p");
    p.innerHTML = `<span class="pill">${i+1}</span> <strong>${c.name} (${c.symbol.toUpperCase()})</strong>
      — prijs: ${c.current_price?.toLocaleString(undefined,{maximumFractionDigits:8})} • 7d: ${(c.price_change_percentage_7d_in_currency||0).toFixed(2)}% • score: ${c.opportunity_score.toFixed(2)}
      <button data-id="${c.id}" class="watch-btn">Volgen</button>`;
    container.appendChild(p);
  });
  container.querySelectorAll(".watch-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      el("hold-coin").value = btn.dataset.id;
      el("hold-qty").focus();
    });
  });
}

async function refreshSelection() {
  const vs = el("vsCurrency").value;
  log("Selectie verversen…");
  const markets = await fetchMarkets(vs, 50);
  if(!markets) { log("Kon marktdata niet ophalen."); return; }

  const MIN_VOLUME = 5_000_000;
  const liquid = markets.filter(c => (c.total_volume || 0) >= MIN_VOLUME);

  const scored = computeScores(liquid);
  scored.sort((a,b)=>b.opportunity_score - a.opportunity_score);
  currentTop10 = scored.slice(0,10);
  renderTop10(currentTop10);
  log("Top10 bijgewerkt.");
}

// ====== HOLDINGS ======
let holdings = []; // {id, qty, buyPrice}

function saveHoldingRow(h) {
  holdings.push(h);
  renderHoldings();
}

async function getPrice(coinId, vs="eur") {
  try {
    const url = `${CG_API}/simple/price?ids=${coinId}&vs_currencies=${vs}`;
    const r = await fetch(url);
    const j = await r.json();
    return j[coinId] ? j[coinId][vs] : null;
  } catch(e){
    return null;
  }
}

function adviceForHolding(h, currentPrice, isInTop10) {
  const gross = (currentPrice - h.buyPrice) * h.qty;
  const net = gross - TRANSACTION_FEE;

  if(net > 0) {
    if(isInTop10) return {advice:"Behouden", reason:`Winst (€${net.toFixed(2)}) + in top10`};
    return {advice:"Behouden", reason:`Winst €${net.toFixed(2)}`};
  } else {
    if(isInTop10) return {advice:"Behouden", reason:`Verlies maar coin in top10`};
    return {advice:"Verkopen", reason:`Verlies €${net.toFixed(2)}`};
  }
}

async function renderHoldings() {
  const tbody = el("holdings-table").querySelector("tbody");
  tbody.innerHTML = "";
  const vs = el("vsCurrency").value;
  for(const h of holdings) {
    const price = await getPrice(h.id, vs);
    const net = (price!==null) ? ((price - h.buyPrice) * h.qty - TRANSACTION_FEE) : null;
    const inTop = currentTop10.some(c=>c.id===h.id);
    const ad = (price!==null) ? adviceForHolding(h, price, inTop) : {advice:"?", reason:"geen data"};
    const tr = document.createElement("tr");
    tr.innerHTML = `<td>${h.id}</td>
      <td>${h.qty}</td>
      <td>${h.buyPrice.toFixed(4)}</td>
      <td>${price!==null ? price.toLocaleString(undefined,{maximumFractionDigits:8}) : "?"}</td>
      <td>${net!==null ? "€"+net.toFixed(2) : "?"}</td>
      <td class="${ad.advice==='Behouden'?'advice-hold':'advice-sell'}">${ad.advice}<br><small>${ad.reason}</small></td>
      <td><button data-id="${h.id}" class="del">Verwijder</button></td>`;
    tbody.appendChild(tr);
  }
  tbody.querySelectorAll(".del").forEach(b=>b.addEventListener("click", ()=>{
    holdings = holdings.filter(x=>x.id!==b.dataset.id);
    renderHoldings();
  }));
}

// ====== ADVIES LOG ======
function saveAdviceLog(coin, advice, price){
  const logs = JSON.parse(localStorage.getItem("adviceLogs") || "[]");
  logs.push({time:new Date().toLocaleString(), coin, advice, price, result:"?"});
  localStorage.setItem("adviceLogs", JSON.stringify(logs));
  renderAdviceLog();
}

function renderAdviceLog(){
  const tbody = el("adviceTable").querySelector("tbody");
  tbody.innerHTML="";
  const logs = JSON.parse(localStorage.getItem("adviceLogs") || "[]");
  logs.forEach(l=>{
    const tr=document.createElement("tr");
    tr.innerHTML=`<td>${l.time}</td><td>${l.coin}</td><td>${l.advice}</td><td>${l.price}</td><td>${l.result}</td>`;
    tbody.appendChild(tr);
  });
}

// ====== GRAFIEK ======
async function loadChartData(coin, days, vs="eur"){
  const url = `${CG_API}/coins/${coin}/market_chart?vs_currency=${vs}&days=${days}`;
  const r = await fetch(url);
  const data = await r.json();
  return data.prices.map(p => ({x:new Date(p[0]), y:p[1]}));
}

let chart;
el("loadChart").addEventListener("click", async ()=>{
  const coin = el("chart-coin").value.trim().toLowerCase();
  const days = el("chart-range").value;
  const vs = el("vsCurrency").value;
  const prices = await loadChartData(coin, days, vs);
  if(chart) chart.destroy();
  const ctx = document.getElementById("coinChart").getContext("2d");
  chart = new Chart(ctx,{
    type:"line",
    data:{ datasets:[{ label: `${coin} prijs`, data:prices, borderColor:"blue", fill:false }] },
    options:{ scales:{ x:{ type:"time", time:{ unit:"day" } }, y:{ beginAtZero:false } } }
  });
});

// ====== EVENT BINDING ======
el("refreshSelection").addEventListener("click", refreshSelection);
el("addHolding").addEventListener("click", ()=>{
  const id = el("hold-coin").value.trim().toLowerCase();
  const qty = parseFloat(el("hold-qty").value);
  const price = parseFloat(el("hold-price").value);
  if(!id || isNaN(qty) || isNaN(price)) { alert("Vul coin, qty en aankoopprijs in"); return; }
  saveHoldingRow({id, qty, buyPrice: price});
  el("hold-coin").value = ""; el("hold-qty").value=""; el("hold-price").value="";
  renderHoldings();
});

el("startMonitor").addEventListener("click", () => {
  const interval = parseInt(el("interval").value,10);
  if(monitorHandle) clearInterval(monitorHandle);
  log("Live monitor gestart");
  refreshSelection(); 
  renderHoldings();
  monitorHandle = setInterval(async () => {
    await refreshSelection();
    await renderHoldings();
  }, interval);
});

el("stopMonitor").addEventListener("click", () => {
  if(monitorHandle) { clearInterval(monitorHandle); monitorHandle = null; log("Monitor gestopt"); }
});

// start rendering log
renderAdviceLog();

