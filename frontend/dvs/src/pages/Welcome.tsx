import { type Language } from "../data/config";
import { copy } from "../i18n/copy";
import { Icon } from "../components/Icon";
import { Button } from "../components/Button";
import { BrandHeader } from "../components/BrandHeader";
import { Organizer } from "../components/Organizer";
import { Frame } from "../components/Frame";
import innovationSymbol from "../imports/innovation-symbol-dark-red.svg";
import innovationOutline from "../imports/innovation-symbol-dark-red-outline.svg";
import cpfLogoBurgundy from "../imports/cpf-logo-burgundy.svg";

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
        <BrandHeader
          lang={lang}
          onLanguage={() => setLang(lang === "ar" ? "en" : "ar")}
        />
        <div className="welcome-content">
          <div className="welcome-visual" aria-hidden="true">
            <div className="welcome-emblem">
              <img className="welcome-emblem__layer welcome-emblem__layer--outer" src={innovationOutline} alt="" />
              <img className="welcome-emblem__layer welcome-emblem__layer--middle" src={innovationSymbol} alt="" />
              <img className="welcome-emblem__layer welcome-emblem__layer--center" src={innovationSymbol} alt="" />
            </div>
          </div>
          <div className="welcome-action">
            <p className="hero-subtitle">{t.heroTitle}</p>
            <Button className="hero-button" onClick={onStart}>
              <span>{t.start}</span>
              <span className="hero-button__arrow" aria-hidden="true">
                <span className="flip-rtl">
                  <Icon name="arrow" size={20} />
                </span>
              </span>
            </Button>
            <div className="access-note">
              <span className="access-check">
                <Icon name="check" size={16} />
              </span>
              <span>{t.onSite}</span>
            </div>
          </div>
        </div>
        <Organizer lang={lang} logoSrc={cpfLogoBurgundy} />
      </main>
    </Frame>
  );
}
