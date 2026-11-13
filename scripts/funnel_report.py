import argparse
from collections.abc import Mapping, Sequence
from pathlib import Path
from statistics import median

from forecastle_pipeline.io.files import read_object, text_field
from forecastle_pipeline.series.base import SeriesError, json_array, json_object

RETURN_RATE_NOTE = (
    "Return rate is not reported: puzzle ids are per puzzle, so the export cannot link "
    "submissions from the same player across puzzles."
)


def load_submissions(path: Path) -> list[object]:
    """Read the worker export payload, keeping path and field errors at the boundary."""
    try:
        return json_array(read_object(path).get("submissions"))
    except SeriesError as error:
        msg = f"Invalid export in {path}: {error}"
        raise ValueError(msg) from error


def lock_times(submissions: Sequence[object]) -> dict[str, list[int]]:
    """Group lock times by puzzle, rejecting rows without a usable lock time."""
    grouped: dict[str, list[int]] = {}
    for item in submissions:
        row = json_object(item)
        puzzle_id = text_field(row, "puzzle_id")
        ms_to_lock = row.get("ms_to_lock")
        if type(ms_to_lock) is not int or ms_to_lock < 0:
            msg = f"Expected nonnegative integer ms_to_lock for {puzzle_id}"
            raise ValueError(msg)
        grouped.setdefault(puzzle_id, []).append(ms_to_lock)
    return grouped


def render_table(grouped: Mapping[str, Sequence[int]]) -> str:
    """Show counts and medians in puzzle order so repeated runs print the same rows."""
    rows = [["Puzzle", "Submissions", "Median msToLock"]]
    rows.extend(
        [puzzle_id, str(len(times)), f"{median(times):g}"]
        for puzzle_id, times in sorted(grouped.items())
    )
    widths = [max(len(cell) for cell in column) for column in zip(*rows, strict=True)]
    rows.insert(1, ["-" * width for width in widths])
    return "\n".join(
        "| " + " | ".join(cell.ljust(width) for cell, width in zip(row, widths, strict=True)) + " |"
        for row in rows
    )


def render_report(path: Path) -> str:
    """Report only what an export supports: per-puzzle volume and lock time."""
    return render_table(lock_times(load_submissions(path))) + "\n\n" + RETURN_RATE_NOTE


def main() -> None:
    """Print the funnel for one saved export without changing any file."""
    parser = argparse.ArgumentParser(description="Print submissions and lock time per puzzle")
    parser.add_argument("export", type=Path, help="Saved worker export JSON")
    args = parser.parse_args()
    try:
        print(render_report(args.export))
    except (OSError, ValueError) as error:
        parser.exit(1, f"{error}\n")


if __name__ == "__main__":
    main()
