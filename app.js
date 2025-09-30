// app.js — Crypto Pilot PWA (volledig herschreven voor iPad/Safari)
document.addEventListener("DOMContentLoaded", () => {

  const CG_API = "https://api.coingecko.com/api/v3";
  let monitorHandle = null;
  let chart = null;
  let currentTop10 = [];
  let holdings = [];
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

  function loadAdviceLogs(){ return JSON.parse(localStorage.getItem("adviceLogs") || "[]"); }
  function saveAdviceLogs(logs){ localStorage.setItem("adviceLogs", JSON.stringify(logs)); }
  function loadSuccessStats(){ return JSON.parse(localStorage.getItem("successStats") || '{"checked":0,"correct":0}'); }
  function saveSuccessStats(s){ localStorage.setItem("successStats", JSON.stringify(s)); }
  function updateSuccessRateUI(){
    const s = loadSuccessStats();
    const rate = s.checked === 0 ? "-" : ((s.correct / s.checked) * 100).toFixed(1) + "%";
    el("successRate").textContent = rate;
  }

  // ---------------- Market data ----------------
  async function fetchMarkets(vs="eur", per_page=50) {
    try {
      const r = await fetch(`${CG_API}/coins/markets?vs_currency=${vs}&order=market_cap_desc&per_page=${per_page}&page=1&sparkline=false&price_change_percentage=24h,7d`);
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

  // ---------------- Render Top10 ----------------
  function renderTop10(list) {
    const container = el("top10-list");
    container.innerHTML = "";
    if(!list || list.length===0){ container.innerHTML = "<em>Geen resultaten</em>"; return; }
    list.forEach((c, i) => {
      const p = document.createElement("p");
      p.innerHTML = `<span class="pill">${i+1}</span> <strong>${c.name} (${c.symbol.toUpperCase()})</strong>
        — prijs: ${c.current_price?.toLocaleString(undefined,{maximumFractionDigits:8})} • 7d: ${(c.price_change_percentage_7d_in_currency||0).toFixed(2)}% • score: ${c.opportunity_score.toFixed(2)}
        <button data-id="${c.id}" class="watch-btn">Volgen</button>
        <button data-id="${c.id}" class="chart-btn">Grafiek</button>`;
      container.appendChild(p);
    });

    container.querySelectorAll(".watch-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        el("hold-coin").value = btn.dataset.id;
        el("hold-qty").focus();
      });
    });

    container.querySelectorAll(".chart-btn").forEach(btn=>{
      btn.addEventListener("click", ()=>{
        populateChartDropdown();
        el("chart-coin").value = btn.dataset.id;
        showTab('charts');
      });
    });

    populateChartDropdown();
  }

  // ---------------- Selection & adaptive filter ----------------
  async function refreshSelection() {
    const vs = el("vsCurrency").value;
    log("Selectie verversen…");
    const markets = await fetchMarkets(vs, 100);
    if(!markets) { log("Kon marktdata niet ophalen."); return; }

    const stats = loadSuccessStats();
    const successRate = stats.checked === 0 ? 0.6 : (stats.correct / (stats.checked || 1));
    let MIN_VOLUME = 5_000_000;
    if(successRate < 0.5) MIN_VOLUME *= 1.5;
    if(successRate < 0.35) MIN_VOLUME *= 2.0;

    const liquid = markets.filter(c => (c.total_volume || 0) >= MIN_VOLUME);
    const scored = computeScores(liquid);
    scored.sort((a,b)=>b.opportunity_score - a.opportunity_score);
    currentTop10 = scored.slice(0,10);
    renderTop10(currentTop10);
    log(`Top10 bijgewerkt. (MIN_VOLUME=${MIN_VOLUME.toLocaleString()})`);

    const AUTO_SCORE_THRESHOLD = 10;
    const logs = loadAdviceLogs();
    for(const coin of currentTop10){
      if(coin.opportunity_score > AUTO_SCORE_THRESHOLD){
        const exists = logs.some(l=>l.coin===coin.id && l.result==="?");
        if(!exists){
          const entry = {
            time: new Date().toLocaleString(),
            coin: coin.id,
            advice: "Koop",
            startPrice: coin.current_price,
            currentPrice: coin.current_price,
            result: "?"
          };
          logs.push(entry);
          log(`🟢 Automatisch koopadvies toegevoegd voor ${coin.id} @ €${coin.current_price.toFixed(4)}`);
        }
      }
    }
    saveAdviceLogs(logs);
    renderAdviceLog();
  }

  // ---------------- Holdings ----------------
  function saveHoldingRow(h) {
    holdings.push(h);
    renderHoldings();
  }

  async function getPrice(coinId, vs="eur") {
    try {
      const r = await fetch(`${CG_API}/simple/price?ids=${coinId}&vs_currencies=${vs}`);
      if(!r.ok) throw new Error("HTTP "+r.status);
      const j = await r.json();
      return j[coinId] ? j[coinId][vs] : null;
    } catch(e){
      console.error("getPrice err", e);
      return null;
    }
  }

  function adviceForHolding(h, currentPrice, isInTop10) {
    const gross = (currentPrice - h.buyPrice) * h.qty;
    const net = gross - TRANSACTION_FEE;
    if(net > 0) return {advice:"Behouden", reason:`Winst (€${net.toFixed(2)})${isInTop10 ? " + in top10" : ""}`};
    return {advice: isInTop10 ? "Behouden" : "Verkopen", reason:`Verlies €${net.toFixed(2)}${isInTop10 ? " maar coin in top10" : ""}`};
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

  // ---------------- Advice log ----------------
  function saveAdviceLogEntry(entry){
    const logs = loadAdviceLogs();
    logs.push(entry);
    saveAdviceLogs(logs);
    renderAdviceLog();
  }

  async function renderAdviceLog(){
    const tbody = el("adviceTable").querySelector("tbody");
    tbody.innerHTML="";
    const logs = loadAdviceLogs();
    const vs = el("vsCurrency").value;
    for(let i=0;i<logs.length;i++){
      const l = logs[i];
      const price = await getPrice(l.coin, vs);
      const tr = document.createElement("tr");
      tr.innerHTML = `<td>${l.time}</td>
        <td>${l.coin}</td>
        <td>${l.advice}</td>
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

  // ---------------- Charts ----------------
  async function loadChartData(coin, days, vs="eur"){
    try {
      const url = `${CG_API}/coins/${coin}/market_chart?vs_currency=${vs}&days=${days}`;
      const r = await fetch(url);
      if(!r.ok) throw new Error("HTTP "+r.status);
      const data = await r.json();
      if(!data.prices) return [];
      return data.prices.map(p => ({x:new Date(p[0]), y:p[1]}));
    } catch(e){
      console.error("loadChartData", e);
      return [];
    }
  }

  function populateChartDropdown(){
    const sel = el("chart-coin");
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

  // ---------------- UI wiring ----------------
  el("refreshSelection").addEventListener("click", refreshSelection);
  el("addHolding").add
