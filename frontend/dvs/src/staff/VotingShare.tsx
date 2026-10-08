import { useRef, useState } from "react"
import { QRCodeSVG } from "qrcode.react"
import type { Language } from "../data/config"
import { staffCopy } from "../i18n/staff"
import StaffIcon from "./StaffIcon"
import { downloadBlob } from "./utils"

export default function VotingShare({
  event,
  lang,
  locationEnabled = false,
}: {
  event: string
  lang: Language
  locationEnabled?: boolean
}) {
  const t = staffCopy[lang]
  const qr = useRef<SVGSVGElement>(null)
  const [notice, setNotice] = useState("")
  const [error, setError] = useState("")
  const url = new URL(import.meta.env.BASE_URL, window.location.origin)
  url.searchParams.set("event", event)
  const visitorUrl = url.href
  const local = ["localhost", "127.0.0.1", "[::1]", "0.0.0.0"].includes(
    url.hostname,
  )
  const copyLink = async () => {
    setError("")
    setNotice("")
    try {
      await navigator.clipboard.writeText(visitorUrl)
      setNotice(t.linkCopied)
    } catch {
      setError(t.copyLinkError)
    }
  }
  const download = () => {
    if (!qr.current) return
    downloadBlob(
      new Blob([new XMLSerializer().serializeToString(qr.current)], {
        type: "image/svg+xml;charset=utf-8",
      }),
      `voting-qr-event-${event}.svg`,
    )
  }
  return (
    <section className="staff-panel staff-share">
      <div className="staff-share__content">
        <h2>{t.shareVoting}</h2>
        <p className="staff-muted">{t.shareVotingBody}</p>
        <label className="staff-field">
          <span>{t.votingLink}</span>
          <input
            type="url"
            dir="ltr"
            value={visitorUrl}
            readOnly
            onFocus={(e) => e.currentTarget.select()}
          />
        </label>
        {local && <p className="staff-hint">{t.shareLocalHint}</p>}
        {locationEnabled && url.protocol !== "https:" && (
          <p className="staff-error" role="alert">{t.shareHttpsHint}</p>
        )}
        <div className="staff-share__actions">
          <button
            className="staff-button staff-button--outline"
            type="button"
            onClick={() => void copyLink()}
            disabled={local}
          >
            {t.copyLink}
          </button>
          <button
            className="staff-button staff-button--primary"
            type="button"
            onClick={download}
            disabled={local}
          >
            <StaffIcon name="download" size={18} />
            {t.downloadQr}
          </button>
        </div>
        {notice && (
          <p className="staff-success" role="status">
            {notice}
          </p>
        )}
        {error && (
          <p className="staff-error" role="alert">
            {error}
          </p>
        )}
      </div>
      <div className="staff-share__qr">
        <QRCodeSVG
          ref={qr}
          value={visitorUrl}
          size={224}
          level="M"
          marginSize={4}
          title={t.votingQr}
        />
        <p className="staff-hint">{t.scanToVote}</p>
      </div>
    </section>
  )
}
