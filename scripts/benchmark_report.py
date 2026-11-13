import argparse
from collections.abc import Sequence
from datetime import date
from pathlib import Path
from statistics import median
from typing import Literal

from forecastle_pipeline.core.stats import (
    BOOTSTRAP_RESAMPLES,
    BOOTSTRAP_SEED,
    MIN_HEADLINE_ROUNDS,
    Comparison,
    Estimate,
    bootstrap_mean,
    bootstrap_skill,
    paired_difference,
)
from forecastle_pipeline.io.files import read_object
from forecastle_pipeline.io.round_schema import MIN_CROWD, ResolvedRound, parse_round

PROJECT_ROOT = Path(__file__).resolve().parents[1]
START_MARKER = "<!-- benchmark:start -->"
END_MARKER = "<!-- benchmark:end -->"
Metric = Literal["scaledMae", "closeness", "coverage", "scaledWinkler", "scaledQuantileLoss"]
METRICS: tuple[tuple[Metric, str], ...] = (
    ("scaledMae", "Scaled MAE"),
    ("closeness", "Closeness"),
    ("coverage", "80% coverage"),
    ("scaledWinkler", "Scaled Winkler"),
    ("scaledQuantileLoss", "Scaled 3-quantile loss"),
)
FORECASTERS = (
    ("chronos-2", "chronos-2 (opponent)"),
    ("chronos-2-cutoff", "chronos-2 at cutoff"),
    ("chronos-2-long", "chronos-2 (365 points)"),
    ("chronos-2-small", "chronos-2-small"),
    ("seasonal-naive-7", "Seasonal naive 7"),
    ("flat", "Flat line"),
    ("crowd-median", "Crowd median"),
    ("median-human", "Median human (players)"),
)


def load_rounds(root: Path) -> list[ResolvedRound]:
    """Validate persisted evidence before reporting any public numbers."""
    rounds: list[ResolvedRound] = []
    for path in sorted((root / "benchmark/rounds").glob("*.json")):
        try:
            resolved = parse_round(read_object(path))
        except ValueError as error:
            msg = f"Invalid resolved round {path}: {error}"
            raise ValueError(msg) from error
        if resolved["id"] != path.stem or resolved["id"] not in (
            "fixture",
            f"live-{resolved['openDay']}",
        ):
            msg = f"Round id must match its filename and opening date (or fixture): {path}"
            raise ValueError(msg)
        rounds.append(resolved)
    return sorted(rounds, key=lambda item: (item["openDay"], item["id"]))


def format_estimate(value: Estimate | None) -> str:
    """Render means and interval bounds consistently across public outputs."""
    if value is None:
        return "unavailable"
    # Preserve the sign of small bounds so printed intervals cannot imply a zero crossing.
    numbers = [
        f"{number:.4g}" if number != 0 and round(number, 4) == 0 else f"{number:.4f}"
        for number in (value.mean, value.lower, value.upper)
    ]
    return f"{numbers[0]} [{numbers[1]}, {numbers[2]}]"


def render_table(rounds: Sequence[ResolvedRound]) -> str:
    """Show chart counts and submission counts alongside every forecaster's metrics."""
    headers = [
        "Forecaster",
        "n charts",
        "Median submissions / chart",
        *(label for _, label in METRICS),
        "Skill vs seasonal naive",
    ]
    rows = [headers]
    for name, label in FORECASTERS:
        clusters = [
            [chart for chart in resolved["charts"] if name in chart["forecasters"]]
            for resolved in rounds
        ]
        charts = [chart for cluster in clusters for chart in cluster]
        values = [
            format_estimate(
                bootstrap_mean(
                    [
                        [chart["forecasters"][name]["scores"][key] for chart in group]
                        for group in clusters
                    ]
                )
            )
            for key, _ in METRICS
        ]
        skill = bootstrap_skill(
            [
                [
                    (
                        chart["forecasters"][name]["scores"]["scaledMae"],
                        chart["forecasters"]["seasonal-naive-7"]["scores"]["scaledMae"],
                    )
                    for chart in cluster
                ]
                for cluster in clusters
            ]
        )
        submissions = (
            f"{median(chart['submissionCount'] for chart in charts):g}"
            if charts
            else "no charts scored yet"
        )
        rows.append(
            [
                label,
                str(len(charts)),
                submissions,
                *values,
                format_estimate(skill),
            ]
        )
    widths = [max(len(cell) for cell in column) for column in zip(*rows, strict=True)]
    rows.insert(1, ["-" * width for width in widths])
    return "\n".join(
        "| " + " | ".join(cell.ljust(width) for cell, width in zip(row, widths, strict=True)) + " |"
        for row in rows
    )


