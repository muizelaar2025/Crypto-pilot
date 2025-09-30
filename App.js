// app.js — Live Top10 + Holdings & advies (CoinGecko)
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

async function fetchMarkets(vs="eur", per_page=50) {
  const url = `${CG_API}/coins/markets?vs_currency=${vs}&order=market_cap_desc&per_page=${per_page}&page=1&sparkline=false&price_change_percentage=24h,7d`;
  try {
    const r = await fetch(url);
    if(!r.ok) throw new Error("HTTP "+r.status);
    const data = await r.json();
    return data; // array of coin objects
  } catch(e){
    console.error("fetchMarkets error", e);
    return null;
  }
}

// eenvoudige score: 0.6*7d + 0.3*24h + 0.1*(norm(volume))
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
  // watch buttons vullen automatisch het holdings-formulier
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

  // filter coins met voldoende liquiditeit
  const MIN_VOLUME = 5_000_000; // minimaal 5 miljoen in gekozen valuta (aanpasbaar)
  const liquid = markets.filter(c => (c.total_volume || 0) >= MIN_VOLUME);

  const scored = computeScores(liquid);
  scored.sort((a,b)=>b.opportunity_score - a.opportunity_score);
  currentTop10 = scored.slice(0,10);
  renderTop10(currentTop10);
  log("Top10 bijgewerkt.");
}

// Holdings management
let holdings = []; // {id, qty, buyPrice}

function saveHoldingRow(h) {
  holdings.push(h);
  renderHoldings();
}

async function getPrice(coinId, vs="eur") {
  try {
    const url = `${CG_API}/simple/price?ids=${coinId}&vs_currencies=${vs}`;
    const r = await fetch(url);
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

  if(net > 0) {
    if(isInTop10) return {advice:"Behouden", reason:`Positief na fee (€${net.toFixed(2)}) + in top10`};
    const tin = currentTop10.find(c=>c.id===h.id);
    if(tin && tin.opportunity_score > 0) return {advice:"Behouden", reason:`Netto winst (€${net.toFixed(2)}) + score ${tin.opportunity_score.toFixed(2)}`};
    if(net < Math.abs(0.01 * (h.buyPrice*h.qty))) return {advice:"Optioneel verkopen", reason:`Kleine winst (€${net.toFixed(2)}), score laag`};
    return {advice:"Behouden", reason:`Netto winst €${net.toFixed(2)}`};
  } else {
    if(isInTop10) return {advice:"Behouden", reason:`Verlies nu maar coin in top10 — kans op herstel`};
    return {advice:"Verkopen", reason:`Netto verlies €${net.toFixed(2)}`};
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
    const ad = (price!==null) ? adviceForHolding(h, price, inTop) : {advice:"Onbekend", reason:"Kon prijs niet ophalen"};
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
    const id = b.dataset.id;
    holdings = holdings.filter(x=>x.id!==id);
    renderHoldings();
  }));
}

// UI wiring
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

// monitor: periodiek top10 refresh + holdings update
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
