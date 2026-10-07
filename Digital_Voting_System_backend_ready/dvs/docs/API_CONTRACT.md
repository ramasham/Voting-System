# MC2026 Voting - API contract (front end <-> back end)

The front end already calls every endpoint below through `src/services/http.ts`.
Set `VITE_API_URL` (see `.env.example`) and it talks to your server. Without it, a demo back end runs in the browser (`src/services/mock.ts`).

## General rules
- JSON over HTTPS. Base URL = `VITE_API_URL` (example `https://api.example.com/api`).
- **Session = httpOnly cookie** (`Secure`, `SameSite=None` or `Lax` depending on hosting). The front end sends `credentials: "include"`, so the server needs CORS with `Access-Control-Allow-Credentials: true` and an explicit allowed origin (not `*`).
- Phone numbers are always **E.164** (`+962791234567`). Digits are Latin 0-9 only.
- Errors always use this shape (HTTP 4xx/5xx):
  ```json
  { "error": { "code": "OTP_INVALID", "message": "free text, not shown to users", "retryAfterSeconds": 60, "votes": { "categoryId": "makerId" } } }
  ```
  `retryAfterSeconds` only for `RATE_LIMITED`. `votes` only for `ALREADY_VOTED`.

## Error codes
| code | HTTP | meaning / what the user sees |
|---|---|---|
| `VALIDATION` | 400 | bad input |
| `OTP_INVALID` | 400 | wrong code |
| `OTP_EXPIRED` | 400 | code expired, ask for a new one |
| `RATE_LIMITED` | 429 | too many attempts, show countdown (`retryAfterSeconds`) |
| `OFF_SITE_NETWORK` | 403 | request is not from the exhibition network ("connect to the exhibition Wi-Fi") |
| `OFF_SITE_LOCATION` | 403 | coordinates outside the venue ("voting is inside the exhibition only") |
| `LOCATION_INACCURATE` | 403 | GPS accuracy too weak to decide ("couldn't find your location") |
| `VOTING_NOT_STARTED` / `VOTING_CLOSED` | 403 | voting window |
| `ALREADY_VOTED` | 409 | already voted in this category (send current `votes`) |
| `UNAUTHORIZED` | 401 | no verified visitor session |
| `SESSION_EXPIRED` | 401 | session existed but expired ("verify again") |
| `SERVER` | 5xx | anything else |

## Endpoints
### `GET /config`
```json
{ "status": "open", "requireNetworkCheck": true, "requireLocation": true, "resendAfterSeconds": 30 }
```
`status`: `open` | `closed` | `not_started`. The two flags let you choose the on-site policy without changing the app.

### `POST /access/network-check`  (no body)
Server compares the request IP with the venue network (IP / CIDR allow-list). Behind a proxy read `X-Forwarded-For` only from a trusted proxy.
`200 {}` or `403 OFF_SITE_NETWORK`. On success, mark the (anonymous) session as network-verified for ~15 minutes.

### `POST /access/location-check`
```json
{ "latitude": 31.9539, "longitude": 35.9106, "accuracy": 25 }
```
Server computes the distance to the venue centre and compares it with the allowed radius (suggested: reject `accuracy` > 100 m with `LOCATION_INACCURATE`).
`200 {}` or `403 OFF_SITE_LOCATION | LOCATION_INACCURATE`. On success, mark the session as location-verified for ~15 minutes.

### `POST /auth/otp/send`
```json
{ "name": "Razan Ahmad", "phone": "+962791234567" }
```
`name`: 2-60 characters, any language, one, two or three names (the front end does not require a full name).
Response `200 { "resendAfterSeconds": 30 }`. Errors: `VALIDATION`, `RATE_LIMITED`, `OFF_SITE_*` (if the on-site flags are on and the session is not verified), `VOTING_CLOSED`.

