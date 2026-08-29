"use client";

import { useState } from "react";

import styles from "./studio.module.css";

export function RolePanelButton() {
  const [status, setStatus] = useState("");
  const [pending, setPending] = useState(false);

  async function connectRolePanel() {
    setPending(true);
    setStatus("");

    try {
      const response = await fetch("/studio/api/discord/role-panel", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-studio-request": "1",
        },
        body: "{}",
      });
      const result = (await response.json()) as {
        created?: unknown;
        messageId?: unknown;
      };

      if (!response.ok || typeof result.messageId !== "string") {
        throw new Error("Role panel write failed");
      }

      setStatus(
        `${result.created === true ? "생성됨" : "연결됨"} · 메시지 ${result.messageId}`,
      );
    } catch {
      setStatus("역할 패널 연결에 실패했습니다. 다시 시도해 주세요.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className={styles.rolePanelAction}>
      <button type="button" disabled={pending} onClick={connectRolePanel}>
        {pending ? "연결 중…" : "Discord 역할 패널 연결"}
      </button>
      {status ? <p role="status">{status}</p> : null}
    </div>
  );
}
