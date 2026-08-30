import type { Metadata } from "next";
import type { ReactNode } from "react";

import { RolePanelButton } from "./role-panel-button";
import styles from "./studio.module.css";

export const metadata: Metadata = {
  title: "Studio Console — 한파란",
  robots: { index: false, follow: false },
};

export default function StudioLayout({ children }: { children: ReactNode }) {
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
        {children}
        <footer className={styles.actions}>
          <p>
            Access·same-origin 경계 안에서 draft, R2 파생본, Queue delivery와
            Discord 역할 패널을 검증합니다.
          </p>
          <RolePanelButton />
        </footer>
      </div>
    </main>
  );
}
