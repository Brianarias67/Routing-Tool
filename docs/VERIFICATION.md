# Verification record

Checked on October 30, 2026 using Python 3.12 and OR-Tools 9.15.6755 on Windows.

- Ten regression tests pass (`python -m unittest discover -s tests -v`).
- JavaScript syntax check passes (`node --check web/app.js`).
- Sample scenario evaluates all 40 deliveries across eight manual routes.
- OR-Tools produced a feasible plan with 40 unique deliveries, no warnings and seven active trucks under the eight-truck maximum. Search is time-limited; exact ordering and totals can vary by run/machine. Offline distances are simulated, not operational savings.
- Browser smoke check: manual plan loads, map tiles render, optimize updates assignments and totals, unassigning a delivery invalidates the schedule and disables approval.
- Live Valhalla adapter smoke test: two fictional coordinates `[18.4485,-69.9250]` and `[18.4870,-69.9535]` returned a directed matrix (5.851 km / 1,186 sec outbound; 6.386 km / 1,251 sec return) and a 135-point road polyline. This was a one-off test against the public demo endpoint, not a bundled or production dependency. Those values are not guaranteed to stay unchanged and do not verify the actual Rica entrance or legal truck access.

Not yet verified: local Docker/Valhalla tile build (Docker is not installed on the development host), full 41-location Valhalla deployment, historical traffic, real delivery coordinates, ERP integration, production operation.
