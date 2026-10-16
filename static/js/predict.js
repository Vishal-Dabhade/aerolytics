/* Prediction lab. All numbers come from POST /api/predict and /api/predict-csv (the Stage 6 bundle). */
AERO.chrome("/predict");
AERO.chartDefaults();
const $ = (s, r = document) => r.querySelector(s);
const resultEl = $("#result");

let CFG, EXAMPLES = [];
const vals = {}, defaults = {}, els = {};
let mode = "manual", model = "Random Forest", loadedExample = null;
let last = { manual: null, csv: null };     // last payload shown for each tab
let csv = null;                              // { rows, summary }
let seq = 0, timer = null, csvChart = null;

const decimals = (step) => (step >= 1 ? 0 : String(step).split(".")[1].length);
const fmtIn = (v, step) => (Number.isFinite(v) ? v.toFixed(decimals(step)) : "");
const labelFor = (spec) => {
  const m = CFG.sensor_meta;
  if (spec.name === "cycle") return ["Cycle", "Flight cycles completed", ""];
  if (m.sensors[spec.name]) { const s = m.sensors[spec.name]; return [s.symbol, s.name, s.unit]; }
  const t = m.settings[spec.name]; return [t.symbol, t.name, ""];
};

/* ---------------- controls ---------------- */
function buildControls() {
  const main = $("#ctl-main"), adv = $("#ctl-adv");
  CFG.inputs.forEach((spec) => {
    const [sym, nm, unit] = labelFor(spec), id = spec.name, dec = decimals(spec.step);
    const row = AERO.el("div", { class: "ctl", "data-name": id });
    const imp = spec.importance_pct;
    row.innerHTML = `<div class="ctl-h"><label for="n-${id}"><span class="sym">${AERO.esc(sym)}</span><span class="nm">${AERO.esc(nm)}</span></label>
      <span class="imp" title="Share of the Random Forest and XGBoost decisions that rely on this input">Model weight ${AERO.n(imp, 1)}%<i style="width:${Math.max(2, imp * 1.6)}px"></i></span></div>
      <div class="ctl-b"><input type="range" id="r-${id}" min="${spec.min}" max="${spec.max}" step="${spec.step}" aria-label="${AERO.esc(sym)} slider">
      <div class="numwrap"><input type="number" id="n-${id}" step="${spec.step}" inputmode="decimal" aria-describedby="w-${id}"><span class="u">${AERO.esc(unit)}</span></div></div>
      <div class="ctl-f"><span>${AERO.n(spec.min, dec)}</span><span class="warn" id="w-${id}" role="status"></span><span>${AERO.n(spec.max, dec)}</span></div>`;
    (spec.group === "main" ? main : adv).append(row);
    els[id] = { range: $(`#r-${id}`, row), num: $(`#n-${id}`, row), warn: $(`#w-${id}`, row), spec };
    defaults[id] = spec.default;
    els[id].range.addEventListener("input", () => setValue(id, parseFloat(els[id].range.value), "slider"));
    els[id].num.addEventListener("input", () => setValue(id, els[id].num.value === "" ? NaN : parseFloat(els[id].num.value), "num"));
    els[id].num.addEventListener("blur", () => { if (Number.isFinite(vals[id])) els[id].num.value = fmtIn(vals[id], spec.step).replace(/\.?0+$/, (m) => (spec.step >= 1 ? "" : m)); });
  });
  $("summary", $("#adv")).textContent = `Advanced inputs (${CFG.inputs.filter((s) => s.group !== "main").length})`;
}

