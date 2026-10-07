import type { Api, ApiErrorCode, AppConfig, Session } from "./types"
import { ApiError } from "./errors"
import { backendRequest, BackendError, mediaUrl } from "./backend"
import type { StaffCategory, StaffEvent, StaffExhibitor } from "./staff-types"

let onSessionExpired: (() => void) | null = null
export const setSessionExpiredHandler = (handler: (() => void) | null) => {
  onSessionExpired = handler
}
const SESSION_KEY = "mc2026.visitor.session"
type VisitorAuth = {
  accessToken: string
  expiresAt: number
}
const readAuth = (): VisitorAuth | null => {
  try {
    const data = JSON.parse(
      sessionStorage.getItem(SESSION_KEY) ?? "null",
    ) as VisitorAuth | null
    if (data && data.expiresAt > Date.now()) return data
  } catch {
    /* start a fresh session */
  }
  sessionStorage.removeItem(SESSION_KEY)
  return null
}
function convertError(
  error: unknown,
  outside: ApiErrorCode = "OFF_SITE_NETWORK",
): ApiError {
  if (!(error instanceof BackendError)) return new ApiError("SERVER")
  const mapped: Record<string, ApiErrorCode> = {
    NETWORK: "NETWORK",
    INVALID_TOKEN: "SESSION_EXPIRED",
    AUTHENTICATION_REQUIRED: "SESSION_EXPIRED",
    INVALID_OR_EXPIRED_OTP: "OTP_INVALID",
    OTP_ATTEMPTS_EXCEEDED: "RATE_LIMITED",
    RATE_LIMITED: "RATE_LIMITED",
    DUPLICATE_VOTE: "ALREADY_VOTED",
    VOTING_CLOSED: "VOTING_CLOSED",
    VOTING_NOT_CONFIGURED: "VOTING_CLOSED",
    LOCATION_REQUIRED: "OFF_SITE_NETWORK",
    OUTSIDE_VENUE: outside,
    LOCATION_INACCURATE: "LOCATION_INACCURATE",
  }
  const code =
    mapped[error.code] ?? (error.status >= 500 ? "SERVER" : "VALIDATION")
  if (code === "SESSION_EXPIRED") {
    sessionStorage.removeItem(SESSION_KEY)
    onSessionExpired?.()
  }
  return new ApiError(code, {
    message: error.message,
    retryAfterSeconds: code === "RATE_LIMITED" ? 60 : undefined,
  })
}

