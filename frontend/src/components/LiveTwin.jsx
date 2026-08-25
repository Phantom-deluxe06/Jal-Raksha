import { useEffect, useState } from "react";
import { fetchTwinState, triggerTwinSync } from "../api";

function formatIst(isoNaive) {
  return `${isoNaive.replace("T", " ")} IST`;
}

function formatUtcAsLocal(isoUtc) {
  try {
    return new Date(isoUtc + "Z").toLocaleString();
  } catch {
    return isoUtc;
  }
}

function freshnessBadge(reading) {
  if (!reading.is_live) return { label: `STALE (${reading.age_hours}h old)`, cls: "warn" };
  if (reading.age_hours <= 30) return { label: `Current (${reading.age_hours}h old)`, cls: "ok" };
  return { label: `Aging (${reading.age_hours}h old) — next daily reading overdue?`, cls: "warn" };
}

function LevelGauge({ level, frl, mwl }) {
  const range = mwl - frl;
  const padded = range * 0.15;
  const lo = frl - padded, hi = mwl + padded;
  const pct = (v) => Math.max(0, Math.min(100, ((v - lo) / (hi - lo)) * 100));
  return (
    <div className="twin-gauge">
      <div className="twin-gauge-track">
        <div className="twin-gauge-band" style={{ bottom: `${pct(frl)}%`, top: `${100 - pct(mwl)}%` }} />
        <div className="twin-gauge-marker" style={{ bottom: `${pct(level)}%` }} title={`${level}m`} />
      </div>
      <div className="twin-gauge-labels">
        <div style={{ bottom: `${pct(mwl)}%` }} className="twin-gauge-label">MWL {mwl}m</div>
        <div style={{ bottom: `${pct(level)}%` }} className="twin-gauge-label twin-gauge-label-current">{level}m</div>
        <div style={{ bottom: `${pct(frl)}%` }} className="twin-gauge-label">FRL {frl}m</div>
      </div>
    </div>
  );
}

export default function LiveTwin() {
  const [state, setState] = useState(null);
  const [error, setError] = useState(null);
  const [syncing, setSyncing] = useState(false);

  const load = () => {
    fetchTwinState().then(setState).catch((e) => setError(e.message));
  };
  useEffect(load, []);

  const handleSync = async () => {
    setSyncing(true);
    setError(null);
    try {
      const result = await triggerTwinSync();
      setState(result);
    } catch (e) {
      setError(e.message);
    } finally {
      setSyncing(false);
    }
  };

  if (error && !state) {
    return (
      <div className="sph-panel">
        <p className="warn">{error}</p>
        <button className="predict-btn" onClick={handleSync} disabled={syncing}>
          {syncing ? "Syncing…" : "Try sync now"}
        </button>
      </div>
    );
  }
  if (!state) return <div className="sph-panel"><div className="panel-loading"><span className="spinner" />Loading live twin state…</div></div>;

  const sync = state.last_good_sync;
  const latestAttempt = state.sync_log?.[0];
  const attemptFailed = latestAttempt && !latestAttempt.success;

  if (!sync) {
    return (
      <div className="sph-panel">
        <h2>Live Twin — no successful sync yet</h2>
        <p className="warn">{latestAttempt?.error || "No sync has succeeded."}</p>
        <button className="predict-btn" onClick={handleSync} disabled={syncing}>
          {syncing ? "Syncing…" : "Sync now"}
        </button>
      </div>
    );
  }

  const reading = sync.current_reading;
  const badge = freshnessBadge(reading);

  return (
    <div className="sph-panel">
      <div className="twin-badge-row">
        <span className="twin-type-badge">LIVE TWIN — GAUGE DATA</span>
      </div>
      <h2>{sync.station.name}</h2>
      <p className="subtle">
        CWC station {sync.station.cwc_station_code} ({sync.station.cwc_type}) ·{" "}
        {sync.station.lat.toFixed(2)}°N, {sync.station.lon.toFixed(2)}°E
      </p>

      <span className={`sph-status-badge ${badge.cls}`}>{badge.label}</span>

      {attemptFailed && (
        <p className="warn">
          Last sync attempt ({formatUtcAsLocal(latestAttempt.attempted_at_utc)}) failed:{" "}
          {latestAttempt.error} — showing last successful sync below.
        </p>
      )}

      <div className="twin-reading-row">
        <LevelGauge level={reading.water_level_m} frl={reading.reference_levels_m.frl} mwl={reading.reference_levels_m.mwl} />
        <div className="stat-grid twin-stat-grid">
          <div><span>Water level</span><strong>{reading.water_level_m} m</strong></div>
          <div><span>vs. FRL</span><strong>+{reading.level_vs_reference.above_frl_m} m</strong></div>
          <div><span>vs. MWL</span><strong>−{reading.level_vs_reference.below_mwl_m} m</strong></div>
          <div><span>Reading age</span><strong>{reading.age_hours} h</strong></div>
        </div>
      </div>

      <div className="twin-timestamps">
        <div><span>CWC reading taken:</span> {formatIst(reading.data_time_ist)}</div>
        <div><span>Last synced by this app:</span> {formatUtcAsLocal(sync.synced_at_utc)}</div>
      </div>

      <p className="subtle twin-cadence">
        <strong>Update frequency:</strong> {sync.update_cadence.description}. This is the real,
        measured cadence of the source — not assumed. The background sync here checks hourly for
        a new reading, but that cannot make the underlying daily source update any faster.
      </p>

      <button className="predict-btn" onClick={handleSync} disabled={syncing}>
        {syncing ? "Syncing…" : "Sync now"}
      </button>

      <details>
        <summary>Data source & honesty notes</summary>
        <ul className="assumptions">
          <li>
            Source: <a href={sync.source.url} target="_blank" rel="noreferrer">{sync.source.name}</a>
          </li>
          <li>{sync.source.note}</li>
          {Object.entries(sync.other_datatypes_seen || {}).map(([code, v]) => (
            <li key={code}>
              Datatype <code>{code}</code> also reported by this station: last value {v.latest_value} at{" "}
              {formatIst(v.latest_data_time_ist)} — <strong>{v.age_hours}h old, not shown as live</strong> (excluded from the reading above).
            </li>
          ))}
        </ul>
      </details>

      <details>
        <summary>Recent sync attempts ({state.sync_log.length})</summary>
        <ul className="assumptions">
          {state.sync_log.map((a, i) => (
            <li key={i} className={a.success ? "" : "warn"}>
              {formatUtcAsLocal(a.attempted_at_utc)} — {a.success ? "OK" : `FAILED: ${a.error}`}
            </li>
          ))}
        </ul>
      </details>
    </div>
  );
}
