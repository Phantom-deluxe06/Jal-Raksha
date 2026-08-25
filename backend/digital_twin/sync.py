"""
Digital Twin sync: pulls the real current state of the Kosi Barrage CWC
gauge station and writes it to a state file with honest timestamps. Never
fabricates a reading -- on failure, the last successfully-synced state is
left untouched (not overwritten with a stale/failed guess), and the failure
itself is recorded so the frontend can say "last successful sync was X" and
"last sync attempt (at Y) failed" rather than silently going quiet.
"""
import datetime as dt
import json
import statistics
import sys
import traceback
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from digital_twin import cwc_client

STATE_DIR = Path(__file__).resolve().parent.parent / "outputs" / "digital_twin"
STATE_PATH = STATE_DIR / "state.json"

# A reading older than this is not presented as "current" -- see
# _classify_datatypes. Empirically this station reports once daily
# (~08:00 IST); 3 days gives slack for a missed day without silently
# treating month-old data as live.
STALE_THRESHOLD_HOURS = 72
MAX_SYNC_LOG_ENTRIES = 20


def _classify_datatypes(latest_readings: list[dict], now_utc: dt.datetime) -> dict:
    """For each datatype code reported for the station, judge live vs stale
    from its own latestDataTime -- no hardcoded assumption about which codes
    are "supposed" to be live."""
    out = {}
    for r in latest_readings:
        code = r["datatypeCode"]
        # CWC timestamps are naive IST (UTC+5:30). Converting to UTC means
        # subtracting 5.5h from data_time -- which makes the gap to now_utc
        # 5.5h *larger*, not smaller (data_time_utc = data_time - 5.5h, so
        # age = now_utc - data_time_utc = (now_utc - data_time) + 5.5h).
        data_time = dt.datetime.fromisoformat(r["latestDataTime"])
        age_h = (now_utc.replace(tzinfo=None) - data_time).total_seconds() / 3600 + 5.5
        out[code] = {
            "latest_value": r["latestDataValue"],
            "latest_data_time_ist": r["latestDataTime"],
            "age_hours": round(age_h, 1),
            "live": age_h <= STALE_THRESHOLD_HOURS,
        }
    return out


def _measure_cadence(history: list[dict]) -> dict:
    """Empirically measured update interval from real recent history,
    rather than an assumed/hardcoded cadence string."""
    if len(history) < 2:
        return {"median_interval_hours": None, "n_samples": len(history), "description": "insufficient history to measure"}
    times = [dt.datetime.fromisoformat(e["id"]["dataTime"]) for e in history]
    gaps_h = [(t2 - t1).total_seconds() / 3600 for t1, t2 in zip(times, times[1:])]
    median_h = statistics.median(gaps_h)
    if 20 <= median_h <= 28:
        desc = f"~daily (median {median_h:.1f}h between readings over last {len(history)} samples)"
    elif median_h <= 2:
        desc = f"~hourly (median {median_h:.1f}h between readings over last {len(history)} samples)"
    else:
        desc = f"irregular (median {median_h:.1f}h between readings over last {len(history)} samples)"
    return {"median_interval_hours": round(median_h, 2), "n_samples": len(history), "description": desc}


def _load_state() -> dict:
    if STATE_PATH.exists():
        return json.loads(STATE_PATH.read_text())
    return {"last_good_sync": None, "sync_log": []}


def sync_now() -> dict:
    """Perform one real sync attempt. Returns the resulting state dict
    (whether this attempt succeeded or not -- on failure, returns the
    previous last-good state with the failed attempt appended to the log)."""
    STATE_DIR.mkdir(parents=True, exist_ok=True)
    state = _load_state()
    now_utc = dt.datetime.utcnow()
    attempt = {"attempted_at_utc": now_utc.isoformat(), "success": False, "error": None}

    try:
        static_info = cwc_client.fetch_station_static_info()
        latest = cwc_client.fetch_latest_readings()
        history = cwc_client.fetch_recent_history(days=14)

        datatypes = _classify_datatypes(latest, now_utc)
        cadence = _measure_cadence(history)

        primary = datatypes.get("HHS")
        if primary is None:
            raise cwc_client.CwcApiError("expected datatype HHS not present in latest readings")

        frl = static_info.get("frl")
        mwl = static_info.get("mwl")
        level_vs_ref = None
        if frl is not None and mwl is not None:
            level_vs_ref = {
                "above_frl_m": round(primary["latest_value"] - frl, 2),
                "below_mwl_m": round(mwl - primary["latest_value"], 2),
            }

        last_good_sync = {
            "station": {
                "name": "Kosi Barrage",
                "cwc_station_code": cwc_client.KOSI_BARRAGE_STATION_CODE,
                "lat": 26.52,
                "lon": 86.92,
                "cwc_type": "Inflow",
            },
            "current_reading": {
                "water_level_m": primary["latest_value"],
                "data_time_ist": primary["latest_data_time_ist"],
                "age_hours": primary["age_hours"],
                "is_live": primary["live"],
                "reference_levels_m": {"frl": frl, "mwl": mwl},
                "level_vs_reference": level_vs_ref,
            },
            "other_datatypes_seen": {
                code: v for code, v in datatypes.items() if code != "HHS"
            },
            "update_cadence": cadence,
            "source": {
                "name": "Central Water Commission (CWC), Government of India -- Flood Forecasting System",
                "url": "https://ffs.india-water.gov.in",
                "note": (
                    "Unofficial/undocumented public JSON API discovered by inspecting the CWC "
                    "dashboard's own network requests -- no auth required, but no published "
                    "API contract either; could change without notice."
                ),
            },
            "synced_at_utc": now_utc.isoformat(),
        }
        state["last_good_sync"] = last_good_sync
        attempt["success"] = True

    except Exception as e:
        attempt["error"] = str(e)
        attempt["traceback"] = traceback.format_exc(limit=3)

    state.setdefault("sync_log", []).insert(0, attempt)
    state["sync_log"] = state["sync_log"][:MAX_SYNC_LOG_ENTRIES]
    STATE_PATH.write_text(json.dumps(state, indent=2))
    return state


if __name__ == "__main__":
    result = sync_now()
    latest_attempt = result["sync_log"][0]
    if latest_attempt["success"]:
        r = result["last_good_sync"]["current_reading"]
        print(f"Sync OK: water level {r['water_level_m']}m at {r['data_time_ist']} IST "
              f"(age {r['age_hours']}h, live={r['is_live']})")
        print(f"Cadence: {result['last_good_sync']['update_cadence']['description']}")
    else:
        print(f"Sync FAILED: {latest_attempt['error']}")
        if result.get("last_good_sync"):
            print(f"Showing last good sync from: {result['last_good_sync']['synced_at_utc']}")
        else:
            print("No previous successful sync exists.")
