import { useId, useLayoutEffect, useRef } from "react";
import { type Language, type Maker } from "../data/config";
import { copy } from "../i18n/copy";
import { Icon } from "./Icon";
import { Button } from "./Button";
import { ProjectThumbnail } from "./ProjectThumbnail";

export function ProjectSheet({
  maker,
  lang,
  disabled,
  selected,
  voted,
  onClose,
  onSelect,
}: {
  maker: Maker;
  lang: Language;
  disabled: boolean;
  selected: boolean;
  voted: boolean;
  onClose: () => void;
  onSelect: () => void;
}) {
  const t = copy[lang];
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const names = (maker.members ?? [])
    .map((member) => member[lang] || member[lang === "ar" ? "en" : "ar"])
    .filter((name) => name.trim());

  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    const previousOverflow = document.body.style.overflow;
    dialog?.showModal();
    document.body.style.overflow = "hidden";
    return () => {
      dialog?.close();
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  return (
    <dialog
      aria-labelledby={titleId}
      className="project-sheet"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target !== event.currentTarget) return;
        const bounds = event.currentTarget.getBoundingClientRect();
        if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) {
          onClose();
        }
      }}
      onKeyDown={(event) => {
        if (event.key !== "Tab") return;
        const controls = event.currentTarget.querySelectorAll<HTMLElement>("button:not(:disabled), [tabindex='0']");
        const first = controls[0];
        const last = controls[controls.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }}
      ref={dialogRef}
    >
      <header className="project-sheet__header">
        <ProjectThumbnail className="project-sheet__thumbnail" lang={lang} maker={maker} />
        <div>
          <span className="maker-team">{maker.team[lang]}</span>
          <h2 id={titleId}>{maker.title[lang]}</h2>
        </div>
        <Button aria-label={t.close} className="close-button" onClick={onClose} type="button" variant="ghost">
          <Icon name="close" size={20} />
        </Button>
      </header>
      <div className="project-sheet__body" tabIndex={0}>
        <section className="project-description">
          <h3 className="detail-label">{t.aboutProject}</h3>
          <p>{maker.long[lang]}</p>
        </section>
        <section className="project-team">
          <h3 className="detail-label">{t.teamMembers}</h3>
          {names.length ? (
            <ul className="team-members">
              {names.map((name, index) => (
                <li key={`${index}-${name}`}>
                  <span aria-hidden="true" className="team-member__initial">{Array.from(name.trim())[0]}</span>
                  <span>{name}</span>
                </li>
              ))}
            </ul>
          ) : <p>{t.teamMembersUnavailable}</p>}
        </section>
      </div>
      <footer className="project-sheet__footer">
        <Button
          className="wide-button"
          disabled={disabled}
          onClick={() => {
            onSelect();
            onClose();
          }}
          type="button"
        >
          {voted ? t.voted : selected ? t.selected : t.choose}
          {(selected || voted) && <Icon name="check" size={18} />}
        </Button>
      </footer>
    </dialog>
  );
}
