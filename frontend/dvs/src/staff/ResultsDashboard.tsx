import { useEffect, useState } from "react"
import type { Language } from "../data/config"
import { Organizer } from "../components/Organizer"
import { staffCopy } from "../i18n/staff"
import { staffApi, staffMode } from "../services/staff"
import { DEMO_CHANGE } from "../services/demo-store"
import type {
  StaffCategory,
  StaffEvent,
  StaffExhibitor,
} from "../services/staff-types"
import makerLogo from "../imports/logo-white.png"
import Leaderboard from "./Leaderboard"
import StaffIcon from "./StaffIcon"
import useLiveResults from "./useLiveResults"
import { isExpired, numberFormat, routeUrl } from "./utils"
export default function ResultsDashboard({
  event,
  events,
  onEvent,
  token,
  lang,
  setLang,
  onExpired,
  onLogout,
}: {
  event: StaffEvent
  events: StaffEvent[]
  onEvent: (id: string) => void
  token: string
  lang: Language
  setLang: (lang: Language) => void
  onExpired: () => void
  onLogout: () => void
}) {
  const t = staffCopy[lang]
  const live = useLiveResults(token, event.id, onExpired)
  const [categories, setCategories] = useState<StaffCategory[]>([])
  const [exhibitors, setExhibitors] = useState<StaffExhibitor[]>([])
  const [presenting, setPresenting] = useState(false)
  useEffect(() => {
    let alive = true
    const load = async () => {
      try {
        const [c, e] = await Promise.all([
          staffApi.categories(token, event.id),
          staffApi.exhibitors(token, event.id),
        ])
        if (alive) {
          setCategories(c)
          setExhibitors(e)
        }
      } catch (error) {
        if (isExpired(error)) onExpired()
      }
    }
    const changed = () => void load()
    void load()
    const interval = setInterval(changed, 15000)
    window.addEventListener("storage", changed)
    window.addEventListener(DEMO_CHANGE, changed)
    return () => {
      alive = false
      clearInterval(interval)
      window.removeEventListener("storage", changed)
      window.removeEventListener(DEMO_CHANGE, changed)
    }
  }, [token, event.id, onExpired])
  useEffect(() => {
    const changed = () => setPresenting(Boolean(document.fullscreenElement))
    document.addEventListener("fullscreenchange", changed)
    return () => document.removeEventListener("fullscreenchange", changed)
  }, [])
  const togglePresentation = async () => {
    if (document.fullscreenElement) await document.exitFullscreen()
    else {
      setPresenting(true)
      try {
        await document.documentElement.requestFullscreen()
      } catch {
        /* presentation layout also works without browser fullscreen */
      }
    }
  }
  const total = live.data?.categories.reduce(
    (n, c) => n + c.exhibitors.reduce((n, e) => n + e.votes, 0),
    0,
  )
  const connectionText = {
    connecting: t.reconnecting,
    live: t.connected,
    polling: t.polling,
    offline: t.offline,
  }[live.connection]
  return (
    <main
      className={`results-screen brand-surface ${
        presenting ? "is-presenting" : ""
      }`}
    >
      <header className="results-topbar">
        <a href={routeUrl("admin", event.id)}>
          <img
            className="results-brand"
            alt="The Maker Collective"
            src={makerLogo}
          />
        </a>
        <div className="results-topbar__actions">
          <a
            className="staff-button staff-button--white-outline"
            href={routeUrl("admin", event.id)}
          >
            {t.admin}
          </a>
          <button
            className="staff-language"
            onClick={() => setLang(lang === "ar" ? "en" : "ar")}
          >
            {lang === "ar" ? "English" : "العربية"}
          </button>
          <button
            aria-label={t.signOut}
            title={t.signOut}
            className="staff-icon-button"
            onClick={onLogout}
          >
            <StaffIcon name="logout" />
          </button>
        </div>
        <button
          className="results-exit"
          onClick={async () => {
            setPresenting(false)
            if (document.fullscreenElement) await document.exitFullscreen()
          }}
        >
          {t.exitFullscreen}
          <StaffIcon name="close" size={18} />
        </button>
      </header>
      <div className="results-content">
        <header className="results-heading">
          <div>
            <span className="staff-eyebrow">THE MAKER COLLECTIVE 2026</span>
            <h1>{t.resultsTitle}</h1>
            <p>{t.resultsBody}</p>
          </div>
          <div className="results-summary">
            <span>{t.registeredVotes}</span>
            <b>{total === undefined ? "—" : numberFormat(total, lang)}</b>
          </div>
        </header>
        <div className="results-toolbar">
          <div className="results-status">
            <span
              className={`results-connection results-connection--${live.connection}`}
            >
              <i />
              {connectionText}
            </span>
            {live.data && (
              <time dateTime={live.data.updatedAt}>
                {t.lastUpdated}{" "}
                {new Intl.DateTimeFormat(lang === "ar" ? "ar-JO" : "en-GB", {
                  timeZone: "Asia/Amman",
                  hour: "2-digit",
                  minute: "2-digit",
                  second: "2-digit",
                  hourCycle: "h23",
                }).format(new Date(live.data.updatedAt))}
              </time>
            )}
            {staffMode === "mock" && (
              <span className="results-demo">{t.demo}</span>
            )}
          </div>
          <div className="results-controls">
            <select
              aria-label={t.event}
              value={event.id}
              onChange={(e) => onEvent(e.target.value)}
            >
              {events.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name}
                </option>
              ))}
            </select>
            <button
              aria-label={t.refresh}
              title={t.refresh}
              className="staff-icon-button"
              onClick={live.refresh}
            >
              <StaffIcon name="refresh" size={18} />
            </button>
            <button
              className="staff-button staff-button--white"
              onClick={() => void togglePresentation()}
            >
              <StaffIcon name="expand" size={18} />
              {t.fullscreen}
            </button>
          </div>
        </div>
        {Boolean(live.error) && (
          <p className="results-error" role="alert">
            {t.stale}
            <button onClick={live.refresh}>{t.retry}</button>
          </p>
        )}
        {live.data ? (
          <div className="staff-leaderboards staff-leaderboards--results">
            {live.data.categories.map((c, index) => (
              <Leaderboard
                key={c.categoryId}
                category={c}
                index={index}
                lang={lang}
                categories={categories}
                exhibitors={exhibitors}
              />
            ))}
          </div>
        ) : (
          <div className="results-loading" role="status">
            <StaffIcon name="chart" size={40} />
            <p>{t.loading}</p>
          </div>
        )}
        <footer className="results-footer">
          <span>{event.name}</span>
          <Organizer dark lang={lang} />
        </footer>
      </div>
    </main>
  )
}
