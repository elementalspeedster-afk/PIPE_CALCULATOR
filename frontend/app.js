const form = document.getElementById("calc-form");
const fittingsList = document.getElementById("fittings-list");
const addFittingBtn = document.getElementById("add-fitting");
const resultsSection = document.getElementById("results");
const resultsBody = document.getElementById("results-body");
const downloadBtn = document.getElementById("download-report");
const formError = document.getElementById("form-error");
const moverThresholdLabel = document.getElementById("mover-threshold-label");
const p1Label = document.getElementById("p1-label");
const thresholdInput = form.pump_threshold_kw;

const DEFAULT_THRESHOLD = { liquid: 0.1, gas: 0.3 };

let knownFittings = [];
let lastPayload = null;

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

function fluidWord() {
  const type = form.fluid_type.value;
  return type === "liquid" ? "Pump" : "Compressor";
}

function updateMoverLabel() {
  moverThresholdLabel.firstChild.textContent = `${fluidWord()} threshold (kW)`;
}

function syncFluidFields() {
  const type = form.fluid_type.value;
  updateMoverLabel();

  p1Label.firstChild.textContent =
    type === "liquid" ? "Pressure at Equipment 1 (bar) *" : "Known Pressure, P1 (bar) *";

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
  resultsSection.scrollIntoView({ behavior: "smooth", block: "start" });
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
