import io

from docx import Document
from docx.enum.table import WD_TABLE_ALIGNMENT
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.shared import Pt, RGBColor

import omml as M
from numfmt import eq_number, fmt

ACCENT = RGBColor(0x1F, 0x3B, 0x57)


def _p(doc, text="", size=11, bold=False, italic=False, align=None, space_after=6):
    para = doc.add_paragraph()
    para.paragraph_format.space_after = Pt(space_after)
    if align is not None:
        para.alignment = align
    run = para.add_run(text)
    run.bold = bold
    run.italic = italic
    run.font.size = Pt(size)
    return para


def _heading(doc, text, size=13):
    para = doc.add_paragraph()
    para.paragraph_format.space_before = Pt(14)
    para.paragraph_format.space_after = Pt(6)
    run = para.add_run(text.upper())
    run.bold = True
    run.font.size = Pt(size)
    run.font.color.rgb = ACCENT
    return para


def _eq(doc, parts, note=None):
    para = M.add_equation(doc, parts)
    para.paragraph_format.space_after = Pt(2)
    if note:
        n = doc.add_paragraph()
        n.alignment = WD_ALIGN_PARAGRAPH.CENTER
        r = n.add_run(note)
        r.italic = True
        r.font.size = Pt(9)
    return para


def _table(doc, headers, rows, widths=None):
    t = doc.add_table(rows=1, cols=len(headers))
    t.style = "Light Grid Accent 1"
    t.alignment = WD_TABLE_ALIGNMENT.CENTER
    hdr = t.rows[0].cells
    for i, h in enumerate(headers):
        hdr[i].text = str(h)
        for para in hdr[i].paragraphs:
            for run in para.runs:
                run.bold = True
    for row in rows:
        cells = t.add_row().cells
        for i, val in enumerate(row):
            cells[i].text = str(val)
    doc.add_paragraph().paragraph_format.space_after = Pt(4)
    return t


def _num(value, sig=4):
    return eq_number(value, sig)


def _unit_num(value, unit, sig=4):
    return [*_num(value, sig), " " + unit]


def _sum_chain(values, sig=4):
    parts = list(_num(values[0], sig))
    for v in values[1:]:
        if v < 0:
            parts += [" - "] + list(_num(abs(v), sig))
        else:
            parts += [" + "] + list(_num(v, sig))
    return parts


