from dataclasses import dataclass
from typing import Never


@dataclass(frozen=True)
class Message:
    """What happened and the one command that resolves it."""

    what: str
    next_step: str


class MessageError(Exception):
    """An expected failure with wording that belongs in the CLI table."""

    def __init__(self, message: Message) -> None:
        super().__init__(message.what)
        self.message = message


# The documented way to run the tool without installing it; a bare name is not on PATH.
COMMAND = "uvx --torch-backend cpu forecastle-pipeline"

MESSAGES: dict[str, Message] = {
    "csv_missing": Message(
        "The file {path} does not exist.",
        "Pass an existing CSV path, for example `{command} custom data.csv --no-open`.",
    ),
    "csv_unreadable": Message(
        "The file {path} could not be read.",
        "Check the file permissions, then run `{command} custom {path} --no-open`.",
    ),
    "csv_empty": Message(
        "The file {path} has no header row.",
        "Add a header row naming the value column, then run `{command} custom {path} --no-open`.",
    ),
    "csv_no_header": Message(
        "Row 1 holds data instead of a header row.",
        "Add a header row naming the value column, then run `{command} custom {path} --no-open`.",
    ),
    "csv_columns": Message(
        "Row {row} has {columns} columns; use one value column or date,value.",
        "Rewrite row {row} with one or two columns, then run `{command} custom {path} --no-open`.",
    ),
    "csv_value": Message(
        "Row {row} holds {value!r} instead of a finite number.",
        "Replace row {row} with a finite number, then run `{command} custom {path} --no-open`.",
    ),
    "csv_date": Message(
        "Row {row} holds the invalid date {value!r}; use YYYY-MM-DD.",
        "Fix the date in row {row}, then run `{command} custom {path} --no-open`.",
    ),
    "csv_gap": Message(
        "Row {row} does not follow row {previous} by one day.",
        "Fill the missing day before row {row}, then run `{command} custom {path} --no-open`.",
    ),
    "csv_short": Message(
        "Row {row} is missing; a custom puzzle needs 35 daily rows.",
        "Add rows until the file has 35 daily values, then run "
        "`{command} custom {path} --no-open`.",
    ),
    "label_empty": Message(
        "The label is empty.",
        'Pass a label, for example `{command} custom {path} --label "My series" --no-open`.',
    ),
    "label_long": Message(
        "The label is {length} characters; use at most 80.",
        'Pass a shorter `--label "My series"`, then run `{command} custom {path} --no-open`.',
    ),
    "unit_long": Message(
        "The unit is {length} characters; use at most 16.",
        "Pass a shorter `--unit`, then run `{command} custom {path} --no-open`.",
    ),
    "source_missing": Message(
        "No input was given.",
        "Pass a CSV file or `--wikipedia <Article>`, for example "
        "`{command} custom data.csv --no-open`.",
    ),
    "source_both": Message(
        "A CSV file and --wikipedia cannot be used together.",
        "Choose one: `{command} custom data.csv --no-open` or "
        "`{command} custom --wikipedia Pumpkin --no-open`.",
    ),
    "wikipedia_label_long": Message(
        "The Wikipedia label is {length} characters; use at most 80.",
        'Pass a shorter label: `{command} custom --wikipedia {argument} --label "Pageviews" '
        "--no-open`.",
    ),
    "wikipedia_failed": Message(
        "en.wikipedia has no complete daily views for {article} over the last 35 days: {reason}.",
        "Check the exact title on en.wikipedia.org, then run "
        "`{command} custom --wikipedia {argument} --no-open`.",
    ),
    "wikipedia_unreachable": Message(
        "The Wikimedia pageviews service could not be reached for {article}: {reason}.",
        "Check the connection, then run `{command} custom --wikipedia {argument} --no-open`.",
    ),
    "model_download": Message(
        "Could not download {repo} from huggingface.co: {reason}.",
        "Check the connection, then run `{command} fetch-model`; the download resumes "
        "and your command then runs without it.",
    ),
    "model_hash": Message(
        "The downloaded file {repo}/{filename} does not match the pinned sha256.",
        "Run `{command} fetch-model --redownload`, then run your command again.",
    ),
    "model_load": Message(
        "The chronos-2 model could not be loaded: {reason}.",
        "Run `{command} fetch-model --redownload`, then run your command again.",
    ),
    "payload_large": Message(
        "The encoded puzzle is {length} characters; the link limit is {limit}.",
        'Pass a shorter label with `--label "Short label"` and run the same command again.',
    ),
    "series_failed": Message(
        "{series}: {reason}.",
        "Run `uv run forecastle-pipeline probe {series}` to see what the source returns.",
    ),
}


def format_message(key: str, **fields: object) -> Message:
    """Fill one table entry so row numbers and commands stay consistent."""
    template = MESSAGES[key]
    return Message(
        template.what.format(**fields), template.next_step.format(command=COMMAND, **fields)
    )


def fail(key: str, **fields: object) -> Never:
    """Raise an expected CLI failure instead of a traceback."""
    raise MessageError(format_message(key, **fields))
