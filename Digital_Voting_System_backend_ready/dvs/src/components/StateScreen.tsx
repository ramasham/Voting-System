import { type ReactNode } from "react";
import { type Language } from "../data/config";
import { copy } from "../i18n/copy";
import { Icon } from "./Icon";
import { Button } from "./Button";
import { BrandHeader } from "./BrandHeader";
import { Organizer } from "./Organizer";
import { Frame } from "./Frame";

type Tone = "purple" | "blue" | "yellow" | "error" | "success";

// One full-page layout for every "state": closed, not started, offline, server error, session expired,
// wrong network, location denied, outside the venue, loading. Same brand style, one clear action.
export function StateScreen({
  lang,
  setLang,
  icon,
  tone = "purple",
  spinner = false,
  title,
  body,
  notes = [],
  action,
  secondary,
  onBack,
  children,
}: {
  lang: Language;
  setLang: (lang: Language) => void;
  icon?: "alert" | "check" | "lock" | "message" | "pin" | "wifi";
  tone?: Tone;
  spinner?: boolean;
  title: string;
  body?: string;
  notes?: string[];
  action?: { label: string; onClick: () => void; busy?: boolean };
  secondary?: { label: string; onClick: () => void };
  onBack?: () => void;
  children?: ReactNode;
}) {
  const t = copy[lang];
  return (
    <Frame lang={lang} screen="state">
      <main className="flow-page flow-page--white state-page">
        <BrandHeader lang={lang} light onBack={onBack} onLanguage={() => setLang(lang === "ar" ? "en" : "ar")} />
        <section aria-live="polite" className="state-panel">
          <div className={`state-icon state-icon--${tone}`}>
            {spinner ? <span aria-label={t.loading} className="state-spinner" role="status" /> : icon && <Icon name={icon} size={36} />}
          </div>
          <h1>{title}</h1>
          {body && <p>{body}</p>}
          {notes.length > 0 && (
            <ul className="state-notes">
              {notes.map((note) => <li key={note}>{note}</li>)}
            </ul>
          )}
          {children}
          {action && (
            <Button className="wide-button" disabled={action.busy} onClick={action.onClick}>
              {action.label}
            </Button>
          )}
          {secondary && (
            <Button className="wide-button" onClick={secondary.onClick} variant="ghost">
              {secondary.label}
            </Button>
          )}
        </section>
        <Organizer lang={lang} />
      </main>
    </Frame>
  );
}
