import math

from pipe_data import find_closest_pipe

G = 9.81
GC = 1.0
RE_TURBULENT = 2300
R_KMOL = 8314.0
R_MOL = 8.314

LIQUID_VELOCITY = 1.0
DEFAULT_GAS_VELOCITY = 20.0

METER_CM = {"liquid": 0.98, "gas": 0.5}
METER_YM = {"liquid": 1.0, "gas": 0.98}
METER_PHI = 2.0
METER_KM = 0.1

DEFAULT_PUMP_THRESHOLD_KW = 0.1
DEFAULT_COMPRESSOR_THRESHOLD_KW = 0.3
DEFAULT_COMPRESSOR_EFFICIENCY = 0.78
DEFAULT_Z = 1.0
DEFAULT_GAMMA = 1.4


class CalculationError(ValueError):
    pass


def _resolve_fittings(fittings):
    resolved = []
    total_kf = 0.0
    for item in fittings:
        name = (item.get("name") or "").strip()
        qty = float(item.get("qty") or 0)
        if not name or qty <= 0:
            continue
        k = item.get("k")
        if k in (None, ""):
            raise CalculationError(f"Missing K value for fitting '{name}'.")
        k = float(k)
        kf = k * qty
        total_kf += kf
        resolved.append({"name": name, "k": k, "qty": qty, "kf": kf})
    return resolved, total_kf


def _size_and_friction(fluid_type, m_flow, rho, mu, l_pipe, epsilon_m, total_kf,
                        schedule, v_fixed):
    cm = METER_CM[fluid_type]
    ym = METER_YM[fluid_type]

    q_f = m_flow / rho
    a_pipe = q_f / v_fixed
    d_pipe_m = math.sqrt((4 * a_pipe) / math.pi)
    d_pipe_in = d_pipe_m * 39.37

    matched = find_closest_pipe(d_pipe_in, schedule=schedule, search_by="Inside diameter, in")
    d_act_in = matched["inside_diameter_in"]
    d_act_m = d_act_in / 39.37
    a_act = (math.pi / 4) * (d_act_m ** 2)
    v_act = q_f / a_act

    re = (d_act_m * v_act * rho) / mu
    is_turbulent = re >= RE_TURBULENT
    if is_turbulent:
        f_fanning = (
            (-4 * math.log10(((0.27 * epsilon_m) / d_act_m) + ((7 / re) ** 0.9))) ** -1
        ) ** 2
    else:
        f_fanning = 16 / re
    f_darcy = 4 * f_fanning

    f_skin = (f_darcy * l_pipe * (v_act ** 2)) / (2 * GC * d_act_m)

    f_fittings = (f_darcy * (v_act ** 2) * total_kf) / (2 * GC)

    v_meter = (METER_PHI ** 2) * v_act
    h_meter = ((v_meter / (cm * ym)) ** 2) * (((METER_PHI ** 4) - 1) / (2 * GC))
    f_meter = METER_KM * h_meter

    f_total = f_skin + f_fittings + f_meter

    return {
        "q_f": q_f, "a_pipe": a_pipe, "d_pipe_m": d_pipe_m, "d_pipe_in": d_pipe_in,
        "matched_pipe": matched, "d_act_in": d_act_in, "d_act_m": d_act_m,
        "a_act": a_act, "v_act": v_act,
        "re": re, "is_turbulent": is_turbulent, "f_fanning": f_fanning,
        "f_darcy": f_darcy, "f_skin": f_skin, "f_fittings": f_fittings,
        "v_meter": v_meter, "h_meter": h_meter, "f_meter": f_meter, "f_total": f_total,
        "cm": cm, "ym": ym, "v_fixed": v_fixed,
    }


