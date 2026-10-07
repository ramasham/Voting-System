import { useEffect, useState, type FormEvent } from "react"
import type { Language } from "../data/config"
import { staffCopy } from "../i18n/staff"
import { staffApi } from "../services/staff"
import {
  categoryName,
  exhibitorName,
  type StaffCategory,
  type StaffExhibitor,
} from "../services/staff-types"
import StaffModal from "./StaffModal"
import StaffIcon from "./StaffIcon"
import { isExpired, staffError } from "./utils"
export default function ExhibitorEditor({
  initial,
  categories,
  token,
  event,
  lang,
  onClose,
  onSaved,
  onExpired,
}: {
  initial: StaffExhibitor | null
  categories: StaffCategory[]
  token: string
  event: string
  lang: Language
  onClose: () => void
  onSaved: () => void
  onExpired: () => void
}) {
  const t = staffCopy[lang]
  const [id, setId] = useState(initial?.id)
  const [name, setName] = useState(initial ? exhibitorName(initial, lang) : "")
  const [description, setDescription] = useState(
    initial?.labels?.[lang].description ?? initial?.description ?? "",
  )
  const [imageUrl, setImageUrl] = useState(
    initial?.image_url.startsWith("data:") ? "" : (initial?.image_url ?? ""),
  )
  const [categoryIds, setCategoryIds] = useState(
    initial?.categories.map((c) => c.id) ?? [],
  )
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  useEffect(() => {
    if (!file) {
      setPreview("")
      return
    }
    const url = URL.createObjectURL(file)
    setPreview(url)
    return () => URL.revokeObjectURL(url)
  }, [file])
  const submit = async (eventObject: FormEvent) => {
    eventObject.preventDefault()
    setError("")
    if (!name.trim() || !categoryIds.length) {
      setError(t.validation)
      return
    }
    setBusy(true)
    try {
      const saved = await staffApi.saveExhibitor(
        token,
        event,
        {
          name,
          description,
          categoryIds,
          imageUrl: imageUrl.trim() || initial?.image_url || "",
        },
        id,
      )
      setId(saved.id)
      if (file) {
        try {
          await staffApi.uploadPhoto(token, event, saved.id, file)
        } catch (error) {
          if (isExpired(error)) onExpired()
          setError(t.photoFailed)
          return
        }
      }
      onSaved()
    } catch (error) {
      if (isExpired(error)) onExpired()
      else setError(staffError(error, lang))
    } finally {
      setBusy(false)
    }
  }
  const visual = preview || imageUrl || initial?.image_url
  return (
    <StaffModal
      lang={lang}
      title={initial ? t.editProject : t.addProject}
      onClose={onClose}
      busy={busy}
      className="staff-project-editor"
    >
      <form onSubmit={submit} className="staff-modal__form">
        <div className="staff-modal__content">
          <div className="staff-photo-field">
            <span className="staff-photo-preview" aria-hidden="true">
              <StaffIcon name="projects" size={30} />
              {visual && (
                <img
                  alt=""
                  key={visual}
                  src={visual}
                  onError={(e) => {
                    e.currentTarget.hidden = true
                  }}
                />
              )}
            </span>
            <div>
              <strong>{t.photo}</strong>
              <label className="staff-button staff-button--outline staff-photo-picker">
                <StaffIcon name="upload" size={16} />
                {t.upload}
                <input
                  aria-label={t.photo}
                  disabled={busy}
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  onChange={(e) => {
                    const value = e.target.files?.[0]
                    if (!value) return
                    if (
                      !["image/png", "image/jpeg", "image/webp"].includes(
                        value.type,
                      ) ||
                      value.size > 2 * 1024 * 1024
                    ) {
                      setError(t.invalidPhoto)
                      e.target.value = ""
                      return
                    }
                    setError("")
                    setFile(value)
                  }}
                />
              </label>
              <small>{file?.name ?? t.photoHint}</small>
            </div>
          </div>
          <label className="staff-field">
            <span>{t.name}</span>
            <input
              name="projectName"
              required
              maxLength={255}
              value={name}
              disabled={busy}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <label className="staff-field">
            <span>{t.description}</span>
            <textarea
              name="description"
              rows={4}
              maxLength={5000}
              value={description}
              disabled={busy}
              onChange={(e) => setDescription(e.target.value)}
            />
          </label>
          <fieldset className="staff-category-options">
            <legend>{t.chooseCategories}</legend>
            <p className="staff-hint">{t.chooseCategoriesHint}</p>
            {categories.map((c, index) => (
              <label
                className={`staff-category-option staff-category-option--${index}`}
                key={c.id}
              >
                <input
                  type="checkbox"
                  disabled={busy}
                  checked={categoryIds.includes(c.id)}
                  onChange={(e) =>
                    setCategoryIds((current) =>
                      e.target.checked
                        ? [...current, c.id]
                        : current.filter((id) => id !== c.id),
                    )
                  }
                />
                <span>{categoryName(c, lang)}</span>
              </label>
            ))}
          </fieldset>
          <label className="staff-field">
            <span>{t.imageUrl}</span>
            <input
              name="imageUrl"
              type="url"
              dir="ltr"
              value={imageUrl}
              disabled={busy || Boolean(file)}
              maxLength={500}
              onChange={(e) => setImageUrl(e.target.value)}
              placeholder="https://…"
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
            className="staff-button staff-button--subtle"
            disabled={busy}
            type="button"
            onClick={onClose}
          >
            {t.cancel}
          </button>
          <button
            className="staff-button staff-button--primary"
            disabled={busy}
          >
            {busy ? t.saving : t.save}
            <StaffIcon name="check" size={18} />
          </button>
        </footer>
      </form>
    </StaffModal>
  )
}
