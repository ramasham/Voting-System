import { type Language } from "../data/config";
import type { Catalog } from "../services/types";
import { copy } from "../i18n/copy";
import { Icon } from "../components/Icon";
import { Button } from "../components/Button";
import { BrandHeader } from "../components/BrandHeader";
import { Organizer } from "../components/Organizer";
import { Frame } from "../components/Frame";

export function ThankYou({
  lang,
  setLang,
  votes,
  catalog,
  onFinish,
}: {
  lang: Language;
  setLang: (lang: Language) => void;
  votes: Record<string, string>;
  catalog: Catalog | null;
  onFinish: () => void;
}) {
  const t = copy[lang];
  return (
    <Frame lang={lang} screen="thanks">
      <main className="thanks-page">
        <BrandHeader lang={lang} onLanguage={() => setLang(lang === "ar" ? "en" : "ar")} />
        <section className="thanks-hero">
          <div className="success-orbit">
            <span /><span /><span />
            <div><Icon name="check" size={42} /></div>
          </div>
          <span className="eyebrow eyebrow--yellow">{t.thanksKicker}</span>
          <h1>{t.thanksTitle}</h1>
          <p>{t.thanksBody}</p>
        </section>
        <section className="receipt">
          <div className="receipt__top">
            <span>{t.votedFor}</span>
            <b>MC2026</b>
          </div>
          {catalog?.categories.map((category) => {
            const maker = catalog?.makers.find((item) => item.id === votes[category.id]);
            return (
              <div className="receipt-row" key={category.id}>
                <span className={`receipt-dot receipt-dot--${category.color}`}><Icon name="check" size={16} /></span>
                <div><small>{category.name[lang]}</small><b>{maker?.title[lang]}</b></div>
                <span>{t.done}</span>
              </div>
            );
          })}
        </section>
        <Button className="finish-button" onClick={onFinish} variant="secondary">{t.finish}</Button>
        <Organizer dark lang={lang} />
      </main>
    </Frame>
  );
}
