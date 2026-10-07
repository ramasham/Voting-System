import { useCallback, useEffect, useState } from "react"
import type { Language } from "../data/config"
import { Organizer } from "../components/Organizer"
import { staffCopy } from "../i18n/staff"
import {
  readStaffSession,
  saveStaffSession,
  staffApi,
  staffMode,
} from "../services/staff"
import type {
  StaffEvent,
  StaffProfile,
  StaffSession,
} from "../services/staff-types"
import makerLogo from "../imports/logo-white.png"
import StaffLogin from "./StaffLogin"
import AdminDashboard, { type AdminTab } from "./AdminDashboard"
import ResultsDashboard from "./ResultsDashboard"
import StaffIcon from "./StaffIcon"
import { isExpired, routeUrl, staffError } from "./utils"
import "./staff.css"

export default function StaffApp({ view }: { view: "admin" | "results" }) {
  const [lang, updateLang] = useState<Language>(() =>
    localStorage.getItem("mc2026.staff.language") === "en" ? "en" : "ar",
  )
  const [session, setSession] = useState<StaffSession | null>(readStaffSession)
  const [profile, setProfile] = useState<StaffProfile | null>(null)
  const [events, setEvents] = useState<StaffEvent[]>([])
  const [eventId, setEventId] = useState(
    new URLSearchParams(location.search).get("event") ??
      sessionStorage.getItem("mc2026.staff.event") ??
      "",
  )
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<unknown>(null)
  const [notice, setNotice] = useState("")
  const [attempt, setAttempt] = useState(0)
  const [tab, setTab] = useState<AdminTab>("overview")
  const t = staffCopy[lang]
  useEffect(() => {
    document.title = `${
      view === "admin" ? t.admin : t.liveResults
    } · The Maker Collective`
  }, [view, t.admin, t.liveResults])
  const setLang = (next: Language) => {
    updateLang(next)
    localStorage.setItem("mc2026.staff.language", next)
  }
  const expire = useCallback(() => {
    saveStaffSession(null)
    setSession(null)
    setProfile(null)
    setNotice("expired")
  }, [])
  useEffect(() => {
    if (!session) {
      setLoading(false)
      return
    }
    let alive = true
    setLoading(true)
    setError(null)
    Promise.all([
      staffApi.me(session.accessToken),
      staffApi.events(session.accessToken),
    ])
      .then(([profile, events]) => {
        if (alive) {
          setProfile(profile)
          setEvents(events)
          setEventId((current) =>
            events.some((e) => e.id === current)
              ? current
              : (events[0]?.id ?? ""),
          )
        }
      })
      .catch((error) => {
        if (alive) {
          if (isExpired(error)) expire()
          else setError(error)
        }
      })
      .finally(() => {
        if (alive) setLoading(false)
      })
    const timer = setTimeout(
      expire,
      Math.max(0, session.expiresAt - Date.now()),
    )
    return () => {
      alive = false
      clearTimeout(timer)
    }
  }, [session, attempt, expire])
  useEffect(() => {
    if (!eventId) return
    sessionStorage.setItem("mc2026.staff.event", eventId)
    const url = new URL(location.href)
    url.searchParams.set("event", eventId)
    history.replaceState(null, "", url)
  }, [eventId])
  const event = events.find((e) => e.id === eventId)
  const onAuthenticated = (session: StaffSession) => {
    saveStaffSession(session)
    setSession(session)
    setNotice("")
  }
  const logout = () => {
    saveStaffSession(null)
    setSession(null)
    setProfile(null)
    setNotice("")
  }
  const nav = [
    { id: "overview", label: t.overview, icon: "grid" },
    { id: "exhibitors", label: t.exhibitors, icon: "projects" },
    { id: "voting", label: t.voting, icon: "settings" },
    { id: "security", label: t.security, icon: "shield" },
  ] as const
  return (
    <div
      className={`staff-app staff-app--${view}`}
      dir={lang === "ar" ? "rtl" : "ltr"}
      lang={lang}
    >
      {!session ? (
        <StaffLogin
          lang={lang}
          setLang={setLang}
          onAuthenticated={onAuthenticated}
          notice={notice ? t.sessionExpired : ""}
        />
      ) : loading || error || !profile ? (
        <main className="staff-boot">
          <img alt="The Maker Collective" src={makerLogo} />
          <p role={error ? "alert" : "status"}>
            {error ? staffError(error, lang) : t.loading}
          </p>
          {Boolean(error) && (
            <button
              className="staff-button"
              onClick={() => setAttempt((n) => n + 1)}
            >
              {t.retry}
            </button>
          )}
          <button
            className="staff-button staff-button--subtle"
            onClick={logout}
          >
            {t.signOut}
          </button>
        </main>
      ) : view === "results" ? (
        event ? (
          <ResultsDashboard
            event={event}
            events={events}
            onEvent={setEventId}
            token={session.accessToken}
            lang={lang}
            setLang={setLang}
            onExpired={expire}
            onLogout={logout}
          />
        ) : (
          <main className="staff-boot">
            <p>{t.eventMissing}</p>
            <a href={routeUrl("admin")}>{t.admin}</a>
          </main>
        )
      ) : (
        <div className="admin-shell">
          <aside className="admin-sidebar">
            <a
              className="admin-sidebar__brand"
              href={routeUrl("admin", eventId)}
            >
              <img src={makerLogo} alt="The Maker Collective" />
            </a>
            <span className="admin-sidebar__caption">{t.staffOnly}</span>
            <nav aria-label={t.admin}>
              {nav.map((item) => (
                <button
                  aria-current={tab === item.id ? "page" : undefined}
                  className={tab === item.id ? "is-active" : ""}
                  key={item.id}
                  onClick={() => setTab(item.id)}
                >
                  <StaffIcon name={item.icon} />
                  <span>{item.label}</span>
                </button>
              ))}
              <a href={routeUrl("results", eventId)}>
                <StaffIcon name="chart" />
                {t.liveResults}
                <span className="admin-sidebar__live" />
              </a>
            </nav>
            <div className="admin-sidebar__footer">
              <Organizer dark lang={lang} />
              <a href={routeUrl("")}>{t.backVote}</a>
            </div>
          </aside>
          <div className="admin-main">
            <header className="admin-topbar">
              <div className="admin-topbar__event">
                <label htmlFor="staff-event">{t.event}</label>
                <select
                  id="staff-event"
                  value={eventId}
                  onChange={(e) => setEventId(e.target.value)}
                >
                  {events.map((e) => (
                    <option value={e.id} key={e.id}>
                      {e.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="admin-topbar__actions">
                <button
                  className="staff-language"
                  onClick={() => setLang(lang === "ar" ? "en" : "ar")}
                >
                  {lang === "ar" ? "English" : "العربية"}
                </button>
                <span className="staff-account">
                  <span>{profile.username.slice(0, 1).toUpperCase()}</span>
                  <b>{profile.username}</b>
                </span>
                <button
                  aria-label={t.signOut}
                  title={t.signOut}
                  className="staff-icon-button"
                  onClick={logout}
                >
                  <StaffIcon name="logout" />
                </button>
              </div>
            </header>
            {staffMode === "mock" && (
              <div className="staff-demo-banner">
                <b>{t.demo}</b>
                <span>{t.demoBody}</span>
              </div>
            )}
            {event ? (
              <AdminDashboard
                key={event.id}
                event={event}
                token={session.accessToken}
                lang={lang}
                tab={tab}
                onTab={setTab}
                profile={profile}
                onProfile={setProfile}
                onExpired={expire}
              />
            ) : (
              <p className="staff-empty">{t.eventMissing}</p>
            )}
            <Organizer lang={lang} />
          </div>
        </div>
      )}
    </div>
  )
}
