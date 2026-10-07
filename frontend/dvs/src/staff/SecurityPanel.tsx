import { useState, type FormEvent } from "react"
import type { Language } from "../data/config"
import { normalizeDigits } from "../lib/digits"
import { staffCopy } from "../i18n/staff"
import { staffApi } from "../services/staff"
import type { MfaSetup, StaffProfile } from "../services/staff-types"
import StaffIcon from "./StaffIcon"
import StaffModal from "./StaffModal"
import { isExpired, staffError } from "./utils"
export default function SecurityPanel({
  profile,
  token,
  lang,
  onProfile,
  onExpired,
}: {
  profile: StaffProfile
  token: string
  lang: Language
  onProfile: (profile: StaffProfile) => void
  onExpired: () => void
}) {
  const t = staffCopy[lang]
  const [password, setPassword] = useState("")
  const [code, setCode] = useState("")
  const [setup, setSetup] = useState<MfaSetup | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const [copied, setCopied] = useState(false)
  const start = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError("")
    try {
      setSetup(await staffApi.setupMfa(token, password))
      setPassword("")
    } catch (error) {
      if (isExpired(error)) onExpired()
      else setError(staffError(error, lang))
    } finally {
      setBusy(false)
    }
  }
  const confirm = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError("")
    try {
      await staffApi.confirmMfa(token, code)
      setSetup(null)
      setCode("")
      onProfile({ ...profile, mfa_enabled: true })
    } catch (error) {
      if (isExpired(error)) onExpired()
      else setError(staffError(error, lang))
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="staff-settings-grid">
      <section className="staff-panel staff-security-card">
        <span className="staff-feature-icon">
          <StaffIcon name="shield" size={28} />
        </span>
        <h2>{t.mfaTitle}</h2>
        <p>{t.mfaBody}</p>
        <span
          className={`staff-status ${
            profile.mfa_enabled ? "staff-status--open" : "staff-status--closed"
          }`}
        >
          <i />
          {profile.mfa_enabled ? t.mfaOn : t.mfaOff}
        </span>
        {!profile.mfa_enabled &&
          (profile.mfa_available ? (
            <form onSubmit={start}>
              <label className="staff-field">
                <span>{t.currentPassword}</span>
                <input
                  autoComplete="current-password"
                  type="password"
                  value={password}
                  required
                  maxLength={128}
                  onChange={(e) => setPassword(e.target.value)}
                  disabled={busy}
                />
              </label>
              <button
                className="staff-button staff-button--primary"
                disabled={busy}
              >
                {busy ? t.saving : t.setupMfa}
              </button>
            </form>
          ) : (
            <p className="staff-hint">{t.mfaUnavailable}</p>
          ))}
        {!setup && error && (
          <p className="staff-error" role="alert">
            {error}
          </p>
        )}
      </section>
      <section className="staff-panel staff-protection-card">
        <span className="staff-feature-icon">
          <StaffIcon name="lock" size={28} />
        </span>
        <h2>{t.protected}</h2>
        <p>{t.protectedBody}</p>
        <div className="staff-account-detail">
          <span>{t.account}</span>
          <b dir="ltr">{profile.username}</b>
        </div>
      </section>
      {setup && (
        <StaffModal
          title={t.setupTitle}
          lang={lang}
          busy={busy}
          onClose={() => {
            setSetup(null)
            setCode("")
            setError("")
          }}
        >
          <form onSubmit={confirm} className="staff-modal__form">
            <div className="staff-modal__content">
              <p className="staff-muted">{t.setupBody}</p>
              <label className="staff-field">
                <span>{t.setupKey}</span>
                <input
                  readOnly
                  dir="ltr"
                  value={setup.secret}
                  onFocus={(e) => e.currentTarget.select()}
                />
              </label>
              <button
                className="staff-button staff-button--outline"
                type="button"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(setup.secret)
                    setCopied(true)
                  } catch {
                    setCopied(false)
                  }
                }}
              >
                {copied ? t.copied : t.copy}
              </button>
              <label className="staff-field">
                <span>{t.mfaCode}</span>
                <input
                  name="mfaCode"
                  required
                  inputMode="numeric"
                  dir="ltr"
                  autoComplete="one-time-code"
                  pattern="[0-9]{6}"
                  maxLength={6}
                  value={code}
                  onChange={(e) =>
                    setCode(normalizeDigits(e.target.value).replace(/\D/g, ""))
                  }
                />
              </label>
              {Boolean(error) && (
                <p className="staff-error" role="alert">
                  {error}
                </p>
              )}
            </div>
            <footer className="staff-modal__footer">
              <button
                className="staff-button staff-button--primary"
                disabled={busy}
              >
                {busy ? t.saving : t.enableMfa}
              </button>
            </footer>
          </form>
        </StaffModal>
      )}
    </div>
  )
}
