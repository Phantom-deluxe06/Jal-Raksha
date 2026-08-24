export const API_BASE = "http://127.0.0.1:8000";
const JOB_ID = "kosi_actual2008";

export async function fetchResult() {
  const res = await fetch(`${API_BASE}/simulate/result/${JOB_ID}`);
  if (!res.ok) throw new Error(`result fetch failed: ${res.status}`);
  return res.json();
}

export async function triggerRun() {
  const res = await fetch(`${API_BASE}/simulate/swe`, { method: "POST" });
  if (!res.ok) throw new Error(`run trigger failed: ${res.status}`);
  return res.json();
}

export function frameUrl(filename) {
  const base = filename.split("/").pop();
  return `${API_BASE}/simulate/frame/${JOB_ID}/${base}`;
}

export function exportUrl(format) {
  return `${API_BASE}/export/${JOB_ID}?format=${format}`;
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

