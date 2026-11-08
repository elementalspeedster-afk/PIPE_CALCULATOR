const form = document.getElementById("calc-form");
const fittingsList = document.getElementById("fittings-list");
const addFittingBtn = document.getElementById("add-fitting");
const resultsSection = document.getElementById("results");
const resultsBody = document.getElementById("results-body");
const downloadBtn = document.getElementById("download-report");
const formError = document.getElementById("form-error");
const thresholdInput = form.pump_threshold_kw;

const DEFAULT_THRESHOLD = { liquid: 0.1, gas: 0.3 };

let knownFittings = [];
let lastPayload = null;

const SETTINGS_KEY = "pipedash.settings.v1";
const ORIGINAL_SETTINGS = {
  app_name: "PIPE DASH",
  theme_color: "#1f3b57",
  accent_color: "#1f8a70",
  dark_mode: false,
  epsilon_mm: 0.0457,
  schedule: "40",
  liquid_threshold_kw: 0.1,
  gas_threshold_kw: 0.3,
  gas_velocity: 20,
  z_factor: 1.0,
  gamma: 1.4,
  compressor_efficiency: 0.78,
  font: "segoe",
  text_size: "100",
  text_color: "",
  input_color: "",
  results_position: "below",
};
const MODE_COLORS = {
  light: { text: "#222233", input: "#ffffff" },
  dark: { text: "#e4e9ee", input: "#151b21" },
};
const OPTIONAL_COLORS = { text_color: "text", input_color: "input" };
const FONT_STACKS = {
  segoe: '"Segoe UI", system-ui, -apple-system, sans-serif',
  arial: 'Arial, Helvetica, sans-serif',
  calibri: 'Calibri, Carlito, "Segoe UI", sans-serif',
  verdana: 'Verdana, Geneva, sans-serif',
  tahoma: 'Tahoma, Verdana, sans-serif',
  cambria: 'Cambria, Caladea, Georgia, serif',
  georgia: 'Georgia, "Times New Roman", serif',
  times: '"Times New Roman", Times, serif',
  consolas: 'Consolas, "Courier New", monospace',
};
const TEXT_SIZES = ["90", "100", "112", "125"];
const NUMBER_SETTINGS = [
  "epsilon_mm", "liquid_threshold_kw", "gas_threshold_kw",
  "gas_velocity", "z_factor", "gamma", "compressor_efficiency",
];
const FORM_DEFAULT_FIELDS = [
  "epsilon_mm", "schedule", "gas_velocity", "z_factor", "gamma", "compressor_efficiency",
];
const SCHEDULE_CHOICES = ["40", "80", "160", "ANY"];

const FIELD_LABELS = [
  { key: "stream_label", text: "Stream label", group: "Line identification" },
  { key: "equipment1", text: "Equipment 1 tag", group: "Line identification" },
  { key: "equipment2", text: "Equipment 2 tag", group: "Line identification" },
  { key: "temp1_c", text: "Temperature 1 (°C)", group: "Line identification" },
  { key: "temp2_c", text: "Temperature 2 (°C)", group: "Line identification" },
  { key: "m_flow", text: "Mass Flowrate (kg/s)", req: true, group: "Liquid & gas" },
  { key: "rho", text: "Density (kg/m³)", req: true, group: "Liquid & gas" },
  { key: "mu", text: "Viscosity (Pa·s)", req: true, group: "Liquid & gas" },
  { key: "l_pipe", text: "Length of Pipe (m)", req: true, group: "Liquid & gas" },
  { key: "delta_z", text: "Height Change, Δz (m)", req: true, group: "Liquid & gas" },
  { key: "epsilon_mm", text: "Surface Roughness (mm)", group: "Liquid & gas" },
  { key: "schedule", text: "Pipe schedule search", group: "Liquid & gas" },
  { key: "p1_bar:liquid", field: "p1_bar", fluid: "liquid", text: "Pressure at Equipment 1 (bar)", req: true, group: "Liquid only" },
  { key: "p2_bar", text: "Pressure at Equipment 2 (bar)", req: true, group: "Liquid only" },
  { key: "pump_threshold_kw:liquid", field: "pump_threshold_kw", fluid: "liquid", text: "Pump threshold (kW)", group: "Liquid only" },
  { key: "p1_bar:gas", field: "p1_bar", fluid: "gas", text: "Known Pressure, P1 (bar)", req: true, group: "Gas only" },
  { key: "gas_velocity", text: "Gas Design Velocity (m/s)", group: "Gas only" },
  { key: "temp_c", text: "Stream Temperature (°C)", req: true, group: "Gas only" },
  { key: "molecular_weight", text: "Molecular Weight (kg/kmol)", req: true, group: "Gas only" },
  { key: "z_factor", text: "Compressibility Factor, Z", group: "Gas only" },
  { key: "gamma", text: "Gamma, Cp/Cv (γ)", group: "Gas only" },
  { key: "compressor_efficiency", text: "Compressor Efficiency (0-1)", group: "Gas only" },
  { key: "pump_threshold_kw:gas", field: "pump_threshold_kw", fluid: "gas", text: "Compressor threshold (kW)", group: "Gas only" },
];
const LABEL_KEYS = FIELD_LABELS.map((l) => l.key);

