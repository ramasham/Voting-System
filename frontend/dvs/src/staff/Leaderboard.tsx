import type { CSSProperties } from "react"
import type { Language } from "../data/config"
import { staffCopy } from "../i18n/staff"
import type {
  LiveResults,
  StaffCategory,
  StaffExhibitor,
} from "../services/staff-types"
import { categoryName, exhibitorName } from "../services/staff-types"
import StaffIcon from "./StaffIcon"
import { numberFormat } from "./utils"
export default function Leaderboard({
  category,
  index,
  lang,
  categories,
  exhibitors,
  compact = false,
}: {
  category: LiveResults["categories"][number]
  index: number
  lang: Language
  categories: StaffCategory[]
  exhibitors: StaffExhibitor[]
  compact?: boolean
}) {
  const t = staffCopy[lang]
  const metadata = categories.find((c) => c.id === category.categoryId)
  const total = category.exhibitors.reduce((n, e) => n + e.votes, 0)
  const rows = [...category.exhibitors].sort(
    (a, b) => b.votes - a.votes || a.exhibitor.localeCompare(b.exhibitor),
  )
  const highest = rows[0]?.votes ?? 0
  return (
    <section
      className={`leaderboard leaderboard--${index % 3} ${
        compact ? "leaderboard--compact" : ""
      }`}
      aria-label={metadata ? categoryName(metadata, lang) : category.category}
    >
      <header className="leaderboard__header">
        <span className="leaderboard__number" dir="ltr">
          {String(index + 1).padStart(2, "0")}
        </span>
        <div>
          <span className="staff-eyebrow">{t.category}</span>
          <h2>{metadata ? categoryName(metadata, lang) : category.category}</h2>
        </div>
        <span className="leaderboard__total">
          <b>{numberFormat(total, lang)}</b>
          <small>{t.votes}</small>
        </span>
      </header>
      {rows.length ? (
        <ol className="leaderboard__list">
          {rows.map((row) => {
            const project = exhibitors.find((e) => e.id === row.exhibitorId)
            const name = project ? exhibitorName(project, lang) : row.exhibitor
            const rank = rows.findIndex((e) => e.votes === row.votes) + 1
            const leading = row.votes > 0 && row.votes === highest
            return (
              <li
                className={`leaderboard-row ${leading ? "is-leading" : ""}`}
                key={row.exhibitorId}
              >
                <span className="leaderboard-row__rank">
                  {leading ? (
                    <StaffIcon name="trophy" size={20} />
                  ) : (
                    numberFormat(rank, lang)
                  )}
                  <span className="staff-sr-only">
                    {numberFormat(rank, lang)}
                  </span>
                </span>
                <span className="staff-project-avatar" aria-hidden="true">
                  <span>{Array.from(name.trim())[0]}</span>
                  {row.imageUrl && (
                    <img
                      alt=""
                      key={row.imageUrl}
                      src={row.imageUrl}
                      loading="lazy"
                      onError={(e) => {
                        e.currentTarget.hidden = true
                      }}
                    />
                  )}
                </span>
                <div className="leaderboard-row__project">
                  {leading && (
                    <span className="leaderboard-row__leading">{t.leader}</span>
                  )}
                  <h3>{name}</h3>
                  <span className="leaderboard-row__bar" aria-hidden="true">
                    <i
                      style={
                        {
                          "--vote-share": `${
                            highest ? (row.votes / highest) * 100 : 0
                          }%`,
                        } as CSSProperties
                      }
                    />
                  </span>
                </div>
                <span className="leaderboard-row__votes">
                  <b>{numberFormat(row.votes, lang)}</b>
                  <small>{t.votes}</small>
                </span>
              </li>
            )
          })}
        </ol>
      ) : (
        <p className="staff-empty">{t.noProjects}</p>
      )}
      {total === 0 && rows.length > 0 && (
        <p className="leaderboard__waiting">{t.noVotes}</p>
      )}
    </section>
  )
}
