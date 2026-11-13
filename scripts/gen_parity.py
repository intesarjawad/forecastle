import argparse
import json
from pathlib import Path

import numpy as np
from forecastle_pipeline.core.scoring import (
    Interval,
    closeness,
    coverage,
    day_cells,
    quantile_loss,
    typical_move,
    winkler,
)
from forecastle_pipeline.io.scoring import ScoringInput, validate_scoring_input

PROJECT_ROOT = Path(__file__).resolve().parents[1]
CASE_COUNT = 500
SEED = 20261104
HORIZON = 7
VISIBLE_DAYS = 28
INTERVAL_ALPHA = 0.2


def generate_cases() -> list[dict[str, object]]:
    """Build deterministic, mixed-scale inputs with Python scoring expectations."""
    rng = np.random.default_rng(SEED)
    cases: list[dict[str, object]] = []
    for index in range(CASE_COUNT):
        scale = 10 ** float(rng.uniform(-2, 6))
        visible = [float(value) for value in rng.normal(0, scale, VISIBLE_DAYS)]
        actual = [float(value) for value in rng.normal(0, scale, HORIZON)]
        path = [value + float(rng.normal(0, scale)) for value in actual]
        widths = [float(value) for value in rng.uniform(0, 2 * scale, HORIZON)]
        interval: Interval = {
            "lower": [value - width for value, width in zip(path, widths, strict=True)],
            "upper": [value + width for value, width in zip(path, widths, strict=True)],
        }
        k = float(rng.uniform(1, 8))
        scoring_input: ScoringInput = {
            "visible": visible,
            "path": path,
            "interval": interval,
            "actual": actual,
            "k": k,
        }
        validate_scoring_input(scoring_input)
        move = typical_move(visible)
        cases.append(
            {
                "name": f"parity-{index:03d}",
                "visible": visible,
                "path": path,
                "interval": interval,
                "actual": actual,
                "k": k,
                "expected": {
                    "typicalMove": move,
                    "closeness": closeness(path, actual, move, k),
                    "cells": day_cells(path, actual, move),
                    "coverage": coverage(interval, actual),
                    "winkler": winkler(interval, actual, INTERVAL_ALPHA),
                    "quantileLoss": quantile_loss(path, interval, actual),
                },
            }
        )
    golden: list[dict[str, object]] = json.loads(
        (PROJECT_ROOT / "scoring" / "golden.json").read_text(encoding="utf-8")
    )
    cases.extend(case for case in golden if "error" in case)
    return cases


def main() -> int:
    """Write the parity fixture, or check its exact reproducibility without writing."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="Fail if parity.json is out of date")
    args = parser.parse_args()
    destination = PROJECT_ROOT / "scoring" / "parity.json"
    cases = generate_cases()
    content = json.dumps(cases, indent=2, allow_nan=False) + "\n"
    if args.check:
        if not destination.exists() or destination.read_text(encoding="utf-8") != content:
            print("scoring/parity.json is out of date; run uv run python scripts/gen_parity.py")
            return 1
        print(f"scoring/parity.json is up to date ({len(cases)} cases, seed {SEED})")
        return 0
    destination.write_text(content, encoding="utf-8")
    print(f"Wrote {len(cases)} cases to scoring/parity.json (seed {SEED})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