def _compute_liquid(params, fittings, total_kf):
    m_flow = float(params["m_flow"])
    rho = float(params["rho"])
    mu = float(params["mu"])
    l_pipe = float(params["l_pipe"])
    delta_z = float(params["delta_z"])
    p1 = float(params["p1_bar"]) * 1e5
    p2 = float(params["p2_bar"]) * 1e5
    epsilon_m = float(params["epsilon_mm"]) / 1000.0
    threshold_kw = float(params.get("pump_threshold_kw") or DEFAULT_PUMP_THRESHOLD_KW)
    schedule = params.get("schedule") or "40"

    sf = _size_and_friction("liquid", m_flow, rho, mu, l_pipe, epsilon_m, total_kf,
                             schedule, v_fixed=LIQUID_VELOCITY)

    pe = delta_z * (G / GC)
    ke = (sf["v_act"] ** 2) / (2 * GC)
    p_head = (p2 - p1) / rho
    w_theo_kw = (ke + pe + p_head + sf["f_total"]) * m_flow / 1000.0
    needs_mover = w_theo_kw > threshold_kw

    return {
        "fluid_type": "liquid",
        "inputs": {
            "m_flow": m_flow, "rho": rho, "mu": mu, "l_pipe": l_pipe,
            "delta_z": delta_z, "p1_bar": params["p1_bar"], "p2_bar": params["p2_bar"],
            "p1_pa": p1, "p2_pa": p2, "epsilon_mm": params["epsilon_mm"],
            "epsilon_m": epsilon_m, "v_fixed": sf["v_fixed"],
            "pump_threshold_kw": threshold_kw, "schedule": schedule,
        },
        "sizing": {k: sf[k] for k in (
            "q_f", "a_pipe", "d_pipe_m", "d_pipe_in", "matched_pipe",
            "d_act_in", "d_act_m", "a_act", "v_act",
        )},
        "friction": {
            "re": sf["re"], "is_turbulent": sf["is_turbulent"], "f_fanning": sf["f_fanning"],
            "f_darcy": sf["f_darcy"], "f_skin": sf["f_skin"], "fittings": fittings,
            "total_kf": total_kf, "f_fittings": sf["f_fittings"], "v_meter": sf["v_meter"],
            "h_meter": sf["h_meter"], "f_meter": sf["f_meter"], "f_total": sf["f_total"],
            "cm": sf["cm"], "ym": sf["ym"],
        },
        "balance": {
            "pe": pe, "ke": ke, "p_head": p_head, "w_theo_kw": w_theo_kw,
            "needs_mover": needs_mover, "threshold_kw": threshold_kw,
        },
    }


