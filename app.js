// app.js — Complete, definitieve versie (Top10, Holdings, Charts, Advies, 3 Simulaties)
document.addEventListener("DOMContentLoaded", () => {

const CG_API = "https://api.coingecko.com/api/v3";
let monitorHandle = null;
let chart = null;
let currentTop10 = [];
const TRANSACTION_FEE = 5.0;
const ADVICE_CHECK_INTERVAL_MS = 60 * 60 * 1000;

// ---------------- Helpers ----------------
function el(id){ return document.getElementById(id); }
function log(msg){
  const out = el("output");
  const p = document.createElement("div");
  p.textContent = `${new Date().toLocaleTimeString()} — ${msg}`;
  out.prepend(p);
}
function showTab(name){
  document.querySelectorAll(".tab").forEach(t=>t.classList.remove("active"));
  const elTab = document.getElementById("tab-"+name);
  if(elTab) elTab.classList.add("active");
}

// ---------------- Local storage ----------------
function loadAdviceLogs(){ return JSON.parse(localStorage.getItem("adviceLogs") || "[]"); }
function saveAdviceLogs(logs){ localStorage.setItem("adviceLogs", JSON.stringify(logs)); }
function loadSuccessStats(){ return JSON.parse(localStorage.getItem("successStats") || '{"checked":0,"correct":0}'); }
function saveSuccessStats(s){ localStorage.setItem("successStats", JSON.stringify(s)); }
function updateSuccessRateUI(){ const s=loadSuccessStats(); const rate = s.checked===0?"-":((s.correct/s.checked)*100).toFixed(1)+"%"; el("successRate").textContent = rate; }

// ---------------- Market data ----------------
async function fetchMarkets(vs="eur", per_page=50){
  try{
    const url = `${CG_API}/coins/markets?vs_currency=${vs}&order=market_cap_desc&per_page=${per_page}&page=1&sparkline=false&price_change_percentage=24h,7d`;
    const r = await fetch(url, { cache: "no-store" });
    if(!r.ok) throw new Error("HTTP "+r.status);
    return await r.json();
  }catch(e){ console.error("fetchMarkets error", e); return null; }
}

function computeScores(coins){
  if(!coins || coins.length===0) return [];
  const vols = coins.map(c => c.total_volume || 0);
  const logVols = vols.map(v => Math.log10(v||1));
  const minV = Math.min(...logVols), maxV = Math.max(...logVols);
  return coins.map(c=>{
    const ch7 = c.price_change_percentage_7d_in_currency || 0;
    const ch24 = c.price_change_percentage_24h_in_currency || 0;
    const lv = Math.log10(c.total_volume||1);
    const normVol = (maxV===minV) ? 0.5 : (lv - minV) / (maxV - minV);
    const score = 0.6*ch7 + 0.3*ch24 + 5*normVol;
    return {...c, opportunity_score: score};
  });
}

// ---------------- Render Top10 ----------------
function renderTop10(list){
  const container = el("top10-list");
  container.innerHTML = "";
  if(!list || list.length===0){ container.innerHTML = "<em>Geen resultaten</em>"; return; }
  list.forEach((c,i)=>{
    const p = document.createElement("p");
    p.innerHTML = `<span class="pill">${i+1}</span> <strong>${c.name} (${c.symbol.toUpperCase()})</strong>
      — prijs: ${c.current_price?.toLocaleString(undefined,{maximumFractionDigits:8})} • 7d: ${(c.price_change_percentage_7d_in_currency||0).toFixed(2)}% • score: ${c.opportunity_score.toFixed(2)}
      <button data-id="${c.id}" class="watch-btn">Volgen</button>
      <button data-id="${c.id}" class="chart-btn">Grafiek</button>`;
    container.appendChild(p);
  });
  container.querySelectorAll(".watch-btn").forEach(btn=>btn.addEventListener("click", ()=>{
    el("hold-coin").value = btn.dataset.id;
    el("hold-qty").focus();
  }));
  container.querySelectorAll(".chart-btn").forEach(btn=>btn.addEventListener("click", ()=>{
    populateChartDropdown();
    el("chart-coin").value = btn.dataset.id;
    showTab('charts');
  }));
  populateChartDropdown();
}

// ---------------- Selection / Monitor ----------------
async function refreshSelection(){
  const vs = el("vsCurrency").value;
  log("Selectie verversen…");
  const markets = await fetchMarkets(vs, 100);
  if(!markets){ log("Kon marktdata niet ophalen."); return; }

  // adaptive minimum volume
  const stats = loadSuccessStats();
  const successRate = stats.checked===0 ? 0.6 : (stats.correct/(stats.checked||1));
  let MIN_VOLUME = 5_000_000;
  if(successRate < 0.5) MIN_VOLUME *= 1.5;
  if(successRate < 0.35) MIN_VOLUME *= 2.0;

  const liquid = markets.filter(c => (c.total_volume||0) >= MIN_VOLUME);
  const scored = computeScores(liquid);
  scored.sort((a,b)=>b.opportunity_score - a.opportunity_score);
  currentTop10 = scored.slice(0,10);
  renderTop10(currentTop10);
  log(`Top10 bijgewerkt. (MIN_VOLUME=${MIN_VOLUME.toLocaleString()})`);

  // Auto koopadvies
  const AUTO_SCORE_THRESHOLD = 10;
  const logs = loadAdviceLogs();
  for(const coin of currentTop10){
    if(coin.opportunity_score > AUTO_SCORE_THRESHOLD){
      if(!logs.some(l=>l.coin===coin.id && l.result==="?")){
        logs.push({time: new Date().toLocaleString(), coin: coin.id, advice:"Koop", startPrice: coin.current_price, currentPrice: coin.current_price, result:"?"});
        log(`🟢 Automatisch koopadvies toegevoegd voor ${coin.id} @ €${coin.current_price.toFixed(4)}`);
      }
    }
  }
  saveAdviceLogs(logs);
  renderAdviceLog();
}

// ---------------- Holdings ----------------
let holdings = [];
function saveHoldingRow(h){ holdings.push(h); renderHoldings(); }
async function getPrice(coinId, vs="eur"){
  try{
    const url = `${CG_API}/simple/price?ids=${coinId}&vs_currencies=${vs}`;
    const r = await fetch(url, { cache: "no-store" });
    if(!r.ok) throw new Error("HTTP "+r.status);
    const j = await r.json();
    return j[coinId] ? j[coinId][vs] : null;
  }catch(e){ console.error("getPrice err", e); return null; }
}
function adviceForHolding(h,currentPrice,isInTop10){
  const gross = (currentPrice - h.buyPrice) * h.qty;
  const net = gross - TRANSACTION_FEE;
  if(net > 0) return {advice:"Behouden", reason:`Winst €${net.toFixed(2)}${isInTop10?' + in top10':''}`};
  return {advice: isInTop10 ? "Behouden" : "Verkopen", reason:`Verlies €${net.toFixed(2)}${isInTop10?' + in top10':''}`};
}
async function renderHoldings(){
  const tbody = el("holdings-table").querySelector("tbody");
  tbody.innerHTML = "";
  const vs = el("vsCurrency").value;
  for(const h of holdings){
    const price = await getPrice(h.id, vs);
    const net = price!==null ? (price - h.buyPrice) * h.qty - TRANSACTION_FEE : null;
    const inTop = currentTop10.some(c=>c.id===h.id);
    const ad = price!==null ? adviceForHolding(h, price, inTop) : {advice:"?", reason:"geen data"};
    const tr = document.createElement("tr");
    tr.innerHTML = `<td>${h.id}</td><td>${h.qty}</td><td>${h.buyPrice.toFixed(4)}</td>
      <td>${price!==null?price.toLocaleString(undefined,{maximumFractionDigits:8}):"?"}</td>
      <td>${net!==null?"€"+net.toFixed(2):"?"}</td>
      <td class="${ad.advice==='Behouden'?'advice-hold':'advice-sell'}">${ad.advice}<br><small>${ad.reason}</small></td>
      <td><button data-id="${h.id}" class="del">Verwijder</button></td>`;
    tbody.appendChild(tr);
  }
  tbody.querySelectorAll(".del").forEach(b=>b.addEventListener("click", ()=>{
    holdings = holdings.filter(x=>x.id!==b.dataset.id);
    renderHoldings();
  }));
}

// ---------------- Advice log ----------------
function saveAdviceLogEntry(entry){ const logs = loadAdviceLogs(); logs.push(entry); saveAdviceLogs(logs); renderAdviceLog(); }
async function renderAdviceLog(){
  const tbody = el("adviceTable").querySelector("tbody");
  tbody.innerHTML = "";
  const logs = loadAdviceLogs();
  const vs = el("vsCurrency").value;
  for(let i=0;i<logs.length;i++){
    const l = logs[i];
    const price = await getPrice(l.coin, vs);
    const tr = document.createElement("tr");
    tr.innerHTML = `<td>${l.time}</td><td>${l.coin}</td><td>${l.advice}</td>
      <td>${l.startPrice !== undefined ? "€"+Number(l.startPrice).toFixed(4) : "?"}</td>
      <td>${price!==null ? "€"+price.toFixed(4) : "?"}</td>
      <td>${l.result}</td>
      <td><button data-i="${i}" class="unfollow">Niet meer volgen</button></td>`;
    tbody.appendChild(tr);
  }
  tbody.querySelectorAll(".unfollow").forEach(b=>b.addEventListener("click", ()=>{
    const i = Number(b.dataset.i);
    const logs2 = loadAdviceLogs();
    logs2.splice(i,1);
    saveAdviceLogs(logs2);
    renderAdviceLog();
  }));
}

// ---------------- Advice checking ----------------
async function updateAdviceResults(){
  const logs = loadAdviceLogs();
  const vs = el("vsCurrency").value;
  let changed = false;
  let stats = loadSuccessStats();
  for(let i=0;i<logs.length;i++){
    const l = logs[i];
    if(l.result === "?"){
      const current = await getPrice(l.coin, vs);
      if(current === null) continue;
      let correct = false;
      if(l.advice.toLowerCase().includes("koop")) correct = current > l.startPrice;
      if(l.advice.toLowerCase().includes("verkoop")) correct = current < l.startPrice;
      if(correct){
        logs[i].result = "✅"; stats.checked++; stats.correct++; log(`✅ Advies CORRECT: ${l.coin} (${l.advice})`);
      } else {
        const diff = Math.abs((current - l.startPrice) / l.startPrice);
        if(diff > 0.005){ logs[i].result = "❌"; stats.checked++; log(`❌ Advies FOUT: ${l.coin} (${l.advice})`); }
      }
      changed = true;
    }
  }
  if(changed){ saveAdviceLogs(logs); saveSuccessStats(stats); renderAdviceLog(); updateSuccessRateUI(); }
}

// ---------------- Charts ----------------
async function loadChartData(coin, days, vs="eur"){
  try{
    const url = `${CG_API}/coins/${coin}/market_chart?vs_currency=${vs}&days=${days}`;
    const r = await fetch(url, { cache: "no-store" });
    if(!r.ok) throw new Error("HTTP "+r.status);
    const data = await r.json();
    if(!data.prices) return [];
    return data.prices.map(p => ({ x: new Date(p[0]), y: p[1] }));
  }catch(e){ console.error("loadChartData", e); return []; }
}

el("loadChart").addEventListener("click", async ()=>{
  const coin = el("chart-coin").value.trim().toLowerCase();
  const days = parseInt(el("chart-range").value, 10);
  const vs = el("vsCurrency").value;
  if(!coin){ alert("Kies een coin uit de dropdown (Top10)"); return; }
  const prices = await loadChartData(coin, days, vs);
  if(prices.length === 0){ alert("Geen grafiekdata beschikbaar voor deze coin."); return; }
  if(chart) chart.destroy();
  const ctx = el("coinChart").getContext("2d");
  chart = new Chart(ctx, {
    type: "line",
    data: { datasets: [{ label: `${coin} prijs`, data: prices, borderColor: "blue", fill: false, pointRadius: 0 }] },
    options: { scales: { x: { type: "time", time: { unit: days > 90 ? "month" : "day" } }, y: { beginAtZero: false } } }
  });
});

function populateChartDropdown(){
  const sel = el("chart-coin");
  const prev = sel.value;
  sel.innerHTML = "";
  if(currentTop10 && currentTop10.length>0){
    currentTop10.forEach(c=>{
      const opt = document.createElement("option");
      opt.value = c.id; opt.textContent = `${c.name} (${c.id})`; sel.appendChild(opt);
    });
    if(prev) sel.value = prev;
  } else {
    const opt = document.createElement("option"); opt.value = ""; opt.textContent = "Laad eerst Top10 (Refresh selection)"; sel.appendChild(opt);
  }
}
el("autoChart").addEventListener("click", ()=>{ populateChartDropdown(); alert("Chart dropdown gevuld met Top10"); });

// ---------------- UI wiring ----------------
el("refreshSelection").addEventListener("click", refreshSelection);
el("addHolding").addEventListener("click", ()=>{
  const id = el("hold-coin").value.trim().toLowerCase();
  const qty = parseFloat(el("hold-qty").value);
  const price = parseFloat(el("hold-price").value);
  if(!id || isNaN(qty) || isNaN(price)){ alert("Vul coin, qty en aankoopprijs in"); return; }
  saveHoldingRow({ id, qty, buyPrice: price });
  el("hold-coin").value=""; el("hold-qty").value=""; el("hold-price").value="";
  renderHoldings();
});

el("startMonitor").addEventListener("click", ()=>{
  const interval = parseInt(el("interval").value, 10);
  if(monitorHandle) clearInterval(monitorHandle);
  log("Live monitor gestart");
  refreshSelection(); renderHoldings();
  monitorHandle = setInterval(async ()=>{ await refreshSelection(); await renderHoldings(); }, interval);
  if(!window._adviceChecker) window._adviceChecker = setInterval(updateAdviceResults, ADVICE_CHECK_INTERVAL_MS);
});

el("stopMonitor").addEventListener("click", ()=>{
  if(monitorHandle){ clearInterval(monitorHandle); monitorHandle = null; log("Monitor gestopt"); }
  if(window._adviceChecker){ clearInterval(window._adviceChecker); window._adviceChecker = null; }
});

// ---------------- SIMULATIONS ----------------
// Each simulation has its own state (cash, holdings, tx log)
const SIM_DEFAULT = { cash:1500, monthly:150, holdings:[], log:[] };
let sims = {
  sim1: JSON.parse(JSON.stringify(SIM_DEFAULT)), // vrije strategie
  sim2: JSON.parse(JSON.stringify(SIM_DEFAULT)), // verwachte top10
  sim3: JSON.parse(JSON.stringify(SIM_DEFAULT)), // top10 aankopen
  running: false,
  currentDate: new Date() // simulation start date (today)
};

function resetSimUI(){
  ['sim1-table','sim2-table','sim3-table'].forEach(id=>{
    const tbody = el(id).querySelector('tbody');
    tbody.innerHTML = '';
  });
  el('sim-overviews').innerHTML = '';
}
function resetSims(){
  sims = {
    sim1: JSON.parse(JSON.stringify(SIM_DEFAULT)),
    sim2: JSON.parse(JSON.stringify(SIM_DEFAULT)),
    sim3: JSON.parse(JSON.stringify(SIM_DEFAULT)),
    running: false,
    currentDate: new Date()
  };
  resetSimUI();
  log("Simulaties gereset");
}
function addSimRow(simId, row){
  const tbody = el(simId+'-table').querySelector('tbody');
  const tr = document.createElement('tr'); tr.innerHTML = row; tbody.appendChild(tr);
}
function updateSimOverview(){
  const elWrap = el('sim-overviews');
  elWrap.innerHTML = `
    <div><strong>Sim1 (Vrij):</strong> Cash €${sims.sim1.cash.toFixed(2)} — Holdings ${sims.sim1.holdings.length}</div>
    <div><strong>Sim2 (Verwacht Top10):</strong> Cash €${sims.sim2.cash.toFixed(2)} — Holdings ${sims.sim2.holdings.length}</div>
    <div><strong>Sim3 (Top10):</strong> Cash €${sims.sim3.cash.toFixed(2)} — Holdings ${sims.sim3.holdings.length}</div>
  `;
}

// helper: buy as much as fractionOfCash (0..1) of cash
async function simBuy(simObj, coinId, fractionOfCash, vs="eur"){
  const price = await getPrice(coinId, vs);
  if(price===null) return null;
  const spend = simObj.cash * fractionOfCash;
  const qty = Math.floor((spend / price) * 100000) / 100000; // round
  if(qty <= 0) return null;
  simObj.cash -= qty * price;
  // merge if exists
  const existing = simObj.holdings.find(h => h.coin === coinId);
  if(existing){ existing.qty += qty; existing.avgPrice = (existing.avgPrice * (existing.qty - qty) + price * qty) / (existing.qty); }
  else { simObj.holdings.push({ coin: coinId, qty, avgPrice: price }); }
  return { coin: coinId, qty, price, spend };
}

// helper: sell holding (either all or fraction)
async function simSell(simObj, coinId, fraction=1, vs="eur"){
  const h = simObj.holdings.find(x => x.coin === coinId);
  if(!h) return null;
  const sellQty = h.qty * fraction;
  const price = await getPrice(coinId, vs);
  if(price===null) return null;
  const value = sellQty * price;
  simObj.cash += value;
  h.qty -= sellQty;
  if(h.qty <= 0.0000001) simObj.holdings = simObj.holdings.filter(x => x.coin !== coinId);
  return { coin: coinId, qty: sellQty, price, value, avgPrice: h.avgPrice };
}

// decide sells: we allow sells anytime, but limit to 2 actions/day
function shouldSellHolding(h, currentPrice){
  const profitPct = ((currentPrice - h.avgPrice) / h.avgPrice) * 100;
  // simple rule: sell if profitPct < -3% (stop loss) or profitPct > 8% (take profit)
  if(profitPct <= -3 || profitPct >= 8) return true;
  return false;
}

// Run a single simulation day for one sim object
async function runSimDay(simKey, markets, maxActionsPerDay=2){
  const simObj = sims[simKey];
  let actions = 0;
  const date = new Date(sims.currentDate); // current sim date

  // monthly deposit on day 1 of month
  if(date.getDate() === 1){
    simObj.cash += simObj.monthly;
  }

  // get top lists
  const scored = computeScores(markets);
  scored.sort((a,b)=>b.opportunity_score - a.opportunity_score);
  const top10 = scored.slice(0,10);
  const outsideHighScore = scored.filter(c => !top10.find(t=>t.id===c.id) && c.opportunity_score > 5);

  // SELL phase: prioritize selling risky/target hits
  for(const holding of [...simObj.holdings]){
    if(actions >= maxActionsPerDay) break;
    const market = markets.find(m=>m.id === holding.coin);
    if(!market) continue;
    const price = market.current_price;
    if(shouldSellHolding({avgPrice: holding.avgPrice}, price)){
      const sold = await simSell(simObj, holding.coin, 1, el("vsCurrency").value);
      if(sold){
        actions++;
        simObj.log.push({ date: date.toISOString().slice(0,10), action: "SELL", coin: sold.coin, qty: sold.qty, price: sold.price, value: sold.value, profitPct: ((sold.price - sold.avgPrice)/sold.avgPrice)*100 });
        addSimRow(simKey, `<td>${date.toISOString().slice(0,10)}</td><td>VERKOOP</td><td>${sold.coin}</td><td>${sold.qty.toFixed(5)}</td><td>€${sold.price.toFixed(4)}</td><td>${(((sold.price - sold.avgPrice)/sold.avgPrice)*100).toFixed(2)}%</td><td>€${simObj.cash.toFixed(2)}</td><td>€${portfolioValue(simObj).toFixed(2)}</td>`);
      }
    }
  }

  // BUY phase: depending on simKey
  // We'll allocate a fraction of cash per buy so multiple buys are possible
  const buyFraction = 0.5; // spend up to 50% of cash per buy (can be adjusted)
  if(actions < maxActionsPerDay){
    // build candidate list
    let candidates = [];
    if(simKey === 'sim1'){ // vrije strategie: best overall by opportunity_score
      candidates = scored.filter(c=>c.current_price && c.market_cap).slice(0,5);
    } else if(simKey === 'sim2'){ // verwachte top10: outside top10 but with positive 7d change or rising score
      candidates = outsideHighScore.sort((a,b)=>b.opportunity_score-a.opportunity_score).slice(0,5);
    } else if(simKey === 'sim3'){ // top10 aankopen
      candidates = top10;
    }

    for(const candidate of candidates){
      if(actions >= maxActionsPerDay) break;
      if(simObj.cash < 1) break;
      const bought = await simBuy(simObj, candidate.id, buyFraction, el("vsCurrency").value);
      if(bought){
        actions++;
        simObj.log.push({ date: date.toISOString().slice(0,10), action: "BUY", coin: bought.coin, qty: bought.qty, price: bought.price, value: bought.spend });
        addSimRow(simKey, `<td>${date.toISOString().slice(0,10)}</td><td>KOOP</td><td>${bought.coin}</td><td>${bought.qty.toFixed(5)}</td><td>€${bought.price.toFixed(4)}</td><td>-</td><td>€${simObj.cash.toFixed(2)}</td><td>€${portfolioValue(simObj).toFixed(2)}</td>`);
      }
    }
  }
  updateSimOverview();
}

// compute portfolio market value
function portfolioValue(simObj){
  // sum holdings' last known price * qty
  // note: we don't call API here; when used, ensure markets available
  let total = 0;
  for(const h of simObj.holdings){
    // best effort: use avgPrice as approximate if no market price available
    total += h.qty * (h.lastPrice || h.avgPrice || 0);
  }
  return total;
}

// run simulation over N days with small UI delay so user can observe
let simIntervalHandle = null;
async function runSimulationsDays(days=30){
  if(sims.running) return;
  sims.running = true;
  log(`Simulatie start — ${days} dagen`);
  // ensure we have market snapshot
  const markets = await fetchMarkets(el("vsCurrency").value, 200);
  if(!markets){ log("Kon marktdata niet ophalen — simulatie afgebroken"); sims.running=false; return; }

  // attach latest market price to sim holdings when bought
  // run day-by-day
  for(let d=0; d<days; d++){
    if(!sims.running) break;
    // set simulator date
    // increment date by one day
    sims.currentDate.setDate(sims.currentDate.getDate() + (d===0?0:1));
    // refresh markets each day (to be more realistic)
    const dailyMarkets = await fetchMarkets(el("vsCurrency").value, 200);
    if(!dailyMarkets) break;

    // run each sim day
    await runSimDay('sim1', dailyMarkets, 2);
    await runSimDay('sim2', dailyMarkets, 2);
    await runSimDay('sim3', dailyMarkets, 2);

    // small pause so UI updates (250ms)
    await new Promise(res => setTimeout(res, 250));
  }

  sims.running = false;
  log("Simulatie afgerond");
}

// UI for simulation controls
el("sim-start").addEventListener("click", async ()=>{
  resetSimUI(); // clear previous table rows
  sims.currentDate = new Date(); // start at today
  if(simIntervalHandle) clearInterval(simIntervalHandle);
  // run 30 days
  await runSimulationsDays(30);
});
el("sim-reset").addEventListener("click", ()=>{ resetSims(); resetSimUI(); updateSimOverview(); });
el("sim-stop").addEventListener("click", ()=>{ sims.running = false; log("Simulatie gestopt"); });

// helper: reset sims initial
function resetSimUI(){
  ['sim1-table','sim2-table','sim3-table'].forEach(id=> el(id).querySelector('tbody').innerHTML = '');
  el('sim-overviews').innerHTML = '';
  // reset sim states
  sims.sim1 = JSON.parse(JSON.stringify(SIM_DEFAULT));
  sims.sim2 = JSON.parse(JSON.stringify(SIM_DEFAULT));
  sims.sim3 = JSON.parse(JSON.stringify(SIM_DEFAULT));
}

// we need SIM_DEFAULT in this scope:
const SIM_DEFAULT = { cash:1500, monthly:150, holdings:[], log:[] };
// initialize sims
if(!window.sims){ // set initial if not set
  sims.sim1 = JSON.parse(JSON.stringify(SIM_DEFAULT));
  sims.sim2 = JSON.parse(JSON.stringify(SIM_DEFAULT));
  sims.sim3 = JSON.parse(JSON.stringify(SIM_DEFAULT));
  updateSimOverview();
}

// small helper to update sim overview
function updateSimOverview(){
  const wrap = el('sim-overviews');
  if(!wrap) return;
  wrap.innerHTML = `
    <div style="display:flex;gap:16px;flex-wrap:wrap">
      <div><strong>Sim1 (Vrij):</strong> Cash €${sims.sim1.cash.toFixed(2)} — Holdings ${sims.sim1.holdings.length}</div>
      <div><strong>Sim2 (Verwacht Top10):</strong> Cash €${sims.sim2.cash.toFixed(2)} — Holdings ${sims.sim2.holdings.length}</div>
      <div><strong>Sim3 (Top10):</strong> Cash €${sims.sim3.cash.toFixed(2)} — Holdings ${sims.sim3.holdings.length}</div>
    </div>
  `;
}

// ---------------- Init ----------------
(function init(){
  updateSuccessRateUI();
  populateChartDropdown();
  updateSimOverview();
  // safe initial refresh (do not auto-start monitor)
  // refreshSelection();
})();
}); // DOMContentLoaded end
