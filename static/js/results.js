AERO.chrome("/results");
AERO.chartDefaults();
const $ = (s, r = document) => r.querySelector(s);
const M = AERO.MODELS;
const tbl = (cols, rows, hl) => `<div class="tbl-text"><table><thead><tr>${cols.map((c, i) => `<th scope="col" class="${i ? "n" : ""}">${c}</th>`).join("")}</tr></thead><tbody>${rows.map((r, ri) => `<tr class="${ri === hl ? "hl" : ""}">${r.map((v, i) => `<td class="${i ? "n" : ""}">${v}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
const sg = (v, d = 1) => (v > 0 ? "+" : v < 0 ? "-" : "") + Math.abs(v).toFixed(d);
const ABL = { "Final setup (cap 125, window 3, + cycle)": "Final setup", "No cap (raw RUL target)": "No cap", "No rolling mean (raw sensors only)": "No rolling average", "No cycle feature": "No cycle number" };

(async function () {
  let r;
  try { r = await AERO.api("/api/results"); } catch (e) { return AERO.state($("main"), "error", "The results could not be loaded", e.message, () => location.reload()); }
  const test = Object.fromEntries(r.test.map((t) => [t.model, t])), best = r.best_model;

  /* score cards */
  $("#scores").innerHTML = M.map((m) => { const t = test[m], isBest = m === best;
    return `<div class="panel panel-pad" style="${isBest ? "border-color:var(--lime)" : ""}"><div class="panel-h" style="margin-bottom:6px;min-height:40px;align-items:center"><h3 style="display:flex;align-items:center;gap:10px"><i style="width:12px;height:12px;background:${AERO.MODEL_COLOR[m]};border-radius:2px;display:inline-block"></i>${m}</h3>${isBest ? '<span class="badge st-healthy" style="color:var(--lime)">Lowest error</span>' : ""}</div>
      <div style="margin:14px 0 4px"><span class="stat-n" style="font-size:3.2rem">${AERO.n(t.test_RMSE, 2)}</span><span class="stat-l">RMSE, in cycles</span></div>
      <dl class="sensor-card" style="grid-template-columns:1fr auto"><dt>MAE</dt><dd class="num">${AERO.n(t.test_MAE, 2)} cycles</dd><dt>R&sup2;</dt><dd class="num">${AERO.n(t.test_R2, 3)}</dd></dl></div>`; }).join("");

  /* predicted vs actual */
  const P = r.predictions; let sel = best, pv;
  const draw = () => {
    $("#pvSeg").innerHTML = M.map((m) => `<button type="button" data-m="${m}" aria-pressed="${m === sel}">${m === "Linear Regression" ? "Linear" : m}</button>`).join("");
    $("#pvSeg").querySelectorAll("button").forEach((b) => (b.onclick = () => { sel = b.dataset.m; draw(); }));
    const pts = P.map((p) => ({ x: p.true_RUL, y: p[sel], unit: p.unit })), errs = P.map((p) => p[sel] - p.true_RUL);
    const within = (k) => errs.filter((e) => Math.abs(e) <= k).length, over = errs.filter((e) => e > 0).length, under = errs.filter((e) => e < 0).length;
    $("#pvStats").innerHTML = `<dt>Within 10 cycles</dt><dd class="num">${within(10)} of ${P.length}</dd><dt>Within 20 cycles</dt><dd class="num">${within(20)} of ${P.length}</dd><dt>Too optimistic</dt><dd class="num">${over} engines</dd><dt>Too cautious</dt><dd class="num">${under} engines</dd><dt>Largest miss</dt><dd class="num">${AERO.n(Math.max(...errs.map(Math.abs)), 1)} cycles</dd>`;
    $("#pvInfo").textContent = `${sel}: RMSE ${AERO.n(test[sel].test_RMSE, 2)}`;
    pv && pv.destroy();
    pv = new Chart($("#pvChart"), { type: "scatter", data: { datasets: [
      { label: "Perfect prediction", type: "line", data: [{ x: 0, y: 0 }, { x: 150, y: 150 }], borderColor: "#8a92a3", borderDash: [6, 5], borderWidth: 1.2, pointRadius: 0, pointHoverRadius: 0 },
      { label: sel, data: pts, backgroundColor: AERO.MODEL_COLOR[sel], borderColor: "#121927", borderWidth: 1.5, pointRadius: 5.5, pointHoverRadius: 8, pointStyle: AERO.SHAPE[sel] }] },
      options: { scales: { x: AERO.axis("Actual remaining life (cycles)", { min: 0, max: 150 }), y: AERO.axis("Predicted remaining life (cycles)", { min: 0, max: 150 }) },
        plugins: { tooltip: { filter: (i) => i.datasetIndex === 1, callbacks: { title: (i) => `Engine ${i[0].raw.unit}`, label: (c) => [` Actual: ${c.parsed.x}`, ` Predicted: ${AERO.n(c.parsed.y, 1)}`] } } } } });
  };
  draw();

  /* error by band */
  const eb = r.error_bands; const worstBand = (m) => eb.reduce((a, b) => (a[m] > b[m] ? a : b));
  $("#ebText").textContent = `The tree models are most accurate for engines with 30 to 60 cycles left, and least accurate for engines with 100 or more. Linear Regression is clearly worse than both tree models for engines in their last 30 cycles, where a wrong call matters most.`;
  $("#ebKey").innerHTML = AERO.keyHtml(M.map((m) => [AERO.MODEL_COLOR[m], m, true]));
  new Chart($("#ebChart"), { type: "bar", data: { labels: eb.map((b) => [`${b.band} left`, `${b.engines} engines`]), datasets: M.map((m) => ({ label: m, data: eb.map((b) => b[m]), backgroundColor: AERO.MODEL_COLOR[m], borderRadius: 2, barPercentage: .88, categoryPercentage: .78 })) },
    options: { layout: { padding: { top: 18 } }, scales: { x: AERO.axis(null, { grid: { display: false }, ticks: { color: "#ece9e1" } }), y: AERO.axis("RMSE (cycles)", { beginAtZero: true }) }, plugins: { tooltip: { callbacks: { label: (c) => ` ${c.dataset.label}: ${AERO.n(c.parsed.y, 1)}` } } } },
    plugins: [AERO.valueLabels((v) => AERO.n(v, 0))] });
  $("#worst").innerHTML = tbl(["Engine", "Last cycle", "Actual left", ...M.map((m) => `${m === "Linear Regression" ? "Linear" : m} error`)],
    r.worst.map((w) => [`Engine ${w.unit}`, w.last_cycle, w.true_RUL, ...M.map((m) => sg(w["err_" + m]))]));

  /* ablation */
  const ab = r.ablation, fin = ab[0];
  $("#abKey").innerHTML = AERO.modelKey();
  AERO.dotPlot($("#abChart"), ab.map((a) => AERO.wrap(ABL[a.setup] || a.setup, 14)), Object.fromEntries(M.map((m) => [m, ab.map((a) => a[m])])), "Cross-validated RMSE (cycles)", { y: { min: 14, max: 24 } });
  const delta = (row, m) => row[m] - fin[m];
  $("#abTbl").innerHTML = tbl(["Choice removed", ...M], ab.slice(1).map((a) => [ABL[a.setup] || a.setup, ...M.map((m) => sg(delta(a, m), 2))]));
  const rf = (k) => delta(ab.find((a) => (ABL[a.setup] || "") === k), "Random Forest");
  $("#abText").textContent = `Removing the cycle number cost Random Forest ${AERO.n(rf("No cycle number"), 1)} RMSE and removing the cap cost ${AERO.n(rf("No cap"), 1)}. Removing the rolling average cost only ${AERO.n(rf("No rolling average"), 1)}, so it helps a little but is the least important of the three. The cap matters most for Linear Regression.`;
})();
