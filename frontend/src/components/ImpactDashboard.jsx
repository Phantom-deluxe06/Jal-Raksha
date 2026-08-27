import { useState, useEffect, useMemo } from "react";
import { fetchImpactAnalysis, DEFAULT_JOB_ID } from "../api";
import {
  IconBuilding,
  IconUsers,
  IconSearch,
  IconFilter,
  IconCheck,
  IconArrowRight,
  IconChevron,
} from "./icons";

export default function ImpactDashboard({
  jobId = DEFAULT_JOB_ID,
  meta,
  frameIndex = 0,
  onSelectSettlement,
  onEnterView,
}) {
  const [impactData, setImpactData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Filters & Sorting State
  const [searchQuery, setSearchQuery] = useState("");
  const [placeTypeFilter, setPlaceTypeFilter] = useState("all");
  const [exposureFilter, setExposureFilter] = useState("all"); // "all" | "current" | "scenario_reached" | "unaffected"
  const [sortBy, setSortBy] = useState("arrival_time"); // "arrival_time" | "name" | "max_depth" | "current_depth" | "population"
  const [sortOrder, setSortOrder] = useState("asc"); // "asc" | "desc"
  const [selectedSettlement, setSelectedSettlement] = useState(null);
  const [viewScope, setViewScope] = useState("timestep"); // "timestep" | "max_scenario"

  useEffect(() => {
    setLoading(true);
    setError(null);
    fetchImpactAnalysis(jobId)
      .then((data) => {
        setImpactData(data);
        setLoading(false);
      })
      .catch((e) => {
        // Fallback: use meta impact_analysis if available
        if (meta && meta.impact_analysis) {
          setImpactData(meta.impact_analysis);
          setLoading(false);
        } else {
          setError(e.message);
          setLoading(false);
        }
      });
  }, [jobId, meta]);

  const currentFrameImpact = useMemo(() => {
    if (!impactData || !impactData.timeline_frames) return null;
    const idx = Math.min(frameIndex, impactData.timeline_frames.length - 1);
    return impactData.timeline_frames[idx] || impactData.timeline_frames[0];
  }, [impactData, frameIndex]);

  // Filtered & Sorted Settlements List
  const filteredSettlements = useMemo(() => {
    if (!impactData || !impactData.settlements) return [];

    let list = impactData.settlements.map((s) => {
      // Get current depth for the active frameIndex
      const depthObj = s.depth_time_series && s.depth_time_series[frameIndex];
      const currentDepth = depthObj ? depthObj.depth_m : 0.0;
      const isExposedCurrent = currentDepth >= 0.1;
      return {
        ...s,
        current_depth_m: currentDepth,
        is_exposed_current: isExposedCurrent,
      };
    });

    // 1. Text Search
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter((s) => s.name.toLowerCase().includes(q));
    }

    // 2. Place Type Filter
    if (placeTypeFilter !== "all") {
      list = list.filter((s) => s.place_type === placeTypeFilter);
    }

    // 3. Exposure Status Filter
    if (exposureFilter === "current") {
      list = list.filter((s) => s.is_exposed_current);
    } else if (exposureFilter === "scenario_reached") {
      list = list.filter((s) => s.is_potentially_exposed);
    } else if (exposureFilter === "unaffected") {
      list = list.filter((s) => !s.is_potentially_exposed);
    }

    // 4. Sorting
    list.sort((a, b) => {
      let valA, valB;
      if (sortBy === "name") {
        valA = a.name.toLowerCase();
        valB = b.name.toLowerCase();
        return sortOrder === "asc" ? valA.localeCompare(valB) : valB.localeCompare(valA);
      } else if (sortBy === "arrival_time") {
        valA = a.arrival_time_minutes !== null ? a.arrival_time_minutes : 99999;
        valB = b.arrival_time_minutes !== null ? b.arrival_time_minutes : 99999;
      } else if (sortBy === "max_depth") {
        valA = a.max_simulated_depth_m;
        valB = b.max_simulated_depth_m;
      } else if (sortBy === "current_depth") {
        valA = a.current_depth_m;
        valB = b.current_depth_m;
      } else if (sortBy === "population") {
        valA = a.local_worldpop_cell_population;
        valB = b.local_worldpop_cell_population;
      }
      return sortOrder === "asc" ? valA - valB : valB - valA;
    });

    return list;
  }, [impactData, frameIndex, searchQuery, placeTypeFilter, exposureFilter, sortBy, sortOrder]);

  const handleRowClick = (settlement) => {
    setSelectedSettlement(settlement);
    if (onSelectSettlement) {
      onSelectSettlement(settlement);
    }
  };

  const toggleSort = (field) => {
    if (sortBy === field) {
      setSortOrder((o) => (o === "asc" ? "desc" : "asc"));
    } else {
      setSortBy(field);
      setSortOrder(field === "name" ? "asc" : "desc");
    }
  };

  if (loading) {
    return (
      <div className="impact-loading">
        <div className="spinner" />
        <p>Running spatial zonal analysis across WorldPop and settlement layers…</p>
      </div>
    );
  }

  if (error || !impactData) {
    return (
      <div className="impact-error">
        <h3>Could not load impact analysis</h3>
        <p>{error || "No impact analysis data found for this scenario."}</p>
      </div>
    );
  }

  const summary = impactData.summary;
  const activeTimeMinutes = currentFrameImpact ? currentFrameImpact.t_minutes : 0;

  return (
    <div className="impact-dashboard-container">
      {/* Header */}
      <div className="impact-header">
        <div className="impact-header-title">
          <IconBuilding />
          <div>
            <h2>Flood Impact Analysis Engine</h2>
            <p className="subtle">
              Spatial intersection & zonal exposure calculations across real SRTM DEM, WorldPop India 2020, and OpenStreetMap settlements.
            </p>
          </div>
        </div>

        {/* View Scope Toggle */}
        <div className="impact-scope-toggle">
          <button
            className={viewScope === "timestep" ? "active" : ""}
            onClick={() => setViewScope("timestep")}
          >
            ⏱️ Current Timestep (T+{activeTimeMinutes} min)
          </button>
          <button
            className={viewScope === "max_scenario" ? "active" : ""}
            onClick={() => setViewScope("max_scenario")}
          >
            🌊 Max Scenario Footprint
          </button>
        </div>
      </div>

      {/* Primary Impact Metrics Banner */}
      <div className="impact-metrics-banner">
        <div className="impact-metric-card">
          <span className="metric-label">
            {viewScope === "timestep" ? `Flooded Area (T+${activeTimeMinutes}m)` : "Max Scenario Flood Extent"}
          </span>
          <strong className="metric-value">
            {viewScope === "timestep"
              ? `${currentFrameImpact?.flooded_area_km2.toLocaleString()} km²`
              : `${summary.max_scenario_flooded_area_km2.toLocaleString()} km²`}
          </strong>
          <span className="metric-sub">
            {(( (viewScope === "timestep" ? currentFrameImpact?.flooded_area_km2 : summary.max_scenario_flooded_area_km2) / summary.aoi_area_km2 ) * 100).toFixed(2)}% of AOI domain
          </span>
        </div>

        <div className="impact-metric-card">
          <span className="metric-label">
            {viewScope === "timestep" ? `Settlements Exposed (T+${activeTimeMinutes}m)` : "Settlements in Flood Path"}
          </span>
          <strong className="metric-value accent-exposed">
            {viewScope === "timestep"
              ? currentFrameImpact?.settlements_potentially_exposed_count
              : summary.settlements_potentially_exposed_count}{" "}
            <span className="metric-denom">/ {summary.total_settlements_in_aoi}</span>
          </strong>
          <span className="metric-sub">Named OSM settlements (≥0.1m depth)</span>
        </div>

        <div className="impact-metric-card">
          <span className="metric-label">Population Potentially Exposed</span>
          <strong className="metric-value accent-population">
            {viewScope === "timestep"
              ? Number(currentFrameImpact?.population_potentially_exposed || 0).toLocaleString()
              : Number(summary.max_population_potentially_exposed || 0).toLocaleString()}
          </strong>
          <span className="metric-sub">WorldPop India 2020 zonal resample (&gt;0.1m)</span>
        </div>

        <div className="impact-metric-card">
          <span className="metric-label">Significantly Affected (&gt;0.3m)</span>
          <strong className="metric-value accent-significant">
            {viewScope === "timestep"
              ? Number(currentFrameImpact?.["population_significantly_affected_gt0.3m"] || 0).toLocaleString()
              : Number(summary.max_population_significantly_affected || 0).toLocaleString()}
          </strong>
          <span className="metric-sub">Higher hazard threshold (&gt;0.3m depth)</span>
        </div>

        <div className="impact-metric-card">
          <span className="metric-label">Earliest Settlement Arrival</span>
          <strong className="metric-value">
            {summary.earliest_arrival_time_minutes !== null
              ? `T+${summary.earliest_arrival_time_minutes} min`
              : "N/A"}
          </strong>
          <span className="metric-sub">First settlement inundated (&gt;0.1m)</span>
        </div>
      </div>

      {/* Infrastructure Datasets Section (Zero-Invention Handling) */}
      <div className="impact-infrastructure-section">
        <div className="infra-header">
          <h3>Critical Infrastructure & Lifelines</h3>
          <span className="infra-tag">Zero-Invention Compliance</span>
        </div>

        <div className="infra-grid">
          <div className="infra-card unavailable">
            <div className="infra-card-top">
              <strong>🛣️ Road Network</strong>
              <span className="infra-status-badge">No Dataset</span>
            </div>
            <p className="subtle">
              {impactData.infrastructure?.roads?.reason || "Road vector network is not present in workspace."}
            </p>
          </div>

          <div className="infra-card unavailable">
            <div className="infra-card-top">
              <strong>🌉 Bridges & Crossings</strong>
              <span className="infra-status-badge">No Dataset</span>
            </div>
            <p className="subtle">
              {impactData.infrastructure?.bridges?.reason || "Bridge structure vector layer is not present in workspace."}
            </p>
          </div>

          <div className="infra-card unavailable">
            <div className="infra-card-top">
              <strong>🏥 Critical Facilities (Hospitals / Schools)</strong>
              <span className="infra-status-badge">No Dataset</span>
            </div>
            <p className="subtle">
              {impactData.infrastructure?.critical_facilities?.reason || "Facility footprints are not present in workspace."}
            </p>
          </div>
        </div>
      </div>

      {/* Main Content Grid: Settlement Table & Selected Settlement Details */}
      <div className="impact-layout-grid">
        {/* Left / Main Column: Searchable & Sortable Settlement Table */}
        <div className="impact-table-col">
          <div className="table-controls-bar">
            {/* Search Input */}
            <div className="table-search-box">
              <IconSearch />
              <input
                type="text"
                placeholder="Search settlement name (e.g. Kusaha, Bhargama, Supaul)…"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
              {searchQuery && (
                <button className="clear-search-btn" onClick={() => setSearchQuery("")}>
                  ✕
                </button>
              )}
            </div>

            {/* Filter by Place Type */}
            <div className="table-filter-group">
              <label>Type:</label>
              <select value={placeTypeFilter} onChange={(e) => setPlaceTypeFilter(e.target.value)}>
                <option value="all">All Types</option>
                <option value="village">Villages</option>
                <option value="town">Towns</option>
                <option value="hamlet">Hamlets</option>
                <option value="city">Cities</option>
              </select>
            </div>

            {/* Filter by Exposure */}
            <div className="table-filter-group">
              <label>Exposure:</label>
              <select value={exposureFilter} onChange={(e) => setExposureFilter(e.target.value)}>
                <option value="all">All Settlements ({impactData.settlements.length})</option>
                <option value="current">Exposed at T+{activeTimeMinutes}m</option>
                <option value="scenario_reached">Reached in Scenario ({summary.settlements_potentially_exposed_count})</option>
                <option value="unaffected">Outside Extent</option>
              </select>
            </div>
          </div>

          {/* Results Count & Table */}
          <div className="settlements-table-wrapper">
            <table className="settlements-table">
              <thead>
                <tr>
                  <th onClick={() => toggleSort("name")} className={sortBy === "name" ? "sorted" : ""}>
                    Settlement Name {sortBy === "name" && (sortOrder === "asc" ? "▲" : "▼")}
                  </th>
                  <th>Type</th>
                  <th onClick={() => toggleSort("arrival_time")} className={sortBy === "arrival_time" ? "sorted" : ""}>
                    Arrival Time {sortBy === "arrival_time" && (sortOrder === "asc" ? "▲" : "▼")}
                  </th>
                  <th onClick={() => toggleSort("current_depth")} className={sortBy === "current_depth" ? "sorted" : ""}>
                    Depth @ T+{activeTimeMinutes}m {sortBy === "current_depth" && (sortOrder === "asc" ? "▲" : "▼")}
                  </th>
                  <th onClick={() => toggleSort("max_depth")} className={sortBy === "max_depth" ? "sorted" : ""}>
                    Max Depth {sortBy === "max_depth" && (sortOrder === "asc" ? "▲" : "▼")}
                  </th>
                  <th onClick={() => toggleSort("population")} className={sortBy === "population" ? "sorted" : ""}>
                    Local Pop. {sortBy === "population" && (sortOrder === "asc" ? "▲" : "▼")}
                  </th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {filteredSettlements.length === 0 ? (
                  <tr>
                    <td colSpan="7" style={{ textAlign: "center", padding: "2rem", color: "var(--text-tertiary)" }}>
                      No settlements match the search or filter criteria.
                    </td>
                  </tr>
                ) : (
                  filteredSettlements.map((s) => {
                    const isSelected = selectedSettlement?.osm_id === s.osm_id;
                    const isExposedNow = s.current_depth_m >= 0.1;
                    const isSignificantNow = s.current_depth_m >= 0.3;

                    return (
                      <tr
                        key={s.osm_id || `${s.lat}_${s.lon}`}
                        className={`${isSelected ? "selected-row" : ""} ${isExposedNow ? "row-exposed" : ""}`}
                        onClick={() => handleRowClick(s)}
                      >
                        <td className="settlement-name-cell">
                          <strong>{s.name}</strong>
                          <span className="coords-sub">
                            {s.lat.toFixed(3)}°N, {s.lon.toFixed(3)}°E
                          </span>
                        </td>
                        <td>
                          <span className="place-type-chip">{s.place_type}</span>
                        </td>
                        <td>
                          {s.arrival_time_minutes !== null ? (
                            <span className="arrival-badge">T+{s.arrival_time_minutes} min</span>
                          ) : (
                            <span className="subtle">Not reached</span>
                          )}
                        </td>
                        <td>
                          <strong className={isSignificantNow ? "depth-sig" : isExposedNow ? "depth-exp" : "subtle"}>
                            {s.current_depth_m > 0 ? `${s.current_depth_m.toFixed(2)} m` : "0.00 m"}
                          </strong>
                        </td>
                        <td>
                          <strong>{s.max_simulated_depth_m > 0 ? `${s.max_simulated_depth_m.toFixed(2)} m` : "0.00 m"}</strong>
                        </td>
                        <td>
                          <span>{s.local_worldpop_cell_population > 0 ? s.local_worldpop_cell_population.toLocaleString() : "—"}</span>
                        </td>
                        <td>
                          {isSignificantNow ? (
                            <span className="status-tag tag-sig">Significant (&gt;0.3m)</span>
                          ) : isExposedNow ? (
                            <span className="status-tag tag-exp">Exposed</span>
                          ) : s.is_potentially_exposed ? (
                            <span className="status-tag tag-future">Reached @ T+{s.arrival_time_minutes}m</span>
                          ) : (
                            <span className="status-tag tag-safe">Outside Extent</span>
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Right Column: Selected Settlement Details & Depth Over Time Chart */}
        <div className="impact-details-col">
          {selectedSettlement ? (
            <div className="settlement-detail-card">
              <div className="detail-card-header">
                <div>
                  <h3>{selectedSettlement.name}</h3>
                  <span className="place-type-chip">{selectedSettlement.place_type}</span>
                </div>
                <button className="detail-close-btn" onClick={() => setSelectedSettlement(null)}>
                  ✕
                </button>
              </div>

              <div className="detail-card-body">
                <div className="detail-stat-row">
                  <div>
                    <span>Coordinates:</span>
                    <strong>{selectedSettlement.lat}°N, {selectedSettlement.lon}°E</strong>
                  </div>
                  <div>
                    <span>Estimated Arrival Time:</span>
                    <strong>
                      {selectedSettlement.arrival_time_minutes !== null
                        ? `T+${selectedSettlement.arrival_time_minutes} min`
                        : "Not reached"}
                    </strong>
                  </div>
                </div>

                <div className="detail-stat-row">
                  <div>
                    <span>Current Depth (T+{activeTimeMinutes}m):</span>
                    <strong className={selectedSettlement.current_depth_m >= 0.3 ? "depth-sig" : selectedSettlement.current_depth_m >= 0.1 ? "depth-exp" : ""}>
                      {selectedSettlement.current_depth_m.toFixed(2)} m
                    </strong>
                  </div>
                  <div>
                    <span>Max Scenario Depth:</span>
                    <strong>{selectedSettlement.max_simulated_depth_m.toFixed(2)} m</strong>
                  </div>
                </div>

                <div className="detail-stat-row">
                  <div>
                    <span>WorldPop Cell Population:</span>
                    <strong>{selectedSettlement.local_worldpop_cell_population ? selectedSettlement.local_worldpop_cell_population.toLocaleString() : "—"} people</strong>
                  </div>
                  <div>
                    <span>Scenario Status:</span>
                    <strong>{selectedSettlement.is_potentially_exposed ? "Potentially Exposed" : "Outside Simulated Extent"}</strong>
                  </div>
                </div>

                {/* Depth Over Time Progression */}
                {selectedSettlement.depth_time_series && (
                  <div className="depth-progression-block">
                    <h4>Simulated Water Depth Progression</h4>
                    <div className="depth-series-bars">
                      {selectedSettlement.depth_time_series.map((ts, idx) => {
                        const isCurrent = idx === frameIndex;
                        const heightPct = Math.min(100, (ts.depth_m / (selectedSettlement.max_simulated_depth_m || 1)) * 100);
                        return (
                          <div
                            key={ts.t_minutes}
                            className={`depth-bar-col ${isCurrent ? "active-step" : ""}`}
                            title={`T+${ts.t_minutes}min: ${ts.depth_m.toFixed(2)}m`}
                          >
                            <div className="depth-bar-track">
                              <div
                                className={`depth-bar-fill ${ts.depth_m >= 0.3 ? "fill-sig" : ts.depth_m >= 0.1 ? "fill-exp" : "fill-dry"}`}
                                style={{ height: `${ts.depth_m > 0 ? Math.max(8, heightPct) : 2}%` }}
                              />
                            </div>
                            <span className="depth-bar-time">{ts.t_minutes}m</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Map Navigation Action */}
                <div className="detail-actions">
                  <button
                    className="detail-nav-btn primary"
                    onClick={() => {
                      if (onSelectSettlement) onSelectSettlement(selectedSettlement);
                      if (onEnterView) onEnterView("full");
                    }}
                  >
                    🗺️ Locate on 2D Flood Map <IconArrowRight />
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <div className="settlement-detail-placeholder">
              <IconBuilding />
              <h4>Select a settlement from the table</h4>
              <p className="subtle">
                Click any row in the table to inspect its localized depth hydrograph, arrival time, and spatial exposure metrics.
              </p>
            </div>
          )}

          {/* Methodology & Terminology Notes */}
          <div className="impact-terminology-card">
            <h4>📖 Terminology & Methodology</h4>
            <ul>
              <li>
                <strong>Potentially Exposed:</strong> Estimated population residing within grid cells where simulated flood depth reaches $\ge 0.1\text{"{"}m{"}"}$.
              </li>
              <li>
                <strong>Significantly Affected:</strong> Population in zones where depth reaches $\ge 0.3\text{"{"}m{"}"}$ (representing vehicle and pedestrian hazard thresholds).
              </li>
              <li>
                <strong>Model-Estimated:</strong> All exposure values are scenario estimates for humanitarian disaster planning and response, not confirmed ground truth casualties.
              </li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
