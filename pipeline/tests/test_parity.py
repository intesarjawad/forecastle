import json

import pytest

from .test_scoring import GOLDEN_CASES, SCORING_DIR, ScoringCase, assert_scores

PARITY_CASES: list[ScoringCase] = json.loads((SCORING_DIR / "parity.json").read_text())


def test_parity_case_count() -> None:
    assert len([case for case in PARITY_CASES if "error" not in case]) == 500
    assert len({case["name"] for case in PARITY_CASES}) == len(PARITY_CASES)
    assert [case for case in PARITY_CASES if "error" in case] == [
        case for case in GOLDEN_CASES if "error" in case
    ]


@pytest.mark.parametrize("case", PARITY_CASES, ids=[case["name"] for case in PARITY_CASES])
def test_parity(case: ScoringCase) -> None:
    assert_scores(case, 1e-9)
