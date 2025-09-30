/* app.js — Complete, definitieve versie met Top10, Holdings, Charts, Advieslog en 3 Simulaties
   - Gebruik: vervang bestaande app.js met dit bestand.
   - Zorg dat index.html de benodigde element-IDs bevat (zie earlier index.html provided).
*/

// ---------------- Robust init wrapper & global error handler ----------------
(function(){
  function showInitError(msg){
    console.error("INIT ERROR:", msg);
    try {
      const out = document.getElementById('output');
      if(out){
        const p = document.createElement('div');
        p.style.color = 'red';
        p.textContent = `INIT ERROR: ${msg}`;
        out.prepend(p);
      }
    } catch(e){}
  }

  function safeInit(){
    try {
      if(typeof initMain !== 'function') {
        showInitError("initMain() ontbreekt — zie app.js");
        return;
      }
      initMain();
    } catch(e){
      showInitError(e && e.message ? e.message : String(e));
      console.error(e);
    }
  }

  if(document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', safeInit);
  } else {
    safeInit();
  }
})();

window.addEventListener('error', function(ev){
  try{
    const msg = (ev && ev.message) ? ev.message : String(ev);
    console.error("Global error:", msg, ev.error || ev);
    const out = document.getElementById('output');
    if(out){
      const p = document.createElement('div');
      p.style.color='red';
      p.textContent = `Fout: ${msg}`;
      out.prepend(p);
    }
  }catch(e){}
});

