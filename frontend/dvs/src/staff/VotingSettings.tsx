import { useState, type FormEvent } from "react"
import type { Language } from "../data/config"
import { staffCopy } from "../i18n/staff"
import { staffApi, staffMode } from "../services/staff"
import type { EventSettings } from "../services/staff-types"
import StaffIcon from "./StaffIcon"
import {
  ammanInput,
  ammanIso,
  downloadBlob,
  isExpired,
  staffError,
  votingStatus,
} from "./utils"
export default function VotingSettings({
  settings,
  token,
  event,
  lang,
  onRefresh,
  onConfirm,
  onExpired,
}: {
  settings: EventSettings
  token: string
  event: string
  lang: Language
  onRefresh: () => void
  onConfirm: (action: "open" | "close" | "reset") => void
  onExpired: () => void
}) {
  const t = staffCopy[lang]
  const [start, setStart] = useState(ammanInput(settings.voting_start_at))
  const [end, setEnd] = useState(ammanInput(settings.voting_end_at))
  const [ranges, setRanges] = useState(settings.allowed_ip_ranges ?? "")
  const [location, setLocation] = useState(settings.location_enabled)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const [notice, setNotice] = useState("")
  const status = votingStatus(settings)
  const perform = async (action: () => Promise<void>, message: string) => {
    setBusy(true)
    setError("")
    setNotice("")
    try {
      await action()
      setNotice(message)
      onRefresh()
    } catch (error) {
      if (isExpired(error)) onExpired()
      else setError(staffError(error, lang))
    } finally {
      setBusy(false)
    }
  }
  const save = (e: FormEvent) => {
    e.preventDefault()
    if (start && end && start >= end) {
      setError(t.invalidWindow)
      return
    }
    void perform(
      () =>
        staffApi.updateSettings(token, event, {
          votingStartAt: ammanIso(start),
          votingEndAt: ammanIso(end),
          allowedIpRanges: ranges,
          locationEnabled: location,
        }),
      t.saved,
    )
  }
  const anchor = () => {
    if (!navigator.geolocation) {
      setError(t.locationError)
      return
    }
    setBusy(true)
    setError("")
    navigator.geolocation.getCurrentPosition(
      (p) => {
        void perform(
          () =>
            staffApi.anchor(token, event, {
              latitude: p.coords.latitude,
              longitude: p.coords.longitude,
              accuracy: p.coords.accuracy,
            }),
          t.saved,
        )
      },
      () => {
        setBusy(false)
        setError(t.locationError)
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 },
    )
  }
  return (
    <div className="staff-voting-settings">
      <section className="staff-panel staff-voting-control">
        <div>
          <span className="staff-eyebrow">{t.votingStatus}</span>
          <h2>{t[status]}</h2>
          <p>{t.timezone}</p>
        </div>
        <span className={`staff-status staff-status--${status}`}>
          <i />
          {t[status]}
        </span>
        <button
          className={`staff-button ${
            settings.voting_enabled
              ? "staff-button--outline"
              : "staff-button--primary"
          }`}
          onClick={() => onConfirm(settings.voting_enabled ? "close" : "open")}
        >
          <StaffIcon
            name={settings.voting_enabled ? "lock" : "check"}
            size={18}
          />
          {settings.voting_enabled ? t.closeVoting : t.openVoting}
        </button>
      </section>
      <form onSubmit={save} className="staff-settings-grid">
        <section className="staff-panel">
          <span className="staff-feature-icon">
            <StaffIcon name="settings" size={26} />
          </span>
          <h2>{t.schedule}</h2>
          <p className="staff-muted">{t.timezone}</p>
          <label className="staff-field">
            <span>{t.startAt}</span>
            <input
              type="datetime-local"
              dir="ltr"
              value={start}
              onChange={(e) => setStart(e.target.value)}
              disabled={busy}
            />
          </label>
          <label className="staff-field">
            <span>{t.endAt}</span>
            <input
              type="datetime-local"
              dir="ltr"
              value={end}
              min={start || undefined}
              onChange={(e) => setEnd(e.target.value)}
              disabled={busy}
            />
          </label>
        </section>
        <section className="staff-panel">
          <span className="staff-feature-icon">
            <StaffIcon name="pin" size={26} />
          </span>
          <h2>{t.venue}</h2>
          <p className="staff-muted">{t.venueBody}</p>
          <label className="staff-field">
            <span>{t.ipRanges}</span>
            <textarea
              name="ipRanges"
              dir="ltr"
              value={ranges}
              rows={2}
              maxLength={4096}
              onChange={(e) => setRanges(e.target.value)}
              disabled={busy}
            />
            <small>{t.ipHint}</small>
          </label>
          <label className="staff-switch">
            <input
              type="checkbox"
              checked={location}
              onChange={(e) => setLocation(e.target.checked)}
              disabled={busy}
            />
            <span>{t.locationEnabled}</span>
          </label>
          {location && (
            <div className="staff-location-status">
              <span
                className={`staff-status ${
                  settings.location_ready
                    ? "staff-status--open"
                    : "staff-status--scheduled"
                }`}
              >
                <i />
                {settings.location_ready ? t.ready : t.learning}
              </span>
              <p className="staff-hint">{t.anchorHint}</p>
              <button
                className="staff-button staff-button--outline"
                type="button"
                disabled={busy || staffMode === "mock"}
                onClick={anchor}
              >
                <StaffIcon name="pin" size={18} />
                {t.captureAnchor}
              </button>
            </div>
          )}
        </section>
        <div className="staff-settings-submit">
          {Boolean(error) && (
            <p className="staff-error" role="alert">
              {error}
            </p>
          )}
          {notice && (
            <p className="staff-success" role="status">
              {notice}
            </p>
          )}
          <button
            className="staff-button staff-button--primary"
            disabled={busy}
          >
            {busy ? t.saving : t.save}
            <StaffIcon name="check" size={18} />
          </button>
        </div>
      </form>
      <section className="staff-panel staff-result-tools">
        <div>
          <h2>{t.resultsTools}</h2>
          <p className="staff-muted">{t.exportBody}</p>
        </div>
        <div>
          <button
            className="staff-button staff-button--outline"
            disabled={busy}
            onClick={() =>
              void perform(
                async () =>
                  downloadBlob(
                    await staffApi.export(token, event),
                    `event-${event}-results.csv`,
                  ),
                "",
              )
            }
          >
            <StaffIcon name="download" size={18} />
            {t.export}
          </button>
          <button
            className="staff-button staff-button--danger"
            title={settings.voting_enabled ? t.resetClosed : undefined}
            disabled={settings.voting_enabled || busy}
            onClick={() => onConfirm("reset")}
          >
            <StaffIcon name="trash" size={18} />
            {t.reset}
          </button>
        </div>
      </section>
    </div>
  )
}
