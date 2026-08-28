import React, { useState, useEffect, useRef } from "react";
import { Search, MapPin, Activity, ShieldAlert, Navigation } from "lucide-react";

export default function DamSelector({ onSelect }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [isSearching, setIsSearching] = useState(false);
  const [selectedDam, setSelectedDam] = useState(null);
  const [showDropdown, setShowDropdown] = useState(false);

  const containerRef = useRef(null);

  // Close dropdown if clicked outside
  useEffect(() => {
    function handleClickOutside(event) {
      if (containerRef.current && !containerRef.current.contains(event.target)) {
        setShowDropdown(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Fetch dams on search
  useEffect(() => {
    let active = true;
    const fetchDams = async () => {
      setIsSearching(true);
      try {
        const res = await fetch(`http://127.0.0.1:8000/api/catalog/dams?query=${encodeURIComponent(query)}`);
        const data = await res.json();
        if (active) {
          setResults(data.dams || []);
        }
      } catch (err) {
        console.error("Failed to fetch dams", err);
      } finally {
        if (active) setIsSearching(false);
      }
    };

    const debounceId = setTimeout(() => {
      fetchDams();
    }, 300);

    return () => {
      active = false;
      clearTimeout(debounceId);
    };
  }, [query]);

  const handleSelectDam = async (dam) => {
    setSelectedDam(dam);
    setShowDropdown(false);
    setQuery(dam.name);
  };

  const handleInitialize = async () => {
    if (!selectedDam) return;
    
    let aoi = null;
    try {
      // Fetch AOI for the selected dam
      const aoiRes = await fetch(`http://127.0.0.1:8000/api/catalog/dams/${selectedDam.dam_id}/downstream-aoi`);
      if (aoiRes.ok) {
        aoi = await aoiRes.json();
      }
    } catch (e) {
      console.warn("Could not fetch downstream AOI, proceeding with defaults");
    }

    if (onSelect) {
      onSelect(selectedDam, aoi);
    }
  };

  return (
    <div ref={containerRef} style={{ position: "relative", width: "100%", maxWidth: "500px" }}>
      
      {/* Search Input */}
      <div style={{ position: "relative" }}>
        <input
          type="text"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setShowDropdown(true);
            setSelectedDam(null);
          }}
          onFocus={() => setShowDropdown(true)}
          placeholder="Search 5,334+ CWC Dams or Rivers..."
          style={{
            width: "100%",
            padding: "12px 16px 12px 42px",
            background: "rgba(255, 255, 255, 0.05)",
            border: "1px solid rgba(255,255,255,0.1)",
            borderRadius: "8px",
            color: "white",
            fontSize: "15px",
            outline: "none",
            boxShadow: "inset 0 2px 4px rgba(0,0,0,0.2)"
          }}
        />
        <Search style={{ position: "absolute", left: "14px", top: "12px", color: "#888" }} size={18} />
      </div>

      {/* Dropdown Results */}
      {showDropdown && (
        <div
          style={{
            position: "absolute",
            top: "100%",
            left: 0,
            right: 0,
            marginTop: "8px",
            background: "rgba(20, 25, 30, 0.95)",
            backdropFilter: "blur(10px)",
            border: "1px solid rgba(255,255,255,0.15)",
            borderRadius: "8px",
            boxShadow: "0 10px 30px rgba(0,0,0,0.5)",
            zIndex: 1000,
            maxHeight: "350px",
            overflowY: "auto",
          }}
        >
          {isSearching && results.length === 0 && (
            <div style={{ padding: "16px", color: "#888", textAlign: "center" }}>Searching NRLD Database...</div>
          )}
          {!isSearching && results.length === 0 && (
            <div style={{ padding: "16px", color: "#888", textAlign: "center" }}>No dams found.</div>
          )}

          {results.map((dam) => (
            <div
              key={dam.dam_id}
              onClick={() => handleSelectDam(dam)}
              style={{
                padding: "12px 16px",
                borderBottom: "1px solid rgba(255,255,255,0.05)",
                cursor: "pointer",
                display: "flex",
                flexDirection: "column",
                gap: "4px",
                background: selectedDam?.dam_id === dam.dam_id ? "rgba(74, 144, 255, 0.15)" : "transparent",
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(255,255,255,0.05)")}
              onMouseLeave={(e) => {
                if (selectedDam?.dam_id !== dam.dam_id) {
                  e.currentTarget.style.background = "transparent";
                }
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontWeight: "600", fontSize: "15px", color: "white" }}>
                  {dam.is_preset && <span style={{ color: "#fbc531", marginRight: "6px" }}>★</span>}
                  {dam.name}
                </span>
                <span style={{ fontSize: "12px", color: "#888", background: "rgba(0,0,0,0.3)", padding: "2px 6px", borderRadius: "4px" }}>
                  {dam.state}
                </span>
              </div>
              <div style={{ fontSize: "13px", color: "#aaa", display: "flex", alignItems: "center", gap: "6px" }}>
                <Navigation size={12} /> River: {dam.river || "Unknown"}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Selected Dam Card */}
      {selectedDam && !showDropdown && (
        <div
          style={{
            marginTop: "16px",
            padding: "20px",
            background: "linear-gradient(135deg, rgba(20, 25, 30, 0.8) 0%, rgba(10, 15, 20, 0.9) 100%)",
            border: "1px solid rgba(74, 144, 255, 0.4)",
            borderRadius: "12px",
            boxShadow: "0 8px 25px rgba(0,0,0,0.4)",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "16px" }}>
            <div>
              <div style={{ fontSize: "12px", color: "#4a90ff", fontWeight: "bold", textTransform: "uppercase", letterSpacing: "1px", marginBottom: "4px" }}>
                Target Structure Selected
              </div>
              <h3 style={{ margin: 0, color: "white", fontSize: "20px" }}>{selectedDam.name}</h3>
              <div style={{ color: "#aaa", fontSize: "14px", marginTop: "4px", display: "flex", alignItems: "center", gap: "6px" }}>
                <MapPin size={14} /> {selectedDam.district}, {selectedDam.state}
              </div>
            </div>
            
            <div style={{ textAlign: "right" }}>
              <div style={{ fontSize: "12px", color: "#888" }}>CWC NRLD ID</div>
              <div style={{ fontFamily: "monospace", color: "#ddd", background: "rgba(0,0,0,0.3)", padding: "2px 6px", borderRadius: "4px" }}>
                {selectedDam.dam_id}
              </div>
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px", marginBottom: "20px" }}>
            <div style={{ background: "rgba(0,0,0,0.2)", padding: "10px", borderRadius: "8px", border: "1px solid rgba(255,255,255,0.05)" }}>
              <div style={{ fontSize: "12px", color: "#888", marginBottom: "4px" }}>Max Height</div>
              <div style={{ fontSize: "16px", color: "white", fontWeight: "500" }}>{selectedDam.height_m > 0 ? `${selectedDam.height_m} m` : "Unknown"}</div>
            </div>
            <div style={{ background: "rgba(0,0,0,0.2)", padding: "10px", borderRadius: "8px", border: "1px solid rgba(255,255,255,0.05)" }}>
              <div style={{ fontSize: "12px", color: "#888", marginBottom: "4px" }}>Gross Storage</div>
              <div style={{ fontSize: "16px", color: "white", fontWeight: "500" }}>{selectedDam.storage_mcm > 0 ? `${selectedDam.storage_mcm} MCM` : "Unknown"}</div>
            </div>
            <div style={{ background: "rgba(0,0,0,0.2)", padding: "10px", borderRadius: "8px", border: "1px solid rgba(255,255,255,0.05)", gridColumn: "span 2" }}>
              <div style={{ fontSize: "12px", color: "#888", marginBottom: "4px", display: "flex", alignItems: "center", gap: "4px" }}>
                <Activity size={14} /> Spillway Capacity
              </div>
              <div style={{ fontSize: "16px", color: "#ff9f1c", fontWeight: "500" }}>
                {selectedDam.spillway_capacity_cumec > 0 ? `${selectedDam.spillway_capacity_cumec.toLocaleString()} m³/s` : "Unknown"}
              </div>
            </div>
          </div>

          <button
            onClick={handleInitialize}
            style={{
              width: "100%",
              padding: "12px",
              background: "#4a90ff",
              color: "white",
              border: "none",
              borderRadius: "8px",
              fontWeight: "600",
              fontSize: "15px",
              cursor: "pointer",
              display: "flex",
              justifyContent: "center",
              alignItems: "center",
              gap: "8px",
              transition: "background 0.2s"
            }}
            onMouseEnter={(e) => e.target.style.background = "#357abd"}
            onMouseLeave={(e) => e.target.style.background = "#4a90ff"}
          >
            <ShieldAlert size={18} /> Initialize Scenario
          </button>
        </div>
      )}
    </div>
  );
}
