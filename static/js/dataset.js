/* Dataset explorer. Every chart reads the real FD001 files through /api/dataset/*. */
AERO.chrome("/dataset");
AERO.chartDefaults();
const $ = (s, r = document) => r.querySelector(s);
const C1 = "#1b9fb4", C2 = "#6ba22a";                      // validated data tints (cyan, lime)
let CFG, SUM, CORR, SET;
let split = "train", unit = 1, sensor = new URLSearchParams(location.search).get("sensor") || "sensor_4", smooth = false, eng = null;
let rulChart, senChart;

const meta = (id) => (CFG.sensor_meta.sensors[id] || CFG.sensor_meta.settings[id] || { symbol: id, name: id, unit: "" });
const sNum = (id) => parseInt(id.split("_")[1], 10);
const corrWithRul = (id) => { const i = CORR.labels.indexOf(id), j = CORR.labels.indexOf("RUL"); return CORR.matrix[i][j]; };
const sg = (v, d = 2) => (v > 0 ? "+" : v < 0 ? "-" : "") + Math.abs(v).toFixed(d);
const retry = (el, fn) => (e) => AERO.state(el, "error", "This section could not be loaded", e.message, fn);

/* ---------------- overview ---------------- */
function renderOverview() {
  $("#stats").innerHTML = [["train_engines", "training engines, each run to failure"], ["test_engines", "test engines, stopped before failure"], ["train_rows", "training rows of sensor readings"], ["test_rows", "test rows of sensor readings"]]
    .map(([k, l], i) => `<div ${i === 0 ? 'style="padding-left:24px"' : ""}><span class="stat-n">${AERO.n(SUM[k])}</span><span class="stat-l">${l}</span></div>`).join("");
  const top = CORR.labels.filter((l) => l !== "RUL").map((l) => [l, corrWithRul(l)]).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1])).slice(0, 3);
  const f = [
    `<strong>${SUM.constant_columns.length} of ${SUM.raw_columns} columns never change</strong> (setting_3 and seven sensors), so the models drop them. ${SUM.useful_sensors} sensors stay informative.`,
    SUM.missing_values === 0 && SUM.duplicate_rows === 0 ? `<strong>No missing values and no duplicate rows</strong> in either file.` : `${SUM.missing_values} missing values and ${SUM.duplicate_rows} duplicate rows were found.`,
    `<strong>Training engines last ${SUM.train_life.min} to ${SUM.train_life.max} cycles</strong>, ${AERO.n(SUM.train_life.mean, 0)} on average. Test engines stop after ${SUM.test_length.min} to ${SUM.test_length.max} cycles, with ${SUM.test_true_rul.min} to ${SUM.test_true_rul.max} cycles actually left.`,
    `<strong>One operating condition.</strong> setting_3 is ${SET.setting_3_unique.join(", ")} in every row, and the other two settings barely vary and barely relate to remaining life.`,
    `<strong>The strongest signals</strong> against remaining life are ${top.map(([id, r]) => `${meta(id).symbol} (sensor ${sNum(id)}, ${sg(r)})`).join(", ")}.`,
  ];
  $("#finds").innerHTML = f.map((t) => `<li>${t}</li>`).join("");
  const h = SUM.life_histogram;
  new Chart($("#lifeChart"), { type: "bar",
    data: { labels: h.counts.map((_, i) => `${Math.round(h.edges[i])}-${Math.round(h.edges[i + 1])}`), datasets: [{ data: h.counts, backgroundColor: C1, borderRadius: 2, categoryPercentage: 1, barPercentage: .88 }] },
    options: { scales: { x: AERO.axis("Cycles until failure", { ticks: { color: "#8a92a3", maxRotation: 0, autoSkip: true, maxTicksLimit: 7 } }), y: AERO.axis("Engines", { beginAtZero: true, ticks: { precision: 0, color: "#8a92a3" } }) },
      plugins: { tooltip: { callbacks: { title: (i) => `${i[0].label} cycles`, label: (c) => ` ${c.parsed.y} engines` } } } } });
  const kept = CORR.labels.filter((l) => l !== "RUL").sort((a, b) => sNum(a) - sNum(b));
  const chip = (t, dim) => `<span style="display:inline-block;margin:0 6px 6px 0;padding:4px 10px;border:1px solid ${dim ? "var(--line)" : "var(--ink-3)"};border-radius:2px;font-size:.85rem;color:${dim ? "var(--ink-3)" : "var(--ink)"}">${t}</span>`;
  $("#colMap").innerHTML = `<p class="small muted" style="margin:0 0 8px">Used by the models (${kept.length} sensors, plus cycle):</p><div>${kept.map((id) => chip(`${meta(id).symbol} <span class="faint">s${sNum(id)}</span>`)).join("")}${chip("setting_1")}${chip("setting_2")}</div>
    <p class="small muted" style="margin:16px 0 8px">Dropped because they never change:</p><div>${SUM.constant_columns.map((c) => chip(c.replace("sensor_", "sensor "), true)).join("")}</div>`;
}