// ---------------- initMain: all app code inside this function ----------------
function initMain(){
  // ---------- Configuration ----------
  const CG_API = "https://api.coingecko.com/api/v3";
  const TRANSACTION_FEE = 5.0;
  const ADVICE_CHECK_INTERVAL_MS = 60 * 60 * 1000; // 1h
  const DEFAULT_SIM_DAYS = 30;

  // ---------- State ----------
  let monitorHandle = null;
  let chart = null;
  let currentTop10 = [];
  let holdings = []; // {id, qty, buyPrice}
  // Advice logs stored in localStorage
  // Simulations:
  const SIM_DEFAULT = { cash:1500, monthlyDeposit:150, holdings:[], log:[] };
  let sims = {
    sim1: deepCopy(SIM_DEFAULT), // vrije strategie
    sim2: deepCopy(SIM_DEFAULT), // verwachte top10
    sim3: deepCopy(SIM_DEFAULT), // top10 aankopen
    running: false,
    currentDate: new Date()
  };

  // ---------- Helpers ----------
  function el(id){ return document.getElementById(id); }
  function log(msg){
    const out = el("output");
    const p = document.createElement("div");
    p.textContent = `${new Date().toLocaleTimeString()} — ${msg}`;
    if(out) out.prepend(p);
    else console.log(msg);
  }
  function deepCopy(obj){ return JSON.parse(JSON.stringify(obj)); }

  // ---------- Local storage helpers ----------
  function loadAdviceLogs(){ try{ return JSON.parse(localStorage.getItem("adviceLogs") || "[]"); }catch(e){ return []; } }
  function saveAdviceLogs(logs){ localStorage.setItem("adviceLogs", JSON.stringify(logs)); }
  function loadSuccessStats(){ try{ return JSON.parse(localStorage.getItem("successStats") || '{"checked":0,"correct":0}'); }catch(e){ return {checked:0,correct:0}; } }
  function saveSuccessStats(s){ localStorage.setItem("successStats", JSON.stringify(s)); }
  function updateSuccessRateUI(){ const s = loadSuccessStats(); const rate = s.checked===0 ? "-" : ((s.correct/s.checked)*100).toFixed(1)+"%"; if(el("successRate")) el("successRate").textContent = rate; }

  // ---------- Market API ----------
  async function fetchMarkets(vs="eur", per_page=100){
    const url = `${CG_API}/coins/markets?vs_currency=${vs}&order=market_cap_desc&per_page=${per_page}&page=1&sparkline=false&price_change_percentage=24h,7d`;
    try{
      const r = await fetch(url, { cache: "no-store" });
      if(!r.ok) throw new Error("HTTP "+r.status);
      return await r.json();
    }catch(e){
      console.error("fetchMarkets error", e);
      log("Kon marktdata niet ophalen: "+ (e.message||e));
      return null;
    }
  }
  async function getPrice(coinId, vs="eur"){
    try{
      const url = `${CG_API}/simple/price?ids=${coinId}&vs_currencies=${vs}`;
      const r = await fetch(url,{ cache: "no-store" });
      if(!r.ok) throw new Error("HTTP "+r.status);
      const j = await r.json();
      return j[coinId] ? j[coinId][vs] : null;
    }catch(e){
      console.error("getPrice err", e);
      return null;
    }
  }

  // ---------- Scoring ----------
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
      const score = (0.6 * ch7) + (0.3 * ch24) + (5 * normVol);
      return {...c, opportunity_score: score};
    });
  }

  // ---------- Render Top10 ----------
  function renderTop10(list){
    const container = el("top10-list");
    if(!container) return;
    container.innerHTML = "";
    if(!list || list.length===0){ container.innerHTML = "<em>Geen resultaten</em>"; return; }
    list.forEach((c,i)=>{
      const p = document.createElement("div");
      p.innerHTML = `<span class="pill">${i+1}</span> <strong>${c.name} (${c.symbol.toUpperCase()})</strong>
        — prijs: ${c.current_price?.toLocaleString(undefined,{maximumFractionDigits:8})} • 7d: ${(c.price_change_percentage_7d_in_currency||0).toFixed(2)}% • score: ${c.opportunity_score.toFixed(2)}
        <button data-id="${c.id}" class="watch-btn">Volgen</button>
        <button data-id="${c.id}" class="chart-btn">Grafiek</button>`;
      container.appendChild(p);
    });
    // attach handlers
    container.querySelectorAll(".watch-btn").forEach(btn=>{
      btn.addEventListener("click", ()=>{ if(el("hold-coin")) el("hold-coin").value = btn.dataset.id; if(el("hold-qty")) el("hold-qty").focus(); });
    });
    container.querySelectorAll(".chart-btn").forEach(btn=>{
      btn.addEventListener("click", ()=>{ populateChartDropdown(); if(el("chart-coin")) el("chart-coin").value = btn.dataset.id; showTab('charts'); });
    });
    populateChartDropdown();
  }

  // ---------- Selection refresh (and auto-advices) ----------
  async function refreshSelection(){
    const vs = el("vsCurrency") ? el("vsCurrency").value : "eur";
    log("Selectie verversen…");
    const markets = await fetchMarkets(vs, 200);
    if(!markets) { log("Markt refresh mislukt"); return; }

    const stats = loadSuccessStats();
    const successRate = stats.checked === 0 ? 0.6 : (stats.correct/(stats.checked||1));
    let MIN_VOLUME = 5_000_000;
    if(successRate < 0.5) MIN_VOLUME *= 1.5;
    if(successRate < 0.35) MIN_VOLUME *= 2.0;

    const liquid = markets.filter(c => (c.total_volume || 0) >= MIN_VOLUME);
    const scored = computeScores(liquid);
    scored.sort((a,b)=>b.opportunity_score - a.opportunity_score);
    currentTop10 = scored.slice(0,10);
    renderTop10(currentTop10);
    log(`Top10 bijgewerkt. (MIN_VOLUME=${MIN_VOLUME.toLocaleString()})`);

    // Auto koopadviezen for high score
    const AUTO_SCORE_THRESHOLD = 10;
    const logs = loadAdviceLogs();
    for(const coin of currentTop10){
      if(coin.opportunity_score > AUTO_SCORE_THRESHOLD){
        const exists = logs.some(l => l.coin === coin.id && l.result === "?");
        if(!exists){
          logs.push({ time: new Date().toLocaleString(), coin: coin.id, advice: "Koop", startPrice: coin.current_price, currentPrice: coin.current_price, result: "?" });
          log(`🟢 Automatisch koopadvies toegevoegd voor ${coin.id} @ €${coin.current_price.toFixed(4)}`);
        }
      }
    }
    saveAdviceLogs(logs);
    renderAdviceLog();
  }

  // ---------- Holdings UI ----------
  function saveHoldingRow(h){
    holdings.push(h);
    renderHoldings();
  }
  function removeHolding(id){
    holdings = holdings.filter(h=>h.id!==id);
    renderHoldings();
  }
  async function renderHoldings(){
    const tableBody = el("holdings-table") ? el("holdings-table").querySelector("tbody") : null;
    if(!tableBody) return;
    tableBody.innerHTML = "";
    const vs = el("vsCurrency") ? el("vsCurrency").value : "eur";
    for(const h of holdings){
      const price = await getPrice(h.id, vs);
      const net = (price !== null) ? ((price - h.buyPrice) * h.qty - TRANSACTION_FEE) : null;
      const inTop = currentTop10.some(c => c.id === h.id);
      const advice = (price !== null) ? adviceForHolding(h, price, inTop) : {advice:"?", reason:"geen data"};
      const tr = document.createElement("tr");
      tr.innerHTML = `<td>${h.id}</td><td>${h.qty}</td><td>${h.buyPrice.toFixed(4)}</td>
        <td>${price !== null ? price.toLocaleString(undefined,{maximumFractionDigits:8}) : "?"}</td>
        <td>${net !== null ? "€"+net.toFixed(2) : "?"}</td>
        <td class="${advice.advice==='Behouden'?'advice-hold':'advice-sell'}">${advice.advice}<br><small>${advice.reason}</small></td>
        <td><button data-id="${h.id}" class="del">Verwijder</button></td>`;
      tableBody.appendChild(tr);
    }
    tableBody.querySelectorAll(".del").forEach(b => b.addEventListener("click", ()=>{ removeHolding(b.dataset.id); }));
  }
  function adviceForHolding(h,currentPrice,isInTop10){
    const gross = (currentPrice - h.buyPrice) * h.qty;
    const net = gross - TRANSACTION_FEE;
    if(net > 0){
      return { advice: "Behouden", reason: `Winst €${net.toFixed(2)}${isInTop10?' + in top10':''}` };
    } else {
      return { advice: isInTop10 ? "Behouden" : "Verkopen", reason: `Verlies €${net.toFixed(2)}${isInTop10?' + in top10':''}` };
    }
  }

  // ---------- Advice log ----------
  function loadAdviceLogs(){ return JSON.parse(localStorage.getItem("adviceLogs") || "[]"); }
  function saveAdviceLogs(logs){ localStorage.setItem("adviceLogs", JSON.stringify(logs)); }
  async function renderAdviceLog(){
    const tbody = el("adviceTable") ? el("adviceTable").querySelector("tbody") : null;
    if(!tbody) return;
    tbody.innerHTML = "";
    const logs = loadAdviceLogs();
    const vs = el("vsCurrency") ? el("vsCurrency").value : "eur";
    for(let i=0;i<logs.length;i++){
      const l = logs[i];
      const price = await getPrice(l.coin, vs);
      const tr = document.createElement("tr");
      tr.innerHTML = `<td>${l.time}</td><td>${l.coin}</td><td>${l.advice}</td>
        <td>${l.startPrice !== undefined ? "€"+Number(l.startPrice).toFixed(4) : "?"}</td>
        <td>${price !== null ? "€"+price.toFixed(4) : "?"}</td>
        <td>${l.result}</td>
        <td><button data-i="${i}" class="unfollow">Niet meer volgen</button></td>`;
      tbody.appendChild(tr);
    }
    tbody.querySelectorAll(".unfollow").forEach(b => b.addEventListener("click", ()=>{
      const i = Number(b.dataset.i);
      const logs2 = loadAdviceLogs();
      logs2.splice(i,1);
      saveAdviceLogs(logs2);
      renderAdviceLog();
    }));
  }

  // ---------- Advice checking / learning ----------
  async function updateAdviceResults(){
    const logs = loadAdviceLogs();
    const vs = el("vsCurrency") ? el("vsCurrency").value : "eur";
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
          logs[i].result = "✅";
          stats.checked++; stats.correct++;
          log(`✅ Advies CORRECT: ${l.coin} (${l.advice})`);
        } else {
          const diff = Math.abs((current - l.startPrice) / l.startPrice);
          if(diff > 0.005){
            logs[i].result = "❌";
            stats.checked++;
            log(`❌ Advies FOUT: ${l.coin} (${l.advice})`);
          }
        }
        changed = true;
      }
    }
    if(changed){
      saveAdviceLogs(logs);
      saveSuccessStats(stats);
      renderAdviceLog();
      updateSuccessRateUI();
    }
  }
  function loadSuccessStats(){ try{ return JSON.parse(localStorage.getItem("successStats") || '{"checked":0,"correct":0}'); }catch(e){ return {checked:0, correct:0}; } }
  function saveSuccessStats(s){ localStorage.setItem("successStats", JSON.stringify(s)); }
  function updateSuccessRateUI(){ const s = loadSuccessStats(); const rate = s.checked===0 ? "-" : ((s.correct/s.checked)*100).toFixed(1)+"%"; if(el("successRate")) el("successRate").textContent = rate; }

  // start periodic advice checker
  if(!window._adviceChecker) window._adviceChecker = setInterval(updateAdviceResults, ADVICE_CHECK_INTERVAL_MS);

  // ---------- Charts ----------
  async function loadChartData(coin, days, vs="eur"){
    try{
      const url = `${CG_API}/coins/${coin}/market_chart?vs_currency=${vs}&days=${days}`;
      const r = await fetch(url, { cache: "no-store" });
      if(!r.ok) throw new Error("HTTP "+r.status);
      const data = await r.json();
      if(!data.prices) return [];
      return data.prices.map(p => ({ x: new Date(p[0]), y: p[1] }));
    }catch(e){
      console.error("loadChartData", e);
      return [];
    }
  }

  async function handleLoadChart(){
    const coin = el("chart-coin") ? el("chart-coin").value.trim().toLowerCase() : "";
    const days = el("chart-range") ? parseInt(el("chart-range").value,10) : 7;
    const vs = el("vsCurrency") ? el("vsCurrency").value : "eur";
    if(!coin){ alert("Kies een coin uit de dropdown (Top10)"); return; }
    const prices = await loadChartData(coin, days, vs);
    if(chart) chart.destroy();
    const ctx = el("coinChart").getContext("2d");
    chart = new Chart(ctx, {
      type: "line",
      data: { datasets: [{ label: `${coin} prijs`, data: prices, borderColor: "blue", fill: false, pointRadius: 0 }] },
      options: { scales: { x: { type: "time", time: { unit: days>90 ? "month" : "day" } }, y: { beginAtZero:false } } }
    });
  }

  function populateChartDropdown(){
    const sel = el("chart-coin");
    if(!sel) return;
    const prev = sel.value;
    sel.innerHTML = "";
    if(currentTop10 && currentTop10.length>0){
      currentTop10.forEach(c=>{
        const opt = document.createElement("option");
        opt.value = c.id;
        opt.textContent = `${c.name} (${c.id})`;
        sel.appendChild(opt);
      });
      if(prev) sel.value = prev;
    } else {
      const opt = document.createElement("option");
      opt.value = "";
      opt.textContent = "Laad eerst Top10 (Refresh selection)";
      sel.appendChild(opt);
    }
  }

  // ---------- Simulations ----------
  // Helpers: buy/sell for sim
  async function simBuy(simObj, coinId, spendFraction=0.5, vs="eur"){
    const price = await getPrice(coinId, vs);
    if(price === null) return null;
    const spend = simObj.cash * spendFraction;
    const qty = Math.floor((spend / price) * 100000) / 100000; // round to 5 decimals
    if(qty <= 0) return null;
    simObj.cash -= qty * price;
    const nowPrice = price;
    const existing = simObj.holdings.find(h=>h.coin===coinId);
    if(existing){
      const oldTotal = existing.qty * existing.avgPrice;
      const newTotal = (qty * nowPrice) + oldTotal;
      existing.qty = existing.qty + qty;
      existing.avgPrice = newTotal / existing.qty;
      existing.lastPrice = nowPrice;
    } else {
      simObj.holdings.push({ coin: coinId, qty: qty, avgPrice: nowPrice, lastPrice: nowPrice });
    }
    return { coin: coinId, qty, price: nowPrice, spend };
  }
  async function simSell(simObj, coinId, fraction=1, vs="eur"){
    const h = simObj.holdings.find(x=>x.coin===coinId);
    if(!h) return null;
    const sellQty = h.qty * fraction;
    const price = await getPrice(coinId, vs);
    if(price === null) return null;
    const value = sellQty * price;
    simObj.cash += value;
    h.qty -= sellQty;
    if(h.qty <= 0.0000001) simObj.holdings = simObj.holdings.filter(x=>x.coin!==coinId);
    return { coin: coinId, qty: sellQty, price, value, avgPrice: h.avgPrice || price };
  }
  function simPortfolioValue(simObj, marketMap){
    let sum = 0;
    for(const h of simObj.holdings){
      const m = marketMap[h.coin];
      const price = m ? m.current_price : (h.lastPrice || h.avgPrice || 0);
      sum += h.qty * price;
    }
    return sum;
  }

  // simple sell decision
  function shouldSellHoldingSim(h, marketPrice){
    const profitPct = ((marketPrice - h.avgPrice) / h.avgPrice) * 100;
    // sell rules: take profit >=10% or stop loss <= -5%
    if(profitPct >= 10 || profitPct <= -5) return true;
    return false;
  }

  // Run one simulation day for a simKey
  async function runSimDay(simKey, marketList){
    const simObj = sims[simKey];
    const vs = el("vsCurrency") ? el("vsCurrency").value : "eur";
    const marketMap = {};
    marketList.forEach(m => marketMap[m.id] = m);

    // monthly deposit: if day is the 1st of simulated month
    const date = new Date(sims.currentDate);
    if(date.getDate() === 1){
      simObj.cash += simObj.monthlyDeposit;
    }

    // limit 2 actions per day
    let actions = 0;
    const MAX_ACTIONS = 2;

    // SELL phase first (prioritize holdings that meet sell rules)
    for(const h of [...simObj.holdings]){
      if(actions >= MAX_ACTIONS) break;
      const m = marketMap[h.coin];
      if(!m) continue;
      const price = m.current_price;
      if(shouldSellHoldingSim(h, price)){
        const sold = await simSell(simObj, h.coin, 1, vs);
        if(sold){
          actions++;
          simObj.log.push({ date: date.toISOString().slice(0,10), action: "SELL", coin: sold.coin, qty: sold.qty, price: sold.price, value: sold.value, profitPct: ((sold.price - sold.avgPrice)/sold.avgPrice)*100 });
          addSimRow(simKey, date.toISOString().slice(0,10), "VERKOOP", sold.coin, sold.qty, sold.price, ((sold.price - sold.avgPrice)/sold.avgPrice)*100, simObj.cash, simPortfolioValue(simObj, marketMap));
        }
      }
    }

    // BUY phase based on strategy
    if(actions < MAX_ACTIONS){
      const scored = computeScores(marketList);
      scored.sort((a,b)=>b.opportunity_score - a.opportunity_score);
      const top10 = scored.slice(0,10);
      const outsideHigh = scored.filter(c => !top10.find(t=>t.id===c.id) && c.opportunity_score > 5);

      let candidates = [];
      if(simKey === 'sim1'){ // vrije strategie: buy top by score
        candidates = scored.slice(0,10);
      } else if(simKey === 'sim2'){ // expected top10: buy outsideHigh (likely movers)
        candidates = outsideHigh.slice(0,10);
      } else if(simKey === 'sim3'){ // top10 current
        candidates = top10;
      }

      for(const candidate of candidates){
        if(actions >= MAX_ACTIONS) break;
        if(simObj.cash < 1) break;
        const bought = await simBuy(simObj, candidate.id, 0.5, vs); // spend 50% of cash on first buy
        if(bought){
          actions++;
          simObj.log.push({ date: date.toISOString().slice(0,10), action: "BUY", coin: bought.coin, qty: bought.qty, price: bought.price, value: bought.spend });
          addSimRow(simKey, date.toISOString().slice(0,10), "KOOP", bought.coin, bought.qty, bought.price, 0, simObj.cash, simPortfolioValue(simObj, marketMap));
        }
      }
    }
  }

  // add row to sim table
  function addSimRow(simKey, day, action, coin, qty, price, profitPct, cash, portfolioValue){
    const tableId = simKey + '-table';
    const tbody = el(tableId) ? el(tableId).querySelector('tbody') : null;
    if(!tbody) return;
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${day}</td><td>${action}</td><td>${coin}</td><td>${qty.toFixed(5)}</td><td>€${price.toFixed(4)}</td><td>${profitPct ? profitPct.toFixed(2)+"%" : "-"}</td><td>€${cash.toFixed(2)}</td><td>€${portfolioValue.toFixed(2)}</td>`;
    tbody.appendChild(tr);
  }

  // run simulations for n days with small pause to update UI
  async function runSimulationsDays(days = DEFAULT_SIM_DAYS){
    if(sims.running) return;
    sims.running = true;
    log(`Simulatie gestart (${days} dagen)`);
    // start at today's date
    sims.currentDate = new Date();

    for(let day=0; day<days; day++){
      if(!sims.running) break;
      // fetch markets fresh daily
      const markets = await fetchMarkets(el("vsCurrency") ? el("vsCurrency").value : "eur", 200);
      if(!markets) { log("Marktdata niet beschikbaar — simulatie onderbroken"); break; }

      // run each sim
      await runSimDay('sim1', markets);
      await runSimDay('sim2', markets);
      await runSimDay('sim3', markets);

      // advance date by 1 day
      sims.currentDate.setDate(sims.currentDate.getDate() + 1);

      // update overview UI
      updateSimOverview();

      // small pause so UI can show progress
      await new Promise(res => setTimeout(res, 300));
    }

    sims.running = false;
    log("Simulatie afgerond");
  }

  function stopSimulations(){
    sims.running = false;
    log("Simulatie gestopt door gebruiker");
  }

  function resetSimulations(){
    sims.sim1 = deepCopy(SIM_DEFAULT);
    sims.sim2 = deepCopy(SIM_DEFAULT);
    sims.sim3 = deepCopy(SIM_DEFAULT);
    sims.running = false;
    sims.currentDate = new Date();
    ['sim1-table','sim2-table','sim3-table'].forEach(id=>{
      const tb = el(id) ? el(id).querySelector('tbody') : null;
      if(tb) tb.innerHTML = "";
    });
    updateSimOverview();
    log("Simulaties gereset");
  }

  function updateSimOverview(){
    const wrap = el('sim-overviews');
    if(!wrap) return;
    wrap.innerHTML = `
      <div><strong>Sim1 (Vrij):</strong> Cash €${sims.sim1.cash.toFixed(2)} • Holdings ${sims.sim1.holdings.length}</div>
      <div><strong>Sim2 (Verwacht):</strong> Cash €${sims.sim2.cash.toFixed(2)} • Holdings ${sims.sim2.holdings.length}</div>
      <div><strong>Sim3 (Top10):</strong> Cash €${sims.sim3.cash.toFixed(2)} • Holdings ${sims.sim3.holdings.length}</div>
    `;
  }

  // ---------- UI wiring ----------
  // Buttons and events
  function safeGet(id){
    const eln = document.getElementById(id);
    if(!eln) console.warn(`Element not found: ${id}`);
    return eln;
  }

  // Bind UI elements
  const btnRefresh = safeGet("refreshSelection");
  if(btnRefresh) btnRefresh.addEventListener("click", refreshSelection);

  const btnStartMonitor = safeGet("startMonitor");
  if(btnStartMonitor) btnStartMonitor.addEventListener("click", ()=>{
    const intervalVal = safeGet("interval") ? parseInt(safeGet("interval").value,10) : 60000;
    if(monitorHandle) clearInterval(monitorHandle);
    refreshSelection();
    renderHoldings();
    monitorHandle = setInterval(async ()=>{ await refreshSelection(); await renderHoldings(); }, intervalVal);
    if(!window._adviceChecker) window._adviceChecker = setInterval(updateAdviceResults, ADVICE_CHECK_INTERVAL_MS);
    log("Live monitor gestart");
  });

  const btnStopMonitor = safeGet("stopMonitor");
  if(btnStopMonitor) btnStopMonitor.addEventListener("click", ()=>{
    if(monitorHandle) { clearInterval(monitorHandle); monitorHandle = null; log("Monitor gestopt"); }
    if(window._adviceChecker){ clearInterval(window._adviceChecker); window._adviceChecker = null; }
  });

  const btnAddHolding = safeGet("addHolding");
  if(btnAddHolding) btnAddHolding.addEventListener("click", ()=>{
    const id = safeGet("hold-coin") ? safeGet("hold-coin").value.trim().toLowerCase() : "";
    const qty = parseFloat(safeGet("hold-qty") ? safeGet("hold-qty").value : NaN);
    const price = parseFloat(safeGet("hold-price") ? safeGet("hold-price").value : NaN);
    if(!id || isNaN(qty) || isNaN(price)){ alert("Vul coin, qty en aankoopprijs in"); return; }
    saveHoldingRow({ id, qty, buyPrice: price });
    safeGet("hold-coin").value=""; safeGet("hold-qty").value=""; safeGet("hold-price").value="";
    renderHoldings();
  });

  const btnLoadChart = safeGet("loadChart");
  if(btnLoadChart) btnLoadChart.addEventListener("click", handleLoadChart);
  const btnAutoChart = safeGet("autoChart");
  if(btnAutoChart) btnAutoChart.addEventListener("click", ()=>{ populateChartDropdown(); alert("Chart dropdown gevuld met Top10"); });

  // Simulation controls
  const btnSimStart = safeGet("sim-start");
  if(btnSimStart) btnSimStart.addEventListener("click", async ()=>{ resetSimulations(); updateSimOverview(); await runSimulationsDays(DEFAULT_SIM_DAYS); });

  const btnSimStop = safeGet("sim-stop");
  if(btnSimStop) btnSimStop.addEventListener("click", stopSimulations);

  const btnSimReset = safeGet("sim-reset");
  if(btnSimReset) btnSimReset.addEventListener("click", resetSimulations);

  // Chart coin populate initially
  populateChartDropdown();

  // Initialize advice log and success rate UI
  renderAdviceLog();
  updateSuccessRateUI();
  updateSimOverview();

  // Small initial refresh to populate Top10
  // don't auto-start monitor
  // refreshSelection();

  // ---------- End of initMain ----------
  log("App initialized (complete app.js)");
} // end initMain
