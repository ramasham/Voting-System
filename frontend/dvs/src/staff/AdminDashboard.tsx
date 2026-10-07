import { useCallback, useEffect, useState } from "react"
import type { Language } from "../data/config"
import { staffCopy } from "../i18n/staff"
import { staffApi } from "../services/staff"
import {
  categoryName,
  exhibitorName,
  type EventSettings,
  type StaffCategory,
  type StaffEvent,
  type StaffExhibitor,
  type StaffProfile,
} from "../services/staff-types"
import StaffIcon from "./StaffIcon"
import StaffModal from "./StaffModal"
import ExhibitorEditor from "./ExhibitorEditor"
import VotingSettings from "./VotingSettings"
import SecurityPanel from "./SecurityPanel"
import Leaderboard from "./Leaderboard"
import useLiveResults from "./useLiveResults"
import {
  isExpired,
  numberFormat,
  routeUrl,
  staffError,
  votingStatus,
} from "./utils"
export type AdminTab = "overview" | "exhibitors" | "voting" | "security"
type Content = {
  categories: StaffCategory[]
  exhibitors: StaffExhibitor[]
  settings: EventSettings
}
type Confirmation = {
  kind: "open" | "close" | "reset" | "delete"
  project?: StaffExhibitor
}
export default function AdminDashboard({
  event,
  token,
  lang,
  tab,
  onTab,
  profile,
  onProfile,
  onExpired,
}: {
  event: StaffEvent
  token: string
  lang: Language
  tab: AdminTab
  onTab: (tab: AdminTab) => void
  profile: StaffProfile
  onProfile: (profile: StaffProfile) => void
  onExpired: () => void
}) {
  const t = staffCopy[lang]
  const [content, setContent] = useState<Content | null>(null)
  const [error, setError] = useState<unknown>(null)
  const [editor, setEditor] = useState<{
    project: StaffExhibitor | null
  } | null>(null)
  const [confirm, setConfirm] = useState<Confirmation | null>(null)
  const [confirmText, setConfirmText] = useState("")
  const [confirmError, setConfirmError] = useState<unknown>(null)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] =
    useState<"projectSaved" | "removed" | "resetDone" | "saved" | null>(null)
  const [query, setQuery] = useState("")
  const [filter, setFilter] = useState("")
  const live = useLiveResults(token, event.id, onExpired)
  const load = useCallback(async () => {
    setError(null)
    try {
      const [categories, exhibitors, settings] = await Promise.all([
        staffApi.categories(token, event.id),
        staffApi.exhibitors(token, event.id),
        staffApi.settings(token, event.id),
      ])
      setContent({ categories, exhibitors, settings })
    } catch (error) {
      if (isExpired(error)) onExpired()
      else setError(error)
    }
  }, [token, event.id, onExpired])
  useEffect(() => {
    void load()
  }, [load])
  const refresh = () => {
    void load()
    live.refresh()
  }
  const requestConfirm = (confirmation: Confirmation) => {
    setConfirm(confirmation)
    setConfirmText("")
    setConfirmError(null)
  }
  const commit = async () => {
    if (
      !confirm ||
      (confirm.kind === "reset" && confirmText.trim() !== "RESET")
    )
      return
    setBusy(true)
    setConfirmError(null)
    try {
      if (confirm.kind === "delete" && confirm.project)
        await staffApi.deleteExhibitor(token, event.id, confirm.project.id)
      else if (confirm.kind === "reset") await staffApi.reset(token, event.id)
      else await staffApi.setVoting(token, event.id, confirm.kind === "open")
      setNotice(
        confirm.kind === "delete"
          ? "removed"
          : confirm.kind === "reset"
            ? "resetDone"
            : "saved",
      )
      setConfirm(null)
      refresh()
    } catch (error) {
      if (isExpired(error)) onExpired()
      else setConfirmError(error)
    } finally {
      setBusy(false)
    }
  }
  const title = {
    overview: t.overviewTitle,
    exhibitors: t.projectsTitle,
    voting: t.votingTitle,
    security: t.securityTitle,
  }[tab]
  const body = {
    overview: t.overviewBody,
    exhibitors: t.projectsBody,
    voting: t.votingBody,
    security: t.securityBody,
  }[tab]
  if (!content)
    return (
      <main className="admin-content">
        <p
          className={error ? "staff-error" : "staff-empty"}
          role={error ? "alert" : "status"}
        >
          {error ? staffError(error, lang) : t.loading}
        </p>
        {Boolean(error) && (
          <button
            className="staff-button staff-button--primary"
            onClick={() => void load()}
          >
            {t.retry}
          </button>
        )}
      </main>
    )
  const status = votingStatus(content.settings)
  const totalVotes = live.data?.categories.reduce(
    (sum, c) => sum + c.exhibitors.reduce((n, e) => n + e.votes, 0),
    0,
  )
  const projects = content.exhibitors.filter(
    (e) =>
      (!filter || e.categories.some((c) => c.id === filter)) &&
      `${exhibitorName(e, lang)} ${e.name} ${e.description}`
        .toLocaleLowerCase()
        .includes(query.trim().toLocaleLowerCase()),
  )
  const perProjectVotes = (id: string) =>
    live.data?.categories.reduce(
      (sum, c) =>
        sum + (c.exhibitors.find((e) => e.exhibitorId === id)?.votes ?? 0),
      0,
    )
  const confirmationTitle =
    confirm?.kind === "delete"
      ? t.removeTitle
      : confirm?.kind === "reset"
        ? t.resetTitle
        : confirm?.kind === "open"
          ? t.openTitle
          : t.closeTitle
  const confirmationBody =
    confirm?.kind === "delete"
      ? t.removeBody
      : confirm?.kind === "reset"
        ? t.resetBody
        : confirm?.kind === "open"
          ? t.openBody
          : t.closeBody
  return (
    <main className={`admin-content admin-content--${tab}`}>
      <header className="admin-page-heading">
        <div>
          <span className="staff-eyebrow">{t.controlRoom}</span>
          <h1>{title}</h1>
          <p>{body}</p>
        </div>
        {tab === "exhibitors" ? (
          <button
            className="staff-button staff-button--primary"
            onClick={() => setEditor({ project: null })}
          >
            <StaffIcon name="plus" size={18} />
            {t.addProject}
          </button>
        ) : tab === "overview" ? (
          <a
            className="staff-button staff-button--outline"
            href={routeUrl("results", event.id)}
          >
            <StaffIcon name="chart" size={18} />
            {t.liveResults}
          </a>
        ) : null}
      </header>
      {Boolean(error) && (
        <p className="staff-error" role="alert">
          {staffError(error, lang)}
        </p>
      )}
      {notice && (
        <div className="staff-toast" role="status">
          <StaffIcon name="check" size={18} />
          {t[notice]}
          <button aria-label={t.close} onClick={() => setNotice(null)}>
            <StaffIcon name="close" size={16} />
          </button>
        </div>
      )}
      {tab === "overview" && (
        <>
          <div className="staff-metrics">
            <section className="staff-metric staff-metric--featured">
              <span>{t.totalVotes}</span>
              <b>
                {totalVotes === undefined
                  ? "—"
                  : numberFormat(totalVotes, lang)}
              </b>
              <StaffIcon name="chart" size={32} />
              <small>
                {live.connection === "live"
                  ? t.connected
                  : live.connection === "offline"
                    ? t.offline
                    : t.polling}
              </small>
            </section>
            <section className="staff-metric">
              <span>{t.totalProjects}</span>
              <b>{numberFormat(content.exhibitors.length, lang)}</b>
              <StaffIcon name="projects" size={30} />
              <button onClick={() => onTab("exhibitors")}>
                {t.manageProjects}
                <span className="flip-rtl">
                  <StaffIcon name="arrow" size={16} />
                </span>
              </button>
            </section>
            <section className="staff-metric">
              <span>{t.totalCategories}</span>
              <b>{numberFormat(content.categories.length, lang)}</b>
              <StaffIcon name="trophy" size={30} />
              <small>{t.category}</small>
            </section>
            <section className="staff-metric">
              <span>{t.votingStatus}</span>
              <b className="staff-metric__status">{t[status]}</b>
              <StaffIcon name="settings" size={30} />
              <button onClick={() => onTab("voting")}>
                {t.voting}
                <span className="flip-rtl">
                  <StaffIcon name="arrow" size={16} />
                </span>
              </button>
            </section>
          </div>
          <header className="staff-section-heading">
            <div>
              <h2>{t.latestStandings}</h2>
              <p>{t.standingsBody}</p>
            </div>
            <a href={routeUrl("results", event.id)}>
              {t.seeAll}
              <span className="flip-rtl">
                <StaffIcon name="arrow" size={16} />
              </span>
            </a>
          </header>
          {Boolean(live.error) && (
            <p className="staff-error" role="alert">
              {t.stale}
            </p>
          )}
          {live.data ? (
            <div className="staff-leaderboards staff-leaderboards--overview">
              {live.data.categories.map((c, index) => (
                <Leaderboard
                  key={c.categoryId}
                  category={c}
                  index={index}
                  lang={lang}
                  categories={content.categories}
                  exhibitors={content.exhibitors}
                  compact
                />
              ))}
            </div>
          ) : (
            <p className="staff-empty" role="status">
              {t.loading}
            </p>
          )}
        </>
      )}
      {tab === "exhibitors" && (
        <section className="staff-panel staff-projects-panel">
          <div className="staff-projects-toolbar">
            <label className="staff-search">
              <StaffIcon name="projects" size={18} />
              <input
                aria-label={t.search}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t.search}
              />
            </label>
            <select
              aria-label={t.allCategories}
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            >
              <option value="">{t.allCategories}</option>
              {content.categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {categoryName(c, lang)}
                </option>
              ))}
            </select>
            <span className="staff-project-count">
              {numberFormat(projects.length, lang)} {t.exhibitors}
            </span>
          </div>
          {projects.length ? (
            <div className="staff-table-wrap">
              <table className="staff-project-table">
                <thead>
                  <tr>
                    <th>{t.name}</th>
                    <th>{t.chooseCategories}</th>
                    <th>{t.totalVotes}</th>
                    <th>
                      <span className="staff-sr-only">{t.edit}</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {projects.map((project) => (
                    <tr key={project.id}>
                      <td>
                        <div className="staff-project-cell">
                          <span
                            className="staff-project-avatar"
                            aria-hidden="true"
                          >
                            <span>
                              {
                                Array.from(
                                  exhibitorName(project, lang).trim(),
                                )[0]
                              }
                            </span>
                            {project.image_url && (
                              <img
                                key={project.image_url}
                                alt=""
                                src={project.image_url}
                                loading="lazy"
                                onError={(e) => {
                                  e.currentTarget.hidden = true
                                }}
                              />
                            )}
                          </span>
                          <div>
                            <b>{exhibitorName(project, lang)}</b>
                            <p>
                              {project.labels?.[lang].description ??
                                project.description}
                            </p>
                          </div>
                        </div>
                      </td>
                      <td>
                        <div className="staff-project-categories">
                          {project.categories.map((c) => {
                            const index = content.categories.findIndex(
                              (x) => x.id === c.id,
                            )
                            return (
                              <span
                                className={`staff-category-badge staff-category-badge--${index}`}
                                key={c.id}
                              >
                                {content.categories[index]
                                  ? categoryName(
                                      content.categories[index],
                                      lang,
                                    )
                                  : c.name}
                              </span>
                            )
                          })}
                        </div>
                      </td>
                      <td className="staff-project-votes">
                        {perProjectVotes(project.id) === undefined
                          ? "—"
                          : numberFormat(perProjectVotes(project.id)!, lang)}
                      </td>
                      <td>
                        <div className="staff-row-actions">
                          <button
                            aria-label={`${t.edit}: ${exhibitorName(project, lang)}`}
                            title={t.edit}
                            className="staff-icon-button"
                            onClick={() => setEditor({ project })}
                          >
                            <StaffIcon name="edit" size={18} />
                          </button>
                          <button
                            aria-label={`${t.remove}: ${exhibitorName(project, lang)}`}
                            title={t.remove}
                            className="staff-icon-button staff-icon-button--danger"
                            onClick={() =>
                              requestConfirm({ kind: "delete", project })
                            }
                          >
                            <StaffIcon name="trash" size={18} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="staff-empty">{t.noMatches}</p>
          )}
        </section>
      )}
      {tab === "voting" && (
        <VotingSettings
          settings={content.settings}
          event={event.id}
          token={token}
          lang={lang}
          onRefresh={refresh}
          onExpired={onExpired}
          onConfirm={(kind) => requestConfirm({ kind })}
        />
      )}
      {tab === "security" && (
        <SecurityPanel
          token={token}
          lang={lang}
          profile={profile}
          onProfile={onProfile}
          onExpired={onExpired}
        />
      )}
      {editor && (
        <ExhibitorEditor
          initial={editor.project}
          categories={content.categories}
          token={token}
          event={event.id}
          lang={lang}
          onExpired={onExpired}
          onClose={() => {
            setEditor(null)
            refresh()
          }}
          onSaved={() => {
            setEditor(null)
            setNotice("projectSaved")
            refresh()
          }}
        />
      )}
      {confirm && (
        <StaffModal
          title={confirmationTitle}
          lang={lang}
          busy={busy}
          onClose={() => setConfirm(null)}
        >
          <div className="staff-modal__content">
            <p className="staff-muted">{confirmationBody}</p>
            {confirm.project && (
              <strong className="staff-confirm-project">
                {exhibitorName(confirm.project, lang)}
              </strong>
            )}
            {confirm.kind === "reset" && (
              <label className="staff-field">
                <span>{t.resetConfirm}</span>
                <input
                  name="resetConfirmation"
                  dir="ltr"
                  autoComplete="off"
                  value={confirmText}
                  onChange={(e) => setConfirmText(e.target.value)}
                />
              </label>
            )}
            {Boolean(confirmError) && (
              <p className="staff-error" role="alert">
                {staffError(confirmError, lang)}
              </p>
            )}
          </div>
          <footer className="staff-modal__footer">
            <button
              className="staff-button staff-button--subtle"
              disabled={busy}
              onClick={() => setConfirm(null)}
            >
              {t.cancel}
            </button>
            <button
              className={`staff-button ${
                confirm.kind === "delete" || confirm.kind === "reset"
                  ? "staff-button--danger"
                  : "staff-button--primary"
              }`}
              disabled={
                busy ||
                (confirm.kind === "reset" && confirmText.trim() !== "RESET")
              }
              onClick={() => void commit()}
            >
              {busy
                ? t.saving
                : confirm.kind === "delete"
                  ? t.remove
                  : confirm.kind === "reset"
                    ? t.reset
                    : confirm.kind === "open"
                      ? t.openVoting
                      : t.closeVoting}
            </button>
          </footer>
        </StaffModal>
      )}
    </main>
  )
}
