import { type Category, type Language } from "../data/config";
import { copy } from "../i18n/copy";
import { Icon } from "./Icon";
import { Button } from "./Button";

export function CategoryTabs({
  categories,
  active,
  lang,
  votes,
  onChange,
}: {
  categories: Category[];
  active: number;
  lang: Language;
  votes: Record<string, string>;
  onChange: (index: number) => void;
}) {
  return (
    <nav aria-label={copy[lang].votingTitle} className="category-tabs">
      {categories.map((category, index) => {
        const complete = Boolean(votes[category.id]);
        return (
          <Button
            aria-current={active === index ? "step" : undefined}
            className={`category-tab category-tab--${category.color} ${active === index ? "is-active" : ""}`}
            key={category.id}
            onClick={() => onChange(index)}
            variant="ghost"
          >
            <span className="category-dot">
              {complete ? <Icon name="check" size={20} /> : category.number}
            </span>
            <span>{category.name[lang]}</span>
          </Button>
        );
      })}
    </nav>
  );
}
