import {
  localeOptions,
  type Locale,
  type SiteCopy,
} from "../content";

type HeaderCopy = Pick<
  SiteCopy,
  "homeLabel" | "navLabel" | "languageLabel" | "nav"
>;

export function SiteHeader({
  copy,
  locale,
  onLocaleChange,
}: {
  copy: HeaderCopy;
  locale: Locale;
  onLocaleChange: (locale: Locale) => void;
}) {
  return (
    <header className="site-header">
      <div className="header-inner">
        <a className="wordmark" href="#top" aria-label={copy.homeLabel}>
          HANPARAN<span aria-hidden="true">.</span>
        </a>

        <nav aria-label={copy.navLabel}>
          <a href="#work">{copy.nav.work}</a>
          <a href="#support">{copy.nav.support}</a>
          <a href="#now">{copy.nav.now}</a>
        </nav>

        <div className="header-actions">
          <p className="header-note">WORLD DESIGN · BLUE</p>
          <select
            className="language-select"
            aria-label={copy.languageLabel}
            value={locale}
            onChange={(event) =>
              onLocaleChange(event.currentTarget.value as Locale)
            }
          >
            {localeOptions.map((option) => (
              <option value={option.value} key={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
      </div>
    </header>
  );
}