/* ---------------- engine explorer ---------------- */
async function loadEngineList(keep) {
  const list = await AERO.api(`/api/dataset/engines?split=${split}`);
  $("#engSel").innerHTML = list.map((e) => `<option value="${e.unit}">${AERO.esc(e.label)}</option>`).join("");
  unit = keep && list.some((e) => e.unit === unit) ? unit : list[0].unit;
  $("#engSel").value = unit;
}
async function loadEngine() {
  $("#engErr").innerHTML = "";
  try { eng = await AERO.api(`/api/dataset/engine/${split}/${unit}`); drawEngine(); }
  catch (e) { AERO.state($("#engErr"), "error", "This engine could not be loaded", e.message, loadEngine); }
}
const rolling = (a, w = 3) => a.map((_, i) => { const s = a.slice(Math.max(0, i - w + 1), i + 1); return s.reduce((x, y) => x + y, 0) / s.length; });
function drawEngine() {
  const cyc = eng.cycle, xy = (ys) => cyc.map((c, i) => ({ x: c, y: ys[i] }));
  /* RUL chart */
  const ds = [{ label: split === "train" ? "Remaining life (actual)" : "Remaining life (implied)", data: xy(eng.rul), borderColor: C1, backgroundColor: C1 }];
  if (split === "train") ds.push({ label: `Training target, capped at ${CFG.cap}`, data: xy(eng.rul.map((v) => Math.min(v, CFG.cap))), borderColor: C2, backgroundColor: C2, borderDash: [7, 5] });
  else ds.push({ label: "True value at the last recorded cycle", data: [{ x: cyc.at(-1), y: eng.rul.at(-1) }], borderColor: C2, backgroundColor: C2, pointRadius: 6, showLine: false });
  $("#rulKey").innerHTML = AERO.keyHtml(ds.map((d, i) => [d.borderColor, d.label, i === 1 && split === "test"]));
  $("#rulNote").textContent = split === "train" ? `Engine ${unit} fails after ${cyc.at(-1)} cycles. The capped line is what the models are trained on.` : `Engine ${unit} was recorded for ${cyc.at(-1)} cycles and still has ${eng.rul.at(-1)} left. Earlier values are counted back from that, one per cycle.`;
  rulChart && rulChart.destroy();
  rulChart = new Chart($("#rulChart"), { type: "line", data: { datasets: ds }, options: { parsing: false, normalized: true, interaction: { mode: "nearest", axis: "x", intersect: false },
    scales: { x: AERO.axis("Cycle", { type: "linear", min: 0 }), y: AERO.axis("Remaining useful life (cycles)", { beginAtZero: true }) },
    plugins: { tooltip: { callbacks: { title: (i) => `Cycle ${i[0].parsed.x}`, label: (c) => ` ${c.dataset.label}: ${c.parsed.y}` } } } } });
  /* sensor chart */
  const m = meta(sensor), raw = eng[sensor], avg = rolling(raw);
  $("#senTitle").textContent = `${m.symbol}, ${m.name}`;
  const sd = [{ label: "Raw readings", data: xy(raw), borderColor: smooth ? "rgba(27,159,180,.45)" : C1, backgroundColor: C1, borderWidth: smooth ? 1.2 : 2 }];
  if (smooth) sd.push({ label: "3-cycle average", data: xy(avg), borderColor: C2, backgroundColor: C2 });
  $("#senKey").innerHTML = AERO.keyHtml(sd.map((d, i) => [i === 0 ? C1 : d.borderColor, d.label]));
  senChart && senChart.destroy();
  senChart = new Chart($("#senChart"), { type: "line", data: { datasets: sd }, options: { parsing: false, normalized: true, interaction: { mode: "nearest", axis: "x", intersect: false },
    scales: { x: AERO.axis("Cycle", { type: "linear", min: 0 }), y: AERO.axis(m.unit ? `${m.symbol} (${m.unit})` : m.symbol, { grace: "6%" }) },
    plugins: { tooltip: { callbacks: { title: (i) => `Cycle ${i[0].parsed.x}`, label: (c) => ` ${c.dataset.label}: ${AERO.n(c.parsed.y, 2)}` } } } } });
  const inp = CFG.inputs.find((i) => i.name === sensor), r = corrWithRul(sensor);
  $("#senCard").innerHTML = `<dt>Dataset column</dt><dd>${sensor}</dd><dt>Measures</dt><dd>${AERO.esc(m.name)}${m.unit ? ` (${AERO.esc(m.unit)})` : ""}</dd><dt>Link to remaining life</dt><dd>${sg(r)} ${Math.abs(r) >= .6 ? "(strong)" : Math.abs(r) >= .3 ? "(moderate)" : "(weak)"}, across all training rows</dd><dt>Weight in the models</dt><dd>${inp ? AERO.n(inp.importance_pct, 1) + "%" : "Not used"}</dd>`;
}
function bindExplorer() {
  const pressed = (a, b, on) => { a.setAttribute("aria-pressed", on); b.setAttribute("aria-pressed", !on); };
  $("#sTrain").onclick = async () => { split = "train"; pressed($("#sTrain"), $("#sTest"), true); await loadEngineList(true); loadEngine(); };
  $("#sTest").onclick = async () => { split = "test"; pressed($("#sTest"), $("#sTrain"), true); await loadEngineList(true); loadEngine(); };
  $("#engSel").onchange = (e) => { unit = parseInt(e.target.value, 10); loadEngine(); };
  $("#senSel").onchange = (e) => { sensor = e.target.value; if (eng) drawEngine(); };
  $("#avgOff").onclick = () => { smooth = false; pressed($("#avgOff"), $("#avgOn"), true); eng && drawEngine(); };
  $("#avgOn").onclick = () => { smooth = true; pressed($("#avgOn"), $("#avgOff"), true); eng && drawEngine(); };
  const ids = CORR.labels.filter((l) => l !== "RUL").sort((a, b) => sNum(a) - sNum(b));
  if (!ids.includes(sensor)) sensor = "sensor_4";
  $("#senSel").innerHTML = ids.map((id) => `<option value="${id}">${meta(id).symbol} (sensor ${sNum(id)}): ${AERO.esc(meta(id).name)}</option>`).join("");
  $("#senSel").value = sensor;
}

