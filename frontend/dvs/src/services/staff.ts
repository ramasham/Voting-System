import { backendBase, backendRequest, BackendError, mediaUrl } from "./backend"
import { demoResults, getDemoData, saveDemoData } from "./demo-store"
import type {
  EventSettings,
  ExhibitorInput,
  LiveResults,
  MfaSetup,
  SettingsInput,
  StaffCategory,
  StaffEvent,
  StaffExhibitor,
  StaffProfile,
  StaffSession,
} from "./staff-types"

export const staffMode = backendBase ? "http" : "mock"
const SESSION_KEY = "mc2026.staff.session"
export function readStaffSession(): StaffSession | null {
  try {
    const data = JSON.parse(
      sessionStorage.getItem(SESSION_KEY) ?? "null",
    ) as StaffSession | null
    return data && data.expiresAt > Date.now() ? data : null
  } catch {
    return null
  }
}
export function saveStaffSession(session: StaffSession | null) {
  if (session) sessionStorage.setItem(SESSION_KEY, JSON.stringify(session))
  else sessionStorage.removeItem(SESSION_KEY)
}
function requireDemoToken(token: string) {
  if (!token.startsWith("demo-staff-"))
    throw new BackendError("INVALID_TOKEN", "Sign in again.", 401)
}
const eventPath = (event: string) =>
  `/admin/events/${encodeURIComponent(event)}`
