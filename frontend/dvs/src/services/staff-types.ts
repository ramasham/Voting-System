import type { Language } from "../data/config"

export type StaffEvent = {
  id: string
  name: string
  start_at: string | null
  end_at: string | null
  status: string
}
export type StaffCategory = {
  id: string
  name: string
  description: string
  display_order: number
  labels?: Record<Language, string>
}
export type StaffExhibitor = {
  id: string
  name: string
  description: string
  image_url: string
  team_members?: string[]
  categories: {
    id: string
    name: string
  }[]
  labels?: Record<Language, {
    name: string
    description: string
    team: string
    members: string[]
  }>
}
export type EventSettings = {
  event_id: string
  voting_start_at: string | null
  voting_end_at: string | null
  voting_enabled: boolean
  allowed_ip_ranges: string | null
  location_enabled: boolean
  location_ready: boolean
  location_config?: string | null
}
export type SettingsInput = {
  votingStartAt: string | null
  votingEndAt: string | null
  allowedIpRanges: string
  locationEnabled: boolean
}
export type ExhibitorInput = {
  name: string
  description: string
  imageUrl: string
  categoryIds: string[]
  teamMembers: string[]
}
export type ResultExhibitor = {
  exhibitorId: string
  exhibitor: string
  imageUrl: string
  votes: number
}
export type LiveResults = {
  eventId: string
  event: string
  updatedAt: string
  categories: {
    categoryId: string
    category: string
    exhibitors: ResultExhibitor[]
  }[]
}
export type StaffProfile = {
  id: string
  username: string
  mfa_enabled: boolean
  mfa_available: boolean
}
export type StaffSession = {
  accessToken: string
  expiresAt: number
}
export type MfaSetup = {
  secret: string
  otpauthUrl: string
}
export const exhibitorName = (item: StaffExhibitor, lang: Language) =>
  item.labels?.[lang].name ?? item.name
export const categoryName = (item: StaffCategory, lang: Language) =>
  item.labels?.[lang] ?? item.name
