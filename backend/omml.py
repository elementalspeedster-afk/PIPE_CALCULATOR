from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml import OxmlElement
from docx.oxml.ns import qn


def _m(tag):
    return OxmlElement(f"m:{tag}")


def run(text):
    r = _m("r")
    r.append(_m("rPr"))
    t = _m("t")
    t.set(qn("xml:space"), "preserve")
    t.text = str(text)
    r.append(t)
    return r


def seq(*parts):
    out = []
    for p in parts:
        out.append(run(p) if isinstance(p, str) else p)
    return out


def frac(num_parts, den_parts):
    f = _m("f")
    f.append(_m("fPr"))
    num = _m("num")
    for e in seq(*num_parts):
        num.append(e)
    den = _m("den")
    for e in seq(*den_parts):
        den.append(e)
    f.append(num)
    f.append(den)
    return f


def sup(base_parts, sup_parts):
    s = _m("sSup")
    e = _m("e")
    for el in seq(*base_parts):
        e.append(el)
    sp = _m("sup")
    for el in seq(*sup_parts):
        sp.append(el)
    s.append(e)
    s.append(sp)
    return s


def sub(base_parts, sub_parts):
    s = _m("sSub")
    e = _m("e")
    for el in seq(*base_parts):
        e.append(el)
    sb = _m("sub")
    for el in seq(*sub_parts):
        sb.append(el)
    s.append(e)
    s.append(sb)
    return s


def sqrt(inner_parts):
    rad = _m("rad")
    rad_pr = _m("radPr")
    deg_hide = _m("degHide")
    deg_hide.set(qn("m:val"), "1")
    rad_pr.append(deg_hide)
    rad.append(rad_pr)
    rad.append(_m("deg"))
    e = _m("e")
    for el in seq(*inner_parts):
        e.append(el)
    rad.append(e)
    return rad


def group(*parts):
    d = _m("d")
    d.append(_m("dPr"))
    e = _m("e")
    for el in seq(*parts):
        e.append(el)
    d.append(e)
    return d


def add_equation(doc_or_paragraph, parts, center=True):
    if hasattr(doc_or_paragraph, "add_paragraph"):
        paragraph = doc_or_paragraph.add_paragraph()
    else:
        paragraph = doc_or_paragraph
    if center:
        paragraph.alignment = WD_ALIGN_PARAGRAPH.CENTER
    o_math = _m("oMath")
    for el in parts:
        o_math.append(el)
    paragraph._p.append(o_math)
    return paragraph
