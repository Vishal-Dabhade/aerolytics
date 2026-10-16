AERO.chrome("/");
AERO.chartDefaults();
AERO.heroEngine(document.getElementById("heroEngine"));

AERO.config().then((cfg) => AERO.engineSection(document.getElementById("section-svg"), { meta: cfg.sensor_meta.sensors })).catch(() => AERO.engineSection(document.getElementById("section-svg"), {}));

AERO.api("/api/dataset/summary").then((s) => {
  document.querySelectorAll("[data-k]").forEach((e) => (e.textContent = AERO.n(s[e.dataset.k])));
  document.getElementById("c1text").textContent = `Each of the ${s.train_engines} training engines is simulated from healthy to failure, lasting between ${s.train_life.min} and ${s.train_life.max} cycles. Fourteen of its 21 sensors change as it wears, and they sit at specific points along the gas path.`;
}).catch(() => {});

AERO.api("/api/results").then((r) => {
  const rows = [...r.test].sort((a, b) => a.test_RMSE - b.test_RMSE), best = rows[0];
  document.getElementById("c2text").textContent = `Linear Regression, Random Forest and XGBoost were trained on the same prepared data and scored on 100 engines they had never seen. ${best.model} has the lowest error, ${AERO.n(best.test_RMSE, 2)} cycles RMSE.`;
  new Chart(document.getElementById("c2chart"), {
    type: "bar",
    data: { labels: rows.map((x) => x.model), datasets: [{ data: rows.map((x) => x.test_RMSE), backgroundColor: rows.map((x) => AERO.MODEL_COLOR[x.model]), borderRadius: 2, barThickness: 26 }] },
    options: { indexAxis: "y", layout: { padding: { right: 48 } }, scales: { x: AERO.axis("RMSE (cycles)", { beginAtZero: true }), y: { grid: { display: false }, border: { color: "#263146" }, ticks: { color: "#ece9e1", font: { size: 13 } } } }, plugins: { tooltip: { callbacks: { label: (c) => ` ${AERO.n(c.parsed.x, 2)} cycles` } } } },
    plugins: [AERO.valueLabels((v) => AERO.n(v, 2), true)],
  });
}).catch((e) => AERO.state(document.getElementById("c2box"), "error", "The results could not be loaded", e.message));

(async function demo() {
  const host = document.getElementById("demo");
  try {
    const [cfg, ex] = await Promise.all([AERO.config(), AERO.api("/api/examples")]);
    const e = ex.find((x) => x.id === "critical") || ex[0];
    const r = await AERO.api("/api/predict", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ inputs: e.inputs }) });
    host.innerHTML = `<div class="panel-h"><h3>Test engine ${e.unit}, last recorded cycle</h3><span class="muted small">True remaining life: <strong class="num" style="color:var(--ink)">${e.true_rul}</strong> cycles</span></div><div id="demoBars"></div>
      <p class="chart-note">The three models disagree by a few cycles, which is normal. Treat the range as the estimate.</p>`;
    AERO.predBars(host.querySelector("#demoBars"), r.predictions, cfg);
  } catch (err) { AERO.state(host, "error", "The prediction service did not respond", err.message, demo); }
})();