const settingsDialog = document.getElementById("settings-dialog");
const settingsForm = document.getElementById("settings-form");
const settingsNote = document.getElementById("settings-note");
const appTitle = document.getElementById("app-title");

function cleanSettings(raw) {
  const out = { ...ORIGINAL_SETTINGS, labels: {} };
  if (!raw || typeof raw !== "object") return out;
  if (typeof raw.app_name === "string" && raw.app_name.trim()) {
    out.app_name = raw.app_name.trim().slice(0, 40);
  }
  ["theme_color", "accent_color"].forEach((k) => {
    if (typeof raw[k] === "string" && /^#[0-9a-f]{6}$/i.test(raw[k])) out[k] = raw[k];
  });
  if (typeof raw.dark_mode === "boolean") out.dark_mode = raw.dark_mode;
  if (SCHEDULE_CHOICES.includes(raw.schedule)) out.schedule = raw.schedule;
  if (Object.hasOwn(FONT_STACKS, raw.font)) out.font = raw.font;
  if (["below", "right"].includes(raw.results_position)) out.results_position = raw.results_position;
  Object.entries(OPTIONAL_COLORS).forEach(([k, part]) => {
    const v = typeof raw[k] === "string" ? raw[k].toLowerCase() : "";
    const isModeDefault = v === MODE_COLORS.light[part] || v === MODE_COLORS.dark[part];
    if (/^#[0-9a-f]{6}$/.test(v) && !isModeDefault) out[k] = v;
  });
  if (TEXT_SIZES.includes(String(raw.text_size))) out.text_size = String(raw.text_size);
  NUMBER_SETTINGS.forEach((k) => {
    const v = Number(raw[k]);
    if (raw[k] !== "" && raw[k] !== null && Number.isFinite(v) && v >= 0) out[k] = v;
  });
  if (out.compressor_efficiency > 1 || out.compressor_efficiency === 0) {
    out.compressor_efficiency = ORIGINAL_SETTINGS.compressor_efficiency;
  }
  out.labels = {};
  if (raw.labels && typeof raw.labels === "object") {
    LABEL_KEYS.forEach((k) => {
      const v = raw.labels[k];
      if (typeof v === "string" && v.trim()) out.labels[k] = v.trim().slice(0, 60);
    });
  }
  return out;
}

function loadSettings() {
  try {
    return cleanSettings(JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}"));
  } catch (err) {
    return cleanSettings(null);
  }
}

function storeSettings(s) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
    return true;
  } catch (err) {
    return false;
  }
}

function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function mixWithWhite(hex, amount) {
  const rgb = hexToRgb(hex).map((c) => Math.round(c + (255 - c) * amount));
  return "#" + rgb.map((c) => c.toString(16).padStart(2, "0")).join("");
}

function textColorOn(hex) {
  const [r, g, b] = hexToRgb(hex).map((c) => {
    const x = c / 255;
    return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
  });
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return lum > 0.4 ? "#111111" : "#ffffff";
}

