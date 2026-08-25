"""
Fetch named settlement points (villages/towns/hamlets/cities) within the
Kosi AOI from OpenStreetMap via the public Overpass API -- free, no auth,
same AOI bbox as the rest of the project.
"""
import json
from pathlib import Path

import requests

AOI_BOUNDS = dict(west=86.6, south=25.9, east=87.3, north=26.7)
OVERPASS_URL = "https://overpass-api.de/api/interpreter"
OUT_PATH = Path(__file__).resolve().parent.parent / "data" / "settlements" / "kosi_aoi_settlements.geojson"


def main():
    query = f"""
    [out:json][timeout:60];
    node["place"~"village|town|hamlet|city"]
      ({AOI_BOUNDS['south']},{AOI_BOUNDS['west']},{AOI_BOUNDS['north']},{AOI_BOUNDS['east']});
    out body;
    """
    print("Querying Overpass API for settlement points...")
    headers = {"User-Agent": "FloodSim-HADR/1.0 (SIH26161 case study; settlement lookup)"}
    resp = requests.post(OVERPASS_URL, data={"data": query}, headers=headers, timeout=90)
    resp.raise_for_status()
    data = resp.json()

    features = []
    for el in data["elements"]:
        tags = el.get("tags", {})
        name = tags.get("name")
        if not name:
            continue
        features.append({
            "type": "Feature",
            "geometry": {"type": "Point", "coordinates": [el["lon"], el["lat"]]},
            "properties": {
                "name": name,
                "place_type": tags.get("place"),
                "osm_id": el["id"],
                "osm_population_tag": tags.get("population"),  # community-entered, unverified -- not used for stats
            },
        })

    fc = {
        "type": "FeatureCollection",
        "properties": {
            "source": "OpenStreetMap via Overpass API",
            "license": "ODbL (openstreetmap.org/copyright)",
            "query_bounds": AOI_BOUNDS,
            "note": (
                "osm_population_tag is a crowd-sourced, unverified OSM attribute where present -- "
                "not used for any population statistic in this project. Population magnitude "
                "comes only from the WorldPop raster (data/population/); OSM is used here only "
                "for settlement names/locations."
            ),
        },
        "features": features,
    }
    OUT_PATH.write_text(json.dumps(fc, indent=2))
    place_counts = {}
    for f in features:
        pt = f["properties"]["place_type"]
        place_counts[pt] = place_counts.get(pt, 0) + 1
    print(f"Done: {len(features)} named settlements -> {OUT_PATH}")
    print(f"  by type: {place_counts}")


if __name__ == "__main__":
    main()
