"""Fictional orders; coordinates are illustrative, not verified truck entrances."""

def scenario():
    districts = [
        ('Kennedy / Rica vicinity', 18.4870, -69.9535),
        ('Piantini', 18.4718, -69.9376),
        ('Naco', 18.4808, -69.9244),
        ('Bella Vista', 18.4555, -69.9420),
        ('Gazcue', 18.4670, -69.9020),
        ('Los Prados', 18.4825, -69.9565),
        ('Julieta', 18.4695, -69.9485),
        ('Mirador Sur', 18.4458, -69.9505),
    ]
    deliveries = []
    for zone, (name, lat, lon) in enumerate(districts):
        for j in range(5):
            i = zone * 5 + j
            deliveries.append(dict(id=f'D{i+1:03}', name=f'{name} · delivery {j+1}',
                lat=round(lat + (j-2)*0.0011,6), lon=round(lon + (j%3-1)*0.0013,6),
                pallets=2, service_minutes=15, window_start=480, window_end=960))
    return dict(depot=dict(name='Demo depot · Lincoln / Malecón', lat=18.4485, lon=-69.9250),
        deliveries=deliveries,
        trucks=[dict(id=f'T{i+1:02}', name=f'Truck {i+1:02}', capacity=12, available=True,
            shift_start=480, shift_end=1020) for i in range(12)],
        assignments={f'T{i+1:02}':[deliveries[i+j*8]['id'] for j in range(5)] for i in range(8)},
        settings=dict(provider='offline', max_trucks=8, time_factor=1.0))
