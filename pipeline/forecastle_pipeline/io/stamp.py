import shutil
import subprocess
from pathlib import Path
from typing import Literal

ProofState = Literal["complete", "pending"]


def run_ots(arguments: list[str]) -> subprocess.CompletedProcess[str]:
    """Run the installed timestamp client with bounded execution and captured diagnostics."""
    executable = shutil.which("ots")
    if executable is None:
        msg = "ots is required; install the development dependency group"
        raise FileNotFoundError(msg)
    return subprocess.run(
        [executable, "--no-cache", *arguments],
        check=False,
        capture_output=True,
        text=True,
        timeout=120,
    )


def stamp(path: Path) -> None:
    """Create a detached proof, retaining existing proofs on repeated publication."""
    if Path(f"{path}.ots").is_file():
        return
    result = run_ots(["stamp", str(path)])
    if result.returncode or not Path(f"{path}.ots").is_file():
        msg = f"Timestamp stamping failed for {path}: {result.stderr}"
        raise ValueError(msg)


def upgrade(proof: Path) -> ProofState:
    """Distinguish normal pending attestations from errors and remove rewritten backups."""
    result = run_ots(["upgrade", str(proof)])
    log = result.stdout + result.stderr
    if result.returncode == 0 and "Timestamp complete" in log:
        state: ProofState = "complete"
    elif result.returncode == 1 and "Timestamp not complete" in log:
        state = "pending"
    else:
        msg = f"Timestamp upgrade failed for {proof}: {log}"
        raise ValueError(msg)
    # A successful rewrite can still leave a pending proof and exit 1.
    Path(f"{proof}.bak").unlink(missing_ok=True)
    return state
