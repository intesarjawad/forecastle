import csv
from datetime import date
from math import isfinite
from pathlib import Path

from forecastle_pipeline.core.custom import CustomSeries
from forecastle_pipeline.io.scoring import MAX_ABSOLUTE_VALUE
from forecastle_pipeline.messages import fail

REQUIRED_ROWS = 35
MAX_LABEL_LENGTH = 80
MAX_UNIT_LENGTH = 16
DATED_COLUMNS = 2
FIRST_DATA_ROW = 2


def read_series_csv(
    path: Path,
    *,
    label: str | None = None,
    unit: str = "",
) -> CustomSeries:
    """Read the last 35 daily values, naming the offending row on every failure."""
    rows = _read_rows(path)
    if not rows:
        fail("csv_empty", path=path)
    header, body = rows[0], rows[1:]
    width = _check_header(header, path)
    if len(body) < REQUIRED_ROWS:
        fail("csv_short", row=len(body) + FIRST_DATA_ROW, path=path)
    selected = body[-REQUIRED_ROWS:]
    values, dates = _parse_rows(selected, len(body) - REQUIRED_ROWS, width, path)
    resolved_label = label if label is not None else header[-1]
    _check_text(resolved_label, unit, path)
    return CustomSeries(resolved_label, unit, values, dates)


def _read_rows(path: Path) -> list[list[str]]:
    try:
        with path.open(newline="", encoding="utf-8") as source:
            return [row for row in csv.reader(source) if any(cell.strip() for cell in row)]
    except FileNotFoundError:
        fail("csv_missing", path=path)
    except (OSError, UnicodeError, csv.Error):
        fail("csv_unreadable", path=path)


def _check_header(header: list[str], path: Path) -> int:
    width = len(header)
    if width not in (1, DATED_COLUMNS):
        fail("csv_columns", row=1, columns=width, path=path)
    if (
        _looks_numeric(header[0])
        or _looks_like_date(header[0])
        or (width == DATED_COLUMNS and _looks_numeric(header[1]))
    ):
        fail("csv_no_header", path=path)
    return width


def _parse_rows(
    selected: list[list[str]],
    skipped: int,
    width: int,
    path: Path,
) -> tuple[list[float], list[date] | None]:
    values: list[float] = []
    dates: list[date] | None = [] if width == DATED_COLUMNS else None
    previous: date | None = None
    for row_number, row in enumerate(selected, start=FIRST_DATA_ROW + skipped):
        if len(row) != width:
            fail("csv_columns", row=row_number, columns=len(row), path=path)
        if dates is None:
            values.append(_parse_number(row[0], row=row_number, path=path))
            continue
        day = _parse_date(row[0], row=row_number, path=path)
        if previous is not None and (day - previous).days != 1:
            fail("csv_gap", row=row_number, previous=row_number - 1, path=path)
        dates.append(day)
        previous = day
        values.append(_parse_number(row[1], row=row_number, path=path))
    return values, dates


def _check_text(label: str, unit: str, path: Path) -> None:
    if not label:
        fail("label_empty", path=path)
    if len(label) > MAX_LABEL_LENGTH:
        fail("label_long", length=len(label), path=path)
    if len(unit) > MAX_UNIT_LENGTH:
        fail("unit_long", length=len(unit), path=path)


def _parse_number(cell: str, *, row: int, path: Path) -> float:
    try:
        value = float(cell.strip())
    except ValueError:
        fail("csv_value", row=row, value=cell, path=path)
    if not isfinite(value) or abs(value) > MAX_ABSOLUTE_VALUE:
        fail("csv_value", row=row, value=cell, path=path)
    return value


def _parse_date(cell: str, *, row: int, path: Path) -> date:
    try:
        day = date.fromisoformat(cell.strip())
    except ValueError:
        fail("csv_date", row=row, value=cell, path=path)
    if day.isoformat() != cell.strip():
        fail("csv_date", row=row, value=cell, path=path)
    return day


def _looks_numeric(cell: str) -> bool:
    try:
        value = float(cell.strip())
    except ValueError:
        return False
    return isfinite(value)


def _looks_like_date(cell: str) -> bool:
    try:
        return date.fromisoformat(cell.strip()).isoformat() == cell.strip()
    except ValueError:
        return False
