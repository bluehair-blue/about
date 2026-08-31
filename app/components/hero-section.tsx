import type { PublicPostSummary } from "../../lib/public-projection";
import type { SiteCopy } from "../content";
import { UpdateShowcase } from "./update-showcase";

export function HeroSection({
  copy,
  posts,
  showcase,
  feed,
}: {
  copy: SiteCopy["hero"];
  posts: PublicPostSummary[];
  showcase: SiteCopy["showcase"];
  feed: SiteCopy["feed"];
}) {
  return (
    <section className="hero-scene" id="top" aria-labelledby="hero-title">
      <div className="hero">
        <div className="hero-copy">
          <p className="eyebrow">WORLD · NARRATIVE · SYSTEM</p>
          <h1 id="hero-title">
            {copy.title.map((line) => (
              <span key={line}>{line}</span>
            ))}
          </h1>
          <div className="hero-intro">
            <p>{copy.intro}</p>
            <a className="text-link" href="#work">
              {copy.workLink} <span aria-hidden="true">↓</span>
            </a>
          </div>
        </div>

        <UpdateShowcase items={posts} labels={showcase} feed={feed} />
      </div>
    </section>
  );
}
