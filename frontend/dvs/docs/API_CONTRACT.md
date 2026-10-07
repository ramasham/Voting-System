# Voting API and staff interface

This describes the implemented Express API and frontend adapters. `VITE_API_URL` includes `/api`, normally through a same-origin proxy. Without it, all interfaces share a browser demo store.

## Authentication and responses

Authenticated requests send `Authorization: Bearer <accessToken>`. Visitor tokens expire after 12 hours; staff tokens after 30 minutes. They use separate signing secrets and backend-enforced roles. The frontend uses session storage, not authentication cookies.

Most responses are `{ "success": true, "data": ... }`. Login and OTP verification return `accessToken`, `tokenType`, and `expiresInSeconds` at the top level. Errors are `{ "success": false, "code": "OPTIONAL_CODE", "message": "..." }` with an appropriate status. The adapters normalize native errors to translated messages and integer IDs to strings.

## Visitor endpoints

Paths below are relative to `/api`.

| Method and path | Request / result |
| --- | --- |
| `GET /events` | Event list |
| `GET /events/:eventId/config` | `{ status, requireNetworkCheck, requireLocation, resendAfterSeconds }`; status uses database time and voting settings |
| `GET /events/:eventId/categories` | Categories ordered by display order |
| `GET /events/:eventId/exhibitors` | Names, descriptions, image URLs, and category assignments |
| `GET /events/:eventId/venue-test` | Tests request IP against venue policy |
| `POST /events/:eventId/venue-test` | Tests policy with optional `{ location: { latitude, longitude, accuracy } }` |
| `POST /auth/register` | `{ name, phoneNumber }`; E.164 phone; stores/updates visitor and sends OTP |
| `POST /auth/verify-otp` | `{ phoneNumber, otp }`; returns visitor bearer token |
| `GET /auth/me` | Visitor token; returns that verified visitor's `{ id, name }` |
| `GET /events/:eventId/votes` | Visitor token; returns only that visitor's votes |
| `POST /events/:eventId/votes` | Visitor token; `{ categoryId, exhibitorId, location? }`; checks venue and voting window |
| `GET /events/:eventId/location` | Location policy/readiness; `minimum_samples: 1`, `radius_meters: 100` |
| `POST /events/:eventId/location/samples` | Optional legacy samples; verified visitor token and approved network; `{ latitude, longitude, accuracy }`; cannot change the admin zone |
| `GET /media/exhibitors/:exhibitorId/photo` | Stored photo bytes |

The catalog adapter combines categories and exhibitors. A multi-category exhibitor appears in each assigned category. There are three categories with no fixed exhibitor count. Real names/descriptions come from PostgreSQL; sample team member names belong only to the demo catalog.

Identical vote retries return the existing vote without increasing counts. Changing an already-cast category vote is rejected with `DUPLICATE_VOTE`; the adapter reloads the visitor's votes. Other errors include `INVALID_OR_EXPIRED_OTP`, `OTP_ATTEMPTS_EXCEEDED`, `INVALID_TOKEN`, `VOTING_CLOSED`, `OUTSIDE_VENUE`, `LOCATION_REQUIRED`, `LOCATION_INACCURATE`, `LOCATION_NOT_READY`, and `RATE_LIMITED`. `LOCATION_NOT_READY` means GPS-only access is blocked while the venue zone is being established; approved network access remains available.

When location verification is enabled, the frontend requests location after **Start voting**, including after a successful network check. Coordinates are cached for the selected event and sent for venue checks and votes. The frontend does not submit visitor samples. One authenticated admin capture with accuracy of 100 metres or better immediately creates the approved 100-metre venue zone. The legacy sample endpoint retains its verified-phone, approved-network, accuracy and one-sample-per-visitor checks, but visitor positions cannot change the zone.

## Staff endpoints

`POST /admin/login` accepts `{ username, password, mfaCode? }`. An enrolled account returns `401 MFA_REQUIRED` until a valid code is supplied; wrong/replayed codes return `INVALID_MFA_CODE`. Login has account and IP limits. Create accounts with `npm run admin:create` in `backend`.

Every endpoint below requires a staff token.