### `POST /auth/otp/verify`
```json
{ "phone": "+962791234567", "code": "123456" }
```
Response `200` and sets the session cookie:
```json
{ "visitor": { "id": "v_123", "name": "Razan Ahmad" }, "votes": { "categoryId": "makerId" } }
```
`votes` is empty for a new visitor, or filled if the same phone already voted (so they can continue where they stopped).
Errors: `OTP_INVALID`, `OTP_EXPIRED`, `RATE_LIMITED`.

### `GET /me`
`200` same body as verify, or `401 UNAUTHORIZED` / `SESSION_EXPIRED`. Called on every app start to restore the session.

### `GET /catalog`
```json
{
  "categories": [ { "id": "c1", "number": "01", "color": "purple", "name": { "ar": "الفئة الأولى", "en": "Category One" } } ],
  "makers": [ {
    "id": "m1", "categoryId": "c1",
    "team": { "ar": "", "en": "" }, "title": { "ar": "", "en": "" },
    "short": { "ar": "", "en": "" }, "long": { "ar": "", "en": "" },
    "image": "https://.../photo.jpg", "imageAlt": { "ar": "", "en": "" }
  } ]
}
```
Exactly 3 categories, 3 makers each. `color`: `purple` | `blue` | `yellow`. Category names are editable from the admin panel, so do not hard-code them.

### `POST /votes`
```json
{ "categoryId": "c1", "makerId": "m1" }
```
Response `200 { "votes": { "c1": "m1", "c2": "m4" } }` (all votes of this visitor, the source of truth).
Errors: `ALREADY_VOTED` (+ current `votes`), `VOTING_CLOSED`, `VOTING_NOT_STARTED`, `UNAUTHORIZED`/`SESSION_EXPIRED`, `OFF_SITE_*`, `VALIDATION` (maker not in that category).

## Rules the SERVER must enforce (never trust the browser)
1. **One vote per category per visitor**: database unique constraint on `(visitor_id, category_id)`. Return `ALREADY_VOTED`, never overwrite.
2. **One visitor per phone**: unique `phone_e164`. Same phone verifying again resumes the same visitor.
3. **OTP**: store only a hash, expire after ~5 minutes, max 5 wrong attempts per code, resend cooldown = `resendAfterSeconds`, rate limit per phone and per IP. Never log codes.
4. **On-site checks happen on the server.** Re-check the network (and that the location verification has not expired) when casting a vote, not only at the start.
5. Voting window (`status`, start/end time) is checked on every `/votes` call.
6. Secrets stay on the server. The front end never receives OTP codes, phone lists, or other visitors' data.

## Suggested tables
`visitors(id, name, phone_e164 unique, created_at)` ·
`otp_codes(id, phone_e164, code_hash, expires_at, attempts, consumed_at)` ·
`categories(id, number, color, name_ar, name_en)` ·
`makers(id, category_id, team_ar/en, title_ar/en, short_ar/en, long_ar/en, image_url, image_alt_ar/en)` ·
`votes(id, visitor_id, category_id, maker_id, created_at, unique(visitor_id, category_id))`

## Not in this contract yet
Live results (big screen) and the admin panel (Part B of the brief), and the full list of error screens (Part C). The front end here covers the visitor flow and these states: closed, not started, offline, server error, session expired, wrong network, location denied / unavailable / timeout / outside venue, wrong or expired OTP, rate limited, vote failed.

## Questions to settle with the organizers
Venue public IP or CIDR · venue coordinates and allowed radius · is there free visitor Wi-Fi (and its name) · SMS provider for Jordan and international numbers · session length · voting start/end time.

## Previewing every state without a back end
Add `?demo=` to the URL: `closed`, `not_started`, `server_error`, `rate_limited`, `offsite_network`, `offsite_location`, `location_denied`, `location_unavailable`, `location_timeout`, `vote_fail`, `expired_session`. OTP codes in demo mode: `000000` = wrong, `999999` = expired, anything else = success. `?strict=1` turns on the location check.
