import { type Language } from "../data/config";
import { copy } from "../i18n/copy";
import { Button } from "./Button";

export function LanguageToggle({ lang, onChange }: { lang: Language; onChange: () => void }) {
  return (
    <Button aria-label={copy[lang].language} className="language-toggle" onClick={onChange} variant="ghost">
      {copy[lang].language}
    </Button>
  );
}
