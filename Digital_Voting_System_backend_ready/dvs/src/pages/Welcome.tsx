import { type Language } from "../data/config";
import { copy } from "../i18n/copy";
import { Icon } from "../components/Icon";
import { Button } from "../components/Button";
import { BrandHeader } from "../components/BrandHeader";
import { Organizer } from "../components/Organizer";
import { Frame } from "../components/Frame";

export function Welcome({
  lang,
  setLang,
  onStart,
}: {
  lang: Language;
  setLang: (lang: Language) => void;
  onStart: () => void;
}) {
  const t = copy[lang];
  return (
    <Frame lang={lang} screen="welcome">
      <main className="welcome">
        <BrandHeader lang={lang} onLanguage={() => setLang(lang === "ar" ? "en" : "ar")} />
        <div className="hero-art" aria-hidden="true">
          <span className="ring ring--one" />
          <span className="ring ring--two" />
          <span className="triangle triangle--one" />
          <span className="triangle triangle--two" />
          <span className="triangle triangle--three" />
        </div>
        <section className="hero-copy">
          <span className="eyebrow eyebrow--yellow">{t.heroKicker}</span>
          <h1>{t.heroTitle}</h1>
          <p>{t.heroBody}</p>
          <Button className="hero-button" onClick={onStart}>
            <span>{t.start}</span>
            <span className="flip-rtl"><Icon name="arrow" /></span>
          </Button>
          <div className="access-note">
            <span className="access-check"><Icon name="check" size={16} /></span>
            <span>{t.onSite}</span>
          </div>
          <small>{t.takes}</small>
        </section>
        <Organizer dark lang={lang} />
      </main>
    </Frame>
  );
}
