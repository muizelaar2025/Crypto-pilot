// app.js — Crypto Pilot: Top10, Holdings, Grafieken, Advies Log & Learning

const CG_API = "https://api.coingecko.com/api/v3";
const TRANSACTION_FEE = 5.0;
const ADVICE_CHECK_INTERVAL_MS = 60 * 60 * 1000; // 1 uur (voor demo); productie: 24h

let monitorHandle = null;
let currentTop10 = [];
let holdings = []; // {id, qty, buyPrice}
let chart = null;

// ----------------- Helper functies -----------------
const el = id => document.getElementById(id);
const log = msg => {
  const out = el("output");
  const p = document.createElement("div");
  p.textContent = `${new Date().toLocaleTimeString()} — ${msg}`;
  out.prepend(p);
};

// ----------------- Tabs -----------------
function showTab(name) {
  document.querySelectorAll(".tab").forEach(t => t.classList.remove("active"));
  el("tab-" + name).classList.add("active");
}

// ----------------- Local Storage -----------------
const loadAdviceLogs = () => JSON.parse(localStorage.getItem("adviceLogs") || "[]");
const saveAdviceLogs = logs => localStorage.setItem("adviceLogs", JSON.stringify(logs));
const loadSuccessStats = () => JSON.parse(localStorage.getItem("successStats") || '{"checked":0,"correct":0}');
const saveSuccessStats = stats => localStorage.setItem("successStats", JSON.stringify(stats));
const updateSuccessRateUI = () => {
  const s = loadSuccessStats();
  const rate = s.checked === 0 ? "-" : ((s.correct / s.checked) * 100).toFixed(1) + "%";
  el("successRate").textContent = rate;
};

// ----------------- API Calls -----------------
async function fetchMarkets(vs = "eur", per_page = 50) {
  try {
    const res = await fetch(`${CG_API}/coins/markets?vs_currency=${vs}&order=market_cap_desc&per_page=${per_page}&page=1&sparkline=false&price_change_percentage=24h,7d`);
    if (!res.ok) throw new Error("HTTP " + res.status);
    return await res.json();
  } catch (e) {
    console.error("fetchMarkets error", e);
    return null;
  }
}

async function getPrice(coinId, vs = "eur") {
  try {
    const res = await fetch(`${CG_API}/simple/price?ids=${coinId}&vs_currencies=${vs}`);
    if (!res.ok) throw new Error("HTTP " + res.status);
    const data = await res.json();
    return data[coinId] ? data[coinId][vs] : null;
  } catch (e) {
    console.error("getPrice error", e);
    return null;
  }
}

// ----------------- Score & selectie -----------------
function computeScores(coins) {
  const vols = coins.map(c => c.total_volume || 0);
  const logVols = vols.map(v => Math.log10(v || 1));
  const minV = Math.min(...logVols), maxV = Math.max(...logVols);

  return coins.map(c => {
    const ch7 = c.price_change_percentage_7d_in_currency || 0;
    const ch24 = c.price_change_percentage_24h_in_currency || 0;
    const lv = Math.log10(c.total_volume || 1);
    const normVol = maxV === minV ? 0.5 : (lv - minV) / (maxV - minV);
    const score = (0.6 * ch7) + (0.3 * ch24) + (5 * normVol);
    return { ...c, opportunity_score: score };
  });
}

async function refreshSelection() {
  const vs = el("vsCurrency").value;
  log("Selectie verversen…");

  const markets = await fetchMarkets(vs, 100);
  if (!markets) { log("Kon marktdata niet ophalen."); return; }

  const stats = loadSuccessStats();
  let successRate = stats.checked === 0 ? 0.6 : (stats.correct / stats.checked);

  let MIN_VOLUME = 5_000_000;
  if (successRate < 0.5) MIN_VOLUME *= 1.5;
  if (successRate < 0.35) MIN_VOLUME *= 2.0;

  const liquid = markets.filter(c => (c.total_volume || 0) >= MIN_VOLUME);
  const scored = computeScores(liquid);
  scored.sort((a, b) => b.opportunity_score - a.opportunity_score);

  currentTop10 = scored.slice(0, 10);
  renderTop10(currentTop10);
  log(`Top10 bijgewerkt (MIN_VOLUME=${MIN_VOLUME.toLocaleString()})`);

  autoGenerateAdvice(currentTop10);
  renderAdviceLog();
}

// ----------------- Automatisch advies -----------------
function autoGenerateAdvice(top10) {
  const logs = loadAdviceLogs();
  const AUTO_SCORE_THRESHOLD = 10;

  top10.forEach(coin => {
    if (coin.opportunity_score > AUTO_SCORE_THRESHOLD) {
      const exists = logs.some(l => l.coin === coin.id && l.result === "?");
      if (!exists) {
        logs.push({
          time: new Date().toLocaleString(),
          coin: coin.id,
          advice: "Koop",
          startPrice: coin.current_price,
          currentPrice: coin.current_price,
          result: "?"
        });
        log(`🟢 Automatisch koopadvies toegevoegd voor ${coin.id} @ €${coin.current_price.toFixed(4)}`);
      }
    }
  });

  saveAdviceLogs(logs);
}

