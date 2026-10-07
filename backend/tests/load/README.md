# Load checks

Install k6 separately, start the backend, then run `k6 run backend/tests/load/smoke.js` from the repository root. Set `BASE_URL` to target another local environment. This is a lightweight endpoint smoke load, not a production capacity benchmark. Rate limits are in-memory and per process.
