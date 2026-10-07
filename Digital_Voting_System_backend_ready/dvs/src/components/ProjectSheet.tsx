import { type Language, type Maker } from "../data/config";
import { copy } from "../i18n/copy";
import { Icon } from "./Icon";
import { Button } from "./Button";

export function ProjectSheet({
  maker,
  lang,
  disabled,
  selected,
  onClose,
  onSelect,
}: {
  maker: Maker;
  lang: Language;
  disabled: boolean;
  selected: boolean;
  onClose: () => void;
  onSelect: () => void;
}) {
  const t = copy[lang];
  return (
    <div className="sheet-backdrop" onMouseDown={onClose}>
      <section aria-modal="true" className="sheet project-sheet" onMouseDown={(event) => event.stopPropagation()} role="dialog">
        <div className="sheet-handle" />
        <div className="project-sheet__image">
          <img alt={maker.imageAlt[lang]} src={maker.image} />
          <Button aria-label={t.close} className="close-button close-button--overlay" onClick={onClose} variant="ghost">
            <Icon name="close" />
          </Button>
        </div>
        <div className="project-sheet__body">
          <span className="maker-team">{maker.team[lang]}</span>
          <h2>{maker.title[lang]}</h2>
          <span className="detail-label">{t.aboutProject}</span>
          <p>{maker.long[lang]}</p>
          <Button
            className="wide-button"
            disabled={disabled}
            onClick={() => {
              onSelect();
              onClose();
            }}
          >
            {selected ? t.selected : disabled ? t.voted : t.choose}
            {selected && <Icon name="check" />}
          </Button>
        </div>
      </section>
    </div>
  );
}
