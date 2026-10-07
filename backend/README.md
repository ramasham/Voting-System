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

The seed is idempotent and creates the example event, three categories, example exhibitors, and default event settings. Do not reset or drop a database to resolve migration issues. On an older integration database, `node-pg-migrate` may report that the location migration's filename timestamp precedes an already-applied migration. Inspect `pgmigrations` and pending files; if those are the only pending migrations and their dependencies exist, apply them without changing migration history:

```sh
./node_modules/.bin/node-pg-migrate up --migrations-dir db/migrations --envPath .env --no-check-order
```

## OTP and SMS

OTP codes contain six digits, expire after 60 seconds, and permit three incorrect verification attempts. A new request expires the visitor's previous active code. Requests are limited to three per phone number in 15 minutes. The backend does not impose a resend countdown.

For local development, use `SMS_PROVIDER=console`. The console provider prints the OTP with the phone number masked and is disabled in production. For Twilio, set `SMS_PROVIDER=twilio`, `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, and either `TWILIO_FROM_NUMBER` or `TWILIO_MESSAGING_SERVICE_SID`. Do not put credentials in source control or logs.

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

Configure trusted event IP ranges and enable location through the authenticated admin event-settings API. Record the organizer anchor through `POST /api/admin/events/:eventId/location/anchor`, then collect trusted samples through the visitor location-samples API. Samples require a verified visitor on a configured trusted network. The geofence becomes ready when the required cluster has at least three samples, including the organizer anchor. Use the real event coordinates and network ranges for the event; local test coordinates are not production configuration.

Voting must have a valid start/end window, three populated categories, and a usable venue policy before it can be opened through `POST /api/admin/events/:eventId/voting/open`. Vote acceptance checks the visitor token, verified phone, window, venue, category, assignment, and rate limit. PostgreSQL enforces one vote per visitor per category and event.

## WebSocket live results

Connect to `ws(s)://<host>/ws`. Send `AUTH` with a visitor token before `CAST_VOTE`. Admin tokens may use `SUBSCRIBE_RESULTS`; result subscriptions are admin-only and event-scoped. Important message types are `AUTH_SUCCESS`, `VOTE_ACCEPTED`, `VOTE_REJECTED`, `RESULTS_SUBSCRIBED`, and `RESULTS_UPDATED`. WebSocket messages notify clients that results changed; the authenticated REST results API supplies authoritative totals.

Each process keeps its WebSocket connections and subscription membership in memory. Every backend instance listens to PostgreSQL's `voting_results` notification channel, which fans committed vote notifications out to that instance's local sockets. If a deployment changes that per-instance listener arrangement, it will need a shared pub/sub mechanism for cross-instance notifications.

## Health and local load checks

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

Use HTTPS/WSS, `NODE_ENV=production`, strong independent secrets, Twilio credentials, production event coordinates and venue networks, and a database role with only required privileges. Set `TRUST_PROXY` only to match the actual trusted proxy topology; do not trust client-supplied forwarding headers. Provision backups and a retention policy for audit records. Keep `.env` private. No Docker, Redis, or production infrastructure is provisioned by this backend repository.
