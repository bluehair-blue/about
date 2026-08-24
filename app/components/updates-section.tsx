import type { SiteCopy, UpdateItem } from "../content";

export function UpdatesSection({
  notes,
  updates,
}: {
  notes: SiteCopy["notes"];
  updates: UpdateItem[];
}) {
  return (
    <section className="section updates-section" id="now" aria-labelledby="now-title">
      <div className="section-heading">
        <p>03</p>
        <h2 id="now-title">{notes.sectionTitle}</h2>
        <span>{notes.sectionSubtitle}</span>
      </div>

      <div className="updates-list">
        {updates.map((update, index) => (
          <article className="update" key={update.id}>
            <div className="update-meta">
              <time dateTime={update.dateTime}>{update.date}</time>
              <span>{update.state}</span>
            </div>
            <div className="update-copy">
              <p aria-hidden="true">{String(index + 1).padStart(2, "0")}</p>
              <h3>{update.title}</h3>
              <p>{update.description}</p>
            </div>
          </article>
        ))}
      </div>

      <p className="updates-footnote">{notes.footnote}</p>
    </section>
  );
}
