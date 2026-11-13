import importlib.util
import math
import re
from copy import deepcopy
from datetime import date, timedelta
from pathlib import Path

import pytest
from forecastle_pipeline.core.stats import (
    Comparison,
    Estimate,
    bootstrap_mean,
    bootstrap_skill,
    paired_difference,
    sign_test,
)
from forecastle_pipeline.io.files import read_object
from forecastle_pipeline.io.round_schema import ResolvedRound, parse_round

ROOT = Path(__file__).resolve().parents[2]
SCRIPT = ROOT / "scripts/benchmark_report.py"
spec = importlib.util.spec_from_file_location("benchmark_report", SCRIPT)
assert spec is not None
assert spec.loader is not None
report = importlib.util.module_from_spec(spec)
spec.loader.exec_module(report)


def live_round(opening: date, difference: float) -> ResolvedRound:
    resolved = parse_round(read_object(ROOT / "benchmark/rounds/fixture.json"))
    resolved["id"] = f"live-{opening.isoformat()}"
    resolved["openDay"] = opening.isoformat()
    resolved["charts"] = [deepcopy(resolved["charts"][0]) for _ in range(3)]
    for chart in resolved["charts"]:
        chart["forecasters"]["chronos-2"]["scores"]["scaledMae"] = 10.0
        chart["forecasters"]["crowd-median"]["scores"]["scaledMae"] = 10.0 + difference
    return resolved


def test_round_bootstrap_weights_charts_and_preserves_clusters() -> None:
    # Resampling two rounds gives means 0, 6, 6, 9, never a within-round mix.
    expected = Estimate(6.0, 0.0, 9.0)
    assert bootstrap_mean([[0.0], [9.0, 9.0]]) == expected
    assert bootstrap_mean([[0.0], [9.0, 9.0]]) == expected
    assert bootstrap_mean([[4.0, 4.0], [4.0]]) == Estimate(4.0, 4.0, 4.0)
    assert bootstrap_mean([[], []]) is None
    assert bootstrap_mean([[0.0, 10.0]]) == Estimate(5.0, 5.0, 5.0)


def test_skill_is_geometric_mean_of_chart_ratios() -> None:
    # Ratios 1/2 and 1/8 have geometric mean 1/4, not arithmetic mean 5/16.
    result = bootstrap_skill([[(1.0, 2.0)], [(1.0, 8.0)]])
    assert result is not None
    assert result.mean == pytest.approx(0.75)
    assert result.lower == pytest.approx(0.5)
    assert result.upper == pytest.approx(0.875)
    assert bootstrap_skill([[(0.0, 2.0)]]) == Estimate(1.0, 1.0, 1.0)
    mixed = bootstrap_skill([[(0.0, 2.0)], [(4.0, 2.0)]])
    assert mixed == Estimate(1.0, -1.0, 1.0)
    assert bootstrap_skill([[(1.0, 0.0)]]) is None
    assert bootstrap_skill([[(0.0, 0.0)]]) is None
    assert bootstrap_skill([]) is None


def test_paired_difference_uses_only_pairs_and_tests_round_means() -> None:
    result = paired_difference([[(2.0, 1.0)] * 3, [], [(0.0, 2.0)]])
    assert result.estimate == Estimate(0.25, -2.0, 1.0)
    assert result.charts == 4
    assert result.rounds == 2
    assert result.p_value == 1.0
    empty = paired_difference([[]])
    assert empty.estimate is None
    assert empty.charts == empty.rounds == 0
    assert empty.p_value == 1.0


@pytest.mark.parametrize(
    ("values", "expected"),
    [
        ([], 1.0),
        ([0.0, 0.0], 1.0),
        ([1.0], 1.0),
        ([1.0] * 5, 2 / 32),
        ([-1.0] * 6, 2 / 64),
        ([1.0] * 5 + [-1.0], 14 / 64),
        ([1.0, -1.0, 0.0], 1.0),
    ],
)
def test_exact_two_sided_sign_test(values: list[float], expected: float) -> None:
    assert sign_test(values) == expected


@pytest.mark.parametrize("value", [math.nan, math.inf, -math.inf])
def test_nonfinite_statistics_fail_loudly(value: float) -> None:
    with pytest.raises(ValueError, match="finite"):
        bootstrap_mean([[value]])
    with pytest.raises(ValueError, match="finite"):
        sign_test([value])


