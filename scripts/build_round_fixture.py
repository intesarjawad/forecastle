from pathlib import Path

from forecastle_pipeline.io.files import read_object
from forecastle_pipeline.io.resolve import chart_forecasts, resolve_chart, write_round
from forecastle_pipeline.io.round_schema import ResolvedChart, ResolvedRound

FIXTURES = Path(__file__).resolve().parents[1] / "benchmark/fixtures/live/fixture"


def build_fixture() -> ResolvedRound:
    """Rebuild synthetic round evidence with ten, nine and zero submissions per chart."""
    charts: list[ResolvedChart] = []
    for index, count in enumerate((10, 9, 0), 1):
        directory = FIXTURES / str(index)
        submissions: list[object] = [
            {**{f"d{day}": float(item + day) for day in range(1, 8)}, "half_width": 5.0}
            for item in range(count)
        ]
        charts.append(
            resolve_chart(
                read_object(directory / "puzzle.json"),
                chart_forecasts(directory),
                [float(item + 28) for item in range(7)],
                submissions,
                2.0,
            )
        )
    return {
        "schemaVersion": 1,
        "id": "fixture",
        "openDay": "2026-11-09",
        "cutoffUtc": "2026-11-10T23:59:59+00:00",
        "charts": charts,
    }


if __name__ == "__main__":
    write_round(Path("benchmark/rounds/fixture.json"), build_fixture())