def build_report(result, meta=None):
    meta = meta or {}
    doc = Document()

    fluid_type = result["fluid_type"]
    is_liquid = fluid_type == "liquid"
    mover = "Pump" if is_liquid else "Compressor"
    inp = result["inputs"]
    siz = result["sizing"]
    fr = result["friction"]
    bal = result["balance"]
    pipe = siz["matched_pipe"]

    title = "LIQUIDS" if is_liquid else "GAS"
    _p(doc, "PIPING CALCULATION REPORT", size=16, bold=True, align=WD_ALIGN_PARAGRAPH.CENTER)
    _p(doc, title, size=13, bold=True, align=WD_ALIGN_PARAGRAPH.CENTER)
    eq1 = meta.get("equipment1") or "EQUIPMENT 1"
    eq2 = meta.get("equipment2") or "EQUIPMENT 2"
    _p(doc, f"{eq1} TO {eq2}", bold=True, align=WD_ALIGN_PARAGRAPH.CENTER)

    stream = meta.get("stream_label") or "STREAM"
    decisive_kw = bal["w_theo_kw"] if is_liquid else bal["w_actual_kw"]
    p2_display = fmt(inp["p2_bar"]) if is_liquid else "-"
    _p(doc, f"Table. Technical Specification for {stream}", italic=True, size=10)
    _table(
        doc,
        [stream, eq1, eq2],
        [
            ["Temperature (°C)", meta.get("temp1_c", "-"), meta.get("temp2_c", "-")],
            ["Pressure (bar)", fmt(inp["p1_bar"]), p2_display],
            ["Length of Pipe (m)", fmt(inp["l_pipe"]), ""],
            ["Pipe Diameter (in)", fmt(pipe["inside_diameter_in"]), ""],
            ["Pipe Size", f"{fmt(pipe['nominal_pipe_size_in'])} in, Sch {pipe['schedule']}", ""],
            ["Total Friction Loss (J/kg)", fmt(fr["f_total"]), ""],
            ["Potential Head (J/kg)", fmt(bal["pe"]), ""],
            ["Kinetic Head (J/kg)", fmt(bal["ke"]), ""],
            ["Total Mechanical Energy Balance (kW)", fmt(decisive_kw), ""],
            [f"{mover.upper()} IS", "REQUIRED" if bal["needs_mover"] else "NOT REQUIRED", ""],
        ],
    )

    _heading(doc, "Data and Fluid Properties")
    _p(doc, f"Fluid type: {'Liquid' if is_liquid else 'Gas'}")
    _p(doc, f"Mass Flowrate: {fmt(inp['m_flow'])} kg/s")
    _p(doc, f"Density: {fmt(inp['rho'])} kg/m³")
    _p(doc, f"Viscosity: {fmt(inp['mu'])} Pa·s")
    _p(doc, f"Surface Roughness: {fmt(inp['epsilon_mm'])} mm")
    _p(doc, f"Design Velocity: {fmt(inp['v_fixed'])} m/s")

    _heading(doc, "Volumetric Flow Rate")
    _eq(doc, M.seq(
        M.sub(["Q"], ["f"]), "=", M.frac(["mass flowrate"], ["density"]), "=",
        M.frac(_unit_num(inp["m_flow"], "kg/s"), _unit_num(inp["rho"], "kg/m³")), "=",
        *_num(siz["q_f"]), M.sup([" m"], ["3"]), "/s",
    ))

    _heading(doc, "Pipe Diameter")
    _eq(doc, M.seq(
        "A", "=", M.frac([M.sub(["Q"], ["f"])], ["v"]), "=",
        M.frac(_unit_num(siz["q_f"], "m³/s"), _unit_num(inp["v_fixed"], "m/s")), "=",
        *_num(siz["a_pipe"]), M.sup([" m"], ["2"]),
    ))
    _eq(doc, M.seq(
        M.sub(["D"], ["p"]), "=", M.sqrt([M.frac(["4A"], [M.run("π")])]), "=",
        *_unit_num(siz["d_pipe_m"], "m"), "≈", *_unit_num(siz["d_pipe_in"], "in"),
    ))

    _p(doc, f"Required pipe schedule search basis: Schedule {inp.get('schedule', '40')}"
            if inp.get("schedule") else "", size=9, italic=True)

    _table(
        doc, ["Data", "Value"],
        [
            ["Nominal Pipe Size", f"{fmt(pipe['nominal_pipe_size_in'])} in"],
            ["Schedule", str(pipe["schedule"])],
            ["Outside Diameter", f"{fmt(pipe['outside_diameter_in'])} in"],
            ["Inside Diameter", f"{fmt(pipe['inside_diameter_in'])} in"
                                 f"  ({fmt(siz['d_act_m'])} m)"],
            ["Wall Thickness", f"{fmt(pipe['wall_thickness_in'])} in"],
        ],
    )

    _heading(doc, "Standard Area and Fluid Velocity")
    _eq(doc, M.seq(
        M.sub(["A"], ["standard"]), "=", M.frac([M.run("π")], ["4"]),
        M.sup([M.sub(["D"], ["p"])], ["2"]), "=", *_num(siz["a_act"]), M.sup([" m"], ["2"]),
    ))
    _eq(doc, M.seq(
        "v", "=", M.frac([M.sub(["Q"], ["f"])], ["A"]), "=", *_num(siz["v_act"]), " m/s",
    ))

    _heading(doc, "Friction Losses")
    _p(doc, f"Length of Pipe = {fmt(inp['l_pipe'])} m")

    _p(doc, "Friction Loss Due to Pipe (Skin Friction)", bold=True, size=10.5)
    _eq(doc, M.seq(
        M.sub(["N"], ["Re"]), "=", M.frac(["D v ρ"], ["μ"]),
        "=", *_num(fr["re"], 5),
    ))
    regime = "Turbulent" if fr["is_turbulent"] else "Laminar"
    comparison = "≥ 2300" if fr["is_turbulent"] else "< 2300"
    _p(doc, f"N_Re {comparison} ∴ {regime}", italic=True)

    if fr["is_turbulent"]:
        _p(doc, "Flow is turbulent: the Churchill (Colebrook-type) equation is used for the "
                "Fanning friction factor, where ε is the pipe surface roughness.")
        _eq(doc, M.seq(
            M.frac(["1"], [M.sqrt(["f"])]), "=", "-4 log", M.group(
                M.frac(["0.27ε"], ["D"]), "+", M.sup([M.group(M.frac(["7"], ["Re"]))], ["0.9"]),
            ),
        ))
    else:
        _p(doc, "Flow is laminar: the Fanning friction factor is 16 / Re.")
        _eq(doc, M.seq("f", "=", M.frac(["16"], [M.sub(["N"], ["Re"])])))

    _eq(doc, M.seq("f", "=", *_num(fr["f_fanning"], 4)))
    _eq(doc, M.seq(
        M.sub(["f"], ["Darcy"]), "=", "4f", "=", "4(", *_num(fr["f_fanning"], 4), ")", "=",
        *_num(fr["f_darcy"], 4),
    ))
    _eq(doc, M.seq(
        M.sub(["F"], ["skin"]), "=", M.frac(
            [M.sub(["f"], ["Darcy"]), " L", M.sup(["v"], ["2"])],
            ["2", M.sub(["g"], ["c"]), M.sub(["D"], ["p"])],
        ), "=", *_num(fr["f_skin"]), " J/kg",
    ))

    _p(doc, "Friction Loss Due to Fittings", bold=True, size=10.5)
    if fr["fittings"]:
        _table(
            doc, ["Type of Fitting/Valve", "K", "Quantity", "Kf"],
            [[f["name"], fmt(f["k"]), fmt(f["qty"]), fmt(f["kf"])] for f in fr["fittings"]]
            + [["TOTAL", "", "", fmt(fr["total_kf"])]],
        )
    else:
        _p(doc, "No fittings or valves were added for this line.")
    _eq(doc, M.seq(
        M.sub(["F"], ["fittings"]), "=", M.frac(
            [M.sub(["f"], ["Darcy"]), M.sup(["v"], ["2"]), M.sub(["K"], ["f, total"])],
            ["2", M.sub(["g"], ["c"])],
        ), "=", *_num(fr["f_fittings"]), " J/kg",
    ))

    _p(doc, "Friction Loss Due to Meters", bold=True, size=10.5)
    _p(doc, "Venturi/orifice meter with throat-to-pipe diameter ratio φ = 2, discharge "
            f"coefficient Cm = {fmt(fr['cm'])}, Ym = {fmt(fr['ym'])}, Km = 0.1 "
            "(good design practice).")
    _eq(doc, M.seq(M.sub(["v"], ["meter"]), "=", M.sup(["φ"], ["2"]), "v", "=",
                    *_num(fr["v_meter"])))
    _eq(doc, M.seq(
        M.sub(["ΔH"], ["m"]), "=", M.sup([M.group(M.frac(
            [M.sub(["v"], ["meter"])], [M.sub(["C"], ["m"]), M.sub(["Y"], ["m"])],
        ))], ["2"]),
        M.group(M.frac([M.sup(["φ"], ["4"]), "- 1"], ["2", M.sub(["g"], ["c"])])), "=",
        *_num(fr["h_meter"]), " J/kg",
    ))
    _eq(doc, M.seq(
        M.sub(["F"], ["meter"]), "=", M.sub(["K"], ["m"]), M.sub(["ΔH"], ["m"]), "=",
        *_num(fr["f_meter"]), " J/kg",
    ))

    _p(doc, "Total Friction Loss", bold=True, size=10.5)
    _eq(doc, M.seq(
        "F", "=", M.sub(["F"], ["skin"]), "+", M.sub(["F"], ["fittings"]), "+",
        M.sub(["F"], ["meter"]), "=",
        *_sum_chain([fr["f_skin"], fr["f_fittings"], fr["f_meter"]]),
        "=", *_num(fr["f_total"]), " J/kg",
    ))

    _heading(doc, "Potential Head")
    _eq(doc, M.seq(
        M.run("ΔPE"), "=", M.frac(["Δz g"], [M.sub(["g"], ["c"])]), "=",
        M.frac(_unit_num(inp["delta_z"], "m x 9.81 m/s"), ["1"]), "=",
        *_num(bal["pe"]), " J/kg",
    ))

    _heading(doc, "Kinetic Head")
    _eq(doc, M.seq(
        M.run("ΔKE"), "=", M.frac([M.sup(["v"], ["2"])], ["2", M.sub(["g"], ["c"])]),
        "=", *_num(bal["ke"]), " J/kg",
    ))

    if is_liquid:
        _heading(doc, "Pressure Head")
        _eq(doc, M.seq(
            M.frac(["ΔP"], ["ρ"]), "=", M.frac([M.sub(["P"], ["2"]), "-", M.sub(["P"], ["1"])],
                                                           ["ρ"]), "=",
            M.frac(
                [*_num(inp["p2_pa"], 6), " - ", *_num(inp["p1_pa"], 6), " Pa"],
                _unit_num(inp["rho"], "kg/m³"),
            ), "=", *_num(bal["p_head"]), " J/kg",
        ))

        _heading(doc, "Total Mechanical Energy Balance")
        _eq(doc, M.seq(
            M.sub(["W"], ["theo"]), "=", M.group("ΔKE", "+", "ΔPE", "+",
                                                  M.frac(["ΔP"], ["ρ"]), "+", "F"),
            M.sub([" x m"], ["flow"]),
        ))
        _eq(doc, M.seq(
            M.sub(["W"], ["theo"]), "=", M.group(
                *_sum_chain([bal["ke"], bal["pe"], bal["p_head"], fr["f_total"]]),
            ), " J/kg x ", *_num(inp["m_flow"]), " kg/s / 1000", "=", *_num(bal["w_theo_kw"]), " kW",
        ))
        decision = (
            f"{fmt(bal['w_theo_kw'])} kW > {fmt(bal['threshold_kw'])} kW ∴ {mover} is required."
            if bal["needs_mover"] else
            f"{fmt(bal['w_theo_kw'])} kW ≤ {fmt(bal['threshold_kw'])} kW ∴ no {mover.lower()} needed."
        )
        _p(doc, decision, bold=True)
        buf = io.BytesIO()
        doc.save(buf)
        buf.seek(0)
        return buf

    _heading(doc, "Initial Suction Pressure")
    _p(doc, f"Molecular Weight = {fmt(inp['molecular_weight'])} kg/kmol, "
            f"Z = {fmt(inp['z_factor'])}, Stream Temperature = {fmt(inp['temp_c'])} °C "
            f"({fmt(inp['temp_k'])} K).")
    _p(doc, "G is the mass flux (mass flowrate / pipe area, equivalently density x velocity).")
    _eq(doc, M.seq(
        M.sup([M.sub(["P"], ["1"])], ["2"]), "-", M.sup([M.sub(["P"], ["2"])], ["2"]), "=",
        M.frac(
            ["Z R T ", M.sub(["f"], ["Darcy"]), " L ", M.sup(["G"], ["2"])],
            [M.sub(["g"], ["c"]), M.sub(["D"], ["p"]), " MW"],
        ),
    ))
    _eq(doc, M.seq(
        M.sub(["P"], ["2"]), "=", M.sqrt([
            M.sup([M.sub(["P"], ["1"])], ["2"]), "-", M.frac(
                ["Z R T ", M.sub(["f"], ["Darcy"]), " L ", M.sup(["G"], ["2"])],
                [M.sub(["g"], ["c"]), M.sub(["D"], ["p"]), " MW"],
            ),
        ]), "=", *_num(bal["p2_pipeline"]), " Pa",
    ))

    _heading(doc, "Initial Discharge Pressure")
    _eq(doc, M.seq(
        M.sub(["P"], ["discharge"]), "=", M.group("ΔKE", "-", "F"), "ρ", "+", M.sub(["P"], ["2"]),
        "=", M.group(*_sum_chain([bal["ke"], -fr["f_total"]])), " J/kg x ",
        *_unit_num(inp["rho"], "kg/m³"), "+", *_num(bal["p2_pipeline"]), " Pa", "=",
        *_num(bal["p_discharge"]), " Pa",
    ))

    _heading(doc, "Total Mechanical Energy Balance")
    _p(doc, f"γ (Cp/Cv) = {fmt(inp['gamma'])}, compressor efficiency = "
            f"{fmt(inp['compressor_efficiency'] * 100, 3)}%.")
    _eq(doc, M.seq(
        M.sub(["W"], ["theo"]), "=", M.frac(["γ R T"], ["γ - 1"]),
        M.group(M.sup([M.frac([M.sub(["P"], ["2"])], [M.sub(["P"], ["discharge"])])],
                      [M.frac(["γ - 1"], ["γ"])]), "- 1"), M.sub([" x m"], ["flow"]), "/ MW",
    ))
    _eq(doc, M.seq(
        M.sub(["W"], ["theo"]), "=", *_num(bal["w_theo_kw"]), " kW",
    ))
    _eq(doc, M.seq(
        M.sub(["W"], ["actual"]), "=", M.frac([M.sub(["W"], ["theo"])], ["efficiency"]), "=",
        *_num(bal["w_actual_kw"]), " kW",
    ))
    decision = (
        f"{fmt(bal['w_actual_kw'])} kW > {fmt(bal['threshold_kw'])} kW ∴ {mover} is required."
        if bal["needs_mover"] else
        f"{fmt(bal['w_actual_kw'])} kW ≤ {fmt(bal['threshold_kw'])} kW ∴ no {mover.lower()} needed."
    )
    _p(doc, decision, bold=True)

    buf = io.BytesIO()
    doc.save(buf)
    buf.seek(0)
    return buf