// ----------------- Top10 rendering -----------------
function renderTop10(list) {
  const container = el("top10-list");
  container.innerHTML = "";
  if (!list || list.length === 0) { container.innerHTML = "<em>Geen resultaten</em>"; return; }

  list.forEach((c, i) => {
    const p = document.createElement("p");
    p.innerHTML = `<span class="pill">${i + 1}</span> <strong>${c.name} (${c.symbol.toUpperCase()})</strong>
      — prijs: ${c.current_price?.toLocaleString(undefined, { maximumFractionDigits: 8 })} • 7d: ${(c.price_change_percentage_7d_in_currency || 0).toFixed(2)}% • score: ${c.opportunity_score.toFixed(2)}
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

  container.querySelectorAll(".chart-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      populateChartDropdown();
      el("chart-coin").value = btn.dataset.id;
      showTab('charts');
    });
  });

  populateChartDropdown();
}

// ----------------- Holdings -----------------
function saveHoldingRow(h) {
  holdings.push(h);
  renderHoldings();
}

function adviceForHolding(h, currentPrice, isInTop10) {
  const net = ((currentPrice - h.buyPrice) * h.qty) - TRANSACTION_FEE;
  if (net > 0) return { advice: "Behouden", reason: `Winst (€${net.toFixed(2)})${isInTop10 ? " + in top10" : ""}` };
  return { advice: isInTop10 ? "Behouden" : "Verkopen", reason: `Verlies €${Math.abs(net).toFixed(2)}${isInTop10 ? " maar coin in top10" : ""}` };
}

async function renderHoldings() {
  const tbody = el("holdings-table").querySelector("tbody");
  tbody.innerHTML = "";
  const vs = el("vsCurrency").value;

  for (const h of holdings) {
    const price = await getPrice(h.id, vs);
    const inTop = currentTop10.some(c => c.id === h.id);
    const ad = price !== null ? adviceForHolding(h, price, inTop) : { advice: "?", reason: "geen data" };
    const net = price !== null ? ((price - h.buyPrice) * h.qty - TRANSACTION_FEE) : null;

    const tr = document.createElement("tr");
    tr.innerHTML = `<td>${h.id}</td>
      <td>${h.qty}</td>
      <td>${h.buyPrice.toFixed(4)}</td>
      <td>${price !== null ? price.toLocaleString(undefined, { maximumFractionDigits: 8 }) : "?"}</td>
      <td>${net !== null ? "€" + net.toFixed(2) : "?"}</td>
      <td class="${ad.advice === 'Behouden' ? 'advice-hold' : 'advice-sell'}">${ad.advice}<br><small>${ad.reason}</small></td>
      <td><button data-id="${h.id}" class="del">Verwijder</button></td>`;
    tbody.appendChild(tr);
  }

  tbody.querySelectorAll(".del").forEach(b => {
    b.addEventListener("click", () => {
      holdings = holdings.filter(x => x.id !== b.dataset.id);
      renderHoldings();
    });
  });
}

// ----------------- Advies log -----------------
function saveAdviceLogEntry(entry) {
  const logs = loadAdviceLogs();
  logs.push(entry);
  saveAdviceLogs(logs);
  renderAdviceLog();
}

async function renderAdviceLog() {
  const tbody = el("adviceTable").querySelector("tbody");
  tbody.innerHTML = "";
  const logs = loadAdviceLogs();
  const vs = el("vsCurrency").value;

  for (let i = 0; i < logs.length; i++) {
    const l = logs[i];
    const price = await getPrice(l.coin, vs);
    const tr = document.createElement("tr");
    tr.innerHTML = `<td>${l.time}</td>
      <td>${l.coin}</td>
      <td>${l.advice}</td>
      <td>${l.startPrice !== undefined ? "€" + Number(l.startPrice).toFixed(4) : "?"}</td>
      <td>${price !== null ? "€" + price.toFixed(4) : "?"}</td>
      <td>${l.result}</td>
      <td><button data-i="${i}" class="unfollow">Niet meer volgen</button></td>`;
    tbody.appendChild(tr);
  }

  tbody.querySelectorAll(".unfollow").forEach(b => {
    b.addEventListener("click", () => {
      const i = Number(b.dataset.i);
      const logs2 = loadAdviceLogs();
      logs2.splice(i, 1);
      saveAdviceLogs(logs2);
      renderAdviceLog();
    });
  });
}

// ----------------- Advies check / learning -----------------
async function updateAdviceResults() {
  const logs = loadAdviceLogs();
  const vs = el("vsCurrency").value;
  let changed = false;
  let stats = loadSuccessStats();

  for (let i = 0; i < logs.length; i++) {
    const l = logs[i];
    if (l.result !== "?") continue;

    const current = await getPrice(l.coin, vs);
    if (current === null) continue;

    let correct = false;
    if (l.advice.toLowerCase().includes("koop")) correct = current > l.startPrice;
    if (l.advice.toLowerCase().includes("verkoop")) correct = current < l.startPrice;

    if (correct) {
      logs[i].result = "✅";
      stats.checked++; stats.correct++;
      log(`✅ Advies CORRECT: ${l.coin} (${l.advice})`);
    } else {
      const diff = Math.abs((current - l.startPrice) / l.startPrice);
      if (diff > 0.005) {
        logs[i].result = "❌";
        stats.checked++;
        log(`❌ Advies FOUT: ${l.coin} (${l.advice})`);
      }
    }

    changed = true;
  }

  if (changed) {
    saveAdviceLogs(logs);
    saveSuccessStats(stats);
    renderAdviceLog();
    updateSuccessRateUI();
  }
}

// ----------------- Charts -----------------
async function loadChartData(coin, days, vs = "eur") {
  try {
    const res = await fetch(`${CG_API}/coins/${coin}/market_chart?vs_currency=${vs}&days=${days}`);
    if (!res.ok) throw new Error("HTTP " + res.status);
    const data = await res.json();
    return (data.prices || []).map(p => ({ x: new Date(p[0]), y: p[1] }));
  } catch (e) {
    console.error("loadChartData", e);
    return [];
  }
}

el("loadChart").addEventListener("click", async () => {
  const coin = el("chart-coin").value.trim().toLowerCase();
  const days = el("chart-range").value;
  const vs = el("vsCurrency").value;
  if (!coin) { alert("Kies een coin uit de dropdown (Top10)"); return; }

  const prices = await loadChartData(coin, days, vs);
  if (chart) chart.destroy();

  const ctx = el("coinChart").getContext("2d");
  chart = new Chart(ctx, {
    type: "line",
    data: { datasets: [{ label: `${coin} prijs`, data: prices, borderColor: "blue", fill: false, pointRadius: 0 }] },
    options: { scales: { x: { type: "time", time: { unit: days > 90 ? "month" : "day" } }, y: { beginAtZero: false } } }
  });
});

function populateChartDropdown() {
  const sel = el("chart-coin");
  const prev = sel.value;
  sel.innerHTML = "";

  if (currentTop10 && currentTop10.length > 0) {
    currentTop10.forEach(c => {
      const opt = document.createElement("option");
      opt.value = c.id;
      opt.textContent = `${c.name} (${c.id})`;
      sel.appendChild(opt);
    });
    if (prev) sel.value = prev;
  } else {
    const opt = document.createElement("option");
    opt.value = "";
    opt.textContent = "Laad eerst Top10 (Refresh selection)";
    sel.appendChild(opt);
  }
}

el("autoChart").addEventListener("click", () => {
  populateChartDropdown();
  alert("Chart dropdown gevuld met Top10 (kies coin en klik 'Laad grafiek')");
});

// ----------------- UI events & monitor -----------------
el("refreshSelection").addEventListener("click", refreshSelection);

el("addHolding").addEventListener("click", () => {
  const id = el("hold-coin").value.trim().toLowerCase();
  const qty = parseFloat(el("hold-qty").value);
  const price = parseFloat(el("hold-price").value);

  if (!id || isNaN(qty) || isNaN(price)) { alert("Vul coin, qty en aankoopprijs in"); return; }
  saveHoldingRow({ id, qty, buyPrice: price });
  el("hold-coin").value = ""; el("hold-qty").value = ""; el("hold-price").value = "";
  renderHoldings();
});

el("startMonitor").addEventListener("click", () => {
  const interval = parseInt(el("interval").value, 10);
  if (monitorHandle) clearInterval(monitorHandle);
  log("Live monitor gestart");

  refreshSelection();
  renderHoldings();

  monitorHandle = setInterval(async () => {
    await refreshSelection();
    await renderHoldings();
  }, interval);

  if (!window._adviceChecker) window._adviceChecker = setInterval(updateAdviceResults, ADVICE_CHECK_INTERVAL_MS);
});

el("stopMonitor").addEventListener("click", () => {
  if (monitorHandle) { clearInterval(monitorHandle); monitorHandle = null; log("Monitor gestopt"); }
  if (window._adviceChecker) { clearInterval(window._adviceChecker); window._adviceChecker = null; }
});

// ----------------- Init -----------------
(function init() {
  renderAdviceLog();
  updateSuccessRateUI();
  populateChartDropdown();
})();
