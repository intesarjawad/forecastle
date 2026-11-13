import json
import subprocess
import sys
import tomllib
from pathlib import Path
from typing import TypedDict

import pytest


class Diagnostic(TypedDict):
    code: str
    message: str


def test_core_ruff_config_bans_io_and_model_imports() -> None:
    config_path = Path(__file__).resolve().parents[1] / "forecastle_pipeline/core/ruff.toml"
    with config_path.open("rb") as config_file:
        config = tomllib.load(config_file)
    banned = config["lint"]["flake8-tidy-imports"]["banned-api"]
    for module in ("urllib", "urllib.request", "torch"):
        assert "core/ is pure" in banned[module]["msg"]


@pytest.mark.parametrize(
    ("module", "banned_api"),
    [("urllib", "urllib"), ("urllib.request", "urllib"), ("torch", "torch")],
)
def test_core_ruff_rejects_forbidden_import(module: str, banned_api: str) -> None:
    project_root = Path(__file__).resolve().parents[2]
    probe = subprocess.run(
        [
            sys.executable,
            "-m",
            "ruff",
            "check",
            "--stdin-filename",
            "pipeline/forecastle_pipeline/core/boundary_probe.py",
            "--output-format",
            "json",
            "-",
        ],
        cwd=project_root,
        input=f"import {module}\n",
        capture_output=True,
        text=True,
        check=False,
    )
    assert probe.returncode == 1, probe.stderr
    diagnostics: list[Diagnostic] = json.loads(probe.stdout)
    forbidden = [diagnostic for diagnostic in diagnostics if diagnostic["code"] == "TID251"]
    assert len(forbidden) == 1, diagnostics
    assert f"`{banned_api}` is banned" in forbidden[0]["message"]
    assert "core/ is pure" in forbidden[0]["message"]
