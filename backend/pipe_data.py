from functools import lru_cache
from pathlib import Path

import pandas as pd

DATA_PATH = Path(__file__).resolve().parent.parent / "files" / "Pipings_Data.xlsx"

_TYPO_FIXES = [
    {"nominal": 2.0, "schedule_contains": "40", "field": "Inside diameter, in", "value": 2.067},
    {"nominal": 14.0, "schedule_equals": "XS", "field": "Wall thickness, in", "value": 0.5},
]


def _apply_typo_fixes(df):
    df = df.copy()
    for fix in _TYPO_FIXES:
        mask = (df["Nominal pipe size, in"] - fix["nominal"]).abs() < 1e-6
        if "schedule_contains" in fix:
            mask &= df["Schedule no."].astype(str).str.contains(fix["schedule_contains"])
        if "schedule_equals" in fix:
            mask &= df["Schedule no."].astype(str).str.strip() == fix["schedule_equals"]
        df.loc[mask, fix["field"]] = fix["value"]
    return df


@lru_cache(maxsize=1)
def _pipe_schedule_df():
    df = pd.read_excel(DATA_PATH, sheet_name="T10-22")
    return _apply_typo_fixes(df)


@lru_cache(maxsize=1)
def _k_values_df():
    return pd.read_excel(DATA_PATH, sheet_name="K Values")


def _is_schedule_40(label):
    tokens = [t.strip().upper() for t in str(label).replace(",", " ").split()]
    return any(t in ("40", "40ST", "40S", "ST") for t in tokens)


def _row_to_pipe(row):
    return {
        "nominal_pipe_size_in": float(row["Nominal pipe size, in"]),
        "outside_diameter_in": float(row["Outside diameter, in"]),
        "schedule": row["Schedule no."],
        "wall_thickness_in": float(row["Wall thickness, in"]),
        "inside_diameter_in": float(row["Inside diameter, in"]),
    }


def find_closest_pipe(calculated_id_in, schedule="40", search_by="Inside diameter, in"):
    df = _pipe_schedule_df()

    fell_back = False
    if schedule == "40":
        candidates = df[df["Schedule no."].apply(_is_schedule_40)]
    elif schedule == "ANY":
        candidates = df
    else:
        candidates = df[df["Schedule no."].astype(str).str.strip() == str(schedule)]

    valid_pipes = candidates[candidates[search_by] >= calculated_id_in]
    if valid_pipes.empty:
        valid_pipes = df[df[search_by] >= calculated_id_in]
        fell_back = schedule != "ANY"

    if valid_pipes.empty:
        raise ValueError(
            f"No standard pipe found with an inside diameter >= {calculated_id_in:.4f} in."
        )

    closest_idx = valid_pipes[search_by].sub(calculated_id_in).abs().idxmin()
    row = valid_pipes.loc[closest_idx]

    pipe = _row_to_pipe(row)
    pipe["schedule_fallback_used"] = fell_back
    return pipe


def list_known_fittings():
    df = _k_values_df()
    return [
        {"name": row["Types of fitting or valve"], "k": float(row["K values"])}
        for _, row in df.iterrows()
    ]


def get_fitting_k(name):
    df = _k_values_df()
    match = df[df["Types of fitting or valve"] == name]
    if match.empty:
        return None
    return float(match.iloc[0]["K values"])
