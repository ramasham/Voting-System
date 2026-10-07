# Open voting on phones with Render Free and Neon Free

This deployment serves the React frontend, Express API, and WebSockets from one HTTPS address. Visitors scan its event QR code to open voting. PostgreSQL stores projects, photos, admin accounts, and votes.

## 1. Create the free accounts and database

Sign up at [Render](https://dashboard.render.com/register) and [Neon](https://console.neon.tech/signup), using the GitHub account that has access to this repository. This dashboard workflow works from the Codex IDE extension and does not require a chat plugin connection. Render connects to GitHub to read the deployment branch; the app connects to Neon using its private database connection string.

In Neon, create a **Free** project with PostgreSQL 16, preferably in Frankfurt to match the app region. Open **Connect**, turn off **Connection pooling**, and copy the direct PostgreSQL connection string. It must include `sslmode=require`. Do not share the password in chat or commit the connection string.

The backend uses PostgreSQL `LISTEN` for live results and session locks for migrations, so its connection string must use the direct endpoint. A hostname containing `-pooler` is unsuitable. The deployment setup creates the required [PostGIS extension](https://neon.com/docs/extensions/postgis).

## 2. Make the Android SMS phone reachable from hosting

A hosted server cannot reach an address such as `192.168.1.140:8080` on your home Wi-Fi. In the installed SMSGate app:

1. Enable **Cloud Server**.
2. Tap **Offline** to go **Online**.
3. Copy the username and password from the **Cloud Server** section. These can differ from the Local Server credentials.
4. Keep the phone connected to the internet, permit background operation, and keep its SIM active.

SMS messages still use your phone's SIM allowance. SMSGate's [public cloud guide](https://docs.sms-gate.app/getting-started/public-cloud-server/) describes the connection and [pricing](https://docs.sms-gate.app/pricing/) describes its free service. This adapter sends messages over HTTPS using the standard, unencrypted message API; it does not implement SMSGate's optional end-to-end message encryption.

The hosted backend's settings are:

```dotenv
SMS_PROVIDER=smsgate
SMSGATE_MODE=cloud
SMSGATE_BASE_URL=https://api.sms-gate.app/3rdparty/v1
SMSGATE_USERNAME=cloud-username-from-the-phone
SMSGATE_PASSWORD=cloud-password-from-the-phone
```

You can keep these settings and the Neon connection string in ignored `backend/.env.deploy`. To check cloud credentials locally without sending an SMS:

```sh
cd backend
node --env-file=.env.deploy scripts/check-sms.js
```

This verifies authenticated device registration. It does not prove that the phone is currently online or that a recipient received an SMS. Test one registration with a phone you control after deployment. For multiple SMS phones, optionally set `SMSGATE_DEVICE_ID` to select one; otherwise SMSGate chooses a device. Optional `SMSGATE_SIM_NUMBER` selects the SIM slot.

The deployed server also runs this read-only SMSGate check after startup. In Render's **Logs**, look for `SMS startup check` or `SMS delivery failed`. An HTTP 401 means the gateway rejected authentication; check the Cloud Server credentials saved in Render and deploy the environment changes. Missing devices and connection failures have separate messages. These logs omit phone numbers, OTPs, credentials, and raw provider responses. A successful startup check confirms authenticated registration only; check the SMSGate app's message status when delivery still fails.

For each accepted cloud OTP request, the backend logs `SMS submission accepted`, then checks the existing message's delivery status after approximately 15 and 45 seconds. Look for `SMS delivery status` in Render's logs. `Pending` means the device has not processed it, `Sent` means the mobile network accepted it, and `Delivered` confirms recipient receipt. A `Failed` message includes a fixed diagnostic category such as `SMS_PERMISSION_DENIED` or `NO_DEFAULT_SMS_APP_OR_SIM`; unrecognized errors require checking the SMSGate dashboard. These checks never send another SMS or extend the 60-second OTP lifetime, and stop early on a terminal result. `/ready` also returns an `X-App-Revision` header with Render's deployed commit SHA so releases can be verified.

Startup also logs `SMS latest message status` by reading one recent outgoing message from the cloud account (filtered by `SMSGATE_DEVICE_ID` when configured). This is account history, not proof of a particular visitor's request. Empty history is reported explicitly. Only the state and a fixed failure category are logged; message content, message/device IDs, and recipient information are omitted.

## 3. Deploy the repository on Render

Select the `deployment/phone-qr` branch in Render. It contains `render.yaml` and the deployment changes. Do not upload `.env`, `.env.deploy`, or `.admin-credentials` to GitHub.

In Render, choose **New → Blueprint**, connect this repository, and select the branch with `render.yaml`. Confirm that **maker-collective-voting** uses the **Free** instance plan.

Render prompts for three private values:

| Variable | Value |
| --- | --- |
| `DATABASE_URL` | The direct Neon connection string |
| `SMSGATE_USERNAME` | The Android app's Cloud Server username |
| `SMSGATE_PASSWORD` | The Android app's Cloud Server password |

Apply the Blueprint. Render generates four independent application secrets and the initial hosted admin password. The build installs the pinned frontend dependencies, type-checks the frontend, and builds it with `VITE_API_URL=/api`. Startup applies migrations, seeds a database only when it has no events, and creates an admin only when no administrators exist. Redeployment preserves existing event content and credentials.

After the service becomes Live, copy its actual `https://...onrender.com` address. That is the visitor address. The admin panel is `/admin`, results are `/results`, and `/ready` checks database connectivity. In Render's **Environment** tab, reveal `ADMIN_PASSWORD` privately to sign in as `makerspace`.

`ADMIN_USERNAME` and `ADMIN_PASSWORD` are used only to create the first admin on an empty database. Changing them later does not reset an existing account's password, and redeployment does not validate these unused initial credentials. First-time setup still requires a password of 12–128 characters.

This Blueprint sets `TRUST_PROXY=1` for Render's managed proxy and does not expose the Node port directly to clients. Recheck this setting if adding another reverse proxy or CDN.

## 4. Configure phone voting and location

Open the deployed `/admin` on your phone. Set the voting schedule, check that all three categories have projects, and configure venue access before opening voting.

For network access, connect the admin device to the venue Wi-Fi or your presentation hotspot. In **Voting settings**, tap **إضافة الشبكة الحالية** / **Add this network**, then **Save settings**. The button fills in the exact public address observed by the server (`/32` for IPv4 or `/128` for IPv6); adding it to the field alone does not approve it. Existing ranges are preserved. A cloud backend sees the network's public address; a home subnet such as `192.168.1.0/24` or the development range `127.0.0.1/32` cannot identify remote visitors. You can still enter known public CIDR ranges manually.

For a laptop presentation, use the approved network and reload the visitor page. The server verifies that network before requesting GPS, so laptops with approximate location readings can continue to SMS verification. Keep location verification enabled for visitors whose network is not approved. GPS access still requires accuracy of 100 metres or better and presence inside the venue zone. If you change networks or the public address changes, add the new address from that network and save again. An exact IPv6 address can differ between devices on the same Wi-Fi; approve the laptop from its own admin session, or configure the venue's known public range.

For location access, enable location verification and tap **تسجيل موقع المعرض** / **Record venue location** from your admin account at the actual venue. Allow browser location permission. HTTPS supports location on phones. The admin capture needs accuracy of 100 meters or better and records once per event. It immediately creates a ready zone within 100 metres of that position; no visitor samples or Wi-Fi ranges are required for GPS-only voting. Existing admin locations become ready automatically when the deployment migration runs. During open voting, visitors scan the QR, tap **Start voting**, tap **Allow location**, and complete SMS verification. Their location verifies presence in the admin's zone and does not establish or change it.

Finally, open voting for the configured schedule. Opening the visitor link before voting is open shows the closed/scheduled page.

## 5. Download and test the voting QR

In the deployed admin panel, open **Voting settings → Voting link and QR code** (Arabic: **رابط التصويت ورمز QR**). Copy the visitor link or download the SVG QR code for printing. The URL includes `?event=...` so it opens the selected exhibition. It contains no admin credentials or login token.

Scan it with a second phone. Verify that it opens the correct HTTPS address, gets through the venue check on the approved network, receives the real SMS OTP, and records a test vote. Confirm the vote appears in admin results. Use a test event for test votes rather than clearing real votes afterward.

## Publish future changes

Use `integration/all-work` for development and `deployment/phone-qr` for deployment. Keep the Render service's **Branch** set to `deployment/phone-qr` and **Auto-Deploy** set to **On Commit**. The Blueprint explicitly records these settings.

For each release, commit and push the tested development changes, then merge `integration/all-work` into the deployment checkout. Resolve overlapping changes while preserving the deployment setup, run the frontend type check and build and the backend tests, and push `deployment/phone-qr`. If the deployment branch is already open in another Git worktree, perform the merge and push in that checkout.

Render builds the pushed deployment branch. Wait for its latest deploy to show **Live**, then check the visitor and admin URLs. A successful Git push confirms the repository update; the live website is updated after a successful Render deploy. Locally saved files and commits pushed only to the development branch do not update the deployed app.

## Free hosting limits

[Render Free](https://render.com/docs/free) services sleep after 15 minutes without inbound traffic and can take about a minute to wake. Open the app before phone testing; a sleeping service can outlast the frontend's request timeout. Render recommends free services for preview/hobby use, not production applications. [Neon Free](https://neon.com/pricing) also has compute, storage, and transfer quotas. Review these before an exhibition expecting sustained participation.

Use Neon for this setup instead of Render Free PostgreSQL, whose database expires after 30 days. No paid instance, paid disk, or paid database is declared in `render.yaml`.
