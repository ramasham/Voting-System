# Load validation

Install k6 separately and run against a disposable, migrated deployment. These scripts do not constitute a measured capacity claim until executed on the target infrastructure.

Read traffic: `EVENT_ID=1 VUS=1000 DURATION=60s k6 run backend/tests/load/smoke.js`. Set `BASE_URL` for a remote deployment. This checks database readiness and public listings; private results require admin authentication.

Voting traffic: `VOTERS_FILE=/absolute/path/voters.json VUS=1000 k6 run backend/tests/load/voting.js`. Prepare 1,000 distinct visitors using registration and OTP verification, an open test event with three populated categories, and an allowed source IP. The JSON fixture is an array of `{ "token": "...", "eventId": 1, "selections": [{ "categoryId": 1, "exhibitorId": 1 }, { "categoryId": 2, "exhibitorId": 2 }, { "categoryId": 3, "exhibitorId": 3 }] }`. Keep this file outside version control. Use a test SMS provider account/console in an isolated development environment. No authentication bypass is provided.

Check exactly 3,000 stored votes with protected results/export, then repeat to confirm replay does not increase totals. Use distinct tokens for each VU so the per-visitor limiter reflects realistic use. Record hardware, pool/replica counts, latency and errors. Separately disconnect and reconnect a results dashboard, stop one API replica mid-vote, retry lost responses, and verify committed votes and refreshed standings. Test database failover on the deployment's HA database separately; this repository cannot provision that guarantee by itself.
