# Maker Collective 2026 voting system

Arabic/English visitor voting, a Makerspace admin panel, and a live results screen, using the burgundy palette and both organizer logos.

| Route | Purpose |
| --- | --- |
| `/` | On-site check, registration, OTP, project details, and voting |
| `/admin` | Staff login, overview, exhibitors, voting controls, exports, and account security |
| `/results` | Staff-protected live standings and fullscreen TV/projector presentation |

## Browser demo

Install dependencies with `pnpm install`. Use the existing development server at `http://localhost:8443`; if none is running, start it with `pnpm dev`.

Leave `VITE_API_URL` unset. Sign in at `/admin` or `/results` with **makerspace / Maker2026!**. These credentials are for the browser demo only. The interface labels demo mode explicitly. Exhibitors, photos, settings, and sample counts are shared through local storage across tabs on the same origin. New visitor votes update the results screen. The demo starts with sample counts and does not provide real authentication, OTP delivery, or fraud prevention. MFA requires the real backend.

Preview visitor states with `?demo=closed`, `not_started`, `server_error`, `rate_limited`, `offsite_network`, `offsite_location`, `location_denied`, `location_unavailable`, `location_timeout`, `vote_fail`, or `expired_session`. Demo OTP `000000` is invalid, `999999` is expired, and other six-digit codes succeed. `?strict=1` enables the demo location step. Demo project details include sample team member names.

## Connect the real backend

Run the two servers from their own directories in separate terminals:

```sh
# Frontend (from the repository root)
cd frontend/dvs
pnpm dev
```

```sh
# Backend (from the repository root)
cd backend
npm run dev
```

If they are already running, open the frontend at `http://localhost:8443` rather than starting a second copy. Use **Ctrl+C** to stop a server before restarting it. **Ctrl+Z** suspends it and leaves its port occupied; run `fg` in the original terminal to resume a suspended job, then Ctrl+C if you want to stop it. A suspended process can make the page hang even though its port is listening.

The API in `../../backend` requires PostgreSQL with **PostGIS available**, even for IP-only venue access: the location migration creates geometry columns. A database operator must make the extension available and permit its creation before applying migrations.

1. In `../../backend`, run `npm install`. Create `.env` from `.env.example` if missing, preserving existing configuration. Set `DATABASE_URL` and independent random secrets for OTP, visitor tokens, staff tokens, and rate limits.
2. Run `npm run db:migrate` to apply all pending migrations, including multi-category assignments, venue locations, stored photos, results notifications, and encrypted MFA storage. For a new development database without an event, `npm run db:seed` creates samples. The seed also updates sample categories/exhibitors; do not run it over real event content.
3. Run `npm run admin:create`. It prompts for a username and a password of at least 12 characters. There is no default real admin password.
4. Start the API with `npm start`, or restart the existing process after applying migrations and code changes. Its default port is 3000.
5. Create a frontend `.env` with the values below, then restart the existing Vite process to read the environment:

   ```dotenv
   VITE_API_URL=/api
   # Optional; otherwise visitors use the first event returned by the API.
   VITE_EVENT_ID=1
   ```

The Vite development server proxies `/api` and `/ws` to port 3000. The backend sees a loopback address through this development proxy; use `127.0.0.1/32` for local testing only. For the event, configure a reverse proxy that forwards client addresses, set `TRUST_PROXY` to that proxy's explicit IP/CIDR, and enter the venue's actual public network CIDRs. Never treat a shared proxy address as the venue network.

In production, serve the built frontend over HTTPS, proxy `/api` and WebSocket `/ws` to the backend, and serve `index.html` for `/admin` and `/results`. An absolute API URL instead requires the backend's exact `CORS_ORIGINS`. Configure the production SMS provider; console OTP delivery is development-only.

## Staff workflow

Add/edit/remove exhibitors under Projects, assign one or more of the three categories, and upload PNG/JPEG/WebP visuals up to 2 MiB. Configure voting start/end times (displayed in Asia/Amman), venue CIDRs, and optional location verification. Opening voting requires a valid schedule, three populated categories, and venue access. The server checks the window and venue on every vote.

Export downloads UTF-8 CSV counts per category. Reset requires voting closed and typed `RESET` confirmation. It deletes the selected event's votes and preserves visitors, who can vote again afterward. Exhibitors and assignments with recorded votes cannot be removed before a reset.

Results use PostgreSQL-backed WebSocket notifications and a five-second refresh fallback. Equal counts have equal ranks. Connection status and the last standings remain visible during failures. Presentation mode hides staff controls for TV/projector display. Standings and exports exclude visitor names and phone numbers.

## Optional authenticator MFA

Set a separate `MFA_ENCRYPTION_KEY` in the backend environment to 64 random hexadecimal characters (generate with `openssl rand -hex 32`) and restart the API. Under Account security, re-enter your password, add the setup key to your authenticator, and confirm its six-digit code. Pending enrollment expires after ten minutes. Subsequent logins require a fresh code; consumed codes cannot be replayed.

Secrets are encrypted with AES-256-GCM before database storage. Keep the key in the backend secret store and back it up separately. No self-service recovery/disable action is provided; a lost device or key requires verified operator recovery. The implementation follows [RFC 6238](https://www.rfc-editor.org/rfc/rfc6238).

## Visitor data and venue access

Real visitor names and verified phones remain in PostgreSQL, linked to votes. The browser stores its short-lived bearer token in session storage. OTP/password hashes, shared rate limits, unique phone numbers, and one-vote-per-category constraints are enforced by the backend. Configure restricted database access, transport encryption, backups, and the event's outreach consent/retention policy for deployment.

The existing PostGIS flow requires an organizer anchor and at least three trusted samples before GPS-only access is ready. Verified visitors on the approved network submit samples through the location API. Approved network access or an enabled, ready location zone authorizes voting. Browser coordinates are not device-attested.

## Validation and code

Run `pnpm exec tsc --noEmit` and `pnpm build` here, and `npm test` in `../../backend`. See [the API contract](docs/API_CONTRACT.md) for requests and security behavior.

`src/Router.tsx` selects the visitor/staff application. Visitor pages are in `src/pages`, staff pages in `src/staff`, adapters in `src/services`, and staff translations in `src/i18n/staff.ts`. Shared visual tokens are in `src/index.css`; staff styling is scoped in `src/staff/staff.css`.
