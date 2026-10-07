import { type Language, type Maker } from "../data/config";
import { copy } from "../i18n/copy";
import { Icon } from "./Icon";
import { Button } from "./Button";

export function ConfirmSheet({
  maker,
  lang,
  onCancel,
  onConfirm,
  busy = false,
  error = "",
}: {
  maker: Maker;
  lang: Language;
  onCancel: () => void;
  onConfirm: () => void;
  busy?: boolean;
  error?: string;
}) {
  const t = copy[lang];
  return (
    <div className="sheet-backdrop" onMouseDown={onCancel}>
      <section aria-modal="true" className="sheet confirm-sheet" onMouseDown={(event) => event.stopPropagation()} role="alertdialog">
        <div className="sheet-handle" />
        <div className="confirm-mark"><Icon name="check" size={28} /></div>
        <h2>{t.finalTitle}</h2>
        <p>{t.finalBody}</p>
        <div className="confirm-choice">
          <img alt="" src={maker.image} />
          <div>
            <span>{maker.team[lang]}</span>
            <b>{maker.title[lang]}</b>
          </div>
        </div>
        <div className="final-note"><Icon name="lock" size={18} /><span>{t.finalNote}</span></div>
        {error && <small className="field-error vote-error" role="alert">{error}</small>}
        <Button className="wide-button" disabled={busy} onClick={onConfirm}>{busy ? t.submitting : error ? t.retry : t.confirm}</Button>
        <Button className="wide-button" disabled={busy} onClick={onCancel} variant="ghost">{t.cancel}</Button>
      </section>
    </div>
  );
}
