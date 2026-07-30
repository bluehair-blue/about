import { featuredWork, updates } from "./content";

export default function Home() {
  return (
    <>
      <a className="skip-link" href="#main">
        본문으로 건너뛰기
      </a>

      <header className="site-header">
        <div className="header-inner">
          <a className="wordmark" href="#top" aria-label="한파란 포트폴리오 홈">
            HANPARAN<span aria-hidden="true">.</span>
          </a>

          <nav aria-label="주요 메뉴">
            <a href="#work">작품</a>
            <a href="#support">후원</a>
            <a href="#now">근황</a>
          </nav>

          <p className="header-note">AI CHATBOT PLANNER · SEOUL</p>
        </div>
      </header>

      <main id="main">
        <section className="hero-scene" id="top" aria-labelledby="hero-title">
          <div className="hero">
            <div className="hero-copy">
              <p className="eyebrow">SUBCULTURE × AI CHATBOT</p>
              <h1 id="hero-title">
                <span>대화로</span>
                <span>세계의 결을</span>
                <span>설계합니다.</span>
              </h1>
              <div className="hero-intro">
                <p>
                  캐릭터의 말투부터 세계의 규칙까지.
                  <br />
                  서브컬쳐 AI 챗봇 기획자, 한파란입니다.
                </p>
                <a className="text-link" href="#work">
                  첫 작품 보기 <span aria-hidden="true">↓</span>
                </a>
              </div>
            </div>

            <aside className="hero-poster" aria-label="한파란 브랜드 포스터">
              <div className="poster-top">
                <span>PORTFOLIO</span>
                <span>V.01</span>
              </div>
              <p className="poster-name" aria-hidden="true">
                HAN
                <br />
                PARAN
              </p>
              <span className="poster-glyph" aria-hidden="true">
                파
              </span>
              <div className="poster-bottom">
                <span>BLUE / NARRATIVE / SYSTEM</span>
                <span className="poster-dot" aria-hidden="true" />
              </div>
            </aside>
          </div>
        </section>

        <section className="section work-section" id="work" aria-labelledby="work-title">
          <div className="section-heading">
            <p>01</p>
            <h2 id="work-title">Selected work</h2>
            <span>선별 작품</span>
          </div>

          <article className="featured-work">
            <a
              className="work-visual"
              href={featuredWork.url}
              target="_blank"
              rel="noreferrer"
              aria-label={`${featuredWork.title} 소개 사이트 열기`}
            >
              <img
                src={featuredWork.image}
                alt="프라임시티 캐릭터 장그루"
                width="800"
                height="1200"
              />
              <span className="visual-index">001</span>
              <span className="visual-cta" aria-hidden="true">
                VISIT PROJECT ↗
              </span>
            </a>

            <div className="work-copy">
              <p className="work-label">FEATURED · 2026</p>
              <h3>
                {featuredWork.title}
                <span>{featuredWork.englishTitle}</span>
              </h3>
              <p className="work-description">{featuredWork.description}</p>
              <ul className="work-details" aria-label="프로젝트 주요 정보">
                {featuredWork.details.map((detail) => (
                  <li key={detail}>{detail}</li>
                ))}
              </ul>
              <a
                className="project-link"
                href={featuredWork.url}
                target="_blank"
                rel="noreferrer"
              >
                프로젝트 소개 보기 <span aria-hidden="true">↗</span>
              </a>
            </div>
          </article>
        </section>

        <section className="support-section" id="support" aria-labelledby="support-title">
          <div className="support-inner">
            <div className="support-copy">
              <p className="section-number">02 / SUPPORT</p>
              <h2 id="support-title">
                <span>좋아한 장면이</span>
                <span>오래 남았다면.</span>
              </h2>
              <p>
                후원은 다음 캐릭터와 다음 세계를 만드는 시간으로 돌아옵니다.
              </p>
            </div>

            <div className="support-panel" aria-label="후원 방법">
              <div className="support-row">
                <div>
                  <span>01</span>
                  <h3>한 번의 응원</h3>
                </div>
                <p>후원 링크 준비 중</p>
              </div>
              <div className="support-row">
                <div>
                  <span>02</span>
                  <h3>정기 멤버십</h3>
                </div>
                <p>멤버십 구성 중</p>
              </div>
              <p className="support-note">
                현재는 포트폴리오 구조를 확인하기 위한 안내입니다. 결제 기능은 다음 버전에서 연결됩니다.
              </p>
            </div>
          </div>
        </section>

        <section className="section updates-section" id="now" aria-labelledby="now-title">
          <div className="section-heading">
            <p>03</p>
            <h2 id="now-title">Making notes</h2>
            <span>제작 근황</span>
          </div>

          <div className="updates-list">
            {updates.map((update, index) => (
              <article className="update" key={update.date}>
                <div className="update-meta">
                  <time dateTime={update.date.replaceAll(".", "-")}>{update.date}</time>
                  <span>{update.state}</span>
                </div>
                <div className="update-copy">
                  <p aria-hidden="true">0{index + 1}</p>
                  <h3>{update.title}</h3>
                  <p>{update.description}</p>
                </div>
              </article>
            ))}
          </div>

          <p className="updates-footnote">
            세부 제작 로그와 아카이브는 콘텐츠 구조가 확정된 뒤 순차적으로 공개합니다.
          </p>
        </section>
      </main>

      <footer>
        <div className="footer-mark">
          <span>한파란</span>
          <span>HANPARAN</span>
        </div>
        <p>SUBCULTURE AI CHATBOT PLANNER</p>
        <a href="#top">맨 위로 ↑</a>
      </footer>
    </>
  );
}
