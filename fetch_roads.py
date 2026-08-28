import urllib.request, json
bbox = '25.9,86.6,26.7,87.3'
# Primary and secondary roads to keep it lightweight but useful
query = f'[out:json];(way["highway"~"primary|secondary|tertiary|trunk|motorway|bridge"]({bbox}););out geom;'

req = urllib.request.Request('https://overpass-api.de/api/interpreter', data=query.encode('utf-8'))
try:
    with urllib.request.urlopen(req) as response:
        data = json.loads(response.read().decode('utf-8'))
        
    features = []
    for element in data.get('elements', []):
        if element['type'] == 'way':
            coords = [[node['lon'], node['lat']] for node in element['geometry']]
            features.append({
                'type': 'Feature',
                'geometry': {'type': 'LineString', 'coordinates': coords},
                'properties': element.get('tags', {})
            })
            
    geojson = {'type': 'FeatureCollection', 'features': features}
    with open('frontend/public/roads_kosi.geojson', 'w') as f:
        json.dump(geojson, f)
    print(f'Saved {len(features)} roads!')
except Exception as e:
    print('Error:', e)
