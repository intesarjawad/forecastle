import subprocess
from pathlib import Path

import pytest
from forecastle_pipeline.io.seal import crypt

TEST_KEY = "0123456789abcdef" * 4


@pytest.fixture(autouse=True)
def fixed_key(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("SEAL_KEY", TEST_KEY)


def test_encrypt_decrypt_and_random_salt(tmp_path: Path) -> None:
    source = tmp_path / "forecast.json"
    source.write_bytes(b'{"median":[1,2,3,4,5,6,7]}')
    first, second, revealed = [tmp_path / name for name in ("first.enc", "second.enc", "revealed")]
    crypt(source, first)
    crypt(source, second)
    assert first.read_bytes().startswith(b"Salted__")
    assert first.read_bytes() != second.read_bytes()
    assert source.read_bytes() not in first.read_bytes()
    crypt(first, revealed, decrypt=True)
    assert revealed.read_bytes() == source.read_bytes()


def test_key_validation_and_wrong_key(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    source, encrypted = tmp_path / "input", tmp_path / "encrypted"
    source.write_bytes(b"forecast bytes")
    crypt(source, encrypted)
    monkeypatch.setenv("SEAL_KEY", "f" * 64)
    with pytest.raises(subprocess.CalledProcessError):
        crypt(encrypted, tmp_path / "revealed", decrypt=True)
    monkeypatch.delenv("SEAL_KEY")
    with pytest.raises(ValueError, match="SEAL_KEY"):
        crypt(source, encrypted)