function setValue(id, v, from) {
  const e = els[id], s = e.spec;
  vals[id] = v;
  if (from !== "slider") e.range.value = Math.min(Math.max(Number.isFinite(v) ? v : s.default, s.min), s.max);
  if (from !== "num") e.num.value = fmtIn(v, s.step);
  e.range.style.setProperty("--fill", ((Math.min(Math.max(e.range.value, s.min), s.max) - s.min) / (s.max - s.min)) * 100 + "%");
  const dec = decimals(s.step);
  let msg = "", cls = "", bad = false;
  if (!Number.isFinite(v)) { msg = "Enter a number"; cls = "bad"; bad = true; }
  else if (id === "cycle" && (v < 1 || !Number.isInteger(v))) { msg = "Use a whole number of 1 or more"; cls = "bad"; bad = true; }
  else if (v < s.min || v > s.max) msg = `Outside the training range ${AERO.n(s.min, dec)} to ${AERO.n(s.max, dec)}`;
  e.warn.textContent = msg; e.warn.className = "warn " + cls; e.num.classList.toggle("invalid", bad || !!msg);
  if (loadedExample) { loadedExample = null; }
  schedule();
}
function setAll(map, example) {
  Object.keys(els).forEach((id) => setValue(id, map[id] != null ? map[id] : defaults[id], "all"));
  loadedExample = example || null;
  predictManual();
}

/* ---------------- predict (manual) ---------------- */
function schedule() { clearTimeout(timer); timer = setTimeout(predictManual, 260); }
function invalidFields() { return Object.keys(els).filter((id) => !Number.isFinite(vals[id]) || (id === "cycle" && (vals[id] < 1 || !Number.isInteger(vals[id])))); }
async function predictManual() {
  clearTimeout(timer);
  const bad = invalidFields();
  if (bad.length) { if (mode === "manual") AERO.state(resultEl, "error", "Check the highlighted inputs", "Every field needs a valid number before the models can run."); last.manual = null; return; }
  const my = ++seq; resultEl.classList.add("busy");
  try {
    const inputs = {}; Object.keys(els).forEach((id) => (inputs[id] = vals[id]));
    const r = await AERO.api("/api/predict", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ inputs }) });
    if (my !== seq) return;
    last.manual = { ...r, title: loadedExample ? `Test engine ${loadedExample.unit}, last recorded cycle` : "Your readings", truth: loadedExample ? loadedExample.true_rul : null, kind: "manual" };
    if (mode === "manual") render(last.manual);
  } catch (e) {
    if (my === seq && mode === "manual") AERO.state(resultEl, "error", "The prediction did not run", e.message, predictManual);
  } finally { if (my === seq) resultEl.classList.remove("busy"); }
}

