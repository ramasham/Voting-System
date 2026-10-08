import { categories, makers } from "../data/config"
import type { Catalog } from "./types"
import type {
  EventSettings,
  LiveResults,
  StaffCategory,
  StaffEvent,
  StaffExhibitor,
} from "./staff-types"

const KEY = "mc2026.demo.event.v1"
export const DEMO_CHANGE = "mc2026-demo-change"
export type DemoData = {
  version: 1
  generation: number
  event: StaffEvent
  categories: StaffCategory[]
  exhibitors: StaffExhibitor[]
  settings: EventSettings
  counts: Record<string, Record<string, number>>
}
function seed(): DemoData {
  const start = new Date(Date.now() - 3600000).toISOString()
  const end = new Date(Date.now() + 8 * 3600000).toISOString()
  return {
    version: 1,
    generation: 0,
    event: {
      id: "1",
      name: "The Maker Collective 2026",
      start_at: start,
      end_at: end,
      status: "active",
    },
    categories: categories.map((c, i) => ({
      id: c.id,
      name: c.name.ar,
      labels: c.name,
      description: "",
      display_order: i + 1,
    })),
    exhibitors: makers.map((m) => ({
      id: m.id,
      name: m.title.ar,
      description: m.long.ar,
      image_url: m.image,
      categories: [
        {
          id: m.categoryId,
          name: categories.find((c) => c.id === m.categoryId)!.name.ar,
        },
      ],
      labels: {
        ar: {
          name: m.title.ar,
          description: m.long.ar,
          team: m.team.ar,
          members: (m.members ?? []).map((x) => x.ar),
        },
        en: {
          name: m.title.en,
          description: m.long.en,
          team: m.team.en,
          members: (m.members ?? []).map((x) => x.en),
        },
      },
    })),
    settings: {
      event_id: "1",
      voting_start_at: start,
      voting_end_at: end,
      voting_enabled: true,
      allowed_ip_ranges: "192.168.1.0/24",
      location_enabled: false,
      location_ready: false,
    },
    counts: Object.fromEntries(
      categories.map((c, i) => [
        c.id,
        Object.fromEntries(
          makers
            .filter((m) => m.categoryId === c.id)
            .map((m, j) => [
              m.id,
              [
                [128, 96, 74],
                [112, 89, 65],
                [104, 81, 58],
              ][i][j],
            ]),
        ),
      ]),
    ),
  }
}
export function getDemoData(): DemoData {
  const stored = localStorage.getItem(KEY)
  if (stored) {
    try {
      const data = JSON.parse(stored) as DemoData
      if (
        data.version === 1 &&
        Array.isArray(data.exhibitors) &&
        Array.isArray(data.categories)
      )
        return data
    } catch {
      /* initialize a damaged demo store */
    }
  }
  const data = seed()
  localStorage.setItem(KEY, JSON.stringify(data))
  return data
}
export function saveDemoData(data: DemoData) {
  localStorage.setItem(KEY, JSON.stringify(data))
  window.dispatchEvent(new Event(DEMO_CHANGE))
}
export function demoResults(): LiveResults {
  const data = getDemoData()
  return {
    eventId: data.event.id,
    event: data.event.name,
    updatedAt: new Date().toISOString(),
    categories: data.categories.map((c) => ({
      categoryId: c.id,
      category: c.name,
      exhibitors: data.exhibitors
        .filter((e) => e.categories.some((x) => x.id === c.id))
        .map((e) => ({
          exhibitorId: e.id,
          exhibitor: e.name,
          imageUrl: e.image_url,
          votes: data.counts[c.id]?.[e.id] ?? 0,
        }))
        .sort(
          (a, b) => b.votes - a.votes || a.exhibitor.localeCompare(b.exhibitor),
        ),
    })),
  }
}
export function demoCatalog(): Catalog {
  const data = getDemoData()
  return {
    categories: data.categories.map((c, i) => ({
      id: c.id,
      number: String(i + 1).padStart(2, "0"),
      name: c.labels ?? { ar: c.name, en: c.name },
      color: (["purple", "blue", "yellow"] as const)[i % 3],
    })),
    makers: data.exhibitors.flatMap((e) =>
      e.categories.map((c) => ({
        id: e.id,
        categoryId: c.id,
        title: {
          ar: e.labels?.ar.name ?? e.name,
          en: e.labels?.en.name ?? e.name,
        },
        team: { ar: e.labels?.ar.team ?? "", en: e.labels?.en.team ?? "" },
        short: {
          ar: e.labels?.ar.description ?? e.description,
          en: e.labels?.en.description ?? e.description,
        },
        long: {
          ar: e.labels?.ar.description ?? e.description,
          en: e.labels?.en.description ?? e.description,
        },
        members: e.team_members
          ? e.team_members.map((name) => ({ ar: name, en: name }))
          : (e.labels?.ar.members ?? []).map((name, i) => ({
              ar: name,
              en: e.labels?.en.members[i] ?? name,
            })),
        image: e.image_url,
        imageAlt: { ar: e.name, en: e.labels?.en.name ?? e.name },
      })),
    ),
  }
}
