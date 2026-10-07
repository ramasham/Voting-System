import { useId, useLayoutEffect, useRef, type ReactNode } from "react"
import type { Language } from "../data/config"
import { staffCopy } from "../i18n/staff"
import StaffIcon from "./StaffIcon"
export default function StaffModal({
  title,
  lang,
  onClose,
  busy = false,
  children,
  className = "",
}: {
  title: string
  lang: Language
  onClose: () => void
  busy?: boolean
  children: ReactNode
  className?: string
}) {
  const ref = useRef<HTMLDialogElement>(null)
  const id = useId()
  useLayoutEffect(() => {
    const dialog = ref.current
    const overflow = document.body.style.overflow
    dialog?.showModal()
    document.body.style.overflow = "hidden"
    return () => {
      dialog?.close()
      document.body.style.overflow = overflow
    }
  }, [])
  return (
    <dialog
      aria-labelledby={id}
      className={`staff-modal ${className}`}
      ref={ref}
      onCancel={(event) => {
        event.preventDefault()
        if (!busy) onClose()
      }}
      onClick={(event) => {
        if (event.target !== event.currentTarget || busy) return
        const r = event.currentTarget.getBoundingClientRect()
        if (
          event.clientX < r.left ||
          event.clientX > r.right ||
          event.clientY < r.top ||
          event.clientY > r.bottom
        )
          onClose()
      }}
      onKeyDown={(event) => {
        if (event.key !== "Tab") return
        const controls = [
          ...event.currentTarget.querySelectorAll<HTMLElement>(
            "button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [tabindex='0']",
          ),
        ].filter((el) => el.getClientRects().length)
        const first = controls[0]
        const last = controls[controls.length - 1]
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault()
          last?.focus()
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault()
          first?.focus()
        }
      }}
    >
      <header className="staff-modal__header">
        <h2 id={id}>{title}</h2>
        <button
          aria-label={staffCopy[lang].close}
          className="staff-icon-button"
          disabled={busy}
          onClick={onClose}
          type="button"
        >
          <StaffIcon name="close" />
        </button>
      </header>
      {children}
    </dialog>
  )
}
