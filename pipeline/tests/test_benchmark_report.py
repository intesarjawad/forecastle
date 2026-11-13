import importlib.util
import shutil
import subprocess
import sys
from pathlib import Path

import pytest
from forecastle_pipeline.io.files import read_object
from forecastle_pipeline.io.round_schema import parse_round

ROOT = Path(__file__).resolve().parents[2]
SCRIPT = ROOT / "scripts/benchmark_report.py"
spec = importlib.util.spec_from_file_location("benchmark_report", SCRIPT)
assert spec is not None
assert spec.loader is not None
report = importlib.util.module_from_spec(spec)
spec.loader.exec_module(report)


def test_publications_regenerate_byte_identically_and_check_is_read_only(tmp_path: Path) -> None:
    readme = tmp_path / "README.md"
    original = f"Before\n{report.START_MARKER}\nstale\n{report.END_MARKER}\nAfter\n"
    readme.write_text(original)
    rounds = [parse_round(read_object(ROOT / "benchmark/rounds/fixture.json"))]
    assert not report.update_reports(tmp_path, rounds, check=True)
    assert readme.read_text() == original
    assert not (tmp_path / "BENCHMARK.md").exists()
    assert report.update_reports(tmp_path, rounds, check=False)
    paths = [readme, tmp_path / "BENCHMARK.md"]
    first = [path.read_bytes() for path in paths]
    assert report.update_reports(tmp_path, rounds, check=False)
    assert [path.read_bytes() for path in paths] == first
    assert report.update_reports(tmp_path, rounds, check=True)
    assert readme.read_text().startswith(f"Before\n{report.START_MARKER}\n")
    assert readme.read_text().endswith(f"{report.END_MARKER}\nAfter\n")
    readme.write_text(readme.read_text().replace("Crowd median", "changed", 1))
    assert not report.update_reports(tmp_path, rounds, check=True)
    assert "changed" in readme.read_text()


@pytest.mark.parametrize(
    "text",
    [
        "",
        report.START_MARKER,
        report.END_MARKER + report.START_MARKER,
        report.START_MARKER * 2 + report.END_MARKER,
    ],
)
def test_invalid_readme_markers_fail_without_overwriting(text: str) -> None:
    with pytest.raises(ValueError, match="exactly one ordered"):
        report.replace_markers(text, "new")


def test_bad_round_is_not_silently_omitted(tmp_path: Path) -> None:
    rounds = tmp_path / "benchmark/rounds"
    rounds.mkdir(parents=True)
    bad = rounds / "bad.json"
    bad.write_text('{"schemaVersion": 99}')
    with pytest.raises(ValueError, match=r"Invalid resolved round.*bad\.json"):
        report.load_rounds(tmp_path)


def test_round_filename_must_match_the_contract(tmp_path: Path) -> None:
    rounds = tmp_path / "benchmark/rounds"
    rounds.mkdir(parents=True)
    shutil.copyfile(ROOT / "benchmark/rounds/fixture.json", rounds / "other.json")
    with pytest.raises(ValueError, match="Round id must match"):
        report.load_rounds(tmp_path)


def test_round_cli_prints_fixture_rows_and_current_live_comparison_without_writes(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    rounds = tmp_path / "benchmark/rounds"
    rounds.mkdir(parents=True)
    shutil.copyfile(ROOT / "benchmark/rounds/fixture.json", rounds / "fixture.json")
    paths = [tmp_path / "README.md", tmp_path / "BENCHMARK.md"]
    for path in paths:
        path.write_text("Unchanged publication\n")
    before = [path.read_bytes() for path in paths]
    monkeypatch.setattr(report, "PROJECT_ROOT", tmp_path)
    monkeypatch.setattr(sys, "argv", [str(SCRIPT), "--round", "fixture"])
    report.main()
    output = capsys.readouterr().out
    assert "Synthetic fixture: fixture" in output
    assert "| Crowd median | 1 | 10 |" in " ".join(output.split())
    assert "Current live comparison" in output
    assert "Monday-only sensitivity:" in output
    assert "No paired rounds scored yet (n = 0 charts in 0 rounds" in output
    assert [path.read_bytes() for path in paths] == before


def test_missing_round_cli_fails(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    monkeypatch.setattr(sys, "argv", [str(SCRIPT), "--round", "missing"])
    with pytest.raises(SystemExit) as failure:
        report.main()
    assert failure.value.code == 2
    assert "No resolved round missing" in capsys.readouterr().err


def test_round_script_entrypoint() -> None:
    result = subprocess.run(
        [sys.executable, "scripts/benchmark_report.py", "--round", "fixture"],
        cwd=ROOT,
        capture_output=True,
        text=True,
        check=False,
    )
    assert result.returncode == 0, result.stderr
    assert "| Crowd median | 1 | 10 |" in " ".join(result.stdout.split())
    assert "Monday-only sensitivity:" in result.stdout


def test_copy_lint_rejects_email_addresses(tmp_path: Path) -> None:
    shutil.copyfile(ROOT / "scripts/copy_lint.sh", tmp_path / "copy_lint.sh")
    (tmp_path / "copy.md").write_text("a@example.com")
    result = subprocess.run(["/bin/bash", "copy_lint.sh", "copy.md"], cwd=tmp_path, check=False)
    assert result.returncode == 1


def test_copy_lint_accepts_scoped_packages_and_reports_missing_files(tmp_path: Path) -> None:
    shutil.copyfile(ROOT / "scripts/copy_lint.sh", tmp_path / "copy_lint.sh")
    path = tmp_path / "copy.md"
    path.write_text("too close to call; install @scope/package")
    assert (
        subprocess.run(
            ["/bin/bash", "copy_lint.sh", "copy.md"], cwd=tmp_path, check=False
        ).returncode
        == 0
    )
    path.unlink()
    assert (
        subprocess.run(
            ["/bin/bash", "copy_lint.sh", "copy.md"], cwd=tmp_path, check=False
        ).returncode
        == 1
    )


def test_no_observations_have_an_explicit_status() -> None:
    assert "no paired rounds scored yet" in report.render_report([]).lower()
    assert all("no charts scored yet" in row for row in report.render_table([]).splitlines()[2:])
    assert "too close to call" not in report.render_summary([]).lower()


def test_readme_shows_only_the_status_line_before_any_chart_is_scored(tmp_path: Path) -> None:
    readme = tmp_path / "README.md"
    readme.write_text(f"{report.START_MARKER}\n{report.END_MARKER}\n")
    report.update_reports(tmp_path, [], check=False)
    block = readme.read_text()
    assert "No paired rounds scored yet" in block
    assert "|" not in block
    assert "| Crowd median" in (tmp_path / "BENCHMARK.md").read_text()
