import type { Language } from "../data/config"
import { staffCopy } from "../i18n/staff"
import { BackendError } from "../services/backend"
import type { EventSettings } from "../services/staff-types"

export const routeUrl = (route: "admin" | "results" | "", event?: string) =>
  `${import.meta.env.BASE_URL}${route}${
    event ? `?event=${encodeURIComponent(event)}` : ""
  }`
export const numberFormat = (value: number, lang: Language) =>
  new Intl.NumberFormat(lang === "ar" ? "ar-JO" : "en-GB").format(value)
export function votingStatus(settings: EventSettings) {
  if (
    !settings.voting_enabled ||
    !settings.voting_start_at ||
    !settings.voting_end_at ||
    new Date(settings.voting_end_at).getTime() <= Date.now()
  )
    return "closed"
  return new Date(settings.voting_start_at).getTime() > Date.now()
    ? "scheduled"
    : "open"
}
export function staffError(error: unknown, lang: Language) {
  const t = staffCopy[lang]
  if (!(error instanceof BackendError)) return t.error
  const errors: Record<string, string> = {
    NETWORK: t.networkError,
    INVALID_CREDENTIALS: t.loginError,
    INVALID_TOKEN: t.sessionExpired,
    AUTHENTICATION_REQUIRED: t.sessionExpired,
    INVALID_MFA_CODE: t.invalidMfa,
    MFA_UNAVAILABLE: t.mfaUnavailable,
    MFA_SETUP_EXPIRED: t.setupExpired,
    RATE_LIMITED: t.rateLimited,
    EXHIBITOR_HAS_VOTES: t.hasVotes,
    CATEGORY_HAS_VOTES: t.hasVotes,
    ASSIGNMENT_HAS_VOTES: t.hasVotes,
    CATEGORY_ASSIGNMENT_HAS_VOTES: t.hasVotes,
    VOTING_MUST_BE_CLOSED: t.resetClosed,
    INVALID_VOTING_WINDOW: t.invalidWindow,
    VOTING_WINDOW_REQUIRED: t.windowRequired,
    OUTSIDE_VOTING_WINDOW: t.windowEnded,
    VENUE_ACCESS_REQUIRED: t.venueRequired,
    THREE_CATEGORIES_REQUIRED: t.categoriesRequired,
    CATEGORY_EXHIBITORS_REQUIRED: t.categoriesRequired,
    INVALID_PHOTO: t.invalidPhoto,
    LOCATION_INACCURATE: t.locationError,
  }
  return (
    errors[error.code] ??
    (lang === "en" && error.status < 500 ? error.message : t.error)
  )
}
export const isExpired = (error: unknown) =>
  error instanceof BackendError &&
  error.status === 401 &&
  !["INVALID_CREDENTIALS", "INVALID_MFA_CODE", "MFA_REQUIRED"].includes(
    error.code,
  )
export function ammanInput(iso: string | null) {
  if (!iso) return ""
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Amman",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(iso))
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)!.value
  return `${part("year")}-${part("month")}-${part("day")}T${part("hour")}:${part("minute")}`
}
export function ammanIso(input: string): string | null {
  if (!input) return null
  const wall = Date.parse(`${input}:00Z`)
  // Derive the zone offset with Intl instead of relying on the host timezone.
  let instant = wall
  for (let i = 0; i < 2; i++) {
    const represented = Date.parse(
      `${ammanInput(new Date(instant).toISOString())}:00Z`,
    )
    instant += wall - represented
  }
  return new Date(instant).toISOString()
}
export function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement("a")
  link.href = url
  link.download = name
  link.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}
