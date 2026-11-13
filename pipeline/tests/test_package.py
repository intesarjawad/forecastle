import tomllib
from pathlib import Path

import forecastle_pipeline


def test_package_version_matches_project_metadata() -> None:
    project_root = Path(__file__).resolve().parents[2]
    with (project_root / "pyproject.toml").open("rb") as metadata_file:
        metadata = tomllib.load(metadata_file)
    assert forecastle_pipeline.__version__ == metadata["project"]["version"]
