from dataclasses import dataclass
from datetime import date
from urllib.parse import urlencode

from forecastle_pipeline.series.base import (
    DailyPoint,
    SeriesError,
    complete_days,
    json_array,
    json_object,
    observed_value,
    validate_range,
)
from forecastle_pipeline.series.http import get_json

ARCHIVE_URL = "https://archive-api.open-meteo.com/v1/archive"


@dataclass(frozen=True)
class OpenMeteoSeries:
    """ERA5 daily mean temperature in degrees Celsius at a coordinate."""

    latitude: float
    longitude: float

    def fetch_daily(self, start: date, end: date) -> list[DailyPoint]:
        """Fetch a complete inclusive range, treating nulls as missing days."""
        validate_range(start, end)
        query = urlencode(
            {
                "latitude": self.latitude,
                "longitude": self.longitude,
                "start_date": start.isoformat(),
                "end_date": end.isoformat(),
                "daily": "temperature_2m_mean",
                "timezone": "auto",
                "models": "era5",
            },
        )
        payload = json_object(get_json(f"{ARCHIVE_URL}?{query}"))
        daily = json_object(payload.get("daily"))
        days = json_array(daily.get("time"))
        temperatures = json_array(daily.get("temperature_2m_mean"))
        if len(days) != len(temperatures):
            msg = "Open-Meteo daily dates and values have different lengths"
            raise SeriesError(msg)
        values: dict[date, float] = {}
        seen: set[date] = set()
        for raw_day, temperature in zip(days, temperatures, strict=True):
            if not isinstance(raw_day, str):
                msg = "Open-Meteo daily date must be a string"
                raise SeriesError(msg)
            try:
                day = date.fromisoformat(raw_day)
            except ValueError as error:
                msg = f"Invalid Open-Meteo daily date: {raw_day}"
                raise SeriesError(msg) from error
            if day in seen:
                msg = f"Duplicate daily value for {day}"
                raise SeriesError(msg)
            seen.add(day)
            if temperature is not None:
                values[day] = observed_value(temperature, day)
        return complete_days(values, start, end)
