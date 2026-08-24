import type { SiteCopy } from "../content";

export function ProjectIndexSection({ copy }: { copy: SiteCopy["work"] }) {
  return (
    <section className="section work-section" id="work" aria-labelledby="work-title">
      <div className="section-heading">
        <p>01</p>
        <h2 id="work-title">{copy.sectionTitle}</h2>
        <span>{copy.sectionSubtitle}</span>
      </div>

      <article className="featured-work">
        <a
          className="work-visual"
          href={copy.url}
          target="_blank"
          rel="noreferrer"
          aria-label={copy.openLabel}
        >
          <img
            src={copy.image}
            alt={copy.imageAlt}
            width="800"
            height="1200"
          />
          <span className="visual-index">001</span>
          <span className="visual-cta" aria-hidden="true">
            {copy.visualCta}
          </span>
        </a>

        <div className="work-copy">
          <p className="work-label">{copy.label}</p>
          <h3>
            {copy.title}
            <span>{copy.subtitle}</span>
          </h3>
          <p className="work-description">{copy.description}</p>
          <ul className="work-details" aria-label={copy.detailsLabel}>
            {copy.details.map((detail) => (
              <li key={detail}>{detail}</li>
            ))}
          </ul>
          <a
            className="project-link"
            href={copy.url}
            target="_blank"
            rel="noreferrer"
          >
            {copy.projectLink} <span aria-hidden="true">↗</span>
          </a>
        </div>
      </article>
    </section>
  );
}