/* ---------------- operating conditions ---------------- */
function renderSettings() {
  const s1 = SET.setting_1, s2 = SET.setting_2;
  $("#opText").textContent = `setting_3 is ${SET.setting_3_unique.join(", ")} in every row. setting_1 and setting_2 vary by tiny amounts and show almost no link to remaining life (correlations ${sg(s1.corr_with_rul, 3)} and ${sg(s2.corr_with_rul, 3)}). That is what a single operating condition looks like.`;
  $("#s1stat").textContent = `mean ${s1.mean.toExponential(1)}, std ${s1.std.toFixed(4)}`; $("#s2stat").textContent = `mean ${s2.mean.toExponential(1)}, std ${s2.std.toFixed(4)}`;
  const hist = (id, s, dec) => new Chart($(id), { type: "bar", data: { labels: s.hist.counts.map((_, i) => ((s.hist.edges[i] + s.hist.edges[i + 1]) / 2).toFixed(dec)), datasets: [{ data: s.hist.counts, backgroundColor: C1, borderRadius: 1, categoryPercentage: 1, barPercentage: .9 }] },
    options: { scales: { x: AERO.axis("Value", { ticks: { color: "#8a92a3", maxTicksLimit: 5, maxRotation: 0 } }), y: AERO.axis("Rows", { beginAtZero: true }) }, plugins: { tooltip: { callbacks: { title: (i) => `Around ${i[0].label}`, label: (c) => ` ${AERO.n(c.parsed.y)} rows` } } } } });
  hist("#s1", s1, 4); hist("#s2", s2, 5);
  new Chart($("#s12"), { type: "scatter", data: { datasets: [{ data: SET.scatter.x.map((x, i) => ({ x, y: SET.scatter.y[i] })), backgroundColor: "rgba(27,159,180,.5)", pointRadius: 2.2 }] },
    options: { scales: { x: AERO.axis("setting_1"), y: AERO.axis("setting_2") }, plugins: { tooltip: { callbacks: { label: (c) => ` setting_1 ${c.parsed.x}, setting_2 ${c.parsed.y}` } } } } });
}

