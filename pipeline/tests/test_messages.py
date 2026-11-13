import re

import pytest
from forecastle_pipeline import cli
from forecastle_pipeline.messages import MESSAGES, Message, MessageError, fail, format_message


def test_every_message_ends_with_a_full_stop_and_names_a_command() -> None:
    for key, message in MESSAGES.items():
        assert message.what.strip(), key
        assert message.what.endswith("."), key
        assert re.search(r"`[^`]+`", message.next_step), key


def test_formatting_fills_row_numbers_and_commands() -> None:
    message = format_message("csv_value", row=9, value="n/a", path="series.csv")
    assert message.what == "Row 9 holds 'n/a' instead of a finite number."
    assert (
        "`uvx --torch-backend cpu forecastle-pipeline custom series.csv --no-open`"
        in message.next_step
    )


def test_fail_raises_the_formatted_message() -> None:
    with pytest.raises(MessageError) as error:
        fail("source_missing")
    assert isinstance(error.value.message, Message)
    assert error.value.message.what == "No input was given."


def test_main_prints_the_error_and_next_step(capsys: pytest.CaptureFixture[str]) -> None:
    with pytest.raises(SystemExit) as error:
        cli.main(["custom"])
    assert error.value.code == 2
    lines = capsys.readouterr().err.splitlines()
    assert lines[0] == "error: No input was given."
    assert lines[1].startswith("next: ")
    assert re.search(r"`[^`]+`", lines[1])
