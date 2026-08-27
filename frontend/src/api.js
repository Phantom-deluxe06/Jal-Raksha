export const API_BASE = "http://127.0.0.1:8000";
export const DEFAULT_JOB_ID = "kosi_actual2008";

export async function fetchResult(jobId = DEFAULT_JOB_ID) {
  const res = await fetch(`${API_BASE}/simulate/result/${jobId}`);
  if (!res.ok) throw new Error(`result fetch failed: ${res.status}`);
  return res.json();
}

export async function fetchImpactAnalysis(jobId = DEFAULT_JOB_ID) {
  const res = await fetch(`${API_BASE}/simulate/impact/${jobId}`);
  if (!res.ok) throw new Error(`impact fetch failed: ${res.status}`);
  return res.json();
}


export async function triggerRun(scenario = null) {
  const options = {
    method: "POST",
    headers: { "Content-Type": "application/json" },
  };
  if (scenario) {
    options.body = JSON.stringify(scenario);
  }
  const res = await fetch(`${API_BASE}/simulate/swe`, options);
  if (!res.ok) throw new Error(`run trigger failed: ${res.status}`);
  return res.json();
}

export function frameUrl(filename, jobId = DEFAULT_JOB_ID) {
  if (!filename) return "";
  const base = filename.split("/").pop();
  return `${API_BASE}/simulate/frame/${jobId}/${base}`;
}

export function exportUrl(format, jobId = DEFAULT_JOB_ID) {
  return `${API_BASE}/export/${jobId}?format=${format}`;
}

export async function fetchScenarioPresets() {
  const res = await fetch(`${API_BASE}/scenarios/presets`);
  if (!res.ok) throw new Error(`presets fetch failed: ${res.status}`);
  return res.json();
}

export async function fetchScenarioList() {
  const res = await fetch(`${API_BASE}/scenarios/list`);
  if (!res.ok) throw new Error(`scenario list fetch failed: ${res.status}`);
  return res.json();
}

export async function validateScenario(scenario) {
  const res = await fetch(`${API_BASE}/scenarios/validate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(scenario),
  });
  if (!res.ok) throw new Error(`validation request failed: ${res.status}`);
  return res.json();
}

export async function runScenario(scenario) {
  const res = await fetch(`${API_BASE}/scenarios/run`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(scenario),
  });
  if (!res.ok) throw new Error(`run scenario failed: ${res.status}`);
  return res.json();
}

export async function fetchScenarioStatus(jobId = DEFAULT_JOB_ID) {
  const res = await fetch(`${API_BASE}/simulate/status/${jobId}`);
  if (!res.ok) throw new Error(`status fetch failed: ${res.status}`);
  return res.json();
}

export async function predictInstant({ discharge_cumecs, lat, lon }) {
  const res = await fetch(`${API_BASE}/predict/instant`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ discharge_cumecs, lat, lon }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.detail || `predict failed: ${res.status}`);
  }
  return res.json();
}

export async function fetchDem(downsample = 2) {
  const res = await fetch(`${API_BASE}/terrain/dem?downsample=${downsample}`);
  if (!res.ok) throw new Error(`DEM fetch failed: ${res.status}`);
  return res.json();
}

export function satelliteUrl() {
  return `${API_BASE}/terrain/satellite`;
}

export async function fetchSphResult() {
  const res = await fetch(`${API_BASE}/sph/result`);
  if (!res.ok) throw new Error(`SPH result fetch failed: ${res.status}`);
  return res.json();
}

export async function fetchSphSnapshot(t_seconds) {
  const res = await fetch(`${API_BASE}/sph/snapshot/${t_seconds}`);
  if (!res.ok) throw new Error(`SPH snapshot fetch failed: ${res.status}`);
  return res.json();
}

export async function fetchTwinState() {
  const res = await fetch(`${API_BASE}/twin/state`);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.detail || `twin state fetch failed: ${res.status}`);
  }
  return res.json();
}

export async function triggerTwinSync() {
  const res = await fetch(`${API_BASE}/twin/sync`, { method: "POST" });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.detail || `twin sync failed: ${res.status}`);
  }
  return res.json();
}

export async function fetchGeeAuthStatus() {
  const res = await fetch(`${API_BASE}/realtime/auth-status`);
  if (!res.ok) throw new Error(`auth-status fetch failed: ${res.status}`);
  return res.json();
}

export async function fetchRealtimeWaterExtent(params = {}) {
  const query = new URLSearchParams();
  if (params.start_date) query.append("start_date", params.start_date);
  if (params.end_date) query.append("end_date", params.end_date);
  if (params.orbit_pass) query.append("orbit_pass", params.orbit_pass);
  if (params.threshold_db) query.append("threshold_db", params.threshold_db);

  const url = `${API_BASE}/realtime/water-extent${query.toString() ? `?${query.toString()}` : ""}`;
  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.detail || `realtime water-extent fetch failed: ${res.status}`);
  }
  return res.json();
}

export async function fetchSarComparison(jobId = DEFAULT_JOB_ID, options = {}) {
  const payload = {
    job_id: jobId,
    frame_index: options.frame_index ?? null,
    start_date: options.start_date || null,
    end_date: options.end_date || null,
    orbit_pass: options.orbit_pass || null,
    threshold_db: options.threshold_db ?? -17.0,
  };

  const res = await fetch(`${API_BASE}/realtime/compare`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.detail || `SAR comparison failed: ${res.status}`);
  }
  return res.json();
}

