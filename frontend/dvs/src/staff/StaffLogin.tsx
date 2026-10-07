import { useState, type FormEvent } from "react"
import type { Language } from "../data/config"
import { BrandHeader } from "../components/BrandHeader"
import { Organizer } from "../components/Organizer"
import { staffCopy } from "../i18n/staff"
import { BackendError } from "../services/backend"
import { normalizeDigits } from "../lib/digits"
import { staffApi, staffMode } from "../services/staff"
import type { StaffSession } from "../services/staff-types"
import gear from "../imports/innovation-symbol-dark-red-outline.svg"
import StaffIcon from "./StaffIcon"
import { routeUrl, staffError } from "./utils"

export default function StaffLogin({
  lang,
  setLang,
  onAuthenticated,
  notice,
}: {
  lang: Language
  setLang: (lang: Language) => void
  onAuthenticated: (session: StaffSession) => void
  notice: string
}) {
  const t = staffCopy[lang]
  const [username, setUsername] = useState("")
  const [password, setPassword] = useState("")
  const [show, setShow] = useState(false)
  const [mfaRequired, setMfaRequired] = useState(false)
  const [code, setCode] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setBusy(true)
    setError("")
    try {
      onAuthenticated(
        await staffApi.login(
          username,
          password,
          mfaRequired ? code : undefined,
        ),
      )
    } catch (error) {
      if (error instanceof BackendError && error.code === "MFA_REQUIRED") {
        setMfaRequired(true)
        setError("")
      } else setError(staffError(error, lang))
    } finally {
      setBusy(false)
    }
  }
  return (
    <main className="staff-login">
      <section className="staff-login__brand brand-surface">
        <BrandHeader
          lang={lang}
          onLanguage={() => setLang(lang === "ar" ? "en" : "ar")}
        />
        <div className="staff-login__story">
          <img alt="" aria-hidden="true" src={gear} />
          <span className="staff-eyebrow">THE MAKER COLLECTIVE 2026</span>
          <h1>{t.loginTitle}</h1>
          <p>{t.loginBody}</p>
        </div>
        <Organizer dark lang={lang} />
      </section>
      <section className="staff-login__surface">
        <form className="staff-login__form" onSubmit={submit}>
          <span className="staff-login__lock">
            <StaffIcon name="lock" size={26} />
          </span>
          <span className="staff-eyebrow">{t.staffOnly}</span>
          <h2>{t.signIn}</h2>
          {notice && (
            <p className="staff-notice" role="status">
              {notice}
            </p>
          )}
          <label className="staff-field">
            <span>{t.username}</span>
            <input
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              name="username"
              dir="ltr"
              required
              maxLength={255}
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              disabled={busy}
            />
          </label>
          <label className="staff-field">
            <span>{t.password}</span>
            <span className="staff-password">
              <input
                autoComplete="current-password"
                name="password"
                dir="ltr"
                required
                maxLength={128}
                type={show ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={busy}
              />
              <button
                aria-label={show ? t.hide : t.show}
                type="button"
                onClick={() => setShow(!show)}
              >
                {show ? t.hide : t.show}
              </button>
            </span>
          </label>
          {mfaRequired && (
            <label className="staff-field">
              <span>{t.mfaCode}</span>
              <p className="staff-hint">{t.mfaPrompt}</p>
              <input
                autoComplete="one-time-code"
                autoFocus
                name="mfaCode"
                dir="ltr"
                inputMode="numeric"
                pattern="[0-9]{6}"
                required
                maxLength={6}
                value={code}
                onChange={(e) =>
                  setCode(normalizeDigits(e.target.value).replace(/\D/g, ""))
                }
                disabled={busy}
              />
            </label>
          )}
          {Boolean(error) && (
            <p className="staff-error" role="alert">
              {error}
            </p>
          )}
          <button
            className="staff-button staff-button--primary staff-button--wide"
            disabled={busy}
          >
            {busy ? t.signingIn : t.signIn}
            <span className="flip-rtl">
              <StaffIcon name="arrow" size={18} />
            </span>
          </button>
          {staffMode === "mock" && (
            <div className="staff-demo-login">
              <strong>{t.demo}</strong>
              <p dir="ltr">{t.demoLogin}</p>
            </div>
          )}
          <a className="staff-back-link" href={routeUrl("")}>
            {t.backVote}
          </a>
        </form>
        <Organizer lang={lang} />
      </section>
    </main>
  )
}
