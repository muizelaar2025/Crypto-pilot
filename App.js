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

document.getElementById("simulate").addEventListener("click", async () => {
  const coinInput = document.getElementById("crypto").value.trim().toLowerCase();
  let transactionFee = 5.0;
  let balance = 1000.0;
  let coins = 0;
  let history = [];

  let coinPrice = await getLivePrice(coinInput, "eur");
  if (coinPrice === null) {
    document.getElementById("output").innerHTML = `<p>Kon prijs niet ophalen voor "${coinInput}".</p>`;
    return;
  }

  for (let day = 1; day <= 20; day++) {
    let newPrice = await getLivePrice(coinInput, "eur");
    if (newPrice === null) {
      history.push(`Dag ${day}: kon prijs niet ophalen.`);
      continue;
    }
    let change = (newPrice - coinPrice) / coinPrice;
    coinPrice = newPrice;

    let advice = "";
    if (change < -0.05 && balance > coinPrice + transactionFee) {
      let coinsBought = Math.floor((balance - transactionFee) / coinPrice);
      if (coinsBought > 0) {
        let cost = coinsBought * coinPrice + transactionFee;
        balance -= cost;
        coins += coinsBought;
        advice = `📉 Dag ${day}: Koop ${coinsBought} coins @ €${coinPrice.toFixed(2)}`;
      } else {
        advice = `Dag ${day}: Geen koop mogelijk.`;
      }
    } else if (change > 0.07 && coins > 0) {
      let proceeds = coins * coinPrice - transactionFee;
      balance += proceeds;
      advice = `📈 Dag ${day}: Verkoop ${coins} coins @ €${coinPrice.toFixed(2)}`;
      coins = 0;
    } else {
      advice = `Dag ${day}: Houd positie. Prijs: €${coinPrice.toFixed(2)}`;
    }

    history.push(advice);
  }

  const output = document.getElementById("output");
  output.innerHTML = history.map(line => `<p>${line}</p>`).join("");
  output.innerHTML += `
    <h3>📊 Eindresultaat</h3>
    <p>💰 Balans: €${balance.toFixed(2)}</p>
    <p>🪙 Coins: ${coins}</p>
    <p>📈 Totale waarde: €${(balance + coins * coinPrice).toFixed(2)}</p>
  `;
});
