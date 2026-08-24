# Case Study Data — Kosi River / Kusaha Embankment Breach (2008)

Single demo scenario for FloodSim-HADR (SIH26161), built around the 2008 Kosi
embankment breach at Kusaha, Nepal — the most significant real-world
dam-break-analogue flood event on this river system, and the disaster the
problem statement's "Kosi barrage" reference points to.

All data below is real, publicly hosted, and downloaded programmatically by
the scripts in [`/scripts`](../scripts) (no manual GUI downloads, no accounts
required). Re-run a script at any time to refresh/regenerate its output.

## AOI

`west=86.6, south=25.9, east=87.3, north=26.7` (WGS84) — covers the Kusaha
breach site down through Kosi Barrage into the upper Bihar flood corridor
(~78km x 89km). Does not cover the full historical 3700 km² flood extent
(narrower demo scope for compute tractability); see `dam_config` for the note
on why.

## Layers

| Folder | File | Source | Script |
|---|---|---|---|
| `dem/` | `kosi_aoi_srtm30m.tif` | SRTM 1 arc-second (~30m), NASA, via AWS `elevation-tiles-prod` public bucket (Skadi/HGT tiles N25E086, N25E087, N26E086, N26E087) | `scripts/fetch_dem.py` |
| `population/` | `kosi_aoi_worldpop_2020.tif` | WorldPop India 2020, 1km resolution, unconstrained | `scripts/fetch_population.py` |
| `satellite/` | `kosi_aoi_sentinel2_tci_20231228_40m.tif` (+ `preview.png`) | Sentinel-2 L2A true-colour (TCI), tiles 45RVJ/45RWJ/45RVK/45RWK, 2023-12-28, ESA/Copernicus via AWS Earth Search STAC (`sentinel-cogs` bucket); fetched at native 10m then downsampled to 40m (154MB -> 8.7MB) | `scripts/fetch_satellite.py` + `scripts/postprocess_satellite.py` |
| `dam_config/` | `kosi_case_study.json` | Compiled from Wikipedia (Koshi Barrage, 2008 Bihar flood), IndiaWRIS, GFDRR needs-assessment report — see `sources` field in the JSON | (hand-authored) |
| `river_network/` | *(empty)* | Not yet fetched — optional per PRD; flow direction can be derived from the DEM directly for the SWE solver. HydroRIVERS (hydrosheds.org) is the candidate source if a vector network is needed later. | — |

## Important caveats

- **Breach location coordinates are approximate.** No surveyed breach-point
  coordinates for the 2008 Kusaha embankment failure were found in public
  sources; the JSON uses the nearest mapped settlement (Paschim Kasuha) as a
  stand-in. Verify against a topo sheet or the Sentinel-2 imagery before using
  for precision hydraulic siting.
- **Breach width is not documented publicly** for the 2008 event — the
  `simulation_defaults.breach_width_m` value is a plausible placeholder, not
  a historical fact. Treat it as a tunable scenario parameter.
- **Two discharge numbers exist and mean different things**: 27,000 cumecs is
  the *barrage's design peak discharge* (an engineering upper bound); 3,675
  cumecs is the *actual flow through the breach* on 18 Aug 2008 per Wikipedia.
  Use the latter to reproduce the historical event, the former for a
  worst-case scenario run.
- **Satellite image postdates the event** (Dec 2023, vs. the Aug 2008 flood) —
  it's a real, cloud-free current-conditions reference for Layer 5 (GEE
  toggle-able "current vs simulated" comparison), not imagery of the flood
  itself. No public archive was queried for Aug 2008 scenes; Sentinel-2 didn't
  launch until 2015 in any case, so no satellite imagery of the actual 2008
  event exists from this constellation.
- **Population raster is 1km resolution**, not the 100m WorldPop product —
  the 100m India country file is ~1.8GB and its host does not honor HTTP
  Range despite advertising `Accept-Ranges: bytes`, so a windowed fetch
  wasn't possible without downloading the whole file. Swap in the 100m
  constrained product later if finer-grained impact stats are needed (see
  `scripts/fetch_population.py` for the dataset alias to change).

## Re-fetching

```
.venv\Scripts\python.exe scripts\fetch_dem.py
.venv\Scripts\python.exe scripts\fetch_population.py
.venv\Scripts\python.exe scripts\fetch_satellite.py
.venv\Scripts\python.exe scripts\postprocess_satellite.py
```

All three are idempotent-ish (DEM/population skip re-downloading raw tiles
that already exist under `data/raw/` if present; that folder is deleted after
each run to keep `/data` lean, so a re-run re-downloads from scratch).
