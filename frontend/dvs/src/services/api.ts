import { createHttpApi } from "./http"
import { mockApi } from "./mock"
import type { Api } from "./types"
import { backendBase } from "./backend"

// Set VITE_API_URL (see .env.example) to talk to the real back end. Without it the demo back end runs in the browser.
export const api: Api = backendBase ? createHttpApi() : mockApi
export { ApiError, errorCode } from "./errors"
export { setSessionExpiredHandler } from "./http"
export type {
  ApiErrorCode,
  AppConfig,
  Catalog,
  Session,
  Votes,
  Visitor,
} from "./types"
