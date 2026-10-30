# Verification record

Checked on October 30, 2026 using Python 3.12 and OR-Tools 9.15.6755 on Windows.

- Ten regression tests pass (`python -m unittest discover -s tests -v`).
- JavaScript syntax check passes (`node --check web/app.js`).
- Sample scenario evaluates all 40 deliveries across eight manual routes.
- OR-Tools produced a feasible plan with 40 unique deliveries, no warnings and seven active trucks under the eight-truck maximum. Search is time-limited; exact ordering and totals can vary by run/machine. Offline distances are simulated, not operational savings.
- Browser smoke check: manual plan loads, map tiles render, optimize updates assignments and totals, unassigning a delivery invalidates the schedule and disables approval.
- Live Valhalla adapter smoke test: two fictional coordinates `[18.4485,-69.9250]` and `[18.4870,-69.9535]` returned a directed matrix (5.851 km / 1,186 sec outbound; 6.386 km / 1,251 sec return) and a 135-point road polyline. This was a one-off test against the public demo endpoint, not a bundled or production dependency. Those values are not guaranteed to stay unchanged and do not verify the actual Rica entrance or legal truck access.

## Docker and complete road-network verification

After Docker Desktop installation on October 30, 2026:

- Docker Engine 29.9.2 / Compose 5.6.1 built and started both services successfully.
- Valhalla 3.9.1-f22153579 downloaded and built the Geofabrik Haiti and Dominican Republic extract in a persistent named volume.
- The application reached the local Valhalla `/status` endpoint successfully.
- The full 41-location matrix (depot plus 40 deliveries) succeeded using the truck profile.
- The unchanged fictional manual sample produced 248.94 km / 724 driving minutes across eight trucks.
- A three-second OR-Tools run produced 97.60 km / 291 driving minutes across seven trucks, with all 40 deliveries assigned, no constraint warnings and 2,390 road-geometry points. Results vary with solver runtime and future road-data updates; these sample results are not evidence of actual business savings.
- The browser successfully calculated the saved scenario in Valhalla road mode.
- Compose now pins the tested image digest `sha256:f0556eec9720432337024ef3f29a9cb1ccd752f47ac057c58d3122209989d8da`.

Not yet verified: historical traffic, actual customer entrances/legal truck access, ERP integration, production operation.


## Optimization mode comparison (October 30, 2026)

Added default geographic grouping and driving efficiency, both prioritizing deliveries served and fewer active trucks. All 12 unit tests pass, including a controlled proximity/travel tradeoff, shared-matrix comparison, legacy defaults, input preservation and capacity-limited fleet size. JavaScript syntax validation passes. Docker app rebuilt against the existing regional Valhalla service. Browser comparison and switching between plans verified.

One road-routing sample run served all 40 stops with seven trucks in both modes and no warnings. Geographic grouping: 107.8 km, 316 driving minutes, 26 of 101 nearby assigned pairs split. Efficiency: 97.8 km, 291 driving minutes, 33 of 101 pairs split. Search is time-limited, so results can vary between runs. Nearby is within 800 m straight-line distance. These are fictional sample results, not measured operational savings.


## Load summary and route duration (October 30, 2026)

- Nineteen unit tests pass. New cases verify mixed-capacity fleet bounds, unavailable trucks, fleet-cap shortfalls, unassigned load, overloads without netting against another truck's empty space, eight-hour migration/validation, full elapsed time and earlier shift deadlines.
- A controlled scenario carries only four pallets but needs two trucks under an eight-hour route cap: one truck would take 510 minutes; each of two takes 260 minutes. Both modes respect the limit. A one-truck cap leaves one delivery unassigned instead of allowing overtime.
- Waiting, service and the return leg are all included: a manual 485-minute route warns under the eight-hour cap, and optimization leaves its infeasible stop unassigned.
- JavaScript syntax and git whitespace checks pass. Docker app rebuilt against the existing local Valhalla service.
- Browser verification: migrated saved scenario shows 80 pallets, 144 available spaces, 96 spaces under the eight-truck cap, and 80/84 loaded across seven used trucks (four empty spaces). The capacity floor is seven. Both comparison plans serve 40 deliveries without warnings, with a longest full route displayed as 2h 26m.
- Editing the route cap to two hours flags six of seven manual routes and disables approval. Editing Truck 01's shift end to 09:00 applies the earlier one-hour deadline and warns. Setting the fleet cap to six shows an eight-pallet capacity shortfall without recalculating road routes. Restored the eight-hour limit, eight-truck cap and 17:00 shift end, then compared both modes.
- Pallets remain the capacity unit. Box conversions, depot loading, driver breaks and historical/live traffic are not included.