function applyAppearance(s) {
  const root = document.documentElement;
  document.title = s.app_name;
  appTitle.textContent = s.app_name;
  root.dataset.theme = s.dark_mode ? "dark" : "light";
  root.style.setProperty("--navy", s.theme_color);
  root.style.setProperty("--navy-light", mixWithWhite(s.theme_color, 0.18));
  root.style.setProperty("--accent", s.accent_color);
  root.style.setProperty("--font", FONT_STACKS[s.font]);
  document.querySelector("main").classList.toggle("layout-side", s.results_position === "right");
  ["--text", "--text-muted", "--input-bg", "--input-text"].forEach((v) => root.style.removeProperty(v));
  if (s.text_color) {
    root.style.setProperty("--text", s.text_color);
    root.style.setProperty("--text-muted", s.text_color + "cc");
  }
  if (s.input_color) {
    root.style.setProperty("--input-bg", s.input_color);
    root.style.setProperty("--input-text", textColorOn(s.input_color));
  }
  root.style.fontSize = s.text_size === "100" ? "" : `${s.text_size}%`;
  root.style.setProperty("--on-theme", textColorOn(s.theme_color));
  root.style.setProperty("--on-accent", textColorOn(s.accent_color));
  const lum = textColorOn(s.theme_color) === "#111111";
  root.style.setProperty(
    "--heading",
    s.dark_mode ? mixWithWhite(s.theme_color, 0.6) : lum ? "#223" : s.theme_color
  );
  applyLabels(s.labels || {});
}

function applyLabels(labels) {
  const type = form.fluid_type.value;
  FIELD_LABELS.forEach((item) => {
    if (item.fluid && item.fluid !== type) return;
    const field = form.elements[item.field || item.key];
    const label = field && field.closest("label");
    if (!label) return;
    const text = labels[item.key] || item.text;
    label.firstChild.textContent = text + (item.req ? " *" : "") + " ";
  });
}

function buildLabelSettings() {
  const box = document.getElementById("label-settings");
  let lastGroup = null;
  FIELD_LABELS.forEach((item) => {
    if (item.group !== lastGroup) {
      const head = document.createElement("p");
      head.className = "label-group";
      head.textContent = item.group;
      box.appendChild(head);
      lastGroup = item.group;
    }
    const wrap = document.createElement("label");
    wrap.appendChild(document.createTextNode(item.text));
    const input = document.createElement("input");
    input.type = "text";
    input.maxLength = 60;
    input.dataset.labelKey = item.key;
    wrap.appendChild(input);
    box.appendChild(wrap);
  });
}
buildLabelSettings();

function applyDefaults(s, previous) {
  FORM_DEFAULT_FIELDS.forEach((name) => {
    const field = form[name];
    if (!previous || String(field.value) === String(previous[name]) || field.value === "") {
      field.value = s[name];
    }
  });
  const type = form.fluid_type.value;
  const oldThreshold = previous
    ? (type === "liquid" ? previous.liquid_threshold_kw : previous.gas_threshold_kw)
    : null;
  DEFAULT_THRESHOLD.liquid = s.liquid_threshold_kw;
  DEFAULT_THRESHOLD.gas = s.gas_threshold_kw;
  if (!previous || Number(thresholdInput.value) === oldThreshold || thresholdInput.value === "") {
    thresholdInput.value = DEFAULT_THRESHOLD[type];
  }
  thresholdInput.dataset.lastDefault = DEFAULT_THRESHOLD[type];
  document.getElementById("gas-pill").title =
    `Design velocity: ${s.gas_velocity} m/s default, editable (typical range 15-30 m/s)`;
}

function fillSettingsForm(s) {
  Object.keys(ORIGINAL_SETTINGS).forEach((name) => {
    const field = settingsForm.elements[name];
    if (field.type === "checkbox") field.checked = s[name];
    else field.value = s[name];
  });
  syncOptionalColorPickers(s);
  const labels = s.labels || {};
  settingsForm.querySelectorAll("[data-label-key]").forEach((input) => {
    input.value = labels[input.dataset.labelKey] || "";
  });
}

function readSettingsForm() {
  const raw = {};
  Object.keys(ORIGINAL_SETTINGS).forEach((name) => {
    const field = settingsForm.elements[name];
    raw[name] = field.type === "checkbox" ? field.checked : field.value;
  });
  raw.labels = {};
  settingsForm.querySelectorAll("[data-label-key]").forEach((input) => {
    raw.labels[input.dataset.labelKey] = input.value;
  });
  return cleanSettings(raw);
}

let currentSettings = loadSettings();
applyAppearance(currentSettings);
applyDefaults(currentSettings, null);

document.getElementById("open-settings").addEventListener("click", () => {
  fillSettingsForm(currentSettings);
  settingsNote.hidden = true;
  settingsDialog.showModal();
});

document.getElementById("settings-cancel").addEventListener("click", () => {
  applyAppearance(currentSettings);
  settingsDialog.close();
});

settingsDialog.addEventListener("cancel", () => applyAppearance(currentSettings));

