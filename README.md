# Karaka Dispatch Studio

A runnable reference demo for adding road routing and fleet planning to an existing delivery application. It does not replace the ERP or driver navigation app.

## Run in five minutes

Requires Python 3.12. From the repository directory:

```sh
python -m venv .venv
# Windows PowerShell:
.venv/Scripts/python -m pip install -r requirements.txt
.venv/Scripts/python -m app.server
# macOS / Linux: use .venv/bin/python instead
```

Open **http://127.0.0.1:8080**. No paid API key is needed. An internet connection loads Leaflet, fonts, and OpenStreetMap basemap tiles; the offline planning engine itself requires no network. If the map library cannot load, the delivery board and optimization still work.

The sample contains 12 trucks, 40 fictional deliveries around Santo Domingo, and a deliberately inefficient manual assignment across eight trucks. Locations, including the Rica vicinity, are illustrative and **not verified truck entrances**. Distances saved by optimization on this fictional scenario are not evidence of real operational savings.

1. Inspect the manual assignments and select a truck to see its stops.
2. Change a delivery's truck on the board; move stops up/down in the route panel.
3. Calculate the manual plan to refresh distances and schedules.
4. Optimize the fleet and compare against that manual baseline.
5. Try making trucks unavailable, lowering capacity, or narrowing receiving windows.
6. Resolve warnings/unassigned deliveries, approve locally, and export JSON to share.

## Two explicit travel modes

**Offline simulation** is immediately runnable. It uses straight-line distances at an assumed 25 km/h and draws dashed connectors. It does not use streets, truck restrictions, historical traffic or live traffic. The optional travel-time multiplier is a uniform simulation, not historical traffic and not a time-of-day model.

**Valhalla road routing** uses a real routing server for a directed travel-time/distance matrix and road geometry. It fails visibly when the provider is unavailable; it never silently substitutes straight lines. The common truck profile is 3.8 m high, 2.5 m wide, 8 m long and 12 tonnes. Edit `app/routing.py:options` for your vehicles. Pallet capacity is separate from physical truck weight. This demo does not implement per-vehicle physical routing profiles.

### Run the road-routing server with Docker

Requires Docker with Linux containers and enough RAM/disk for importing the regional road extract. Docker is optional for the offline demo.

```sh
docker compose up --build
```

The Valhalla service downloads the **Haiti and Dominican Republic** OpenStreetMap extract from Geofabrik and builds routing tiles into a persistent volume. Initial preparation takes time; wait for its logs to report a running service. The web app can start before the routing service is ready. Open http://127.0.0.1:8080 and select **Valhalla road routing**, then calculate or optimize.