export function createHttpApi(): Api {
  let eventPromise: Promise<string> | null = null
  const eventId = () => {
    if (!eventPromise)
      eventPromise = (async () => {
        const specified = import.meta.env.VITE_EVENT_ID as string | undefined
        if (specified) return specified
        const events = await backendRequest<StaffEvent[]>("/events")
        if (!events.length) throw new ApiError("SERVER")
        return String(events[0].id)
      })().catch((error) => {
        eventPromise = null
        throw error
      })
    return eventPromise
  }
  const call = async <T,>(
    path: string,
    options: Parameters<typeof backendRequest>[1] = {},
    outside?: ApiErrorCode,
  ): Promise<T> => {
    try {
      return await backendRequest<T>(path, options)
    } catch (error) {
      throw convertError(error, outside)
    }
  }
  const votesFor = async (token: string) => {
    const rows = await call<{
      category_id: number
      exhibitor_id: number
    }[]>(
      `/events/${await eventId()}/votes`,
      { token },
    )
    return Object.fromEntries(
      rows.map((row) => [String(row.category_id), String(row.exhibitor_id)]),
    )
  }
  const restore = async (token: string): Promise<Session> => {
    const [visitor, votes] = await Promise.all([
      call<{
        id: number
        name: string
      }>("/auth/me", { token }),
      votesFor(token),
    ])
    return { visitor: { ...visitor, id: String(visitor.id) }, votes }
  }
  const LOCATION_KEY = "mc2026.visitor.location"
  return {
    mode: "http",
    getConfig: async () => call<AppConfig>(`/events/${await eventId()}/config`),
    checkNetwork: async () => {
      await call(`/events/${await eventId()}/venue-test`)
    },
    checkLocation: async (input) => {
      await call(
        `/events/${await eventId()}/venue-test`,
        { method: "POST", body: { location: input } },
        "OFF_SITE_LOCATION",
      )
      sessionStorage.setItem(
        LOCATION_KEY,
        JSON.stringify({ coordinates: input, at: Date.now() }),
      )
    },
    sendOtp: async (input) => {
      await call("/auth/register", {
        method: "POST",
        body: { name: input.name, phoneNumber: input.phone },
      })
      return { resendAfterSeconds: 30 }
    },
    verifyOtp: async (input) => {
      const result = await call<{
        accessToken: string
        expiresInSeconds: number
      }>("/auth/verify-otp", {
        method: "POST",
        body: { phoneNumber: input.phone, otp: input.code },
      })
      sessionStorage.setItem(
        SESSION_KEY,
        JSON.stringify({
          accessToken: result.accessToken,
          expiresAt: Date.now() + result.expiresInSeconds * 1000,
        }),
      )
      return restore(result.accessToken)
    },
    getMe: async () => {
      const auth = readAuth()
      if (!auth) return null
      try {
        return await restore(auth.accessToken)
      } catch (error) {
        if (
          error instanceof ApiError &&
          ["SESSION_EXPIRED", "UNAUTHORIZED"].includes(error.code)
        )
          return null
        throw error
      }
    },
    getCatalog: async () => {
      const event = await eventId()
      const [categoryRows, exhibitors] = await Promise.all([
        call<StaffCategory[]>(`/events/${event}/categories`),
        call<StaffExhibitor[]>(`/events/${event}/exhibitors`),
      ])
      return {
        categories: categoryRows.map((c, index) => ({
          id: String(c.id),
          number: String(index + 1).padStart(2, "0"),
          name: { ar: c.name, en: c.name },
          color: (["purple", "blue", "yellow"] as const)[index % 3],
        })),
        makers: exhibitors.flatMap((e) =>
          e.categories.map((c) => ({
            id: String(e.id),
            categoryId: String(c.id),
            title: { ar: e.name, en: e.name },
            team: { ar: "", en: "" },
            short: { ar: e.description ?? "", en: e.description ?? "" },
            long: { ar: e.description ?? "", en: e.description ?? "" },
            image: mediaUrl(e.image_url),
            imageAlt: { ar: e.name, en: e.name },
          })),
        ),
      }
    },
    castVote: async (input) => {
      const auth = readAuth()
      if (!auth) throw new ApiError("SESSION_EXPIRED")
      let location: {
        latitude: number
        longitude: number
        accuracy: number
      } | undefined
      try {
        const stored = JSON.parse(
          sessionStorage.getItem(LOCATION_KEY) ?? "null",
        )
        if (stored) {
          if (Date.now() - stored.at < 60000) location = stored.coordinates
          else
            location = await new Promise((resolve, reject) =>
              navigator.geolocation.getCurrentPosition(
                (p) =>
                  resolve({
                    latitude: p.coords.latitude,
                    longitude: p.coords.longitude,
                    accuracy: p.coords.accuracy,
                  }),
                () => reject(new ApiError("OFF_SITE_LOCATION")),
                { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 },
              ),
            )
        }
      } catch (error) {
        if (error instanceof ApiError) throw error
      }
      try {
        await call(
          `/events/${await eventId()}/votes`,
          {
            token: auth.accessToken,
            method: "POST",
            body: {
              categoryId: input.categoryId,
              exhibitorId: input.makerId,
              location,
            },
          },
          "OFF_SITE_LOCATION",
        )
      } catch (error) {
        if (error instanceof ApiError && error.code === "ALREADY_VOTED")
          throw new ApiError("ALREADY_VOTED", {
            votes: await votesFor(auth.accessToken),
          })
        throw error
      }
      return { votes: await votesFor(auth.accessToken) }
    },
  }
}
