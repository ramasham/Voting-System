import { type Language } from "../data/config";
import cpfLogoBurgundy from "../imports/cpf-logo-burgundy.svg";
import cpfLogoWhite from "../imports/cpf-logo-white.svg";
import { copy } from "../i18n/copy";

export function Organizer({
  lang,
  dark = false,
  logoSrc = dark ? cpfLogoWhite : cpfLogoBurgundy,
}: {
  lang: Language;
  dark?: boolean;
  logoSrc?: string;
}) {
  return (
    <footer className={`organizer ${dark ? "organizer--dark" : ""}`}>
      <span>{copy[lang].organized}</span>
      <img alt={lang === "ar" ? "مؤسسة ولي العهد" : "Crown Prince Foundation"} src={logoSrc} />
    </footer>
  );
}