document.getElementById("settings-reset").addEventListener("click", () => {
  fillSettingsForm(ORIGINAL_SETTINGS);
  applyAppearance(ORIGINAL_SETTINGS);
  settingsNote.textContent = "Original settings filled in. Click Save to keep them.";
  settingsNote.hidden = false;
});

function syncOptionalColorPickers(s) {
  const mode = MODE_COLORS[s.dark_mode ? "dark" : "light"];
  Object.entries(OPTIONAL_COLORS).forEach(([k, part]) => {
    settingsForm.elements[k].value = s[k] || mode[part];
  });
}

settingsForm.addEventListener("input", () => {
  const preview = readSettingsForm();
  syncOptionalColorPickers(preview);
  applyAppearance(preview);
});

settingsForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const previous = currentSettings;
  currentSettings = readSettingsForm();
  const saved = storeSettings(currentSettings);
  applyAppearance(currentSettings);
  applyDefaults(currentSettings, previous);
  if (!saved) {
    settingsNote.textContent =
      "Applied, but this browser blocked saving, so it will reset when the page reloads.";
    settingsNote.hidden = false;
    return;
  }
  settingsDialog.close();
});

function fmt(value, digits = 4) {
  if (value === 0) return "0";
  const mag = Math.abs(value);
  if (mag < 1e-3 || mag >= 1e5) {
    const exp = Math.floor(Math.log10(mag));
    const mantissa = (value / 10 ** exp).toFixed(digits - 1);
    return `${mantissa} x 10^${exp}`;
  }
  const decimals = Math.max(0, digits - 1 - Math.floor(Math.log10(mag)));
  return value.toFixed(Math.min(decimals, 6));
}

function syncFluidFields() {
  const type = form.fluid_type.value;
  applyLabels(currentSettings.labels);

  document.querySelectorAll("[data-fluid]").forEach((label) => {
    const show = label.dataset.fluid === type;
    label.hidden = !show;
    const input = label.querySelector("input");
    if (input) input.required = show;
  });

  const lastDefault = Number(thresholdInput.dataset.lastDefault || DEFAULT_THRESHOLD.liquid);
  if (!thresholdInput.value || Number(thresholdInput.value) === lastDefault) {
    thresholdInput.value = DEFAULT_THRESHOLD[type];
  }
  thresholdInput.dataset.lastDefault = DEFAULT_THRESHOLD[type];
}

document.querySelectorAll('input[name="fluid_type"]').forEach((el) => {
  el.addEventListener("change", syncFluidFields);
});
syncFluidFields();

function addFittingRow(prefill) {
  const row = document.createElement("div");
  row.className = "fitting-row";

  const options = knownFittings
    .map((f) => `<option value="${f.name}" data-k="${f.k}">${f.name} (K=${f.k})</option>`)
    .join("");

  row.innerHTML = `
    <label>Fitting/Valve
      <select class="fitting-name">
        ${options}
        <option value="__custom__">Custom / not listed…</option>
      </select>
    </label>
    <label class="custom-k-wrap" hidden>K value
      <input type="number" step="any" class="fitting-k" />
    </label>
    <label>Quantity
      <input type="number" min="1" step="1" value="1" class="fitting-qty" />
    </label>
    <button type="button" class="remove-fitting" title="Remove">✕</button>
  `;

  const select = row.querySelector(".fitting-name");
  const customWrap = row.querySelector(".custom-k-wrap");
  const customNameInput = document.createElement("input");
  customNameInput.type = "text";
  customNameInput.placeholder = "Fitting name";
  customNameInput.className = "fitting-custom-name";
  customNameInput.hidden = true;

  select.insertAdjacentElement("afterend", customNameInput);

  function syncCustomVisibility() {
    const isCustom = select.value === "__custom__";
    customWrap.hidden = !isCustom;
    customNameInput.hidden = !isCustom;
  }
  select.addEventListener("change", syncCustomVisibility);
  syncCustomVisibility();

  row.querySelector(".remove-fitting").addEventListener("click", () => row.remove());

  if (prefill) {
    select.value = prefill.name;
    if (select.value !== prefill.name) {
      select.value = "__custom__";
      customNameInput.value = prefill.name;
    }
    row.querySelector(".fitting-qty").value = prefill.qty;
    row.querySelector(".fitting-k").value = prefill.k;
    syncCustomVisibility();
  }

  fittingsList.appendChild(row);
}

addFittingBtn.addEventListener("click", () => addFittingRow());