def comparison(rounds: Sequence[ResolvedRound], *, monday_only: bool = False) -> Comparison:
    """Pair eligible charts before computing either analysis of the primary metric."""
    return paired_difference(
        [
            [
                (
                    chart["forecasters"]["crowd-median"]["scores"]["scaledMae"],
                    chart["forecasters"]["chronos-2"]["scores"]["scaledMae"],
                )
                for chart in resolved["charts"]
                if "crowd-median" in chart["forecasters"]
            ]
            for resolved in rounds
            if not monday_only or date.fromisoformat(resolved["openDay"]).weekday() == 0
        ]
    )


def headline(all_rounds: Comparison, mondays: Comparison) -> str:
    """Require sufficient rounds and agreement between both intervals for a claim."""
    counts = f"n = {all_rounds.charts} charts in {all_rounds.rounds} rounds"
    monday_counts = f"Monday-only n = {mondays.charts} charts in {mondays.rounds} rounds"
    if all_rounds.rounds == 0:
        return f"No paired rounds scored yet ({counts}; {monday_counts})."
    if min(all_rounds.rounds, mondays.rounds) < MIN_HEADLINE_ROUNDS:
        return f"too close to call (early, {counts}; {monday_counts})."
    overall, sensitivity = all_rounds.estimate, mondays.estimate
    if overall is not None and sensitivity is not None:
        if overall.upper < 0 and sensitivity.upper < 0:
            return f"Crowd median is ahead of chronos-2 ({counts}; {monday_counts})."
        if overall.lower > 0 and sensitivity.lower > 0:
            return f"Crowd median is behind chronos-2 ({counts}; {monday_counts})."
    return f"too close to call ({counts}; {monday_counts})."


def comparison_line(label: str, result: Comparison) -> str:
    """Publish the direction, paired sample size, interval and round-level p-value."""
    p_value = f"{result.p_value:.6g}" if result.rounds else "unavailable"
    return (
        f"{label}: crowd median minus chronos-2 scaled MAE = {format_estimate(result.estimate)}; "
        f"exact two-sided sign-test p = {p_value}; "
        f"n = {result.charts} paired charts in {result.rounds} contributing rounds."
    )


def render_summary(rounds: Sequence[ResolvedRound]) -> str:
    """Use the same headline and both comparison lines in every publication."""
    overall = comparison(rounds)
    mondays = comparison(rounds, monday_only=True)
    return "\n\n".join(
        (
            headline(overall, mondays),
            comparison_line("All rounds", overall),
            comparison_line("Monday-only sensitivity", mondays),
        )
    )


