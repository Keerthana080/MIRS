import os
import numpy as np
from joblib import dump
from sklearn.tree import DecisionTreeClassifier


def _label_financial_level(income: float, expenses: float, savings: float, debt: float) -> str:
   
    if income <= 0:
        return "Critical"
    sr = savings / max(income, 1.0)  # savings rate
    dti = debt / max(income, 1.0)  # debt-to-income
    if savings < 0 or dti >= 1.5 or sr < 0.05:
        return "Critical"
    if dti >= 0.6 or sr < 0.15:
        return "Risky"
    return "Stable"


def _label_spending_behavior(income:float,expenses:float,savings:float,debt:float)-> str:
    if income <= 0:
        return "Overspending"
    sr = savings / max(income, 1.0)
    if savings < 0 or sr < 0.08:
        return "Overspending"
    if sr <= 0.22:
        return "Balanced"
    return "Saver"

def build_dataset(n: int = 5000, seed: int = 42):
    rng = np.random.default_rng(seed)

    # Income distribution (monthly)
    income = rng.integers(8000, 120000, size=n).astype(float)

    # Expenses as a fraction of income (sometimes above income)
    expense_frac = rng.normal(loc=0.78, scale=0.22, size=n)
    expense_frac = np.clip(expense_frac, 0.15, 1.40)
    expenses = np.round(income * expense_frac, 2)

    # Savings derived
    savings = np.round(income - expenses, 2)

    # Debt:overspending somewhat
    base_debt = rng.gamma(shape=2.0, scale=25000.0, size=n)
    debt = np.round(base_debt * (1.0 + np.maximum(0.0, expense_frac - 0.9)), 2)

    X = np.column_stack([income, expenses, savings, debt])
    y_level = np.array([_label_financial_level(i, e, s, d) for i, e, s, d in X], dtype=object)
    y_behavior = np.array([_label_spending_behavior(i, e, s, d) for i, e, s, d in X], dtype=object)
    return X, y_level, y_behavior


def train_and_save(out_path: str):
    X, y_level, y_behavior = build_dataset()

    level_model = DecisionTreeClassifier(
        max_depth=5,
        min_samples_leaf=20,
        random_state=42,
    )
    behavior_model = DecisionTreeClassifier(
        max_depth=5,
        min_samples_leaf=20,
        random_state=42,
    )

    level_model.fit(X, y_level)
    behavior_model.fit(X, y_behavior)

    bundle = {
        "version": 1,
        "features": ["income", "expenses", "savings", "debt"],
        "models": {
            "financial_level": level_model,
            "spending_behavior": behavior_model,
        },
        "classes": {
            "financial_level": sorted(set(y_level.tolist())),
            "spending_behavior": sorted(set(y_behavior.tolist())),
        },
    }
    dump(bundle, out_path)


if __name__ == "__main__":
    here = os.path.dirname(os.path.abspath(__file__))
    out = os.path.join(here, "model.pkl")
    train_and_save(out)
    print(f"Saved model to: {out}")