/* ---------------- result panel ---------------- */
function arc(cx, cy, r, a0, a1) { // angles in degrees, 180 = left, 0 = right, drawn over the top
  const p = (a) => [cx + r * Math.cos((a * Math.PI) / 180), cy - r * Math.sin((a * Math.PI) / 180)];
  const [x0, y0] = p(a0), [x1, y1] = p(a1);
  return `M ${x0.toFixed(2)} ${y0.toFixed(2)} A ${r} ${r} 0 ${a0 - a1 > 180 ? 1 : 0} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
}
function gaugeSvg(rul, status, atCap) {
  const cap = CFG.cap, t = CFG.status_thresholds, cx = 170, cy = 168, r = 134, col = AERO.STATUS_COLOR[status];
  const frac = Math.min(rul, cap) / cap, d = arc(cx, cy, r, 180, 0);
  const tick = (v, label) => { const a = 180 - (v / cap) * 180, rad = (a * Math.PI) / 180, c = Math.cos(rad), s = Math.sin(rad);
    return `<line x1="${cx + (r - 14) * c}" y1="${cy - (r - 14) * s}" x2="${cx + (r + 8) * c}" y2="${cy - (r + 8) * s}" stroke="#090d16" stroke-width="3"/><line x1="${cx + (r - 14) * c}" y1="${cy - (r - 14) * s}" x2="${cx + (r + 8) * c}" y2="${cy - (r + 8) * s}" stroke="#8a92a3" stroke-width="1"/><text class="ticklab" x="${cx + (r + 22) * c}" y="${cy - (r + 22) * s + 4}" text-anchor="middle">${label}</text>`; };
  return `<svg viewBox="0 0 340 206" role="img" aria-label="Gauge: ${atCap ? cap + " or more" : AERO.n(rul, 1)} cycles remaining, ${AERO.STATUS_LABEL[status]}">
    <path d="${d}" fill="none" stroke="#263146" stroke-width="18" pathLength="100"/>
    <path class="arc-fill" d="${d}" fill="none" stroke="${col}" stroke-width="18" pathLength="100" stroke-dasharray="100" stroke-dashoffset="${(100 - frac * 100).toFixed(2)}"/>
    ${tick(t.critical_below, t.critical_below)}${tick(t.warning_below, t.warning_below)}
    <text class="ticklab" x="${cx - r}" y="${cy + 22}" text-anchor="middle">0</text><text class="ticklab" x="${cx + r}" y="${cy + 22}" text-anchor="middle">${cap}+</text>
    <text class="big" x="${cx}" y="${cy - 28}" text-anchor="middle">${atCap ? cap + "+" : AERO.n(rul, 0)}</text><text class="sub" x="${cx}" y="${cy - 4}" text-anchor="middle">cycles remaining</text></svg>`;
}
function render(p) {
  if (!p) return;
  const m = p.predictions[model], sel = AERO.MODELS.map((n) => `<button type="button" data-m="${n}" aria-pressed="${n === model}">${n === "Linear Regression" ? "Linear" : n === "Random Forest" ? "Random Forest" : "XGBoost"}</button>`).join("");
  const rf = (CFG.test_metrics || {})["Random Forest"];
  let truth = "";
  if (p.truth != null) {
    const diff = m.rul - p.truth, word = Math.abs(diff) < 0.5 ? "on target" : diff > 0 ? `${AERO.n(Math.abs(diff), 1)} cycles too optimistic` : `${AERO.n(Math.abs(diff), 1)} cycles too cautious`;
    truth = `<div class="truth"><b>Actual remaining life: ${AERO.n(p.truth)} cycles.</b> ${model} is ${word}. A single reading uses its own value as the rolling average, so this can differ a little from the test results.</div>`;
  }
  const warns = p.warnings && p.warnings.length ? `<div class="warnlist" role="status"><b>Check these inputs</b><ul>${p.warnings.map((w) => `<li>${AERO.esc(w)}</li>`).join("")}</ul></div>` : "";
  const approx = !p.exact_rolling_mean ? `<p class="fine">${p.kind === "csv" ? "This engine has fewer than three rows, so the rolling average is approximate. " : "This is a single reading, so the three-cycle rolling average is approximate. "}Upload three or more cycles for the exact calculation.</p>` : "";
  resultEl.innerHTML = `<div class="panel-h" style="margin-bottom:10px"><h3>${AERO.esc(p.title)}</h3></div>
    <div class="seg" role="group" aria-label="Model shown in the gauge" style="margin-bottom:10px">${sel}</div>
    <div class="gauge">${gaugeSvg(m.rul, m.status, m.at_cap)}</div>
    <div class="res-status">${AERO.badge(m.status)}</div>
    ${m.at_cap ? `<p class="fine" style="text-align:center;margin-top:8px">The models are trained to tell apart the last ${CFG.cap} cycles of life, so anything above that is shown as ${CFG.cap}+.</p>` : ""}
    <h4 style="margin:26px 0 6px;font:600 .95rem var(--body);color:var(--ink-2)">All three models</h4>
    <div id="cmp"></div>${truth}${warns}${approx}
    <p class="fine">This is an estimate, not a guaranteed failure date. On 100 unseen test engines the best model, Random Forest, is off by ${rf ? AERO.n(rf.test_MAE, 1) : "about 14"} cycles on average, and some engines by 40 or more.</p>`;
  AERO.predBars($("#cmp", resultEl), p.predictions, CFG);
  resultEl.querySelectorAll("[data-m]").forEach((b) => b.addEventListener("click", () => { model = b.dataset.m; render(p); }));
  const f = $("#float"); f.textContent = `Estimate: ${m.at_cap ? CFG.cap + "+" : AERO.n(m.rul, 0)} cycles, ${AERO.STATUS_LABEL[m.status]}`;
}

/* ---------------- tabs ---------------- */
function setMode(m) {
  mode = m;
  $("#pane-manual").hidden = m !== "manual"; $("#pane-csv").hidden = m !== "csv";
  $("#tab-manual").setAttribute("aria-pressed", m === "manual"); $("#tab-csv").setAttribute("aria-pressed", m === "csv");
  if (last[m]) render(last[m]);
  else if (m === "csv") AERO.state(resultEl, "empty", "No engine uploaded yet", "Upload a CSV to see the estimate for its last recorded cycle.");
  else predictManual();
}
$("#tab-manual").addEventListener("click", () => setMode("manual"));
$("#tab-csv").addEventListener("click", () => setMode("csv"));

/* ---------------- CSV ---------------- */
const csvStatus = $("#csvStatus");
async function handleFile(file) {
  if (!file) return;
  if (!/\.csv$/i.test(file.name) && !/csv|text/.test(file.type)) return AERO.state(csvStatus, "error", "That is not a CSV file", "Choose a file ending in .csv, or download the sample to see the format.");
  if (file.size > 5 * 1024 * 1024) return AERO.state(csvStatus, "error", "The file is larger than 5 MB", "Upload one engine at a time or trim the rows.");
  csvStatus.innerHTML = `<div class="state"><strong>Reading ${AERO.esc(file.name)}</strong>Running the three models on every row.</div>`;
  $("#csvOut").hidden = true;
  try {
    const fd = new FormData(); fd.append("file", file);
    csv = await AERO.api("/api/predict-csv", { method: "POST", body: fd });
    csv.name = file.name;
    csvStatus.innerHTML = `<p class="small muted" style="margin:0">${AERO.esc(file.name)}: ${AERO.n(csv.rows.length)} rows, ${csv.summary.length} engine${csv.summary.length > 1 ? "s" : ""}.</p>`;
    const sel = $("#unitSel"); sel.innerHTML = csv.summary.map((s) => `<option value="${s.unit}">Engine ${s.unit}</option>`).join("");
    $("#unitWrap").hidden = csv.summary.length < 2; $("#csvOut").hidden = false;
    showUnit(csv.summary[0].unit);
  } catch (e) { csv = null; last.csv = null; AERO.state(csvStatus, "error", "This file could not be used", e.message); if (mode === "csv") AERO.state(resultEl, "empty", "No engine uploaded yet", "Upload a CSV to see the estimate for its last recorded cycle."); }
}
function showUnit(unit) {
  const rows = csv.rows.filter((r) => r.unit === unit), s = csv.summary.find((x) => x.unit === unit), lastRow = rows[rows.length - 1];
  last.csv = { ...s, title: `Engine ${unit}, cycle ${lastRow.cycle}`, truth: null, kind: "csv" };
  if (mode === "csv") render(last.csv);
  drawChart(rows);
}
function drawChart(rows) {
  const cap = CFG.cap, t = CFG.status_thresholds;
  $("#csvKey").innerHTML = AERO.keyHtml(AERO.MODELS.map((m) => [AERO.MODEL_COLOR[m], m]));
  if (csvChart) csvChart.destroy();
  const guides = { id: "guides", afterDatasetsDraw(c) { const { ctx, chartArea: a, scales: { y } } = c; ctx.save(); ctx.setLineDash([5, 5]); ctx.lineWidth = 1; ctx.font = '400 11px "IBM Plex Sans"'; ctx.fillStyle = "#8a92a3";
    [[t.critical_below, "Critical below " + t.critical_below, AERO.STATUS_COLOR.critical], [t.warning_below, "Warning below " + t.warning_below, AERO.STATUS_COLOR.warning]].forEach(([v, l, col]) => { const py = y.getPixelForValue(v); ctx.strokeStyle = col; ctx.beginPath(); ctx.moveTo(a.left, py); ctx.lineTo(a.right, py); ctx.stroke(); ctx.fillText(l, a.left + 6, py - 5); }); ctx.restore(); } };
  const ends = { id: "ends", afterDatasetsDraw(c) { const { ctx } = c; ctx.save(); ctx.font = '500 12px "IBM Plex Sans"'; ctx.fillStyle = "#ece9e1"; ctx.textBaseline = "middle";
    const pts = c.data.datasets.map((ds, i) => { const pt = c.getDatasetMeta(i).data.at(-1); return pt ? { x: pt.x, y: pt.y, t: ds.label === "Linear Regression" ? "Linear" : ds.label } : null; }).filter(Boolean).sort((a, b) => a.y - b.y);
    for (let i = 1; i < pts.length; i++) if (pts[i].y - pts[i - 1].y < 15) pts[i].y = pts[i - 1].y + 15;   // keep neighbouring labels apart
    pts.forEach((p) => ctx.fillText(p.t, p.x + 8, p.y)); ctx.restore(); } };
  csvChart = new Chart($("#csvChart"), {
    type: "line",
    data: { datasets: AERO.MODELS.map((m) => ({ label: m, data: rows.map((r) => ({ x: r.cycle, y: r["pred_" + m] })), borderColor: AERO.MODEL_COLOR[m], backgroundColor: AERO.MODEL_COLOR[m], borderWidth: 2, pointHoverRadius: 5 })) },
    options: { parsing: false, normalized: true, interaction: { mode: "index", intersect: false }, layout: { padding: { right: 70 } },
      scales: { x: AERO.axis("Cycle", { type: "linear" }), y: AERO.axis("Predicted RUL (cycles)", { min: 0, max: cap + 5 }) },
      plugins: { tooltip: { callbacks: { title: (i) => `Cycle ${i[0].parsed.x}`, label: (c) => ` ${c.dataset.label}: ${AERO.n(c.parsed.y, 1)}` } } } },
    plugins: [guides, ends],
  });
}
$("#file").addEventListener("change", (e) => handleFile(e.target.files[0]));
const drop = $("#drop");
["dragenter", "dragover"].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add("over"); }));
["dragleave", "drop"].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove("over"); }));
drop.addEventListener("drop", (e) => handleFile(e.dataTransfer.files[0]));
$("#unitSel").addEventListener("change", (e) => showUnit(parseInt(e.target.value, 10)));
$("#dl").addEventListener("click", () => {
  if (!csv) return;
  const head = ["unit", "cycle", ...AERO.MODELS.map((m) => "pred_" + m.replace(/ /g, "_"))];
  const text = [head.join(","), ...csv.rows.map((r) => [r.unit, r.cycle, ...AERO.MODELS.map((m) => r["pred_" + m])].join(","))].join("\n");
  const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([text], { type: "text/csv" })); a.download = "aerolytics_predictions.csv"; a.click(); URL.revokeObjectURL(a.href);
});

/* ---------------- floating estimate button on small screens ---------------- */
(function () {
  const f = $("#float"); f.addEventListener("click", () => resultEl.scrollIntoView({ behavior: "smooth", block: "start" }));
  new IntersectionObserver(([e]) => f.classList.toggle("on", !e.isIntersecting && mode === "manual" && !!last.manual)).observe(resultEl);
})();

/* ---------------- init ---------------- */
(async function init() {
  AERO.state(resultEl, "empty", "Loading the models", "One moment.");
  try {
    [CFG, EXAMPLES] = await Promise.all([AERO.config(), AERO.api("/api/examples")]);
  } catch (e) { return AERO.state(resultEl, "error", "The prediction service did not respond", e.message, () => location.reload()); }
  buildControls();
  $("#reqCols").innerHTML = CFG.csv_required_columns.map((c) => `<li>${c}</li>`).join("");
  $("#exSel").innerHTML = EXAMPLES.map((e) => `<option value="${e.id}">${AERO.esc(e.label)} (test engine ${e.unit})</option>`).join("");
  const load = (id) => { const e = EXAMPLES.find((x) => x.id === id); if (e) setAll(e.inputs, e); };
  $("#exLoad").addEventListener("click", () => load($("#exSel").value));
  $("#reset").addEventListener("click", () => setAll({}, null));
  const q = new URLSearchParams(location.search).get("example");
  if (q && EXAMPLES.some((e) => e.id === q)) { $("#exSel").value = q; load(q); } else setAll({}, null);
})();
