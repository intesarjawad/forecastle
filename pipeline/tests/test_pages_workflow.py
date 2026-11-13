from pathlib import Path

import yaml


def test_pages_deploys_main_and_completed_data_workflows() -> None:
    path = Path(__file__).resolve().parents[2] / ".github/workflows/pages.yml"
    workflow = yaml.safe_load(path.read_text())
    triggers = workflow[True]
    assert "workflow_dispatch" in triggers
    assert triggers["push"]["branches"] == ["main"]
    assert set(triggers["workflow_run"]["workflows"]) == {"daily", "live"}
    assert triggers["workflow_run"]["types"] == ["completed"]
    assert triggers["workflow_run"]["branches"] == ["main"]
    assert workflow["jobs"]["deploy"]["steps"][0]["with"]["ref"] == "main"
