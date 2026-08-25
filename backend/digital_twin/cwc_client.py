"""
Client for the Central Water Commission (CWC) Flood Forecasting System's
public JSON API (https://ffs.india-water.gov.in). This is the real backend
that powers CWC's own public flood-forecast dashboard for India -- there is
no official published API doc; these endpoints were identified by capturing
the dashboard's own network requests (Playwright, inspecting XHR calls) and
returned data without any authentication. Being an undocumented, unversioned
API riding on a public dashboard, it could change or break without notice --
callers should treat failures as expected/recoverable, not exceptional.

Station of interest: "062-MGD4PTN" = KOSI BARRAGE, type "Inflow", the CWC
station physically at the barrage (26.52N, 86.92E -- matches our case
study's documented barrage coordinates). Confirmed by name match and by
cross-checking its FRL/MWL reference levels against live readings (see
sync.py).
"""
import datetime as dt

import requests

BASE = "https://ffs.india-water.gov.in"
KOSI_BARRAGE_STATION_CODE = "062-MGD4PTN"
HEADERS = {"User-Agent": "FloodSim-HADR/1.0 (SIH26161 case study; digital-twin sync)"}
TIMEOUT_S = 20


class CwcApiError(Exception):
    pass


def _get_json(path: str, spec: dict | None = None):
    import json
    import urllib.parse

    url = f"{BASE}{path}"
    if spec is not None:
        url += f"?specification={urllib.parse.quote(json.dumps(spec))}"
    try:
        resp = requests.get(url, headers=HEADERS, timeout=TIMEOUT_S)
        resp.raise_for_status()
        return resp.json()
    except requests.RequestException as e:
        raise CwcApiError(f"request to {path} failed: {e}") from e
    except ValueError as e:
        raise CwcApiError(f"non-JSON response from {path}: {e}") from e


def fetch_station_static_info(station_code: str = KOSI_BARRAGE_STATION_CODE) -> dict:
    """Reference levels (FRL, MWL, danger/warning level where applicable) --
    these change rarely, unlike the live readings."""
    spec = {"where": {"expression": {
        "valueIsRelationField": False, "fieldName": "type", "operator": "eq", "value": "Inflow",
    }}}
    stations = _get_json("/iam/api/flood-forecast-static/specification/", spec)
    for s in stations:
        if s.get("stationCode") == station_code:
            return s
    raise CwcApiError(f"station {station_code} not found in Inflow-type static list")


def fetch_latest_readings(station_code: str = KOSI_BARRAGE_STATION_CODE) -> list[dict]:
    """Latest known value per datatype code for this station (e.g. HHS = the
    live-updated water level; other codes present for this station, FIN/FOL,
    were found stale (2021) during initial investigation -- see sync.py for
    how staleness is judged and surfaced, not silently hidden."""
    spec = {"where": {"expression": {
        "valueIsRelationField": False, "fieldName": "stationCode.stationCode",
        "operator": "eq", "value": station_code,
    }}}
    return _get_json("/iam/api/new-entry-data-aggregate/specification/", spec)


def fetch_recent_history(
    station_code: str = KOSI_BARRAGE_STATION_CODE,
    datatype_code: str = "HHS",
    days: int = 14,
) -> list[dict]:
    """Full time-series entries for one station+datatype (used to establish
    the *actual* update cadence empirically, rather than assuming it)."""
    spec = {"where": {
        "expression": {"valueIsRelationField": False, "fieldName": "id.stationCode", "operator": "eq", "value": station_code},
        "and": {"expression": {"valueIsRelationField": False, "fieldName": "id.datatypeCode", "operator": "eq", "value": datatype_code}},
    }}
    entries = _get_json("/iam/api/new-entry-data/specification/", spec)
    cutoff = dt.datetime.utcnow() - dt.timedelta(days=days)
    recent = [e for e in entries if dt.datetime.fromisoformat(e["id"]["dataTime"]) >= cutoff]
    recent.sort(key=lambda e: e["id"]["dataTime"])
    return recent