def _compute_gas(params, fittings, total_kf):
    m_flow = float(params["m_flow"])
    rho = float(params["rho"])
    mu = float(params["mu"])
    l_pipe = float(params["l_pipe"])
    delta_z = float(params["delta_z"])
    epsilon_m = float(params["epsilon_mm"]) / 1000.0
    schedule = params.get("schedule") or "40"
    threshold_kw = float(params.get("pump_threshold_kw") or DEFAULT_COMPRESSOR_THRESHOLD_KW)

    try:
        p1 = float(params["p1_bar"]) * 1e5
        temp_c = float(params["temp_c"])
        mw = float(params["molecular_weight"])
    except (KeyError, TypeError, ValueError):
        raise CalculationError(
            "Gas lines need Known Pressure (P1), Stream Temperature and "
            "Molecular Weight."
        )
    z = float(params.get("z_factor") or DEFAULT_Z)
    gamma = float(params.get("gamma") or DEFAULT_GAMMA)
    efficiency = float(params.get("compressor_efficiency") or DEFAULT_COMPRESSOR_EFFICIENCY)
    gas_velocity = float(params.get("gas_velocity") or DEFAULT_GAS_VELOCITY)
    if mw <= 0 or z <= 0 or gamma <= 1 or not (0 < efficiency <= 1):
        raise CalculationError(
            "Molecular weight and Z must be positive, gamma must be > 1, "
            "and compressor efficiency must be between 0 and 1."
        )
    if gas_velocity <= 0:
        raise CalculationError("Gas design velocity must be positive.")

    sf = _size_and_friction("gas", m_flow, rho, mu, l_pipe, epsilon_m, total_kf,
                             schedule, v_fixed=gas_velocity)

    pe = delta_z * (G / GC)
    ke = (sf["v_act"] ** 2) / (2 * GC)
    t_k = temp_c + 273.15

    mass_flux = m_flow / sf["a_act"]
    p2_sq = p1 ** 2 - (
        (z * R_KMOL * t_k * sf["f_darcy"] * l_pipe * (mass_flux ** 2)) / (GC * sf["d_act_m"] * mw)
    )
    if p2_sq <= 0:
        raise CalculationError(
            "The pipeline pressure-drop equation went negative under the square "
            "root - the line is too long/narrow for this flow at this pressure. "
            "Check the inputs."
        )
    p2 = math.sqrt(p2_sq)

    p_discharge = ((ke - sf["f_total"]) * rho) + p2
    if p2 <= 0 or p_discharge <= 0:
        raise CalculationError(
            "Computed a non-positive pressure while solving the gas energy "
            "balance - check the inputs (especially P1, length and flowrate)."
        )

    w_theo_kw = (
        ((gamma * R_MOL * t_k) / (gamma - 1))
        * (((p2 / p_discharge) ** ((gamma - 1) / gamma)) - 1)
        * (1 / 1000) * (1000 / mw) * m_flow
    )
    w_actual_kw = w_theo_kw / efficiency
    needs_mover = w_actual_kw > threshold_kw

    return {
        "fluid_type": "gas",
        "inputs": {
            "m_flow": m_flow, "rho": rho, "mu": mu, "l_pipe": l_pipe,
            "delta_z": delta_z, "p1_bar": params["p1_bar"], "p1_pa": p1,
            "epsilon_mm": params["epsilon_mm"], "epsilon_m": epsilon_m,
            "v_fixed": sf["v_fixed"], "pump_threshold_kw": threshold_kw,
            "schedule": schedule, "temp_c": temp_c, "temp_k": t_k,
            "molecular_weight": mw, "z_factor": z, "gamma": gamma,
            "compressor_efficiency": efficiency,
        },
        "sizing": {k: sf[k] for k in (
            "q_f", "a_pipe", "d_pipe_m", "d_pipe_in", "matched_pipe",
            "d_act_in", "d_act_m", "a_act", "v_act",
        )},
        "friction": {
            "re": sf["re"], "is_turbulent": sf["is_turbulent"], "f_fanning": sf["f_fanning"],
            "f_darcy": sf["f_darcy"], "f_skin": sf["f_skin"], "fittings": fittings,
            "total_kf": total_kf, "f_fittings": sf["f_fittings"], "v_meter": sf["v_meter"],
            "h_meter": sf["h_meter"], "f_meter": sf["f_meter"], "f_total": sf["f_total"],
            "cm": sf["cm"], "ym": sf["ym"],
        },
        "balance": {
            "pe": pe, "ke": ke, "p2_pipeline": p2, "p_discharge": p_discharge,
            "w_theo_kw": w_theo_kw, "w_actual_kw": w_actual_kw,
            "needs_mover": needs_mover, "threshold_kw": threshold_kw,
        },
    }


def compute(fluid_type, params):
    if fluid_type not in ("liquid", "gas"):
        raise CalculationError(f"Unknown fluid type '{fluid_type}'.")

    m_flow = float(params.get("m_flow") or 0)
    rho = float(params.get("rho") or 0)
    mu = float(params.get("mu") or 0)
    if m_flow <= 0 or rho <= 0 or mu <= 0:
        raise CalculationError("Mass flowrate, density and viscosity must all be positive.")

    fittings, total_kf = _resolve_fittings(params.get("fittings") or [])

    if fluid_type == "liquid":
        return _compute_liquid(params, fittings, total_kf)
    return _compute_gas(params, fittings, total_kf)
