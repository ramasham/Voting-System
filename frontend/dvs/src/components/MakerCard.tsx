import { type Language, type Maker } from "../data/config";
import { copy } from "../i18n/copy";
import { Icon } from "./Icon";
import { ProjectThumbnail } from "./ProjectThumbnail";

export function MakerCard({
  maker,
  lang,
  selected,
  voted,
  disabled,
  onDetails,
}: {
  maker: Maker;
  lang: Language;
  selected: boolean;
  voted: boolean;
  disabled: boolean;
  onDetails: () => void;
}) {
  const t = copy[lang];
  return (
    <button
      aria-haspopup="dialog"
      className={`maker-card ${selected ? "is-selected" : ""} ${disabled ? "is-disabled" : ""}`}
      onClick={onDetails}
      type="button"
    >
      <ProjectThumbnail className="maker-image-wrap" lang={lang} maker={maker} />
      <span className="maker-content">
        <span className="maker-team">{maker.team[lang]}</span>
        <span className="maker-title">{maker.title[lang]}</span>
        <span className={`maker-details ${selected || voted ? "maker-details--selected" : ""}`}>
          {(selected || voted) && <Icon name="check" size={14} />}
          {voted ? t.voted : selected ? t.selected : t.viewDetails}
        </span>
      </span>
      <span aria-hidden="true" className="maker-open">
        <span className="flip-rtl"><Icon name="chevron" size={18} /></span>
      </span>
    </button>
  );
}
