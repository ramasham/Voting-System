# Maker Collective Voting Backend

## Requirements

- Node.js 22 or later
- PostgreSQL 16 with PostGIS 3.4 available to the database
- A database role that can run the application migrations

Install dependencies and prepare a local environment:

```sh
cd backend
npm ci
cp .env.example .env
```

Edit `.env` with the local PostgreSQL connection string and independent random values for `OTP_HMAC_SECRET`, `VISITOR_TOKEN_SECRET`, `ADMIN_TOKEN_SECRET`, and `RATE_LIMIT_HMAC_SECRET`. Keep `.env` out of version control. `DB_POOL_MAX` and `DB_CONNECTION_TIMEOUT_MS` tune each process; size the combined pool across all instances below the PostgreSQL connection budget.

Run the schema migrations and starter data, then create an administrator:

```sh
npm run db:migrate
npm run db:seed
npm run admin:create
npm start
```

Keep one backend running at a time. Stop it with **Ctrl+C** and wait for the shell prompt before running `npm start` again. **Ctrl+Z** pauses the process and keeps port 3000 occupied; resume a paused job with `fg` in its original terminal, then press Ctrl+C to stop it. `jobs -l` shows that terminal's paused/background jobs.

For code changes during development, `npm run dev` uses nodemon to restart the backend automatically. After changing `.env`, type `rs` and press Enter in the nodemon terminal to reload it. Run either `npm start` or `npm run dev` in one terminal. If the port is occupied, the new instance prints a recovery hint and exits without stopping the existing process.

The seed is idempotent and creates the example event, three categories, example exhibitors, and default event settings. Do not reset or drop a database to resolve migration issues. On an older integration database, `node-pg-migrate` may report that the location migration's filename timestamp precedes an already-applied migration. Inspect `pgmigrations` and pending files; if those are the only pending migrations and their dependencies exist, apply them without changing migration history:

```sh
./node_modules/.bin/node-pg-migrate up --migrations-dir db/migrations --envPath .env --no-check-order
```

## OTP and SMS

OTP codes contain six digits, expire after 60 seconds, and permit three incorrect verification attempts. A new request expires the visitor's previous active code. Requests are limited to three per phone number in 15 minutes. The backend does not impose a resend countdown.

