/* AEROLYTICS shared helpers: page chrome, API access, status icons, chart defaults, engine illustrations. */
(function () {
  const A = (window.AERO = {});
  const NS = "http://www.w3.org/2000/svg";

  A.MODELS = ["Linear Regression", "Random Forest", "XGBoost"];
  A.MODEL_COLOR = { "Linear Regression": "#8a74e8", "Random Forest": "#6ba22a", "XGBoost": "#1b9fb4" };
  A.STATUS_COLOR = { healthy: "#4fd6a0", warning: "#ffb020", critical: "#ff5a4f" };
  A.STATUS_LABEL = { healthy: "Healthy", warning: "Warning", critical: "Critical" };

  /* ---------- small utilities ---------- */
  A.esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  A.n = (v, d = 0) => (v == null || Number.isNaN(v) ? "n/a" : Number(v).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d }));
  A.el = (tag, attrs = {}, html = "") => {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
    e.innerHTML = html;
    return e;
  };
  A.svg = (tag, attrs = {}) => {
    const e = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
    return e;
  };
  A.api = async (path, opts) => {
    let res;
    try {
      res = await fetch(path, opts);
    } catch (e) {
      throw new Error("Cannot reach the server. Check that the app is running, then try again.");
    }
    if (!res.ok) {
      let msg = `The server returned an error (${res.status}).`;
      try {
        const d = await res.json();
        if (typeof d.detail === "string") msg = d.detail;
        else if (Array.isArray(d.detail) && d.detail[0]) msg = d.detail.map((x) => x.msg).join(" ");
      } catch (_) {}
      throw new Error(msg);
    }
    return res.json();
  };
  let cfgP;
  A.config = () => (cfgP = cfgP || A.api("/api/config"));
  A.statusOf = (rul, cfg) => {
    const t = (cfg && cfg.status_thresholds) || { critical_below: 30, warning_below: 60 };
    return rul < t.critical_below ? "critical" : rul < t.warning_below ? "warning" : "healthy";
  };
  A.state = (el, kind, title, body, retry) => {
    el.innerHTML = `<div class="state ${kind === "error" ? "err" : ""}" role="${kind === "error" ? "alert" : "status"}"><strong>${A.esc(title)}</strong>${A.esc(body || "")}${retry ? '<div style="margin-top:14px"><button class="btn btn-ghost btn-sm" type="button" data-retry>Try again</button></div>' : ""}</div>`;
    if (retry) el.querySelector("[data-retry]").addEventListener("click", retry);
  };
  A.statusIcon = (s) =>
    ({
      healthy: '<svg viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="8" cy="8" r="6.5"/><path d="M5 8.2l2.1 2.1L11 6.2"/></svg>',
      warning: '<svg viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M8 1.8L15 14H1z" stroke-linejoin="round"/><path d="M8 6.5v3.4M8 11.8v.4"/></svg>',
      critical: '<svg viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M5 1.5h6L14.5 5v6L11 14.5H5L1.5 11V5z" stroke-linejoin="round"/><path d="M5.8 5.8l4.4 4.4M10.2 5.8l-4.4 4.4"/></svg>',
    }[s]);
  A.badge = (s) => `<span class="badge st-${s}">${A.statusIcon(s)}${A.STATUS_LABEL[s]}</span>`;

  /* ---------- page chrome ---------- */
  const NAV = [["/", "Home"], ["/dataset", "Dataset"], ["/models", "Models"], ["/results", "Results"]];
  const MARK = `<svg viewBox="0 0 32 32" aria-hidden="true"><circle cx="16" cy="16" r="14.5" fill="none" stroke="#ece9e1" stroke-width="1.4"/>${Array.from({ length: 8 }, (_, i) => `<path d="M16 15 C14.2 11 14.4 7 16 3.6 C17.8 7 17.8 11 17 15Z" transform="rotate(${i * 45} 16 16)" fill="#c5f03a"/>`).join("")}<circle cx="16" cy="16" r="3" fill="#090d16"/></svg>`;
  A.chrome = (path) => {
    const here = path.replace(/\/$/, "") || "/";
    const link = ([h, t]) => `<li><a href="${h}" ${h === here ? 'aria-current="page"' : ""}>${t}</a></li>`;
    const nav = A.el(
      "header",
      { class: "nav" },
      `<div class="wrap nav-in"><a class="brand" href="/" aria-label="AEROLYTICS home">${MARK}<span>AEROLYTICS</span></a>
      <button class="burger" type="button" aria-expanded="false" aria-controls="menu" aria-label="Menu"><svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true" stroke="currentColor" stroke-width="1.8"><path d="M2 5h16M2 10h16M2 15h16"/></svg></button>
      <ul id="menu">${NAV.map(link).join("")}<li><a class="cta" href="/predict" ${here === "/predict" ? 'aria-current="page"' : ""}>Run prediction</a></li></ul></div>`
    );
    const skip = A.el("a", { class: "skip", href: "#main" }, "Skip to content");
    document.body.prepend(nav);
    document.body.prepend(skip);
    const b = nav.querySelector(".burger"), m = nav.querySelector("#menu");
    b.addEventListener("click", () => {
      const o = m.classList.toggle("open");
      b.setAttribute("aria-expanded", o);
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && m.classList.contains("open")) { m.classList.remove("open"); b.setAttribute("aria-expanded", "false"); b.focus(); }
    });
    const f = A.el(
      "footer",
      { class: "footer" },
      `<div class="wrap"><div class="footer-in"><div><a class="brand" href="/" aria-label="AEROLYTICS home">${MARK}<span>AEROLYTICS</span></a>
      <p class="muted small" style="margin-top:14px;max-width:42ch">Remaining useful life prediction for turbofan engines, built on the NASA C-MAPSS FD001 dataset.</p></div>
      <div><h4>Explore</h4><ul><li><a href="/dataset">Dataset explorer</a></li><li><a href="/models">Model lab</a></li><li><a href="/results">Results</a></li><li><a href="/predict">Prediction lab</a></li></ul></div>
      <div><h4>Project</h4><ul><li><a href="/about">About and method</a></li><li><a href="/api/docs">API reference</a></li></ul></div></div>
      <p class="legal">The data is simulated. Predictions are estimates of remaining cycles and do not guarantee when an engine will fail. This project is a study of the method and is not a certified maintenance tool.</p></div>`
    );
    document.body.append(f);
    const main = document.querySelector("main");
    if (main) main.id = "main";
  };

  /* ---------- Chart.js defaults ---------- */
  A.chartDefaults = () => {
    if (!window.Chart) return;
    const C = Chart.defaults;
    C.font.family = '"IBM Plex Sans",system-ui,sans-serif';
    C.font.size = 12;
    C.color = "#aab0bd";
    C.borderColor = "rgba(236,233,225,.09)";
    C.maintainAspectRatio = false;
    C.animation = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? false : { duration: 350 };
    C.plugins.legend.display = false;
    Object.assign(C.plugins.tooltip, { backgroundColor: "#19222f", borderColor: "#263146", borderWidth: 1, titleColor: "#ece9e1", bodyColor: "#ece9e1", padding: 10, cornerRadius: 2, displayColors: true, boxPadding: 4 });
    C.elements.line.borderWidth = 2;
    C.elements.point.radius = 0;
    C.elements.point.hoverRadius = 5;
    C.datasets.line.tension = 0;
  };
  A.axis = (title, extra = {}) => ({ title: title ? { display: true, text: title, color: "#aab0bd" } : { display: false }, grid: { color: "rgba(236,233,225,.07)" }, border: { color: "#263146" }, ticks: { color: "#8a92a3" }, ...extra });
  A.keyHtml = (items) => `<div class="key">${items.map(([c, t, sq]) => `<span><i class="${sq ? "sq" : ""}" style="background:${c}"></i>${A.esc(t)}</span>`).join("")}</div>`;

  /* ---------- hero: turbofan fan face. The outer ring has 125 ticks, one per cycle of the capped RUL horizon. ---------- */
  A.heroEngine = (host) => {
    const cx = 400, cy = 400, blades = 24, ticks = 125, lit = 78;
    const bladePath = "M -10 -62 C -27 -130 -33 -232 -15 -326 L 31 -326 C 35 -240 27 -140 21 -62 Z";
    let s = `<svg viewBox="-40 -40 880 880" role="img" aria-label="Illustration of a turbofan engine seen from the front. A ring of 125 ticks surrounds the fan." xmlns="${NS}">
    <defs>
      <radialGradient id="he-bg" cx="50%" cy="50%" r="50%"><stop offset="0" stop-color="#060a12"/><stop offset=".72" stop-color="#0c1320"/><stop offset="1" stop-color="#16203177"/></radialGradient>
      <linearGradient id="he-blade" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#28344c"/><stop offset=".55" stop-color="#1a2336"/><stop offset="1" stop-color="#0f1626"/></linearGradient>
      <radialGradient id="he-hub" cx="38%" cy="34%" r="75%"><stop offset="0" stop-color="#3a4864"/><stop offset=".6" stop-color="#151d2e"/><stop offset="1" stop-color="#0a0f1a"/></radialGradient>
      <linearGradient id="he-lip" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#3a4762"/><stop offset=".5" stop-color="#1b2538"/><stop offset="1" stop-color="#0d1320"/></linearGradient>
    </defs>
    <circle cx="${cx}" cy="${cy}" r="398" fill="none" stroke="rgba(236,233,225,.06)"/>
    <circle cx="${cx}" cy="${cy}" r="354" fill="url(#he-lip)"/>
    <circle cx="${cx}" cy="${cy}" r="334" fill="url(#he-bg)" stroke="#263146" stroke-width="1.5"/>
    <path d="M ${cx - 330} ${cy} A 330 330 0 0 1 ${cx} ${cy - 330}" fill="none" stroke="#45d6e6" stroke-opacity=".35" stroke-width="1.2"/>
    <g class="fan">${Array.from({ length: blades }, (_, i) => `<g transform="translate(${cx} ${cy}) rotate(${(i * 360) / blades})"><path d="${bladePath}" fill="url(#he-blade)" stroke="rgba(236,233,225,.2)" stroke-width=".8"/><path d="M -10 -62 C -27 -130 -33 -232 -15 -326" fill="none" stroke="#45d6e6" stroke-opacity=".28" stroke-width="1"/></g>`).join("")}</g>
    <circle cx="${cx}" cy="${cy}" r="74" fill="url(#he-hub)" stroke="#2c3850" stroke-width="1.5"/>
    <circle cx="${cx}" cy="${cy}" r="30" fill="#0a0f1a" stroke="#263146"/><circle cx="${cx}" cy="${cy}" r="5" fill="#c5f03a"/>
    <g>${Array.from({ length: ticks }, (_, i) => {
      const a = ((-90 + (i * 360) / ticks) * Math.PI) / 180, on = i < lit, r1 = 366, r2 = on ? 392 : 380;
      return `<line class="${on ? "rul-tick" : ""}" ${on ? `style="animation-delay:${(i * 16).toFixed(0)}ms"` : ""} x1="${(cx + r1 * Math.cos(a)).toFixed(1)}" y1="${(cy + r1 * Math.sin(a)).toFixed(1)}" x2="${(cx + r2 * Math.cos(a)).toFixed(1)}" y2="${(cy + r2 * Math.sin(a)).toFixed(1)}" stroke="${on ? "#c5f03a" : "#3a4660"}" stroke-width="${on ? 2.4 : 1.6}" stroke-linecap="round"/>`;
    }).join("")}</g></svg>`;
    host.innerHTML = s;
  };

  /* ---------- engine cross-section with the real C-MAPSS sensor stations ---------- */
  A.engineSection = (host, opts = {}) => {
    const W = 1200, H = 470, mid = 270, top = (y) => mid - (y - mid) * -1; // helper not used for clarity
    const mir = (y) => 2 * mid - y;
    const coreTop = [[205, 205], [520, 232], [610, 214], [880, 204], [1010, 238]];
    const nac = [[70, 190], [110, 148], [860, 148], [1060, 188], [1130, 250]];
    const poly = (pts, flip) => pts.map(([x, y]) => `${x},${flip ? mir(y) : y}`).join(" ");
    const bars = (x0, x1, n, hFrom, hTo, yAt) => {
      let o = "";
      for (let i = 0; i < n; i++) {
        const x = x0 + ((x1 - x0) * i) / Math.max(1, n - 1), h = hFrom + ((hTo - hFrom) * i) / Math.max(1, n - 1), y = yAt(x);
        o += `<line x1="${x}" y1="${y}" x2="${x}" y2="${y + h}" /><line x1="${x}" y1="${mir(y)}" x2="${x}" y2="${mir(y) - h}" />`;
      }
      return o;
    };
    const yCore = (x) => { for (let i = 0; i < coreTop.length - 1; i++) { const [a, b] = [coreTop[i], coreTop[i + 1]]; if (x >= a[0] && x <= b[0]) return a[1] + ((b[1] - a[1]) * (x - a[0])) / (b[0] - a[0]); } return 220; };
    // station groups: x position, engine marker y, lines [symbol, sensor id]
    const groups = [
      { x: 140, y: mid - 96, lines: [["Nf", "sensor_8"], ["NRf", "sensor_13"]] },
      { x: 255, y: yCore(255) + 12, lines: [["Nc", "sensor_9"], ["NRc", "sensor_14"]] },
      { x: 345, y: yCore(345), lines: [["T24", "sensor_2"]] },
      { x: 445, y: 178, lines: [["BPR", "sensor_15"]] },
      { x: 530, y: yCore(530), lines: [["T30", "sensor_3"], ["P30", "sensor_7"], ["Ps30", "sensor_11"], ["htBleed", "sensor_17"]] },
      { x: 612, y: mid - 40, lines: [["phi", "sensor_12"]] },
      { x: 693, y: yCore(693), lines: [["W31", "sensor_20"]] },
      { x: 795, y: yCore(795), lines: [["W32", "sensor_21"]] },
      { x: 885, y: yCore(885), lines: [["T50", "sensor_4"]] },
    ];
    const key = new Set(["sensor_4", "sensor_11", "sensor_15"]); // the three inputs the models rely on most
    const sections = [["Fan", 100, 190], ["Low-pressure compressor", 200, 345], ["High-pressure compressor", 350, 520], ["Combustor", 520, 650], ["HPT", 650, 725], ["Low-pressure turbine", 730, 880]];
    let g = "";
    groups.forEach((gr) => {
      const rows = gr.lines.length, y0 = 16 + (4 - rows) * 20;
      g += `<line x1="${gr.x}" y1="${y0 + rows * 20 - 4}" x2="${gr.x}" y2="${gr.y}" stroke="${gr.lines.some((l) => key.has(l[1])) ? "#c5f03a" : "#5a6478"}" stroke-width="1" stroke-dasharray="3 3"/>`;
      g += `<circle cx="${gr.x}" cy="${gr.y}" r="5" fill="${gr.lines.some((l) => key.has(l[1])) ? "#c5f03a" : "#0d1424"}" stroke="${gr.lines.some((l) => key.has(l[1])) ? "#c5f03a" : "#8a92a3"}" stroke-width="1.5"/>`;
      gr.lines.forEach((l, i) => {
        const id = l[1], num = id.split("_")[1], k = key.has(id);
        g += `<a href="/dataset?sensor=${id}#explorer" class="st" data-sensor="${id}"><title>Sensor ${num}: ${A.esc((opts.meta && opts.meta[id] && opts.meta[id].name) || l[0])}. Open in the dataset explorer.</title>
          <rect x="${gr.x - 46}" y="${y0 + i * 20 - 14}" width="92" height="20" fill="transparent"/>
          <text x="${gr.x}" y="${y0 + i * 20}" text-anchor="middle" font-size="14" font-weight="${k ? 600 : 500}" fill="${k ? "#c5f03a" : "#ece9e1"}">${l[0]} <tspan fill="#8a92a3" font-weight="400" font-size="12">s${num}</tspan></text></a>`;
      });
    });
    const body = `<svg viewBox="0 0 ${W} ${H}" role="group" aria-label="Side view of a turbofan engine with the C-MAPSS sensor stations marked" xmlns="${NS}" style="width:100%;height:auto;font-family:'IBM Plex Sans',sans-serif">
      <rect width="${W}" height="${H}" fill="none"/>
      <polygon points="${poly(nac)} ${poly(nac.slice().reverse(), true)}" fill="#101826" stroke="#3a4660" stroke-width="1.5"/>
      <polygon points="${poly(coreTop)} ${poly(coreTop.slice().reverse(), true)}" fill="#0a0f1a" stroke="#5a6478" stroke-width="1.5"/>
      <line x1="90" y1="${mid}" x2="1130" y2="${mid}" stroke="#263146" stroke-dasharray="8 6"/>
      <rect x="120" y="${mid - 9}" width="760" height="18" fill="#19222f" stroke="#2c3850"/>
      <g stroke="#7a84a0" stroke-width="3" stroke-linecap="round"><line x1="140" y1="${mid - 120}" x2="140" y2="${mid + 120}" /><line x1="156" y1="${mid - 116}" x2="156" y2="${mid + 116}" /></g>
      <g stroke="#6d7893" stroke-width="2" stroke-linecap="round">${bars(220, 335, 4, 26, 24, yCore)}${bars(362, 505, 7, 22, 10, yCore)}</g>
      <rect x="530" y="${mid - 40}" width="110" height="80" rx="30" fill="#1a1f2a" stroke="#c5f03a" stroke-opacity=".55"/>
      <g stroke="#9aa4bd" stroke-width="2.4" stroke-linecap="round">${bars(660, 700, 2, 22, 22, yCore)}${bars(740, 860, 3, 26, 34, yCore)}</g>
      ${sections.map(([n, a, b]) => `<g><line x1="${a}" y1="${H - 52}" x2="${b}" y2="${H - 52}" stroke="#3a4660"/><line x1="${a}" y1="${H - 56}" x2="${a}" y2="${H - 48}" stroke="#3a4660"/><line x1="${b}" y1="${H - 56}" x2="${b}" y2="${H - 48}" stroke="#3a4660"/><text x="${(a + b) / 2}" y="${H - 28}" text-anchor="middle" font-size="13" fill="#8a92a3">${n}</text></g>`).join("")}
      ${g}</svg>`;
    host.innerHTML = body;
    host.querySelectorAll("a.st").forEach((a) => { a.addEventListener("mouseenter", () => (a.style.opacity = ".7")); a.addEventListener("mouseleave", () => (a.style.opacity = "1")); });
  };
})();

