import React, { useState } from 'react';
import { MapContainer, TileLayer, Rectangle } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import { Satellite, Activity, AlertTriangle, Layers, Calendar } from 'lucide-react';

const DynamicSarComparison = ({ bbox, simulatedExtentKm2 }) => {
  const [targetDate, setTargetDate] = useState("2026-08-20");
  const [thresholdDb, setThresholdDb] = useState(-17.0);
  const [sarResult, setSarResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const runSarAnalysis = async () => {
    setLoading(true);
    setError(null);
    setSarResult(null);
    
    try {
      const res = await fetch("http://127.0.0.1:8000/api/sar/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          bbox: bbox,
          target_date: targetDate,
          threshold_db: thresholdDb
        })
      });
      
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Failed to fetch SAR analysis");
      
      setSarResult(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={styles.card}>
      <h3 style={styles.header}>
        <Satellite size={20} style={{ marginRight: '8px' }} color="#ff9900" />
        Live GEE Sentinel-1 SAR Observational Extent
      </h3>
      
      <div style={styles.controlsRow}>
        <div style={styles.controlGroup}>
          <label style={styles.label}><Calendar size={14} style={{marginRight: '4px'}}/> Crisis Date</label>
          <input 
            type="date" 
            value={targetDate} 
            onChange={(e) => setTargetDate(e.target.value)} 
            style={styles.input}
          />
        </div>
        
        <div style={styles.controlGroup}>
          <label style={styles.label}><Layers size={14} style={{marginRight: '4px'}}/> Water Threshold: {thresholdDb} dB</label>
          <input 
            type="range" 
            min="-22" 
            max="-12" 
            step="0.5" 
            value={thresholdDb} 
            onChange={(e) => setThresholdDb(parseFloat(e.target.value))}
            style={styles.slider}
          />
        </div>
        
        <button onClick={runSarAnalysis} disabled={loading} style={styles.button}>
          {loading ? <Activity size={16} style={{ animation: "spin 2s linear infinite" }} /> : "Run SAR Analysis"}
        </button>
      </div>

      {error && (
        <div style={styles.errorBox}>
          <AlertTriangle size={16} style={{ marginRight: '8px' }} />
          {error}
        </div>
      )}

      {sarResult && (
        <div style={styles.resultContainer}>
          <div style={styles.metricsGrid}>
            <div style={styles.metricBox}>
              <div style={styles.metricLabel}>Simulated Physical Extent</div>
              <div style={styles.metricValue(false)}>{simulatedExtentKm2 || '--'} km²</div>
              <div style={styles.metricBadge(false)}>Hydrodynamic Model</div>
            </div>
            
            <div style={styles.metricBox}>
              <div style={styles.metricLabel}>Observed SAR Extent</div>
              <div style={styles.metricValue(true)}>{sarResult.sar_flood_extent_km2} km²</div>
              <div style={styles.metricBadge(true)}>{sarResult.satellite}</div>
            </div>
          </div>
          
          <div style={styles.telemetryBadge}>
            <strong>Telemetry: </strong> 
            Latency: {sarResult.query_latency_sec}s | 
            Acq: {sarResult.acquisition_timestamp.split('T')[0]} | 
            Pol: {sarResult.polarization} | 
            Orbit: {sarResult.orbit_pass}
          </div>
          
          {sarResult.tile_url && (
            <div style={styles.mapPreview}>
              <div style={{ position: "absolute", top: "10px", left: "10px", zIndex: 500, display: "flex", gap: "8px" }}>
                <span style={{background: "rgba(255,153,0,0.85)", padding: "4px 8px", borderRadius: "4px", fontSize: "12px"}}>
                  Live GEE Sentinel-1 SAR water mask
                </span>
              </div>
              <MapContainer
                center={[(bbox[1] + bbox[3]) / 2, (bbox[0] + bbox[2]) / 2]}
                zoom={9}
                style={{ height: "100%", width: "100%", borderRadius: "6px" }}
                scrollWheelZoom={false}
              >
                <TileLayer
                  attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>'
                  url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
                  subdomains="abcd"
                />
                <TileLayer url={sarResult.tile_url} opacity={0.85} />
                <Rectangle
                  bounds={[[bbox[1], bbox[0]], [bbox[3], bbox[2]]]}
                  pathOptions={{ color: "#00a5ff", weight: 2, fill: false }}
                />
              </MapContainer>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

const styles = {
  card: {
    backgroundColor: "rgba(10, 10, 15, 0.95)",
    border: "1px solid rgba(255, 153, 0, 0.4)",
    borderRadius: "8px",
    padding: "20px",
    marginTop: "20px",
    color: "white",
    fontFamily: "Inter, sans-serif",
    boxShadow: "0 4px 12px rgba(0,0,0,0.5)"
  },
  header: {
    display: "flex",
    alignItems: "center",
    margin: "0 0 16px 0",
    fontSize: "18px",
    fontWeight: "600",
    borderBottom: "1px solid rgba(255,255,255,0.1)",
    paddingBottom: "12px",
    color: "#ff9900"
  },
  controlsRow: {
    display: "flex",
    gap: "16px",
    alignItems: "flex-end",
    marginBottom: "20px"
  },
  controlGroup: {
    display: "flex",
    flexDirection: "column",
    flex: 1
  },
  label: {
    fontSize: "12px",
    color: "#aaa",
    marginBottom: "8px",
    display: "flex",
    alignItems: "center"
  },
  input: {
    backgroundColor: "rgba(0,0,0,0.5)",
    border: "1px solid rgba(255,255,255,0.2)",
    color: "white",
    padding: "8px 12px",
    borderRadius: "4px",
    fontFamily: "inherit",
    outline: "none"
  },
  slider: {
    width: "100%",
    cursor: "pointer"
  },
  button: {
    padding: "10px 16px",
    backgroundColor: "#ff9900",
    color: "black",
    border: "none",
    borderRadius: "4px",
    fontWeight: "600",
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    minWidth: "150px",
    height: "37px"
  },
  errorBox: {
    backgroundColor: "rgba(255,68,68,0.1)",
    border: "1px solid #ff4444",
    color: "#ff4444",
    padding: "12px",
    borderRadius: "6px",
    display: "flex",
    alignItems: "center",
    marginBottom: "20px",
    fontSize: "14px"
  },
  resultContainer: {
    marginTop: "20px",
    borderTop: "1px solid rgba(255,255,255,0.1)",
    paddingTop: "20px"
  },
  metricsGrid: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: "16px",
    marginBottom: "16px"
  },
  metricBox: {
    backgroundColor: "rgba(255,255,255,0.05)",
    padding: "16px",
    borderRadius: "6px",
  },
  metricLabel: {
    fontSize: "12px",
    color: "#aaa",
    marginBottom: "4px"
  },
  metricValue: (isSar) => ({
    fontSize: "24px",
    fontWeight: "bold",
    marginBottom: "8px",
    color: isSar ? "#ff9900" : "#00a5ff"
  }),
  metricBadge: (isSar) => ({
    fontSize: "10px",
    backgroundColor: isSar ? "rgba(255, 153, 0, 0.2)" : "rgba(0, 165, 255, 0.2)",
    color: isSar ? "#ff9900" : "#00a5ff",
    padding: "2px 6px",
    borderRadius: "10px",
    display: "inline-block"
  }),
  telemetryBadge: {
    backgroundColor: "rgba(255,255,255,0.03)",
    padding: "10px",
    borderRadius: "4px",
    fontSize: "11px",
    color: "#888",
    fontFamily: "monospace",
    marginBottom: "16px",
    textAlign: "center"
  },
  mapPreview: {
    height: "220px",
    backgroundColor: "#111",
    borderRadius: "6px",
    position: "relative",
    overflow: "hidden",
    border: "1px solid #333"
  }
};

export default DynamicSarComparison;
