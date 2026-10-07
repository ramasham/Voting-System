import { type ReactNode } from "react";
import { type Language } from "../data/config";
import type { Screen } from "../types";

export function Frame({
  children,
  lang,
  screen,
}: {
  children: ReactNode;
  lang: Language;
  screen: Screen;
}) {
  return (
    <div className={`app app--${screen}`} dir={lang === "ar" ? "rtl" : "ltr"} lang={lang}>
      <div className="ambient ambient--one" />
      <div className="ambient ambient--two" />
      {children}
    </div>
  );
}
