# MC2026 Digital Voting System (visitor flow, front end)

    pnpm install
    pnpm dev        # demo mode (no back end needed)

To connect the real back end: copy `.env.example` to `.env`, set `VITE_API_URL`, restart. Everything the back end must provide is in `docs/API_CONTRACT.md`.

    src/
      App.tsx                 boot (config + session restore), screen switching, shared state
      pages/                  Welcome, OnSiteCheck (network + location), Registration, OTP, Voting, ThankYou
      components/             Icon, Button, TextInput, LanguageToggle, BrandHeader, Organizer, Frame, StateScreen (every error/state page),
                              CategoryTabs, MakerCard, ProjectSheet, ConfirmSheet
      services/               api.ts (picks mock or http), http.ts (real calls), mock.ts (demo back end), errors.ts, types.ts
      i18n/copy.ts            all Arabic / English texts
      data/config.ts          demo categories + makers (the real ones come from GET /catalog)
      data/countries.ts       country codes
      lib/                    digits.ts (Arabic digits -> 0-9), phone.ts (E.164 validation), errors.ts (error -> message)
      index.css               design tokens + styles (--safe-top keeps content below the camera cutout)

Preview any state in demo mode with `?demo=closed`, `?demo=offsite_network`, ... (list in the contract).