For local development, use `SMS_PROVIDER=console`. The console provider prints the OTP with the phone number masked and is disabled in production. For Twilio, set `SMS_PROVIDER=twilio`, `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, and either `TWILIO_FROM_NUMBER` or `TWILIO_MESSAGING_SERVICE_SID`. Do not put credentials in source control or logs.

### Free Android SMS gateway

The backend also supports [SMSGate](https://docs.sms-gate.app/pricing/), a free Android gateway. Texts are sent from your SIM number and use your mobile plan's SMS allowance; your carrier may charge for messages outside that allowance.

1. Install the APK linked from the [official installation guide](https://docs.sms-gate.app/installation/) on an Android phone with a working SIM, and grant permission to send SMS.
2. Put the phone and the computer running the backend on the same Wi-Fi. Enable **Local Server** in SMSGate and tap **Offline** so it becomes **Online**. The app displays its local address, username, and password. Use credentials from the Local Server section.
3. Edit the existing `backend/.env`, replacing `SMS_PROVIDER=console` with `SMS_PROVIDER=smsgate`, and add the actual phone values:

   ```dotenv
   SMS_PROVIDER=smsgate
   SMSGATE_BASE_URL=http://192.168.1.50:8080
   SMSGATE_USERNAME=copy-from-the-app
   SMSGATE_PASSWORD=copy-from-the-app
   # Optional on dual-SIM phones:
   # SMSGATE_SIM_NUMBER=1
   ```

   The address above is an example. Use the phone's Local Server address without `/message` or `/docs`. The adapter uses the local `/message` and `/health` endpoints. HTTP is supported for local development; production requires HTTPS. This configuration uses the phone's Local Server API and does not configure the public cloud service.
4. From `backend`, run `npm run sms:check`. This checks the phone connection without sending a message. If it fails, check the address, credentials, Online status, and Wi-Fi connectivity. Disable Wi-Fi client isolation or use a network that allows the computer to reach the phone.
5. Set `VITE_API_URL=/api` in `frontend/dvs/.env` to use the real backend. Restart the backend and Vite after changing their environment files. Keep the gateway phone awake/charging and permit SMSGate to run in the background.
6. Register in the browser with a recipient phone you control. A Jordanian local number such as `079...` is normalized to `+96279...`. Confirm the SMS arrives and enter its six-digit code within 60 seconds. Check the SMSGate app's message status if it does not arrive. `Pending` means queued and `Sent` means accepted by the SMS network; receipt on the recipient phone confirms delivery. The browser demo does not send messages.

The adapter requests delivery reports and sets a 60-second gateway message lifetime. Successful registration means the gateway accepted the request; it does not prove handset delivery. Phone connectivity, battery restrictions, mobile reception, carrier limits, and sending throughput still affect delivery. Test a few recipients before relying on one phone for an event.

Visitor flow:

```text
POST /api/auth/register
POST /api/auth/verify-otp
```

The verification response contains a visitor bearer token. Use it for visitor vote and location-sample APIs.

## REST API overview

Public event content:

- `GET /api/events`
- `GET /api/events/:eventId/categories`
- `GET /api/events/:eventId/exhibitors`
- `GET /api/events/:eventId/location`

Visitor APIs require `Authorization: Bearer <visitor-token>` where indicated by the route:

- `POST /api/events/:eventId/location/samples`
- `POST /api/events/:eventId/votes`
- `GET /api/events/:eventId/votes`

Admin APIs require an admin bearer token. Login is `POST /api/admin/login`. Admin routes manage event settings, location anchors, voting open/close, categories, exhibitors and photos; they also provide results, reset, and CSV export:

- `GET /api/admin/events/:eventId/results`
- `GET /api/admin/events/:eventId/export.csv`
- `POST /api/admin/events/:eventId/results/reset` (voting must be closed)

`GET /api/results/:eventId` is also admin-authenticated. It returns total votes, distinct participating visitors, category totals, and ranked exhibitor counts. It contains no visitor identities.

## Location and voting setup

Configure venue access through the authenticated admin event-settings API. Record the venue location through `POST /api/admin/events/:eventId/location/anchor` with accuracy of 100 metres or better. That single admin capture immediately enables location verification and creates a ready PostGIS zone within 100 metres of the recorded position; visitor samples are not required and cannot move or expand this zone. Approved network ranges remain an optional alternative to GPS. The location status reports `minimum_samples: 1` and `radius_meters: 100`. Existing admin anchors are upgraded by the admin-location-ready migration without another capture. Use the real event coordinates and network ranges for the event; local test coordinates are not production configuration.

Repeating the anchor request replaces the previous organizer location and rebuilds the approved zone in the same transaction. Each event keeps one organizer anchor; failed requests preserve the previous location and zone.

Voting must have a valid start/end window, three populated categories, and a usable venue policy before it can be opened through `POST /api/admin/events/:eventId/voting/open`. Vote acceptance checks the visitor token, verified phone, window, venue, category, assignment, and rate limit. PostgreSQL enforces one vote per visitor per category and event.

## WebSocket live results

Connect to `ws(s)://<host>/ws`. Send `AUTH` with a visitor token before `CAST_VOTE`. Admin tokens may use `SUBSCRIBE_RESULTS`; result subscriptions are admin-only and event-scoped. Important message types are `AUTH_SUCCESS`, `VOTE_ACCEPTED`, `VOTE_REJECTED`, `RESULTS_SUBSCRIBED`, and `RESULTS_UPDATED`. WebSocket messages notify clients that results changed; the authenticated REST results API supplies authoritative totals.

Each process keeps its WebSocket connections and subscription membership in memory. Every backend instance listens to PostgreSQL's `voting_results` notification channel, which fans committed vote notifications out to that instance's local sockets. If a deployment changes that per-instance listener arrangement, it will need a shared pub/sub mechanism for cross-instance notifications.

## Health and local load checks

Run `npm test` for the backend checks. With a PostGIS database configured in `.env`, run `RUN_POSTGIS_TESTS=1 npm run test:integration` to verify immediate admin location readiness, the fixed venue boundary, and migration upgrades/rollbacks. The integration test writes only to temporary tables and removes them when finished.

- `GET /health` checks that the HTTP process responds.
- `GET /ready` also checks PostgreSQL connectivity.

Install k6 separately to run the read smoke test against localhost:

```sh
EVENT_ID=1 VUS=10 DURATION=10s k6 run tests/load/smoke.js
```

The voting load test needs one real OTP-verified visitor token and three valid selections per virtual user. Prepare the JSON fixture outside version control, use a disposable local event, and run:

```sh
BASE_URL=http://127.0.0.1:3000 VOTERS_FILE=/absolute/path/voters.json VUS=1000 k6 run tests/load/voting.js
```

Passing a local load test does not establish production capacity. Record the machine, database, latency, errors, and resource use. Do not point these commands at a production or external service.

## Production configuration

The repository includes a free Render + Neon deployment Blueprint. Follow [the phone and QR deployment guide](../DEPLOYMENT.md). Hosted mode serves `frontend/dvs/dist` from the backend and SMSGate cloud mode reaches the Android phone over HTTPS. Local SMSGate mode remains available for a backend on the phone's Wi-Fi.

Use HTTPS/WSS, `NODE_ENV=production`, strong independent secrets, a configured SMS provider, production event coordinates and venue networks, and a database role with only required privileges. Set `TRUST_PROXY` only to match the actual trusted proxy topology; do not trust client-supplied forwarding headers. Provision backups and a retention policy for audit records. Keep `.env` private.