async function loadFittings() {
  const res = await fetch("/api/fittings");
  knownFittings = await res.json();
  addFittingRow({ name: "90 degrees Elbow", qty: 1, k: 30 });
}
loadFittings();

function collectFittings() {
  const rows = [...fittingsList.querySelectorAll(".fitting-row")];
  return rows.map((row) => {
    const select = row.querySelector(".fitting-name");
    const isCustom = select.value === "__custom__";
    const name = isCustom
      ? row.querySelector(".fitting-custom-name").value.trim()
      : select.value;
    const k = isCustom
      ? parseFloat(row.querySelector(".fitting-k").value)
      : parseFloat(select.selectedOptions[0].dataset.k);
    const qty = parseFloat(row.querySelector(".fitting-qty").value);
    return { name, k, qty };
  }).filter((f) => f.name && f.qty > 0);
}

function buildPayload() {
  const data = new FormData(form);
  const fluidType = data.get("fluid_type");
  const meta = {
    stream_label: data.get("stream_label") || undefined,
    equipment1: data.get("equipment1") || undefined,
    equipment2: data.get("equipment2") || undefined,
    temp1_c: data.get("temp1_c") || undefined,
    temp2_c: data.get("temp2_c") || undefined,
  };
  const payload = {
    fluid_type: fluidType,
    m_flow: parseFloat(data.get("m_flow")),
    rho: parseFloat(data.get("rho")),
    mu: parseFloat(data.get("mu")),
    l_pipe: parseFloat(data.get("l_pipe")),
    delta_z: parseFloat(data.get("delta_z")),
    p1_bar: parseFloat(data.get("p1_bar")),
    epsilon_mm: parseFloat(data.get("epsilon_mm")),
    schedule: data.get("schedule"),
    pump_threshold_kw: parseFloat(data.get("pump_threshold_kw")),
    fittings: collectFittings(),
    meta,
  };
  if (fluidType === "liquid") {
    payload.p2_bar = parseFloat(data.get("p2_bar"));
  } else {
    payload.gas_velocity = parseFloat(data.get("gas_velocity"));
    payload.temp_c = parseFloat(data.get("temp_c"));
    payload.molecular_weight = parseFloat(data.get("molecular_weight"));
    payload.z_factor = parseFloat(data.get("z_factor"));
    payload.gamma = parseFloat(data.get("gamma"));
    payload.compressor_efficiency = parseFloat(data.get("compressor_efficiency"));
  }
  return payload;
}

function row(label, value) {
  return `<div class="kv"><span class="label">${label}</span><span class="value">${value}</span></div>`;
}

