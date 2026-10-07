import { type Language } from "../data/config";
import makerLogo from "../imports/logo-white.png";
import { copy } from "../i18n/copy";
import { Icon } from "./Icon";
import { Button } from "./Button";
import { LanguageToggle } from "./LanguageToggle";

export function BrandHeader({
  lang,
  onLanguage,
  onBack,
  light = false,
}: {
  lang: Language;
  onLanguage: () => void;
  onBack?: () => void;
  light?: boolean;
}) {
  return (
    <header className={`brand-header ${light ? "brand-header--light" : ""}`}>
      <img alt={copy[lang].event} className="maker-logo" src={makerLogo} />
      <div className="header-actions">
        {onBack && (
          <Button aria-label={copy[lang].back} className="icon-button" onClick={onBack} variant="ghost">
            <span className="flip-rtl"><Icon name="arrow" /></span>
          </Button>
        )}
        <LanguageToggle lang={lang} onChange={onLanguage} />
      </div>
    </header>
  );
}
