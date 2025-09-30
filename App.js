async function getLivePrice(coinId, vsCurrency = "eur") {
  const url = `https://api.coingecko.com/api/v3/simple/price?ids=${coinId}&vs_currencies=${vsCurrency}`;
  try {
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`HTTP fout: ${resp.status}`);
    const data = await resp.json();
    return data[coinId] ? data[coinId][vsCurrency] : null;
  } catch (err) {
    console.error("Prijs ophalen mislukt:", err);
    return null;
  }
}

let balance = 1000.0;
let coins = 0;
let lastPrice = null;
const transactionFee = 5.0;
let coinId = "bitcoin"; // standaard
let monitorInterval = null; // hier slaan we de interval op
let currentPrice = 0;

function log(message) {
  const output = document.getElementById("output");
  const p = document.createElement("p");
  p.textContent = message;
  output.prepend(p); // nieuwste bovenaan
}

function updateDashboard() {
  const coinValue = coins * currentPrice;
  const total = balance + coinValue;

  document.getElementById("balance").textContent = balance.toFixed(2);
  document.getElementById("coins").textContent = coins;
  document.getElementById("coinValue").textContent = coinValue.toFixed(2);
  document.getElementById("totalValue").textContent = total.toFixed(2);
}

async function checkMarket() {
  currentPrice = await getLivePrice(coinId, "eur");
  if (currentPrice === null) {
    log(`❌ Kon prijs niet ophalen (${coinId})`);
    return;
  }

  if (lastPrice === null) {
    lastPrice = currentPrice;
    log(`ℹ️ Startprijs voor ${coinId}: €${currentPrice.toFixed(2)}`);
    updateDashboard();
    return;
  }

  let change = (currentPrice - lastPrice) / lastPrice;
  let advice = "";

  if (change < -0.05 && balance > currentPrice + transactionFee) {
    // KOOP
    let coinsBought = Math.floor((balance - transactionFee) / currentPrice);
    if (coinsBought > 0) {
      let cost = coinsBought * currentPrice + transactionFee;
      balance -= cost;
      coins += coinsBought;
      advice = `📉 Koop ${coinsBought} ${coinId} @ €${currentPrice.toFixed(2)}`;
    }
  } else if (change > 0.07 && coins > 0) {
    // VERKOOP
    let proceeds = coins * currentPrice - transactionFee;
    balance += proceeds;
    advice = `📈 Verkoop ${coins} ${coinId} @ €${currentPrice.toFixed(2)}`;
    coins = 0;
  } else {
    advice = `⏳ Geen actie | ${coinId}: €${currentPrice.toFixed(2)}`;
  }

  log(advice);
  lastPrice = currentPrice;
  updateDashboard();
}

// Start live monitoring
document.getElementById("simulate").addEventListener("click", () => {
  coinId = document.getElementById("crypto").value.trim().toLowerCase();
  let intervalValue = parseInt(document.getElementById("interval").value, 10);

  document.getElementById("output").innerHTML = `<p>🔍 Live volgen van ${coinId} gestart (interval: ${intervalValue / 1000} sec)...</p>`;
  balance = 1000.0;
  coins = 0;
  lastPrice = null;

  updateDashboard();

  // stop eerdere interval als die nog loopt
  if (monitorInterval) {
    clearInterval(monitorInterval);
  }

  monitorInterval = setInterval(checkMarket, intervalValue);
});
