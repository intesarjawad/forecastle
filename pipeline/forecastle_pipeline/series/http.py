import json
from http import HTTPStatus
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from forecastle_pipeline import __version__
from forecastle_pipeline.series.base import SeriesError, SourceUnreachableError

TIMEOUT_SECONDS = 30
# Replace when the repository has a public URL.
REPOSITORY_URL = "https://example.invalid/forecastle"
USER_AGENT = f"forecastle-pipeline/{__version__} (+{REPOSITORY_URL})"


def get_text(url: str, *, token: str = "") -> str:
    """GET HTTPS text with optional export authentication and URL-bearing errors."""
    if not url.startswith("https://"):
        msg = "HTTP sources require an https:// URL"
        raise SeriesError(msg)
    headers = {"User-Agent": USER_AGENT, "Accept": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    request = Request(url, headers=headers)
    try:
        with urlopen(request, timeout=TIMEOUT_SECONDS) as response:
            if response.status != HTTPStatus.OK:
                msg = f"{url} returned {response.status}"
                raise SeriesError(msg)
            return response.read().decode("utf-8")
    except HTTPError as error:
        error.close()
        msg = f"{url} returned {error.code}"
        raise SeriesError(msg) from error
    except (URLError, OSError) as error:
        msg = f"{url} could not be fetched: {error}"
        raise SourceUnreachableError(msg) from error
    except UnicodeError as error:
        msg = f"{url} could not be fetched: {error}"
        raise SeriesError(msg) from error


def get_json(url: str, *, token: str = "") -> object:
    """Decode a JSON response while preserving transport errors."""
    try:
        payload: object = json.loads(get_text(url, token=token))
    except (ValueError, UnicodeError) as error:
        msg = f"{url} returned invalid JSON: {error}"
        raise SeriesError(msg) from error
    else:
        return payload
