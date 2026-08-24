import type { SiteCopy } from "../content";

export function SiteFooter({ copy }: { copy: SiteCopy["footer"] }) {
  return (
    <footer className="site-footer">
      <div className="footer-mark">
        <span>{copy.name}</span>
        <span>HANPARAN</span>
      </div>
      <p>WORLD · NARRATIVE · SYSTEM</p>
      <a href="#top">{copy.top} ↑</a>
    </footer>
  );
}