/* value labels at the end of bars (Chart.js has no built-in) */
window.AERO.valueLabels = (fmt = (v) => v, horizontal = false) => ({
  id: "valueLabels",
  afterDatasetsDraw(chart) {
    const { ctx } = chart; ctx.save(); ctx.font = '500 12px "IBM Plex Mono",monospace'; ctx.fillStyle = "#ece9e1";
    chart.data.datasets.forEach((ds, di) => {
      const meta = chart.getDatasetMeta(di); if (meta.hidden) return;
      meta.data.forEach((el, i) => {
        const v = ds.data[i]; if (v == null) return;
        if (horizontal) { ctx.textAlign = "left"; ctx.textBaseline = "middle"; ctx.fillText(fmt(v), el.x + 8, el.y); }
        else { ctx.textAlign = "center"; ctx.textBaseline = "bottom"; ctx.fillText(fmt(v), el.x, el.y - 6); }
      });
    });
    ctx.restore();
  },
});
/* prediction bars on a shared 0..cap scale, with the 30 and 60 cycle thresholds marked */
window.AERO.predBars = (host, preds, cfg) => {
  const cap = cfg.cap, t = cfg.status_thresholds, pc = (v) => (Math.min(v, cap) / cap) * 100;
  host.innerHTML = '<div class="pbars">' + AERO.MODELS.map((m) => {
    const p = preds[m]; if (!p) return "";
    const val = p.at_cap ? `${cap}+` : AERO.n(p.rul, 1);
    return `<div class="pbar"><div class="nm"><i style="background:${AERO.MODEL_COLOR[m]}"></i>${m}</div>
      <div class="track" role="img" aria-label="${m}: ${val} cycles, ${AERO.STATUS_LABEL[p.status]}"><div class="fill" style="width:${pc(p.rul)}%;background:${AERO.MODEL_COLOR[m]}"></div><span class="mk" style="left:${pc(t.critical_below)}%"></span><span class="mk" style="left:${pc(t.warning_below)}%"></span></div>
      <div class="val st-${p.status}">${val}${AERO.statusIcon(p.status)}</div></div>`;
  }).join("") + `</div><div class="pscale" aria-hidden="true"><span></span><span class="s"><b style="left:0">0</b><b style="left:${pc(t.critical_below)}%">${t.critical_below}</b><b style="left:${pc(t.warning_below)}%">${t.warning_below}</b><b style="left:100%">${cap}+</b></span><span></span></div>`;
};

