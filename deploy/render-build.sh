#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."
npm ci --prefix backend --include=dev
cd frontend/dvs
corepack pnpm install --frozen-lockfile --prod=false
VITE_API_URL=/api corepack pnpm exec tsc --noEmit
VITE_API_URL=/api corepack pnpm build