function renderResults(r) {
  const mover = r.fluid_type === "liquid" ? "Pump" : "Compressor";
  const siz = r.sizing, fr = r.friction, bal = r.balance, pipe = siz.matched_pipe;

  let html = "";

  if (r.fluid_type === "gas") {
    const inp = r.inputs;
    html += `<div class="result-section"><h3>Gas Properties</h3><div class="kv-grid">`;
    html += row("Stream temperature", `${fmt(inp.temp_c)} °C (${fmt(inp.temp_k)} K)`);
    html += row("Molecular weight", `${fmt(inp.molecular_weight)} kg/kmol`);
    html += row("Compressibility factor, Z", fmt(inp.z_factor));
    html += row("Gamma, Cp/Cv", fmt(inp.gamma));
    html += row("Compressor efficiency", `${fmt(inp.compressor_efficiency * 100, 3)}%`);
    html += `</div></div>`;
  }

  html += `<div class="result-section"><h3>Pipe Sizing</h3><div class="kv-grid">`;
  html += row("Volumetric flowrate", `${fmt(siz.q_f)} m³/s`);
  html += row("Calculated pipe diameter", `${fmt(siz.d_pipe_in)} in`);
  html += row("Selected nominal size", `${fmt(pipe.nominal_pipe_size_in)} in, Sch ${pipe.schedule}`);
  html += row("Standard inside diameter", `${fmt(pipe.inside_diameter_in)} in (${fmt(siz.d_act_m)} m)`);
  html += row("Actual fluid velocity", `${fmt(siz.v_act)} m/s`);
  if (pipe.schedule_fallback_used) {
    html += row("Note", "Preferred schedule too small — widened to all schedules");
  }
  html += `</div></div>`;

  html += `<div class="result-section"><h3>Friction Losses</h3><div class="kv-grid">`;
  html += row("Reynolds number", fmt(fr.re, 5));
  html += row("Flow regime", fr.is_turbulent ? "Turbulent (Churchill eq.)" : "Laminar (16/Re)");
  html += row("Fanning friction factor", fmt(fr.f_fanning));
  html += row("Darcy friction factor", fmt(fr.f_darcy));
  html += row("Friction loss — skin", `${fmt(fr.f_skin)} J/kg`);
  html += row("Friction loss — fittings", `${fmt(fr.f_fittings)} J/kg`);
  html += row("Friction loss — meters", `${fmt(fr.f_meter)} J/kg`);
  html += row("Total friction loss", `${fmt(fr.f_total)} J/kg`);
  html += `</div>`;

  if (fr.fittings.length) {
    html += `<table class="fitting-table"><thead><tr><th>Fitting/Valve</th><th>K</th><th>Qty</th><th>Kf</th></tr></thead><tbody>`;
    fr.fittings.forEach((f) => {
      html += `<tr><td>${f.name}</td><td>${fmt(f.k)}</td><td>${fmt(f.qty)}</td><td>${fmt(f.kf)}</td></tr>`;
    });
    html += `<tr><td colspan="3"><strong>TOTAL</strong></td><td><strong>${fmt(fr.total_kf)}</strong></td></tr>`;
    html += `</tbody></table>`;
  }
  html += `</div>`;

  html += `<div class="result-section"><h3>Mechanical Energy Balance</h3><div class="kv-grid">`;
  html += row("Potential head", `${fmt(bal.pe)} J/kg`);
  html += row("Kinetic head", `${fmt(bal.ke)} J/kg`);
  if (r.fluid_type === "liquid") {
    html += row("Pressure head", `${fmt(bal.p_head)} J/kg`);
    html += row("Theoretical work", `${fmt(bal.w_theo_kw)} kW`);
  } else {
    html += row("Pipeline downstream pressure, P2", `${fmt(bal.p2_pipeline)} Pa`);
    html += row("Discharge pressure", `${fmt(bal.p_discharge)} Pa`);
    html += row("Theoretical compressor work", `${fmt(bal.w_theo_kw)} kW`);
    html += row("Actual work (efficiency-adjusted)", `${fmt(bal.w_actual_kw)} kW`);
  }
  html += `</div></div>`;

  const decisiveKw = r.fluid_type === "liquid" ? bal.w_theo_kw : bal.w_actual_kw;
  html += `<div class="verdict ${bal.needs_mover ? "required" : "not-required"}">`;
  html += bal.needs_mover
    ? `${mover} IS REQUIRED (${fmt(decisiveKw)} kW > ${fmt(bal.threshold_kw)} kW threshold)`
    : `No ${mover.toLowerCase()} needed (${fmt(decisiveKw)} kW ≤ ${fmt(bal.threshold_kw)} kW threshold)`;
  html += `</div>`;

  resultsBody.innerHTML = html;
  resultsSection.hidden = false;
  const sideBySide = document.querySelector("main").classList.contains("layout-side")
    && window.matchMedia("(min-width: 1000px)").matches;
  if (sideBySide) resultsSection.scrollTop = 0;
  else resultsSection.scrollIntoView({ behavior: "smooth", block: "start" });
}

function showError(msg) {
  formError.textContent = msg;
  formError.hidden = false;
}

function clearError() {
  formError.hidden = true;
  formError.textContent = "";
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  clearError();
  downloadBtn.disabled = true;
  lastPayload = buildPayload();

  try {
    const res = await fetch("/api/calculate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(lastPayload),
    });
    const data = await res.json();
    if (!res.ok) {
      showError(data.error || "Calculation failed.");
      resultsSection.hidden = true;
      return;
    }
    renderResults(data);
    downloadBtn.disabled = false;
  } catch (err) {
    showError("Could not reach the calculation server. Is app.py running?");
  }
});

downloadBtn.addEventListener("click", async () => {
  if (!lastPayload) return;
  clearError();
  try {
    const res = await fetch("/api/report", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(lastPayload),
    });
    if (!res.ok) {
      const data = await res.json();
      showError(data.error || "Report generation failed.");
      return;
    }
    const blob = await res.blob();
    const disposition = res.headers.get("Content-Disposition") || "";
    const match = disposition.match(/filename="?([^"]+)"?/);
    const filename = match ? match[1] : "Piping_Report.docx";

    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  } catch (err) {
    showError("Could not reach the server to generate the report.");
  }
});