/* dot plot: categories on x, one marker per model. Different marker shapes back up colour. Used where differences are small. */
window.AERO.SHAPE = { "Linear Regression": "rectRot", "Random Forest": "circle", "XGBoost": "triangle" };
window.AERO.GLYPH = { "Linear Regression": "◆", "Random Forest": "●", "XGBoost": "▲" };
window.AERO.modelKey = () => `<div class="key">${AERO.MODELS.map((m) => `<span><b style="color:${AERO.MODEL_COLOR[m]};font-size:.95rem;line-height:1">${AERO.GLYPH[m]}</b>${m}</span>`).join("")}</div>`;
window.AERO.dotPlot = (canvas, labels, byModel, yTitle, opts = {}) => new Chart(canvas, {
  type: "line",
  data: { labels, datasets: AERO.MODELS.map((m) => ({ label: m, data: byModel[m], showLine: false, pointStyle: AERO.SHAPE[m], pointRadius: 7, pointHoverRadius: 9, borderColor: AERO.MODEL_COLOR[m], backgroundColor: AERO.MODEL_COLOR[m] })) },
  options: { interaction: { mode: "index", intersect: false }, scales: { x: AERO.axis(null, { ticks: { color: "#ece9e1", maxRotation: 0, autoSkip: false } }), y: AERO.axis(yTitle, { ...(opts.y || {}) }) },
    plugins: { tooltip: { callbacks: { label: (c) => ` ${c.dataset.label}: ${AERO.n(c.parsed.y, 2)}` } } } },
});
/* wrap a long label into lines for chart axes */
window.AERO.wrap = (t, n = 14) => { const w = String(t).split(" "), out = []; let cur = ""; w.forEach((x) => { if ((cur + " " + x).trim().length > n) { out.push(cur); cur = x; } else cur = (cur + " " + x).trim(); }); out.push(cur); return out; };
