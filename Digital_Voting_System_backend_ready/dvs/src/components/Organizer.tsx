import { type Language } from "../data/config";
import cpfLogo from "../imports/cpf-logo.png";
import { copy } from "../i18n/copy";

export function Organizer({ lang, dark = false }: { lang: Language; dark?: boolean }) {
  return (
    <footer className={`organizer ${dark ? "organizer--dark" : ""}`}>
      <span>{copy[lang].organized}</span>
      <img alt={lang === "ar" ? "مؤسسة ولي العهد" : "Crown Prince Foundation"} src={cpfLogo} />
    </footer>
  );
}
