import json
import shutil
import subprocess
from hashlib import sha256
from pathlib import Path

import pytest
from forecastle_pipeline.io import verify

FIXTURES = Path(__file__).parent / "fixtures/provenance"


@pytest.fixture
def recorded_explorer(monkeypatch: pytest.MonkeyPatch) -> list[str]:
    calls: list[str] = []

    def text(url: str) -> str:
        calls.append(url)
        assert url == "https://blockstream.info/api/block-height/358391"
        return (FIXTURES / "block-height.txt").read_text()

    def block(url: str) -> object:
        calls.append(url)
        assert url.endswith((FIXTURES / "block-height.txt").read_text())
        return json.loads((FIXTURES / "block.json").read_text())

    monkeypatch.setattr(verify, "get_text", text)
    monkeypatch.setattr(verify, "get_json", block)
    return calls


def test_anchored_proof_with_recorded_block(recorded_explorer: list[str]) -> None:
    path = FIXTURES / "hello-world.txt"
    messages = verify.verify_file(path, sha256(path.read_bytes()).hexdigest())
    assert len(recorded_explorer) == 2
    assert len(messages) == 1
    assert "Bitcoin block 358391, proof time 2015-05-28" in messages[0]


def test_tampered_file_and_timestamp_target_fail(
    tmp_path: Path,
    recorded_explorer: list[str],
) -> None:
    path = tmp_path / "hello-world.txt"
    shutil.copyfile(FIXTURES / "hello-world.txt.ots", Path(f"{path}.ots"))
    path.write_bytes(b"tampered")
    with pytest.raises(ValueError, match="SHA-256 mismatch"):
        verify.verify_file(path, "0" * 64)
    with pytest.raises(ValueError, match="File does not match original"):
        verify.verify_file(path, sha256(path.read_bytes()).hexdigest())
    assert not recorded_explorer


def test_pending_proof_fails_without_explorer(
    monkeypatch: pytest.MonkeyPatch, recorded_explorer: list[str]
) -> None:
    path = FIXTURES / "incomplete.txt"

    def pending(_arguments: list[str]) -> subprocess.CompletedProcess[str]:
        return subprocess.CompletedProcess([], 1, "", "Timestamp not complete\nPendingAttestation")

    monkeypatch.setattr(verify, "run_ots", pending)
    with pytest.raises(ValueError, match="not yet anchored in Bitcoin; run ots upgrade"):
        verify.verify_file(path, sha256(path.read_bytes()).hexdigest())
    assert not recorded_explorer


def test_wrong_merkle_root_fails(
    monkeypatch: pytest.MonkeyPatch, recorded_explorer: list[str]
) -> None:
    block: dict[str, object] = json.loads((FIXTURES / "block.json").read_text())
    block["merkle_root"] = "0" * 64

    def response(_url: str) -> object:
        return block

    monkeypatch.setattr(verify, "get_json", response)
    path = FIXTURES / "hello-world.txt"
    with pytest.raises(ValueError, match="does not match"):
        verify.verify_file(path, sha256(path.read_bytes()).hexdigest())
    assert len(recorded_explorer) == 1


def test_incomplete_round_fails(tmp_path: Path) -> None:
    with pytest.raises(ValueError, match="three chart"):
        verify.verify_round(tmp_path)
