def snapshot_download(
    repo_id: str,
    *,
    revision: str,
    force_download: bool = False,
    allow_patterns: list[str] | None = None,
) -> str: ...
