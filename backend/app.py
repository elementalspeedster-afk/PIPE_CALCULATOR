from pathlib import Path

from flask import Flask, jsonify, request, send_file, send_from_directory

from calculations import CalculationError, compute
from docx_report import build_report
from pipe_data import list_known_fittings

FRONTEND_DIR = Path(__file__).resolve().parent.parent / "frontend"

app = Flask(__name__, static_folder=None)


@app.get("/")
def index():
    return send_from_directory(FRONTEND_DIR, "index.html")


@app.get("/<path:filename>")
def static_files(filename):
    return send_from_directory(FRONTEND_DIR, filename)


@app.get("/api/fittings")
def api_fittings():
    return jsonify(list_known_fittings())


def _run_calculation():
    body = request.get_json(force=True, silent=False)
    fluid_type = body.get("fluid_type")
    result = compute(fluid_type, body)
    return result, body


@app.post("/api/calculate")
def api_calculate():
    try:
        result, _ = _run_calculation()
        return jsonify(result)
    except CalculationError as exc:
        return jsonify({"error": str(exc)}), 400
    except (KeyError, TypeError, ValueError) as exc:
        return jsonify({"error": f"Invalid input: {exc}"}), 400


@app.post("/api/report")
def api_report():
    try:
        result, body = _run_calculation()
    except CalculationError as exc:
        return jsonify({"error": str(exc)}), 400
    except (KeyError, TypeError, ValueError) as exc:
        return jsonify({"error": f"Invalid input: {exc}"}), 400

    meta = body.get("meta") or {}
    buf = build_report(result, meta=meta)
    filename_bits = [meta.get("stream_label") or "Piping", result["fluid_type"]]
    filename = "_".join(str(b).replace(" ", "") for b in filename_bits) + "_Report.docx"

    return send_file(
        buf,
        as_attachment=True,
        download_name=filename,
        mimetype="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    )


if __name__ == "__main__":
    app.run(debug=True)
