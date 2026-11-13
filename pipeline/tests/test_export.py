import io
import json
from collections.abc import Generator
from contextlib import contextmanager
from pathlib import Path
from urllib.request import Request

import pytest
from forecastle_pipeline.io import export
from forecastle_pipeline.series import http
from forecastle_pipeline.series.base import SeriesError

TEST_CREDENTIAL = "fixed-test-token"


@pytest.fixture
def game(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    monkeypatch.setenv("EXPORT_TOKEN", TEST_CREDENTIAL)
    path = tmp_path / "game.json"
    path.write_text('{"workerUrl":"https://example.invalid"}')
    return path


def test_authenticated_export_and_three_attempts(
    game: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    attempts: list[Request] = []

    class Response(io.BytesIO):
        status: int = 200

    @contextmanager
    def open_url(request: Request, *, timeout: int) -> Generator[Response]:
        attempts.append(request)
        assert timeout == 30
        if len(attempts) < 3:
            msg = "unavailable"
            raise OSError(msg)
        yield Response(b'{"submissions":[]}')

    monkeypatch.setattr(http, "urlopen", open_url)
    assert export.export_submissions("live-2026-11-09-1", game) == []
    assert len(attempts) == 3
    assert attempts[0].get_header("Authorization") == "Bearer fixed-test-token"
    assert attempts[0].full_url == "https://example.invalid/v1/export/live-2026-11-09-1"


def test_failed_export_retries_exactly_three_times(
    game: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    attempts: list[str] = []

    def unavailable(url: str, *, token: str) -> object:
        assert token == TEST_CREDENTIAL
        attempts.append(url)
        msg = "503"
        raise SeriesError(msg)

    monkeypatch.setattr(export, "get_json", unavailable)
    with pytest.raises(SeriesError, match="503"):
        export.export_submissions("fixture-1", game)
    assert len(attempts) == 3


def test_empty_url_and_missing_token_fail(game: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("EXPORT_TOKEN")
    with pytest.raises(ValueError, match="EXPORT_TOKEN"):
        export.export_submissions("fixture-1", game)
    game.write_text(json.dumps({"workerUrl": ""}))
    with pytest.raises(ValueError, match="workerUrl"):
        export.export_submissions("fixture-1", game)
