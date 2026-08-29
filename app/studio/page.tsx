import type { Metadata } from "next";

import { DraftEditor } from "./draft-editor";
import { RolePanelButton } from "./role-panel-button";
import styles from "./studio.module.css";

export const metadata: Metadata = {
  title: "Studio Console — 한파란",
  robots: { index: false, follow: false },
};

export default function StudioPage() {
  return (
    <main className={styles.shell}>
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>HANPARAN · PRIVATE</p>
          <h1>Studio Console</h1>
        </div>
        <p className={styles.status} role="status">
          Access 보호 연결됨
        </p>
      </header>

      <div className={styles.form}>
        <DraftEditor />
        <section className={styles.card} aria-labelledby="media-heading">
          <div className={styles.sectionHeading}>
            <div>
              <p className={styles.step}>02</p>
              <h2 id="media-heading">이미지</h2>
            </div>
            <p>JPEG · PNG · static WebP · 최대 10장</p>
          </div>

          <label className={styles.upload}>
            <span>fixture 이미지 선택</span>
            <input
              type="file"
              name="images"
              accept="image/jpeg,image/png,image/webp"
              multiple
            />
          </label>
          <p className={styles.note}>
            제목·본문·종류·주제는 staging D1에 자동 저장됩니다. 이미지별 alt와
            순서, R2 업로드, Discord 전송은 다음 slice에서 활성화됩니다.
          </p>
        </section>

        <footer className={styles.actions}>
          <p>
            Access·same-origin 경계 안에서 draft revision과 Discord 역할 패널을
            각각 검증합니다.
          </p>
          <RolePanelButton />
        </footer>
      </div>
    </main>
  );
}