/* ---------------- correlation heatmap ---------------- */
function renderHeat() {
  const ids = CORR.labels.filter((l) => l !== "RUL").sort((a, b) => corrWithRul(b) - corrWithRul(a)), order = ["RUL", ...ids], N = order.length;
  const val = (a, b) => CORR.matrix[CORR.labels.indexOf(a)][CORR.labels.indexOf(b)];
  const mix = (c1, c2, t) => c1.map((v, i) => Math.round(v + (c2[i] - v) * t));
  const MID = [42, 48, 64], NEG = [57, 135, 229], POS = [230, 103, 103];
  const col = (r) => `rgb(${(r >= 0 ? mix(MID, POS, r) : mix(MID, NEG, -r)).join(",")})`;
  const lab = (id) => (id === "RUL" ? "RUL" : `${meta(id).symbol} s${sNum(id)}`);
  const cs = 50, L = 92, T = 92, W = L + N * cs + 56, H = T + N * cs;
  let g = "";
  order.forEach((a, i) => { g += `<text x="${L - 10}" y="${T + i * cs + cs / 2 + 4}" text-anchor="end" font-size="13" fill="${a === "RUL" ? "#c5f03a" : "#ece9e1"}" font-weight="${a === "RUL" ? 600 : 400}">${lab(a)}</text>`;
    g += `<text transform="translate(${L + i * cs + cs / 2 + 4},${T - 10}) rotate(-55)" font-size="13" fill="${a === "RUL" ? "#c5f03a" : "#ece9e1"}" font-weight="${a === "RUL" ? 600 : 400}">${lab(a)}</text>`; });
  order.forEach((a, i) => order.forEach((b, j) => { const r = val(a, b);
    g += `<g class="cell" data-a="${a}" data-b="${b}" data-r="${r}"><rect x="${L + j * cs + 1}" y="${T + i * cs + 1}" width="${cs - 2}" height="${cs - 2}" fill="${col(r)}"/><text x="${L + j * cs + cs / 2}" y="${T + i * cs + cs / 2 + 4}" text-anchor="middle" font-size="11" fill="${Math.abs(r) > .45 ? "#fff" : "#aab0bd"}" style="font-family:var(--mono)">${r.toFixed(2)}</text></g>`; }));
  $("#heat").innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Correlation heatmap of the 14 informative sensors and remaining life. A table version follows.">${g}</svg>`;
  const tip = $("#tip");
  $("#heat").addEventListener("mousemove", (e) => { const c = e.target.closest(".cell"); if (!c) return tip.classList.remove("on");
    tip.innerHTML = `<b>${lab(c.dataset.a)}</b> and <b>${lab(c.dataset.b)}</b><br>correlation ${sg(parseFloat(c.dataset.r))}`; tip.style.left = Math.min(e.clientX + 14, innerWidth - 270) + "px"; tip.style.top = e.clientY + 14 + "px"; tip.classList.add("on"); });
  $("#heat").addEventListener("mouseleave", () => tip.classList.remove("on"));
  $("#heatTbl").innerHTML = `<table><thead><tr><th></th>${order.map((o) => `<th>${lab(o)}</th>`).join("")}</tr></thead><tbody>${order.map((a) => `<tr><td>${lab(a)}</td>${order.map((b) => `<td>${val(a, b).toFixed(2)}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
}

/* ---------------- raw table ---------------- */
const T = { split: "train", q: "", page: 1, ps: 25 };
let tTimer;
async function loadTable() {
  const host = $("#tbl"), pager = $("#pager");
  host.setAttribute("aria-busy", "true");
  if (T.q && !/^\d+$/.test(T.q)) { AERO.state(host, "empty", "Search by engine number", "Type a whole number such as 17, or clear the box to see every row."); pager.innerHTML = ""; host.removeAttribute("aria-busy"); return; }
  try {
    const d = await AERO.api(`/api/dataset/table?split=${T.split}&q=${encodeURIComponent(T.q)}&page=${T.page}&page_size=${T.ps}`);
    T.page = d.page;
    if (!d.total) { AERO.state(host, "empty", `No rows for engine ${T.q}`, `Engines are numbered 1 to ${SUM[T.split + "_engines"]} in the ${T.split === "train" ? "training" : "test"} set.`); pager.innerHTML = ""; return; }
    host.innerHTML = `<div class="tbl-wrap sticky2" tabindex="0" role="region" aria-label="Raw data table, scrolls sideways"><table><thead><tr>${d.columns.map((c) => `<th scope="col">${c}</th>`).join("")}</tr></thead><tbody>${d.rows.map((r) => `<tr>${r.map((v) => `<td>${v}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
    const from = (d.page - 1) * T.ps + 1, to = Math.min(d.page * T.ps, d.total);
    pager.innerHTML = `<span>Rows ${AERO.n(from)} to ${AERO.n(to)} of ${AERO.n(d.total)}</span><span style="display:flex;gap:8px;align-items:center"><button class="btn btn-ghost btn-sm" data-p="1" ${d.page === 1 ? "disabled" : ""}>First</button><button class="btn btn-ghost btn-sm" data-p="${d.page - 1}" ${d.page === 1 ? "disabled" : ""}>Previous</button><span class="small">Page ${AERO.n(d.page)} of ${AERO.n(d.pages)}</span><button class="btn btn-ghost btn-sm" data-p="${d.page + 1}" ${d.page === d.pages ? "disabled" : ""}>Next</button><button class="btn btn-ghost btn-sm" data-p="${d.pages}" ${d.page === d.pages ? "disabled" : ""}>Last</button></span>`;
    pager.querySelectorAll("[data-p]").forEach((b) => (b.onclick = () => { T.page = parseInt(b.dataset.p, 10); loadTable(); }));
  } catch (e) { AERO.state(host, "error", "The table could not be loaded", e.message, loadTable); pager.innerHTML = ""; }
  finally { host.removeAttribute("aria-busy"); }
}
function bindTable() {
  const pressed = (a, b) => { a.setAttribute("aria-pressed", true); b.setAttribute("aria-pressed", false); };
  $("#tTrain").onclick = () => { T.split = "train"; T.page = 1; pressed($("#tTrain"), $("#tTest")); loadTable(); };
  $("#tTest").onclick = () => { T.split = "test"; T.page = 1; pressed($("#tTest"), $("#tTrain")); loadTable(); };
  $("#ps").onchange = (e) => { T.ps = parseInt(e.target.value, 10); T.page = 1; loadTable(); };
  $("#q").oninput = (e) => { clearTimeout(tTimer); tTimer = setTimeout(() => { T.q = e.target.value.trim(); T.page = 1; loadTable(); }, 300); };
}

/* ---------------- init ---------------- */
(async function init() {
  try {
    [CFG, SUM, CORR, SET] = await Promise.all([AERO.config(), AERO.api("/api/dataset/summary"), AERO.api("/api/dataset/correlation"), AERO.api("/api/dataset/settings")]);
  } catch (e) { document.querySelector("main .section").innerHTML = ""; return AERO.state(document.querySelector("main .section"), "error", "The dataset service did not respond", e.message, () => location.reload()); }
  renderOverview(); renderSettings(); renderHeat(); bindExplorer(); bindTable(); loadTable();
  await loadEngineList(false); loadEngine();
  if (location.hash === "#explorer") setTimeout(() => document.getElementById("explorer").scrollIntoView(), 100);
})();
