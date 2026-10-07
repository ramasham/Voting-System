import { type Language, type Maker } from "../data/config";
import { copy } from "../i18n/copy";
import { Icon } from "./Icon";
import { Button } from "./Button";

export function MakerCard({
  maker,
  lang,
  selected,
  voted,
  disabled,
  onDetails,
  onSelect,
}: {
  maker: Maker;
  lang: Language;
  selected: boolean;
  voted: boolean;
  disabled: boolean;
  onDetails: () => void;
  onSelect: () => void;
}) {
  const t = copy[lang];
  return (
    <article
      className={`maker-card ${selected ? "is-selected" : ""} ${disabled ? "is-disabled" : ""}`}
      onClick={onDetails}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onDetails();
        }
      }}
      role="button"
      tabIndex={0}
    >
      <div className="maker-image-wrap">
        <img alt={maker.imageAlt[lang]} className="maker-image" src={maker.image} />
        {voted && <span className="voted-badge"><Icon name="check" size={16} />{t.voted}</span>}
      </div>
      <div className="maker-content">
        <span className="maker-team">{maker.team[lang]}</span>
        <h3>{maker.title[lang]}</h3>
        <p>{maker.short[lang]}</p>
        <Button
          className="select-button"
          disabled={disabled}
          onClick={(event) => {
            event.stopPropagation();
            onSelect();
          }}
          variant={selected ? "primary" : "secondary"}
        >
          {voted ? t.voted : selected ? t.selected : t.choose}
          {(selected || voted) && <Icon name="check" size={18} />}
        </Button>
      </div>
    </article>
  );
}
