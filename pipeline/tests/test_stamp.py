import shutil
import subprocess
from pathlib import Path

import pytest
from forecastle_pipeline.io import stamp

FIXTURES = Path(__file__).parent / "fixtures/provenance"


def test_committed_upgraded_proof_offline(tmp_path: Path) -> None:
    for filename in ("hello-world.txt", "hello-world.txt.ots"):
        shutil.copyfile(FIXTURES / filename, tmp_path / filename)
    assert stamp.upgrade(tmp_path / "hello-world.txt.ots") == "complete"
    assert not list(tmp_path.glob("*.bak"))


@pytest.mark.parametrize("state", ["complete", "pending"])
def test_upgrade_rewrite_removes_backup(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    state: str,
) -> None:
    proof = tmp_path / "file.ots"
    proof.write_bytes(b"old")

    def run(_arguments: list[str]) -> subprocess.CompletedProcess[str]:
        Path(f"{proof}.bak").write_bytes(proof.read_bytes())
        proof.write_bytes(b"new")
        return subprocess.CompletedProcess(
            [],
            int(state == "pending"),
            "",
            "Timestamp complete" if state == "complete" else "Timestamp not complete",
        )

    monkeypatch.setattr(stamp, "run_ots", run)
    assert stamp.upgrade(proof) == state
    assert not Path(f"{proof}.bak").exists()


def test_upgrade_error_does_not_delete_backup(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    backup = tmp_path / "file.ots.bak"
    backup.write_bytes(b"recoverable")

    def run(_args: list[str]) -> subprocess.CompletedProcess[str]:
        return subprocess.CompletedProcess([], 1, "", "invalid timestamp")

    monkeypatch.setattr(stamp, "run_ots", run)
    with pytest.raises(ValueError, match="upgrade failed"):
        stamp.upgrade(tmp_path / "file.ots")
    assert backup.read_bytes() == b"recoverable"