The Compose file follows the [official Valhalla scripted-container instructions](https://github.com/valhalla/valhalla/blob/master/docker/README.md). It pins the tested Valhalla 3.9.1 image digest. The complete Docker build, regional tile import, and 40-delivery road-routing/optimization workflow were verified on Windows with Docker Desktop on October 30, 2026. See [the verification record](docs/VERIFICATION.md).

After the first build, start the saved containers with `docker compose up -d`. Stop them with `docker compose stop`; the road-data volume remains available. Keep Docker Desktop running while using the demo. The localhost address works on your computer only; coworkers must run their own checkout or use a separately hosted deployment.

If your routing service has matrix limits below 41 locations / 1,681 pairs, raise its truck matrix limits in its generated configuration before running the full sample. This application limits imports to 100 deliveries and 20 trucks; that is not a guarantee that a routing server accepts the same limits.

To use an existing Valhalla server with the Python app:

```powershell
$env:VALHALLA_URL = 'http://localhost:8002'
.venv/Scripts/python -m app.server
```

```sh
# macOS / Linux
VALHALLA_URL=http://localhost:8002 .venv/bin/python -m app.server
```

Only configure an endpoint you are authorized to use. Public demo servers are not production infrastructure. No public routing server is called by default.

## Planning model

OR-Tools assigns deliveries and chooses their order using the selected provider's travel matrix. Constraints:

- Available trucks only; at most the configured number of active trucks.
- Integer pallet demand and vehicle capacity; deliveries cannot be split.
- Receiving windows constrain **service start**, not completion. Waiting is allowed.
- Service duration at every delivery, fixed shift departure, return before shift end.
- One depot; one route per truck; all routes return to the depot.

Both optimization modes prioritize serving the greatest number of deliveries, then using fewer trucks, then their secondary objective. Penalties are bounded from the input matrix to make an additional served stop outweigh all truck/travel/grouping costs, and one fewer truck outweigh all secondary costs.

- **Geographic grouping (default):** travel/service seconds plus a soft penalty for splitting nearby delivery pairs across trucks. Pairs within 800 m straight-line distance receive a penalty of up to 900 equivalent seconds, decreasing linearly with distance. This is a proximity preference, not fixed territories or a guarantee of non-overlapping routes. Roads still determine travel costs and schedules.
- **Driving efficiency:** travel/service seconds, with no geographic grouping penalty.

Use **Compare both modes** to solve both against the same matrix and constraints, then view either result on the map. Cards show trucks, distance, driving time, unassigned deliveries, warnings, and the number of nearby assigned pairs split across trucks. Fewer splits indicates better local cohesion but does not prove an operationally superior plan. Any scenario edit clears the comparison.

The default sample has 80 pallets and 12-pallet trucks, so at least seven trucks are needed. Grouping preferences do not override capacity, time windows, shifts or the preference for fewer trucks. Search is limited to three seconds, so a mathematically optimal solution is not guaranteed. Unassigned deliveries are shown explicitly. A generic reason lists possible constraints; the demo does not claim to prove an individual infeasibility cause.

The eight-truck setting is a **maximum**, not an exact route count. The solver may choose fewer. Supporting multiple depot reload trips per truck, breaks, different driver/vehicle identities, pickups, locked assignments, or mixed vehicle routing profiles requires additional modeling.

Manual plans are evaluated with the same matrix and schedule logic. Capacity, shift, availability and window violations are reported. Approval is disabled until every delivery is assigned and warnings are resolved. Any edit invalidates the previous calculation and approval.

## API boundary for the existing application

| Endpoint | Purpose |
|---|---|
| `GET /api/sample` | Fictional input scenario |
| `GET /api/health` | Service health and whether Valhalla is configured |
| `POST /api/validate` | Validate a scenario without routing |
| `POST /api/plan` | Evaluate manual assignments and return schedules/geometry |
| `POST /api/compare` | Return `geographic` and `efficiency` plans using the same travel matrix |
| `POST /api/optimize` | Propose assignments, then return the same plan response |

POST bodies use the structure returned by `/api/sample`. Coordinates are decimal WGS84 latitude/longitude. Times are local minutes after midnight in Santo Domingo, for a single planning day. The depot is shared; trucks contain `id`, `name`, `capacity`, `available`, `shift_start`, and `shift_end`. Deliveries contain `id`, `name`, `lat`, `lon`, `pallets`, `service_minutes`, `window_start`, and `window_end`. `assignments` maps truck IDs to ordered delivery-ID arrays. `settings` includes `mode` (`geographic`, the default for new and legacy scenarios, or `efficiency`), `provider` (`offline` or `valhalla`), `max_trucks`, and `time_factor` (1–3).

Responses contain assignments, per-truck stops and schedules, geometry in **[latitude, longitude]** order (not GeoJSON order), totals, warnings, unassigned IDs, and provider provenance. All routes include the depot return leg. Valhalla geometry and pairwise matrix estimates may differ slightly due to waypoint handling; this prototype schedules from the matrix.

Suggested ERP integration: translate existing orders into this input schema; have the dispatcher review the proposal; then persist approved assignments in the existing app using stable IDs and revision checks. Browser approval in this demo **does not send assignments to drivers or write to an ERP**.

Scenario changes persist in browser local storage. Import accepts raw scenarios or exported envelopes. Export includes the current scenario, calculated plan and local approval timestamp. Reload/import recalculates the plan and intentionally requires fresh approval.

## Historical traffic integration

No historical traffic dataset is included. A production extension should request departure-time-dependent travel estimates from a licensed source with verified Santo Domingo coverage. The current optimizer consumes a static matrix; replacing it with one time-of-day matrix does not model later legs accurately. Time-dependent planning needs time buckets/iterative scheduling or a solver/provider supporting departure-aware costs, followed by schedule validation. The simulated multiplier is only for demonstrating sensitivity.

## Tests

```sh
python -m unittest discover -s tests -v
node --check web/app.js
```

Tests exercise assignment uniqueness, capacity, unavailable trucks, time windows, waiting/service propagation, manual warnings, input validation, directed matrix parsing, polyline decoding and provider failures. GitHub Actions runs these checks. Live Valhalla integration requires a running server; mocked adapter tests do not establish local road-data accuracy.

## Code map

- `app/planner.py`: constraints, optimization and schedule evaluation.
- `app/routing.py`: road provider, matrix and geometry adapters; explicit offline simulation.
- `app/sample.py`: replaceable fictional ERP-like input.
- `app/server.py`: small Python HTTP boundary.
- `web/`: framework-free browser UI with Leaflet; no frontend build required.
- `tests/`: planning and routing adapter regression tests.

## Demo boundaries

Local development server only: no authentication, shared database, production concurrency controls or durable server-side approvals. Do not expose it directly to the internet. No GPS tracking, proof of delivery, notifications, live incidents, or navigation SDK. Your existing application's arrival/status workflow remains separate.

The basemap uses OpenStreetMap's public tiles for this low-volume interactive demo. Retain attribution and follow its [tile usage policy](https://operations.osmfoundation.org/policies/tiles/); use a suitable provider for production. OSM road data is subject to [ODbL attribution and licensing](https://www.openstreetmap.org/copyright). Leaflet, OR-Tools and Valhalla retain their respective licenses.