def test_negative_losses_are_rejected() -> None:
    with pytest.raises(ValueError, match="nonnegative"):
        bootstrap_skill([[(-1.0, 2.0)]])


def test_every_report_metric_matches_hand_computed_fixture_values() -> None:
    resolved = parse_round(read_object(ROOT / "benchmark/rounds/fixture.json"))
    table = re.sub(r" {2,}", " ", report.render_table([resolved]))
    assert (
        "| chronos-2 (opponent) | 3 | 9 | 1.8571 [1.8571, 1.8571] | 7.0000 [7.0000, 7.0000] "
        "| 1.0000 [1.0000, 1.0000] | 20.0000 [20.0000, 20.0000] "
        "| 0.9762 [0.9762, 0.9762] | 0.0000 [0.0000, 0.0000] |"
    ) in table
    assert (
        "| Crowd median | 1 | 10 | 22.5000 [22.5000, 22.5000] | 0.0000 [0.0000, 0.0000] "
        "| 0.0000 [0.0000, 0.0000] | 196.2000 [196.2000, 196.2000] "
        "| 10.2900 [10.2900, 10.2900] | -11.1154 [-11.1154, -11.1154] |"
    ) in table
    assert "| Median human (players) | 1 | 10 | 22.5000" in table
    assert "9.9167 [9.9167, 9.9167]" in table


def test_monday_sensitivity_prevents_an_all_rounds_headline() -> None:
    monday = date(2026, 11, 9)
    rounds = [live_round(monday + timedelta(weeks=week), (-1.0) ** week) for week in range(6)]
    rounds += [live_round(monday + timedelta(weeks=week, days=3), 10.0) for week in range(6)]
    overall = report.comparison(rounds)
    sensitivity = report.comparison(rounds, monday_only=True)
    assert overall.estimate is not None
    assert overall.estimate.lower > 0
    assert sensitivity.estimate is not None
    assert sensitivity.estimate.lower < 0 < sensitivity.estimate.upper
    assert sensitivity.p_value == 1.0
    assert overall.charts == 36
    assert sensitivity.charts == 18
    text = report.render_report(rounds)
    assert "too close to call (n = 36 charts in 12 rounds" in text
    assert "All rounds:" in text
    assert "Monday-only sensitivity:" in text
    assert "is ahead" not in text
    assert "is behind" not in text


@pytest.mark.parametrize(("difference", "word"), [(-1.0, "ahead"), (1.0, "behind")])
def test_headline_requires_six_contributing_monday_rounds(difference: float, word: str) -> None:
    monday = date(2026, 11, 9)
    rounds = [live_round(monday + timedelta(weeks=week), difference) for week in range(6)]
    assert f"is {word}" in report.headline(
        report.comparison(rounds), report.comparison(rounds, monday_only=True)
    )
    thursdays = [
        live_round(monday + timedelta(weeks=week, days=3), difference) for week in range(6)
    ]
    early = rounds[:5] + thursdays
    text = report.headline(report.comparison(early), report.comparison(early, monday_only=True))
    assert "early, n = 33 charts in 11 rounds" in text
    assert "is ahead" not in text
    assert "is behind" not in text


@pytest.mark.parametrize("bounds", [(-1.0, 1.0), (0.0, 1.0), (-1.0, 0.0), (0.0, 0.0)])
def test_interval_containing_zero_always_reads_too_close(bounds: tuple[float, float]) -> None:
    comparison = Comparison(Estimate(0.0, *bounds), 18, 6, 1.0)
    assert "too close to call" in report.headline(comparison, comparison)


def test_opposite_interval_signs_are_too_close() -> None:
    positive = Comparison(Estimate(2.0, 1.0, 3.0), 36, 12, 0.01)
    negative = Comparison(Estimate(-2.0, -3.0, -1.0), 18, 6, 0.03)
    assert "too close to call" in report.headline(positive, negative)


def test_printed_interval_preserves_small_nonzero_bounds() -> None:
    assert report.format_estimate(Estimate(1e-7, 1e-8, 2e-7)) == "1e-07 [1e-08, 2e-07]"
    assert report.format_estimate(Estimate(-1e-7, -2e-7, -1e-8)) == "-1e-07 [-2e-07, -1e-08]"
    assert report.format_estimate(Estimate(0.0, -1e-8, 1e-8)) == "0.0000 [-1e-08, 1e-08]"
