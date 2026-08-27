import re

def manual_resolve(filepath, choices):
    with open(filepath, 'r', encoding='utf-8') as f:
        content = f.read()
    
    parts = []
    last_end = 0
    pattern = re.compile(r'<<<<<<< HEAD\r?\n(.*?)\r?\n?=======\r?\n(.*?)\r?\n?>>>>>>> [a-f0-9]+(?:\r?\n|$)', re.DOTALL)
    
    matches = list(pattern.finditer(content))
    if len(matches) != len(choices):
        print(f"Error: {filepath} has {len(matches)} conflicts, but {len(choices)} choices provided.")
        return
        
    for i, match in enumerate(matches):
        parts.append(content[last_end:match.start()])
        head = match.group(1)
        incoming = match.group(2)
        choice = choices[i]
        
        if choice == 'head':
            parts.append(head)
        elif choice == 'incoming':
            parts.append(incoming)
        elif callable(choice):
            parts.append(choice(head, incoming))
        else:
            parts.append(choice)
            
        last_end = match.end()
        
    parts.append(content[last_end:])
    
    with open(filepath, 'w', encoding='utf-8') as f:
        f.write("".join(parts))

def rs_c1(h, i):
    return """import {
  fetchRealtimeWaterExtent,
  fetchSarComparison,
  fetchGeeAuthStatus,
  DEFAULT_JOB_ID,
  compareSarWithSimulation
} from "../api";
import { IconSatellite, IconCheck, IconArrowRight } from "./icons";"""

def rs_c2(h, i):
    return """  jobId = DEFAULT_JOB_ID,
  meta,
  frameIndex = 0,
  frames = [],
  onData,
  onDifferenceData,
  sarLayers,
  setSarLayers,
  onComparisonChange
}) {
  const [authStatus, setAuthStatus] = useState(null);
  const [data, setData] = useState(null);
  const [comparison, setComparison] = useState(null);
  const [error, setError] = useState(null);
  const [authError, setAuthError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [comparing, setComparing] = useState(false);
  const activeTimestep = frames[frameIndex]?.t_minutes ?? null;"""

def rs_c3(h, i):
    return """    setAuthError(null);
    const params = {
      threshold_db: thresholdDb,
    };
    if (searchMode === "custom_dates") {
      if (startDate) params.start_date = startDate;
      if (endDate) params.end_date = endDate;
    }
    if (orbitPass !== "all") {
      params.orbit_pass = orbitPass;
    }

    fetchRealtimeWaterExtent(params)"""

def rs_c4(h, i):
    return """  useEffect(() => {
    loadData();
  }, []);

  const runComparison = () => {
    setComparing(true);
    setError(null);

    const options = {
      frame_index: frameIndex,
      threshold_db: thresholdDb,
    };
    if (searchMode === "custom_dates") {
      if (startDate) options.start_date = startDate;
      if (endDate) options.end_date = endDate;
    }
    if (orbitPass !== "all") {
      options.orbit_pass = orbitPass;
    }

    fetchSarComparison(jobId, options)
      .then((res) => {
        setComparison(res);
        onComparisonChange?.(res);
        if (res.difference_geojson && onDifferenceData) {
          onDifferenceData(res.difference_geojson);
        }
      })
      .catch((e) => {
        setError(e.message);
      })
      .finally(() => setComparing(false));
  };"""

def rs_c5(h, i):
    return """    <div className="sar-module-panel">
      {/* Header & Auth Banner */}
      <div className="sar-header">
        <div className="twin-badge-row">
          <span className="twin-type-badge realtime-badge">SATELLITE OBSERVATION & VALIDATION</span>
        </div>
        <h2>Sentinel-1 Real-Time Comparison</h2>
        <div className="sar-layer-toolbar" style={{ marginTop: '10px' }}>
          <label>
            <input type="checkbox" checked={sarLayers?.showSim} onChange={(e) => setSarLayers(s => ({...s, showSim: e.target.checked}))} />
            Sim Depth
          </label>
          <label>
            <input type="checkbox" checked={sarLayers?.showSar} onChange={(e) => setSarLayers(s => ({...s, showSar: e.target.checked}))} />
            SAR Outline
          </label>
          <label>
            <input type="checkbox" checked={sarLayers?.showDiff} onChange={(e) => setSarLayers(s => ({...s, showDiff: e.target.checked}))} />
            Difference Map
          </label>
          <label className="toggle-satellite">
            <input type="checkbox" checked={sarLayers?.baseSatellite} onChange={(e) => setSarLayers(s => ({...s, baseSatellite: e.target.checked}))} />
            Optical Base
          </label>
        </div>
      </div>"""

def rs_c6(h, i):
    return i

manual_resolve('frontend/src/components/RealtimeSar.jsx', [rs_c1, rs_c2, rs_c3, rs_c4, rs_c5, rs_c6])
