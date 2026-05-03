import os
from typing import Any, Dict

import numpy as np
from flask import Flask, jsonify, request
from joblib import load


def _as_number(v: Any) -> float:
    try:
        if v is None:
            return 0.0
        return float(v)
    except Exception:
        return 0.0


def _load_model_bundle() -> Dict[str, Any]:
    here = os.path.dirname(os.path.abspath(__file__))
    model_path = os.path.join(here, "model.pkl")
    if not os.path.exists(model_path):
        raise FileNotFoundError(
            f"Model not found at {model_path}. Run: python train_model.py (inside the ml folder)."
        )
    return load(model_path)


bundle = _load_model_bundle()
FEATURES = bundle.get("features", ["income", "expenses", "savings", "debt"])
level_model = bundle["models"]["financial_level"]
behavior_model = bundle["models"]["spending_behavior"]

app = Flask(__name__)


@app.get("/health")
def health():
    return jsonify({"ok": True, "model_version": bundle.get("version", 1)})


@app.post("/predict")
def predict():
    body = request.get_json(silent=True) or {}

    income = _as_number(body.get("income"))
    expenses = _as_number(body.get("expenses"))
    savings = _as_number(body.get("savings"))
    debt = _as_number(body.get("debt"))

    X = np.array([[income, expenses, savings, debt]], dtype=float)

    financial_level = str(level_model.predict(X)[0])
    spending_behavior = str(behavior_model.predict(X)[0])

    return jsonify(
        {
            "financial_level": financial_level,
            "spending_behavior": spending_behavior,
            "features_used": dict(zip(FEATURES, [income, expenses, savings, debt])),
        }
    )


if __name__ == "__main__":
    port = int(os.environ.get("PORT", "5000"))
    app.run(host="127.0.0.1", port=port, debug=False)
