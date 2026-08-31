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
        active?: unknown;
        error?: unknown;
        messageId?: unknown;
      };

      if (
        response.status === 409 &&
        result.error === "discord_role_panel_create_outcome_unknown"
      ) {
        setStatus("생성 결과를 확인할 수 없습니다. Discord 채널을 확인한 뒤 다시 시도하세요.");
        return;
      }
      if (!response.ok || typeof result.messageId !== "string") {
        throw new Error("Role panel write failed");
      }

      setStatus(
        result.active === false
          ? `대기 패널 생성됨 · 메시지 ${result.messageId} · 이 ID를 Worker 설정에 반영한 뒤 다시 연결하세요.`
          : `연결됨 · 메시지 ${result.messageId}`,
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
