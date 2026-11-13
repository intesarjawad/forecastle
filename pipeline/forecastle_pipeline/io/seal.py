import os
import re
import shutil
import subprocess
from pathlib import Path

PBKDF2_ITERATIONS = 600_000


def crypt(source: Path, destination: Path, *, decrypt: bool = False) -> None:
    """Encrypt or decrypt using the 32-byte hexadecimal SEAL_KEY environment secret."""
    key = os.environ.get("SEAL_KEY", "")
    if re.fullmatch(r"[0-9a-fA-F]{64}", key) is None:
        msg = "SEAL_KEY must contain exactly 64 hexadecimal characters"
        raise ValueError(msg)
    executable = shutil.which("openssl")
    if executable is None:
        msg = "openssl is required to seal forecasts"
        raise FileNotFoundError(msg)
    arguments = [
        executable,
        "enc",
        "-aes-256-cbc",
        "-pbkdf2",
        "-iter",
        str(PBKDF2_ITERATIONS),
        "-salt",
        "-pass",
        "env:SEAL_KEY",
        "-in",
        str(source),
        "-out",
        str(destination),
    ]
    if decrypt:
        arguments.append("-d")
    subprocess.run(arguments, check=True, capture_output=True, timeout=60)
