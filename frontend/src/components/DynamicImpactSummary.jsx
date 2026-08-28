import React, { useState, useEffect } from 'react';
import { DownloadCloud, AlertTriangle, Users, Navigation, Home, Activity } from 'lucide-react';

const DynamicImpactSummary = ({ scenarioId }) => {
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    const fetchSummary = async () => {
      try {
        const res = await fetch(`http://127.0.0.1:8000/api/exposure/${scenarioId}/summary`);
        if (!res.ok) throw new Error("Failed to fetch exposure summary");
        const data = await res.json();
        setSummary(data);
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };
    
    fetchSummary();
  }, [scenarioId]);

  if (loading) {
    return (
      <div style={styles.card}>
        <Activity size={24} style={{ animation: "spin 2s linear infinite" }} color="#888" />
        <span style={{ marginLeft: "10px", color: "#888" }}>Computing Post-Simulation Exposure & Loss...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div style={styles.card}>
        <AlertTriangle size={24} color="#ff4444" />
        <span style={{ marginLeft: "10px", color: "#ff4444" }}>Error computing impact: {error}</span>
      </div>
    );
  }

  return (
    <div style={styles.card}>
      <h3 style={styles.header}>
        <AlertTriangle size={20} style={{ marginRight: '8px' }} color="#ff4444" />
        Live HADR Damage & Exposure Report
      </h3>
      
      <div style={styles.grid}>
        <div style={styles.metricBox}>
          <div style={styles.metricIcon}><Users size={20} color="#00a5ff" /></div>
          <div>
            <div style={styles.metricLabel}>Total Population at Risk</div>
            <div style={styles.metricValue}>{summary.total_population_at_risk.toLocaleString()}</div>
            <div style={styles.metricBadge}>{summary.population_source}</div>
          </div>
        </div>
        
        <div style={styles.metricBox}>
          <div style={styles.metricIcon}><Home size={20} color="#ffaa00" /></div>
          <div>
            <div style={styles.metricLabel}>Submerged Settlements</div>
            <div style={styles.metricValue}>{summary.submerged_settlements.length}</div>
            <div style={styles.metricBadge}>Affected Nodes</div>
          </div>
        </div>
        
        <div style={styles.metricBox}>
          <div style={styles.metricIcon}><Navigation size={20} color="#888" /></div>
          <div>
            <div style={styles.metricLabel}>Submerged Roads</div>
            <div style={styles.metricValue}>{summary.submerged_road_length_km} km</div>
            <div style={styles.metricBadge}>Major Transport Links</div>
          </div>
        </div>
      </div>
      
      <div style={styles.sectionHeader}>GIS Vector Exports (Contoured Max Depth)</div>
      
      <div style={styles.buttonGroup}>
        <a href={`http://127.0.0.1:8000/api/export/${scenarioId}/shapefile`} download style={styles.button}>
          <DownloadCloud size={16} style={{ marginRight: '8px' }} />
          Export Shapefile (.shp.zip)
        </a>
        <a href={`http://127.0.0.1:8000/api/export/${scenarioId}/kml`} download style={styles.button}>
          <DownloadCloud size={16} style={{ marginRight: '8px' }} />
          Export Google Earth (.kml)
        </a>
        <a href={`http://127.0.0.1:8000/api/export/${scenarioId}/geojson`} download style={styles.button}>
          <DownloadCloud size={16} style={{ marginRight: '8px' }} />
          Export GeoJSON
        </a>
      </div>

      <div style={{ ...styles.sectionHeader, marginTop: '16px' }}>Real-Time 3D Engine Bundle</div>
      <div style={styles.buttonGroup}>
        <a
          href={`http://127.0.0.1:8000/api/export/${scenarioId}/ue5-package`}
          download
          style={{ ...styles.button, borderColor: '#7c4dff', color: '#c9b6ff' }}
        >
          <DownloadCloud size={16} style={{ marginRight: '8px' }} />
          🎮 Export UE5 Simulation Bundle (.zip)
        </a>
      </div>
    </div>
  );
};

const styles = {
  card: {
    backgroundColor: "rgba(10, 10, 15, 0.95)",
    border: "1px solid rgba(255, 68, 68, 0.4)",
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
    paddingBottom: "12px"
  },
  grid: {
    display: "grid",
    gridTemplateColumns: "repeat(3, 1fr)",
    gap: "16px",
    marginBottom: "20px"
  },
  metricBox: {
    backgroundColor: "rgba(255,255,255,0.05)",
    padding: "16px",
    borderRadius: "6px",
    display: "flex",
    alignItems: "flex-start"
  },
  metricIcon: {
    marginRight: "12px",
    marginTop: "2px",
    backgroundColor: "rgba(255,255,255,0.1)",
    padding: "8px",
    borderRadius: "50%"
  },
  metricLabel: {
    fontSize: "12px",
    color: "#aaa",
    marginBottom: "4px"
  },
  metricValue: {
    fontSize: "24px",
    fontWeight: "bold",
    marginBottom: "4px"
  },
  metricBadge: {
    fontSize: "10px",
    backgroundColor: "rgba(0, 165, 255, 0.2)",
    color: "#00a5ff",
    padding: "2px 6px",
    borderRadius: "10px",
    display: "inline-block"
  },
  sectionHeader: {
    fontSize: "14px",
    color: "#bbb",
    marginBottom: "12px",
    fontWeight: "500"
  },
  buttonGroup: {
    display: "flex",
    gap: "12px"
  },
  button: {
    flex: 1,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#111",
    border: "1px solid #333",
    color: "white",
    textDecoration: "none",
    padding: "10px 16px",
    borderRadius: "6px",
    fontSize: "13px",
    transition: "background 0.2s",
    cursor: "pointer",
  }
};

export default DynamicImpactSummary;