def render_report(rounds: Sequence[ResolvedRound]) -> str:
    """Render the live benchmark without incorporating synthetic fixture results."""
    charts = sum(len(resolved["charts"]) for resolved in rounds)
    return (
        "# Benchmark\n\n## Live rounds\n\n"
        f"Resolved: {charts} charts in {len(rounds)} rounds.\n\n"
        + render_table(rounds)
        + "\n\n"
        + render_summary(rounds)
        + "\n\nArithmetic chart means carry 95% percentile bootstrap intervals, resampling "
        f"whole contributing rounds ({BOOTSTRAP_RESAMPLES:,} resamples, seed {BOOTSTRAP_SEED}). "
        "Charts have equal weight, including when crowd eligibility varies by round. "
        f"Crowd median and median human rows require at least {MIN_CROWD} accepted submissions "
        "per chart. Median human aggregates each submission metric separately. "
        "Skill is 1 minus the geometric mean of chart scaled-MAE ratios against seasonal naive. "
        "Skill is unavailable if any included chart has zero seasonal-naive MAE; "
        "no chart is removed for this reason.\n\n"
        "The primary difference is crowd median minus opponent scaled MAE; negative values "
        "favour the crowd. Sign tests use round mean differences, omitting exact ties. "
        "Comparison counts include only rounds with eligible pairs. "
        f"Headline claims require at least {MIN_HEADLINE_ROUNDS} contributing rounds "
        "in both analyses "
        "and intervals excluding zero with the same sign.\n\n"
        "Consecutive Monday and Thursday rounds share scored days and are not fully independent. "
        "Monday-only scored windows do not overlap. Inputs are public; entries are players, "
        "and self-selection and access to later information limit the comparison. "
        "Synthetic fixtures are excluded from live totals.\n\n"
        "Analysis rules: [ADR 0008](docs/adr/0008-live-round-analysis.md).\n"
    )


def replace_markers(readme: str, content: str) -> str:
    """Replace exactly one ordered marker pair, preserving all surrounding text."""
    if (
        readme.count(START_MARKER) != 1
        or readme.count(END_MARKER) != 1
        or readme.index(START_MARKER) >= readme.index(END_MARKER)
    ):
        msg = "README.md must contain exactly one ordered benchmark marker pair"
        raise ValueError(msg)
    before, _, rest = readme.partition(START_MARKER)
    _, _, after = rest.partition(END_MARKER)
    return before + START_MARKER + "\n" + content.rstrip() + "\n" + END_MARKER + after


def update_reports(root: Path, rounds: Sequence[ResolvedRound], *, check: bool) -> bool:
    """Write both publications, or check their bytes without changing either file."""
    readme = root / "README.md"
    # An all-empty table says nothing above the fold; the README shows it once a chart is scored.
    scored = any(resolved["charts"] for resolved in rounds)
    summary = render_summary(rounds)
    block = render_table(rounds) + "\n\n" + summary if scored else summary.split("\n\n")[0]
    expected = {
        root / "BENCHMARK.md": render_report(rounds),
        readme: replace_markers(readme.read_text(encoding="utf-8"), block),
    }
    current = True
    for path, text in expected.items():
        if not path.is_file() or path.read_bytes() != text.encode("utf-8"):
            current = False
            if check:
                print(f"Out of date: {path.name}; run uv run python scripts/benchmark_report.py")
            else:
                path.write_text(text, encoding="utf-8")
    return current or not check


def main() -> None:
    """Regenerate publications or print one round with the current comparison."""
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--check", action="store_true", help="Fail if either publication is stale")
    mode.add_argument("--round", dest="round_id", help="Print one resolved round as Markdown")
    args = parser.parse_args()
    try:
        rounds = load_rounds(PROJECT_ROOT)
        live = [resolved for resolved in rounds if resolved["id"] != "fixture"]
        if args.round_id is not None:
            selected = next((item for item in rounds if item["id"] == args.round_id), None)
            if selected is None:
                parser.error(f"No resolved round {args.round_id}")
            label = "Synthetic fixture" if selected["id"] == "fixture" else "Live round"
            print(f"# {label}: {selected['id']}\n\n" + render_table([selected]))
            print("\nCurrent live comparison\n\n" + render_summary(live))
        elif not update_reports(PROJECT_ROOT, live, check=args.check):
            raise SystemExit(1)
        elif args.check:
            print("README.md and BENCHMARK.md are up to date.")
    except (OSError, ValueError) as error:
        parser.exit(1, f"{error}\n")


if __name__ == "__main__":
    main()