const normalizeExhibitor = (item: StaffExhibitor): StaffExhibitor => ({
  ...item,
  id: String(item.id),
  image_url: mediaUrl(item.image_url),
  categories: item.categories.map((c) => ({ ...c, id: String(c.id) })),
})
export const staffApi = {
  async login(
    username: string,
    password: string,
    mfaCode?: string,
  ): Promise<StaffSession> {
    if (staffMode === "mock") {
      if (
        username.trim().toLowerCase() !== "makerspace" ||
        password !== "Maker2026!"
      )
        throw new BackendError(
          "INVALID_CREDENTIALS",
          "Username or password is incorrect.",
          401,
        )
      return {
        accessToken: `demo-staff-${crypto.randomUUID()}`,
        expiresAt: Date.now() + 30 * 60000,
      }
    }
    const result = await backendRequest<{
      accessToken: string
      expiresInSeconds: number
    }>("/admin/login", {
      method: "POST",
      body: { username, password, mfaCode },
    })
    return {
      accessToken: result.accessToken,
      expiresAt: Date.now() + result.expiresInSeconds * 1000,
    }
  },
  async me(token: string): Promise<StaffProfile> {
    if (staffMode === "mock") {
      requireDemoToken(token)
      return {
        id: "1",
        username: "makerspace",
        mfa_enabled: false,
        mfa_available: false,
      }
    }
    return backendRequest("/admin/me", { token })
  },
  async events(token: string): Promise<StaffEvent[]> {
    if (staffMode === "mock") {
      requireDemoToken(token)
      return [getDemoData().event]
    }
    return (await backendRequest<StaffEvent[]>("/events", { token })).map(
      (e) => ({ ...e, id: String(e.id) }),
    )
  },
  async currentNetwork(token: string): Promise<{ ip: string; cidr: string }> {
    return backendRequest("/admin/network", { token })
  },
  async approvePresentation(token: string, event: string): Promise<void> {
    await backendRequest(`${eventPath(event)}/presentation`, { token, method: "POST" })
  },
  async categories(token: string, event: string): Promise<StaffCategory[]> {
    if (staffMode === "mock") {
      requireDemoToken(token)
      return getDemoData().categories
    }
    return (
      await backendRequest<StaffCategory[]>(`${eventPath(event)}/categories`, {
        token,
      })
    ).map((c) => ({ ...c, id: String(c.id) }))
  },
  async exhibitors(token: string, event: string): Promise<StaffExhibitor[]> {
    if (staffMode === "mock") {
      requireDemoToken(token)
      return getDemoData().exhibitors
    }
    return (
      await backendRequest<StaffExhibitor[]>(`${eventPath(event)}/exhibitors`, {
        token,
      })
    ).map(normalizeExhibitor)
  },
  async settings(token: string, event: string): Promise<EventSettings> {
    if (staffMode === "mock") {
      requireDemoToken(token)
      return getDemoData().settings
    }
    return backendRequest(`${eventPath(event)}/settings`, { token })
  },
  async results(token: string, event: string): Promise<LiveResults> {
    if (staffMode === "mock") {
      requireDemoToken(token)
      return demoResults()
    }
    const data = await backendRequest<LiveResults>(
      `${eventPath(event)}/results`,
      { token },
    )
    return {
      ...data,
      eventId: String(data.eventId),
      categories: data.categories.map((c) => ({
        ...c,
        categoryId: String(c.categoryId),
        exhibitors: c.exhibitors.map((e) => ({
          ...e,
          exhibitorId: String(e.exhibitorId),
          imageUrl: mediaUrl(e.imageUrl),
        })),
      })),
    }
  },
  async saveExhibitor(
    token: string,
    event: string,
    input: ExhibitorInput,
    id?: string,
  ): Promise<StaffExhibitor> {
    if (staffMode === "mock") {
      requireDemoToken(token)
      const data = getDemoData()
      if (
        !input.categoryIds.length ||
        input.categoryIds.some(
          (id) => !data.categories.some((c) => c.id === id),
        )
      )
        throw new BackendError("VALIDATION", "Choose at least one category.")
      const previous = data.exhibitors.find((e) => e.id === id)
      if (
        previous?.categories.some(
          (c) =>
            !input.categoryIds.includes(c.id) &&
            (data.counts[c.id]?.[previous.id] ?? 0) > 0,
        )
      )
        throw new BackendError(
          "ASSIGNMENT_HAS_VOTES",
          "A category with recorded votes cannot be removed.",
          409,
        )
      const saved = {
        id: id ?? `demo-${crypto.randomUUID()}`,
        name: input.name.trim(),
        description: input.description.trim(),
        image_url: input.imageUrl,
        labels: previous?.labels
          ? {
              ar: {
                ...previous.labels.ar,
                name: input.name.trim(),
                description: input.description.trim(),
              },
              en: {
                ...previous.labels.en,
                name: input.name.trim(),
                description: input.description.trim(),
              },
            }
          : undefined,
        categories: data.categories
          .filter((c) => input.categoryIds.includes(c.id))
          .map((c) => ({ id: c.id, name: c.name })),
      }
      if (previous)
        data.exhibitors = data.exhibitors.map((e) =>
          e.id === saved.id ? saved : e,
        )
      else data.exhibitors.push(saved)
      saveDemoData(data)
      return saved
    }
    return normalizeExhibitor(
      await backendRequest<StaffExhibitor>(
        `${eventPath(event)}/exhibitors${
          id ? `/${encodeURIComponent(id)}` : ""
        }`,
        { token, method: id ? "PATCH" : "POST", body: input },
      ),
    )
  },
  async uploadPhoto(token: string, event: string, id: string, file: File) {
    if (
      !["image/png", "image/jpeg", "image/webp"].includes(file.type) ||
      file.size > 2 * 1024 * 1024
    )
      throw new BackendError(
        "INVALID_PHOTO",
        "Use a PNG, JPEG, or WebP photo under 2 MB.",
      )
    if (staffMode === "mock") {
      requireDemoToken(token)
      const value = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(String(reader.result))
        reader.onerror = reject
        reader.readAsDataURL(file)
      })
      const data = getDemoData()
      data.exhibitors = data.exhibitors.map((e) =>
        e.id === id ? { ...e, image_url: value } : e,
      )
      saveDemoData(data)
      return
    }
    await backendRequest(
      `${eventPath(event)}/exhibitors/${encodeURIComponent(id)}/photo`,
      { token, method: "PUT", file },
    )
  },
  async deleteExhibitor(token: string, event: string, id: string) {
    if (staffMode === "mock") {
      requireDemoToken(token)
      const data = getDemoData()
      if (Object.values(data.counts).some((counts) => (counts[id] ?? 0) > 0))
        throw new BackendError(
          "EXHIBITOR_HAS_VOTES",
          "This exhibitor has votes and cannot be removed.",
          409,
        )
      data.exhibitors = data.exhibitors.filter((e) => e.id !== id)
      saveDemoData(data)
      return
    }
    await backendRequest(
      `${eventPath(event)}/exhibitors/${encodeURIComponent(id)}`,
      { token, method: "DELETE" },
    )
  },
  async updateSettings(token: string, event: string, input: SettingsInput) {
    if (staffMode === "mock") {
      requireDemoToken(token)
      const data = getDemoData()
      if (
        input.votingStartAt &&
        input.votingEndAt &&
        input.votingStartAt >= input.votingEndAt
      )
        throw new BackendError(
          "INVALID_VOTING_WINDOW",
          "End time must be after start time.",
        )
      data.settings = {
        ...data.settings,
        voting_start_at: input.votingStartAt,
        voting_end_at: input.votingEndAt,
        allowed_ip_ranges: input.allowedIpRanges,
        location_enabled: input.locationEnabled,
      }
      saveDemoData(data)
      return
    }
    await backendRequest(`${eventPath(event)}/settings`, {
      token,
      method: "PATCH",
      body: input,
    })
  },
  async setVoting(token: string, event: string, open: boolean) {
    if (staffMode === "mock") {
      requireDemoToken(token)
      const data = getDemoData()
      if (open) {
        if (!data.settings.voting_start_at || !data.settings.voting_end_at)
          throw new BackendError(
            "VOTING_WINDOW_REQUIRED",
            "Set the start and end times first.",
          )
        if (new Date(data.settings.voting_end_at).getTime() <= Date.now())
          throw new BackendError(
            "OUTSIDE_VOTING_WINDOW",
            "The voting window has ended.",
          )
        if (
          !data.settings.allowed_ip_ranges?.trim() &&
          !data.settings.location_ready
        )
          throw new BackendError(
            "VENUE_ACCESS_REQUIRED",
            "Configure venue access before opening voting.",
          )
        if (
          data.categories.length !== 3 ||
          data.categories.some(
            (c) =>
              !data.exhibitors.some((e) =>
                e.categories.some((x) => x.id === c.id),
              ),
          )
        )
          throw new BackendError(
            "CATEGORY_EXHIBITORS_REQUIRED",
            "Assign an exhibitor to each of the three categories.",
          )
      }
      data.settings.voting_enabled = open
      saveDemoData(data)
      return
    }
    await backendRequest(
      `${eventPath(event)}/voting/${open ? "open" : "close"}`,
      { token, method: "POST" },
    )
  },
  async reset(token: string, event: string) {
    if (staffMode === "mock") {
      requireDemoToken(token)
      const data = getDemoData()
      if (data.settings.voting_enabled)
        throw new BackendError(
          "VOTING_MUST_BE_CLOSED",
          "Close voting before resetting results.",
          409,
        )
      data.counts = {}
      data.generation++
      saveDemoData(data)
      return
    }
    await backendRequest(`${eventPath(event)}/results/reset`, {
      token,
      method: "POST",
    })
  },
  async export(token: string, event: string): Promise<Blob> {
    if (staffMode === "http")
      return new Blob(
        [
          "\uFEFF",
          await backendRequest<Blob>(`${eventPath(event)}/export.csv`, {
            token,
          }),
        ],
        { type: "text/csv;charset=utf-8" },
      )
    requireDemoToken(token)
    const cell = (value: unknown) => {
      let text = String(value ?? "")
      if (/^\s*[=+\-@]/.test(text)) text = `'${text}`
      return `"${text.replace(/"/g, '""')}"`
    }
    const rows: unknown[][] = [
      ["category_id", "category", "exhibitor_id", "exhibitor", "votes"],
    ]
    for (const c of demoResults().categories) {
      if (!c.exhibitors.length) rows.push([c.categoryId, c.category, "", "", 0])
      for (const e of c.exhibitors)
        rows.push([
          c.categoryId,
          c.category,
          e.exhibitorId,
          e.exhibitor,
          e.votes,
        ])
    }
    return new Blob(
      ["\uFEFF", rows.map((row) => row.map(cell).join(",")).join("\r\n")],
      { type: "text/csv;charset=utf-8" },
    )
  },
  async setupMfa(token: string, password: string): Promise<MfaSetup> {
    return backendRequest("/admin/mfa/setup", {
      token,
      method: "POST",
      body: { password },
    })
  },
  async confirmMfa(token: string, code: string) {
    return backendRequest("/admin/mfa/confirm", {
      token,
      method: "POST",
      body: { code },
    })
  },
  async anchor(
    token: string,
    event: string,
    coordinates: {
      latitude: number
      longitude: number
      accuracy: number
    },
  ) {
    if (staffMode === "mock")
      throw new BackendError(
        "MFA_UNAVAILABLE",
        "Location learning requires the real backend.",
      )
    await backendRequest(`${eventPath(event)}/location/anchor`, {
      token,
      method: "POST",
      body: coordinates,
    })
  },
}
