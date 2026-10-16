AERO.chrome("/models");
AERO.chartDefaults();
const $ = (s, r = document) => r.querySelector(s);
const M = AERO.MODELS;

function tbl(cols, rows, hlIdx) {
  return `<div class="tbl-text"><table><thead><tr>${cols.map((c, i) => `<th scope="col" class="${i ? "n" : ""}">${c}</th>`).join("")}</tr></thead><tbody>${rows.map((r, ri) => `<tr class="${ri === hlIdx ? "hl" : ""}">${r.map((v, i) => `<td class="${i ? "n" : ""}">${v}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
}
const EXP_LABEL = { "baseline cap125 W5 nocycle": "Starting point (cap 125, 5-cycle average)", "cap=110": "Cap 110", "cap=130": "Cap 130", "cap=150": "Cap 150", "window=10": "10-cycle average", "window=15": "15-cycle average", "with cycle": "Add the cycle number" };

(async function () {
  let r;
  try { r = await AERO.api("/api/results"); }
  catch (e) { return AERO.state($("main"), "error", "The results could not be loaded", e.message, () => location.reload()); }
  const test = Object.fromEntries(r.test.map((t) => [t.model, t])), val = r.validation_rmse;
  const bestVal = M.reduce((a, b) => (val[a] < val[b] ? a : b)), bestTest = r.best_model;

  /* validation vs test */
  $("#vtPanels").innerHTML = `<div class="panel panel-pad"><div class="panel-h"><h3>Validation</h3><span class="muted small">5-fold cross-validation, training engines held out</span></div>
      ${tbl(["Model", "RMSE (cycles)"], M.map((m) => [m, AERO.n(val[m], 2)]), M.indexOf(bestVal))}
      <p class="chart-note">Scored against remaining life capped at ${r.cap}. Used to choose settings. Lower is better.</p></div>
    <div class="panel panel-pad" style="border-color:var(--ink-3)"><div class="panel-h"><h3>Official test</h3><span class="muted small">100 unseen engines, actual remaining life</span></div>
      ${tbl(["Model", "RMSE", "MAE", "R²"], M.map((m) => [m, AERO.n(test[m].test_RMSE, 2), AERO.n(test[m].test_MAE, 2), AERO.n(test[m].test_R2, 3)]), M.indexOf(bestTest))}
      <p class="chart-note">Run once, on each engine's last recorded cycle. ${bestTest} has the lowest error. Test error is higher than validation error, as expected.</p></div>`;

  /* workflow */
  const c = r.config;
  $("#steps").innerHTML = [
    ["Prepare the data", "Eight columns that never change were dropped. Sensors were scaled using the training data only. Each sensor gets a 3-cycle rolling average, and the cycle number is an input."],
    ["Cap the training target", `Remaining life above ${c.cap} cycles is set to ${c.cap} for training. The test is still scored against the actual values.`],
    ["Compare baselines", "All three models were trained with default settings and checked with 5-fold cross-validation, always holding out whole engines."],
    ["Change one thing at a time", "Cap value, rolling window and the cycle number were each tested on their own against the starting point."],
    ["Tune the tree models", "Random Forest and XGBoost tried several depths and learning settings. The best validation score for each was kept."],
    ["Open the test set once", "The chosen setup was retrained on all 100 training engines and scored on the 100 test engines. No choice was changed afterwards."],
  ].map(([h, p]) => `<li><div><h3>${h}</h3><p>${p}</p></div></li>`).join("");

  /* profiles */
  const rf = c.random_forest, xg = c.xgboost;
  const prof = (m, what, why, params) => `<div class="panel panel-pad"><div class="panel-h" style="margin-bottom:10px"><h3 style="display:flex;align-items:center;gap:10px"><i style="width:12px;height:12px;background:${AERO.MODEL_COLOR[m]};border-radius:2px;display:inline-block"></i>${m}</h3></div>
    <p class="muted small" style="margin:0 0 12px">${what}</p><p class="small" style="margin:0 0 14px">${why}</p><div class="num small muted" style="line-height:1.7">${params}</div>
    <p class="small" style="margin:16px 0 0;padding-top:12px;border-top:1px solid var(--line-soft)">Test RMSE <b class="num" style="color:var(--ink)">${AERO.n(test[m].test_RMSE, 2)}</b> ${m === bestTest ? '<span class="st-healthy small">(lowest)</span>' : ""}</p></div>`;
  $("#profiles").innerHTML =
    prof("Linear Regression", "A single weighted sum of the inputs.", "The baseline. It cannot bend, so it struggles when remaining life drops quickly near failure.", "No tuning settings.") +
    prof("Random Forest", "Many decision trees, each trained on a random sample, with their answers averaged.", "Handles curved relationships and is steady across folds. Best test score.", `trees ${rf.n_estimators}<br>max depth ${rf.max_depth}<br>min samples per leaf ${rf.min_samples_leaf}<br>max features ${rf.max_features}`) +
    prof("XGBoost", "Trees built one after another, each correcting the last one's errors.", "Close to Random Forest. Shallow trees and a low learning rate worked best.", `trees ${xg.n_estimators}<br>max depth ${xg.max_depth}<br>learning rate ${xg.learning_rate}<br>subsample ${xg.subsample}, columns ${xg.colsample_bytree}<br>min child weight ${xg.min_child_weight}`);

  /* experiments */
  const finalRow = r.ablation[0];
  const rows = [...r.experiments.map((e) => ({ label: EXP_LABEL[e.experiment] || e.experiment, v: e })), { label: "Final: 3-cycle average and cycle number", v: finalRow }];
  $("#exKey").innerHTML = AERO.modelKey();
  AERO.dotPlot($("#exChart"), rows.map((x) => AERO.wrap(x.label, 16)), Object.fromEntries(M.map((m) => [m, rows.map((x) => x.v[m])])), "Cross-validated RMSE (cycles)", { y: { min: 14, max: 24 } });
  $("#exTbl").innerHTML = tbl(["Experiment", ...M], rows.map((x) => [x.label, ...M.map((m) => AERO.n(x.v[m], 2))]), rows.length - 1);

  /* tuning */
  const tune = (name, el) => { const t = r.tuning.filter((x) => x.model === name).sort((a, b) => a.cv_RMSE - b.cv_RMSE); $(el).innerHTML = tbl(["Settings", "CV RMSE"], t.map((x) => [x.params.replace(/,/g, ", ").replace(/=/g, " "), AERO.n(x.cv_RMSE, 2)]), 0); };
  tune("Random Forest", "#tuneRF"); tune("XGBoost", "#tuneXG");

  /* importance */
  const imp = [...r.importance].sort((a, b) => b.avg - a.avg), cfg = await AERO.config();
  const name = (f) => (f === "cycle" ? "cycle" : cfg.sensor_meta.sensors[f] ? `${cfg.sensor_meta.sensors[f].symbol} (${f.replace("_", " ")})` : f);
  $("#fiText").textContent = `${name(imp[0].feature)} and ${name(imp[1].feature)} carry more than half of the decisions in both tree models. The two operating settings are almost unused, which fits a dataset with a single operating condition.`;
  $("#fiKey").innerHTML = AERO.keyHtml(["Random Forest", "XGBoost"].map((m) => [AERO.MODEL_COLOR[m], m, true]));
  new Chart($("#fiChart"), { type: "bar", data: { labels: imp.map((x) => name(x.feature)), datasets: ["Random Forest", "XGBoost"].map((m) => ({ label: m, data: imp.map((x) => x[m] * 100), backgroundColor: AERO.MODEL_COLOR[m], borderRadius: 1, barPercentage: .9, categoryPercentage: .8 })) },
    options: { indexAxis: "y", scales: { x: AERO.axis("Share of decisions (%)", { beginAtZero: true }), y: { grid: { display: false }, border: { color: "#263146" }, ticks: { color: "#ece9e1", autoSkip: false } } }, plugins: { tooltip: { callbacks: { label: (c) => ` ${c.dataset.label}: ${AERO.n(c.parsed.x, 1)}%` } } } } });
})();
