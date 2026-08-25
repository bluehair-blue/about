import type { SiteCopy } from "../content";

export function SupportSection({ copy }: { copy: SiteCopy["support"] }) {
  return (
    <section className="support-section" id="support" aria-labelledby="support-title">
      <div className="support-inner">
        <div className="support-copy">
          <p className="section-number">02 / SUPPORT</p>
          <h2 id="support-title">
            {copy.title.map((line) => (
              <span key={line}>{line}</span>
            ))}
          </h2>
          <p>{copy.description}</p>
        </div>

        <div
          className="support-panel"
          role="group"
          aria-label={copy.panelLabel}
        >
          {copy.options.map((option, index) => (
            <div className="support-row" key={option.title}>
              <div>
                <span>{String(index + 1).padStart(2, "0")}</span>
                <h3>{option.title}</h3>
              </div>
              <p>
                {option.href ? (
                  <a
                    href={option.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={option.openLabel}
                  >
                    {option.status}
                  </a>
                ) : (
                  option.status
                )}
              </p>
            </div>
          ))}
          <p className="support-note">{copy.note}</p>
        </div>
      </div>
    </section>
  );
}