| Method and path | Request / result |
| --- | --- |
| `GET /admin/me` | `{ id, username, mfa_enabled, mfa_available }` |
| `POST /admin/mfa/setup` | `{ password }`; reauthenticates and returns `{ secret, otpauthUrl }` for ten-minute enrollment |
| `POST /admin/mfa/confirm` | `{ code }`; atomically enables the verified pending secret |
| `GET /admin/events/:eventId/settings` | Voting window, venue CIDRs, location readiness, enabled flags |
| `PATCH /admin/events/:eventId/settings` | `{ votingStartAt, votingEndAt, allowedIpRanges, locationEnabled }`; ISO dates and comma-separated CIDRs |
| `POST /admin/events/:eventId/location/anchor` | `{ latitude, longitude, accuracy }` |
| `GET/POST /admin/events/:eventId/categories` | Read/create categories, capped at three |
| `PATCH/DELETE /admin/events/:eventId/categories/:categoryId` | Update/remove a category; vote-protected removals |
| `GET/POST /admin/events/:eventId/exhibitors` | Read/create exhibitors |
| `PATCH/DELETE /admin/events/:eventId/exhibitors/:exhibitorId` | Update/remove exhibitors; vote-protected removals |
| `PUT /admin/events/:eventId/exhibitors/:exhibitorId/photo` | Raw PNG/JPEG/WebP, correct image content type, maximum 2 MiB; server validates file signatures |
| `POST /admin/events/:eventId/voting/open` | Validates schedule, three populated categories, and venue access |
| `POST /admin/events/:eventId/voting/close` | Disables new votes |
| `GET /admin/events/:eventId/results` | Per-category counts and exhibitors |
| `POST /admin/events/:eventId/results/reset` | Requires voting closed; deletes this event's votes transactionally, preserving visitors |
| `GET /admin/events/:eventId/export.csv` | Category/exhibitor IDs, names, and counts, with spreadsheet formula escaping |

Exhibitor create/update body:

```json
{
  "name": "Project name",
  "description": "Project description",
  "imageUrl": "https://example.com/project.jpg",
  "categoryIds": [1, 3]
}
```

The response includes `{ id, event_id, name, description, image_url, categories: [{ id, name }] }`. Uploaded images use `/api/media/exhibitors/:id/photo`. An assignment with recorded votes cannot be removed. The UI confirms delete/open/close/reset and requires typed `RESET` for resetting.

MFA needs its migration and server-only `MFA_ENCRYPTION_KEY` (32 random bytes as 64 hex characters). AES-256-GCM protects stored secrets. Codes follow [RFC 6238](https://www.rfc-editor.org/rfc/rfc6238), tolerate one clock step, and consume counters atomically to prevent replay. Enrollment requires password reauthentication and code confirmation. No public recovery/disable endpoint is provided.

## Live updates

Connect to `/ws` on the API host (`wss` over HTTPS). Send `{ "type": "AUTH", "token": "<staff token>" }`. After `AUTH_SUCCESS`, send `{ "type": "SUBSCRIBE_RESULTS", "eventId": 1 }`. The server acknowledges `RESULTS_SUBSCRIBED`.

PostgreSQL notifications publish `RESULTS_UPDATED` with an `eventId`; the client reloads the protected results endpoint. Visitor tokens cannot subscribe. Expired tokens close with WebSocket code `1008`. The client also refreshes every five seconds while visible, reconnects with backoff, and shows stale/offline status. Sample counts and browser storage events are demo-only.

## Database and venue enforcement

Unique verified phones identify visitors. Unique `(event_id, visitor_id, category_id)` votes prevent duplicates, including concurrency. Votes reference valid category assignments. Names/phones stay linked to votes in PostgreSQL and are excluded from standings and counts exports. OTPs use secret-backed hashes, passwords salted scrypt, and rate limits shared PostgreSQL storage.

Every vote checks schedule, enabled state, and venue access. Approved CIDRs or an enabled, ready PostGIS zone permit access; requests outside both are rejected. Explicitly trust only the reverse proxy's IP/CIDR for forwarded addresses. GPS readiness requires only the authenticated admin's recorded venue location, with a fixed 100-metre radius. Browser coordinates are not device-attested.

Apply all migrations before starting this API. PostGIS must be available even for IP-only access because geometry columns are part of the schema. See [setup instructions](../README.md) for environment, SMS, MFA, and deployment details.
