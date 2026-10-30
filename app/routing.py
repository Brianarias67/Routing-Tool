"""Replaceable routing boundary. Never silently substitute straight lines for roads."""
import json
import math
import os
from functools import lru_cache
from urllib.request import Request, urlopen


def decode_polyline(encoded):
    points, index, lat, lon = [], 0, 0, 0
    while index < len(encoded):
        deltas = []
        for _ in range(2):
            result = shift = 0
            while True:
                value = ord(encoded[index]) - 63
                index += 1
                result |= (value & 31) << shift
                shift += 5
                if value < 32:
                    break
            deltas.append(~(result >> 1) if result & 1 else result >> 1)
        lat += deltas[0]
        lon += deltas[1]
        points.append([lat / 1e6, lon / 1e6])
    return points


@lru_cache(maxsize=128)
def call_valhalla(endpoint, payload):
    base = os.getenv('VALHALLA_URL', '').rstrip('/')
    if not base:
        raise ValueError('Road routing is not configured. Set VALHALLA_URL on the server or select Offline simulation.')
    request = Request(base + '/' + endpoint, data=payload.encode(),
        headers={'Content-Type':'application/json', 'User-Agent':'KarakaRoutingDemo/0.1'})
    try:
        with urlopen(request, timeout=60) as response:
            data = json.load(response)
    except Exception as error:
        raise ValueError(f'Valhalla could not complete {endpoint}. Check its URL, road coverage and service limits. No offline fallback was used.') from error
    if 'error' in data:
        raise ValueError(f"Valhalla: {data['error']}")
    return data


def options():
    # One common physical profile for this demo; capacity varies independently.
    return {'costing':'truck', 'costing_options':{'truck':{
        'height':3.8, 'width':2.5, 'length':8.0, 'weight':12.0}}, 'units':'kilometers'}


def matrix(points, provider, factor):
    if provider == 'valhalla':
        locs = [{'lat':p['lat'],'lon':p['lon']} for p in points]
        data = call_valhalla('sources_to_targets', json.dumps(dict(options(), sources=locs, targets=locs)))
        cells = data['sources_to_targets']
        if any(c.get('time') is None or c.get('distance') is None for row in cells for c in row):
            raise ValueError('Some locations cannot be connected by the truck profile. Correct their entrances before planning.')
        seconds = [[round(c['time']*factor) for c in row] for row in cells]
        km = [[c['distance'] for c in row] for row in cells]
        return seconds, km
    km = []
    for a in points:
        row = []
        for b in points:
            x,y = math.radians(a['lat']),math.radians(b['lat'])
            h = math.sin((y-x)/2)**2 + math.cos(x)*math.cos(y)*math.sin(math.radians(b['lon']-a['lon'])/2)**2
            row.append(6371*2*math.asin(min(1,math.sqrt(h))))
        km.append(row)
    return [[round(d/25*3600*factor) for d in row] for row in km], km


def geometry(points, provider):
    if provider == 'offline':
        return [[p['lat'],p['lon']] for p in points]
    data = call_valhalla('route', json.dumps(dict(options(), locations=[
        {'lat':p['lat'],'lon':p['lon'],'type':'break'} for p in points])))
    return [point for leg in data['trip']['legs'] for point in decode_polyline(leg['shape'])]
