import { useMemo, useState } from "react";
import { type Language, type Maker } from "../data/config";
import { copy } from "../i18n/copy";
import { Icon } from "../components/Icon";
import { Button } from "../components/Button";
import { BrandHeader } from "../components/BrandHeader";
import { Organizer } from "../components/Organizer";
import { Frame } from "../components/Frame";
import { CategoryTabs } from "../components/CategoryTabs";
import { MakerCard } from "../components/MakerCard";
import { ProjectSheet } from "../components/ProjectSheet";
import { ConfirmSheet } from "../components/ConfirmSheet";
import { StateScreen } from "../components/StateScreen";
import { errorMessage } from "../lib/errors";
import { api, ApiError } from "../services/api";
import type { ApiErrorCode, Catalog } from "../services/types";

export function Voting({
  lang,
  setLang,
  votes,
  setVotes,
  catalog,
  catalogState,
  onRetryCatalog,
  onUnavailable,
  onComplete,
}: {
  lang: Language;
  setLang: (lang: Language) => void;
  votes: Record<string, string>;
  setVotes: (votes: Record<string, string>) => void;
  catalog: Catalog | null;
  catalogState: "loading" | "ready" | "error";
  onRetryCatalog: () => void;
  onUnavailable: (code: ApiErrorCode) => void; // voting closed / not started / session lost
  onComplete: () => void;
}) {
  const t = copy[lang];
  const [active, setActive] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [details, setDetails] = useState<Maker | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [toast, setToast] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [voteError, setVoteError] = useState("");
  const categories = catalog?.categories ?? [];
  const makers = catalog?.makers ?? [];
  const category = categories[active];
  const categoryMakers = useMemo(() => makers.filter((maker) => maker.categoryId === category?.id), [makers, category?.id]);
  const categoryVote = category ? votes[category.id] : undefined;
  const chosen = makers.find((maker) => maker.id === selectedId);
  const chooseCategory = (index: number) => {
    setActive(index);
    setSelectedId(null);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
  const showToast = (message: string, ms = 1500) => {
    setToast(message);
    window.setTimeout(() => setToast(""), ms);
  };
  const confirmVote = async () => {
    if (!chosen || submitting) return;
    setSubmitting(true);
    setVoteError("");
    let nextVotes: Record<string, string>;
    try {
      nextVotes = (await api.castVote({ categoryId: category.id, makerId: chosen.id })).votes; // the server is the source of truth
    } catch (error) {
      setSubmitting(false);
      const code = error instanceof ApiError ? error.code : "SERVER";
      if (code === "ALREADY_VOTED") {
        if (error instanceof ApiError && error.votes) setVotes(error.votes);
        setConfirming(false);
        setSelectedId(null);
        showToast(t.alreadyVoted, 2200);
      } else if (code === "VOTING_CLOSED" || code === "VOTING_NOT_STARTED" || code === "SESSION_EXPIRED" || code === "UNAUTHORIZED") {
        onUnavailable(code);
      } else {
        setVoteError(code === "NETWORK" ? errorMessage(lang, error) : t.voteFailed);
      }
      return;
    }
    setSubmitting(false);
    setVotes(nextVotes);
    setConfirming(false);
    setSelectedId(null);
    const finished = Object.keys(nextVotes).length === 3;
    setToast(`${t.voteSaved}. ${finished ? t.allDone : t.nextCategory}`);
    window.setTimeout(() => {
      setToast("");
      if (finished) onComplete();
      else {
        const nextIndex = categories.findIndex((item) => !nextVotes[item.id]);
        setActive(nextIndex);
        window.scrollTo({ top: 0, behavior: "smooth" });
      }
    }, 1500);
  };
  if (catalogState === "loading") {
    return <StateScreen lang={lang} setLang={setLang} spinner title={t.loading} />;
  }
  if (catalogState === "error" || !category) {
    return (
      <StateScreen
        action={{ label: t.retry, onClick: onRetryCatalog }}
        body={t.serverBody}
        icon="alert"
        lang={lang}
        setLang={setLang}
        title={t.serverTitle}
        tone="error"
      />
    );
  }
  return (
    <Frame lang={lang} screen="voting">
      <main className="voting-page">
        <div className="voting-top">
          <BrandHeader lang={lang} onLanguage={() => setLang(lang === "ar" ? "en" : "ar")} />
          <div className="voting-intro">
            <div>
              <h1>{t.votingTitle}</h1>
              <p>{t.votingBody}</p>
            </div>
            <div className="triangle-progress" aria-label={`${Object.keys(votes).length} / 3`}>
              {categories.map((item) => (
                <span className={votes[item.id] ? `is-filled is-${item.color}` : ""} key={item.id} />
              ))}
            </div>
          </div>
        </div>
        <CategoryTabs active={active} categories={categories} lang={lang} onChange={chooseCategory} votes={votes} />
        <section className={`category-section category-section--${category.color}`}>
          <header className="category-heading">
            <span className="large-category-dot">{category.number}</span>
            <div>
              <span>{t.categoryLabel}</span>
              <h2>{category.name[lang]}</h2>
            </div>
          </header>
          <div className="maker-grid">
            {categoryMakers.length ? (
              categoryMakers.map((maker) => (
                <MakerCard
                  disabled={Boolean(categoryVote) && categoryVote !== maker.id}
                  key={maker.id}
                  lang={lang}
                  maker={maker}
                  onDetails={() => setDetails(maker)}
                  onSelect={() => {
                    if (!categoryVote) setSelectedId(maker.id);
                  }}
                  selected={selectedId === maker.id}
                  voted={categoryVote === maker.id}
                />
              ))
            ) : (
              <div className="empty-state"><span className="empty-rings" /><p>{t.empty}</p></div>
            )}
          </div>
        </section>
        <Organizer lang={lang} />
      </main>
      {selectedId && !categoryVote && (
        <div className="sticky-confirm">
          <div>
            <span>{t.selected}</span>
            <b>{chosen?.title[lang]}</b>
          </div>
          <Button onClick={() => setConfirming(true)}>{t.confirmBar}<Icon name="check" /></Button>
        </div>
      )}
      {details && (
        <ProjectSheet
          disabled={Boolean(categoryVote)}
          lang={lang}
          maker={details}
          onClose={() => setDetails(null)}
          onSelect={() => !categoryVote && setSelectedId(details.id)}
          selected={selectedId === details.id}
        />
      )}
      {confirming && chosen && (
        <ConfirmSheet
          busy={submitting}
          error={voteError}
          lang={lang}
          maker={chosen}
          onCancel={() => {
            setConfirming(false);
            setVoteError("");
          }}
          onConfirm={confirmVote}
        />
      )}
      {toast && <div className="toast"><span><Icon name="check" /></span><p>{toast}</p></div>}
    </Frame>
  );
}
