import { phaseAEnvironmentErrors, type PhaseAEnv, type StudioQueueBatch } from "./phase-a-env";
import {
  processStudioAssetCleanupJob,
  processStudioAssetJob,
  processStudioVersionCleanupJob,
  recordStudioAssetQueueFailure,
  recoverStudioAssetCleanupFailure,
  recoverStudioVersionCleanupFailure,
} from "./studio-assets";
import {
  processStudioDiscordJob,
  processStudioNotificationJob,
  recoverStudioDiscordQueueFailure,
  recoverStudioNotificationQueueFailure,
  type StudioQueueOutcome,
} from "./studio-publishing";
import {
  processStudioTaxonomyJob,
  recoverStudioTaxonomyQueueFailure,
} from "./studio-taxonomy";

export const PHASE_A_QUEUE_MAX_RETRIES = 3;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseMessage(value: unknown) {
  if (!isRecord(value) || typeof value.type !== "string") return null;
  if (
    value.type === "asset_process" &&
    typeof value.jobId === "string" &&
    typeof value.assetId === "string" &&
    Object.keys(value).every((key) => ["type", "jobId", "assetId"].includes(key))
  ) {
    return {
      type: "asset_process" as const,
      jobId: value.jobId,
      assetId: value.assetId,
    };
  }
  if (
    value.type === "asset_cleanup" &&
    typeof value.jobId === "string" &&
    typeof value.assetId === "string" &&
    Object.keys(value).every((key) => ["type", "jobId", "assetId"].includes(key))
  ) {
    return {
      type: "asset_cleanup" as const,
      jobId: value.jobId,
      assetId: value.assetId,
    };
  }
  if (
    value.type === "version_cleanup" &&
    typeof value.jobId === "string" &&
    typeof value.versionId === "string" &&
    Object.keys(value).every((key) => ["type", "jobId", "versionId"].includes(key))
  ) {
    return {
      type: "version_cleanup" as const,
      jobId: value.jobId,
      versionId: value.versionId,
    };
  }
  if (
    value.type === "discord_delivery" &&
    typeof value.jobId === "string" &&
    Object.keys(value).every((key) => ["type", "jobId"].includes(key))
  ) {
    return { type: "discord_delivery" as const, jobId: value.jobId };
  }
  if (
    value.type === "notification_send" &&
    typeof value.jobId === "string" &&
    Object.keys(value).every((key) => ["type", "jobId"].includes(key))
  ) {
    return { type: "notification_send" as const, jobId: value.jobId };
  }
  if (
    value.type === "taxonomy_sync" &&
    typeof value.jobId === "string" &&
    Object.keys(value).every((key) => ["type", "jobId"].includes(key))
  ) {
    return { type: "taxonomy_sync" as const, jobId: value.jobId };
  }
  return null;
}

function retry(message: StudioQueueBatch["messages"][number], outcome?: StudioQueueOutcome) {
  message.retry(
    outcome?.action === "retry" && outcome.delaySeconds
      ? { delaySeconds: outcome.delaySeconds }
      : undefined,
  );
}

export async function handleStudioQueue(
  batch: StudioQueueBatch,
  env: PhaseAEnv,
) {
  if (phaseAEnvironmentErrors(env).length > 0) {
    for (const message of batch.messages) message.retry({ delaySeconds: 30 });
    return;
  }

  for (const message of batch.messages) {
    const body = parseMessage(message.body);
    if (!body) {
      message.ack();
      continue;
    }
    const terminal = message.attempts > PHASE_A_QUEUE_MAX_RETRIES;
    if (body.type === "asset_process") {
      try {
        await processStudioAssetJob(body.jobId, body.assetId, env);
        message.ack();
      } catch (error) {
        await recordStudioAssetQueueFailure(
          body.jobId,
          body.assetId,
          env,
          error,
          terminal,
        );
        retry(message);
      }
      continue;
    }

    if (body.type === "asset_cleanup") {
      let outcome: StudioQueueOutcome;
      try {
        outcome = await processStudioAssetCleanupJob(
          body.jobId,
          body.assetId,
          env,
        );
      } catch (error) {
        outcome = await recoverStudioAssetCleanupFailure(
          body.jobId,
          body.assetId,
          env,
          error,
          terminal,
        );
      }
      if (outcome.action === "ack") message.ack();
      else retry(message, outcome);
      continue;
    }

    if (body.type === "version_cleanup") {
      let outcome: StudioQueueOutcome;
      try {
        outcome = await processStudioVersionCleanupJob(
          body.jobId,
          body.versionId,
          env,
        );
      } catch (error) {
        outcome = await recoverStudioVersionCleanupFailure(
          body.jobId,
          env,
          error,
          terminal,
        );
      }
      if (outcome.action === "ack") message.ack();
      else retry(message, outcome);
      continue;
    }

    if (body.type === "taxonomy_sync") {
      let outcome: StudioQueueOutcome;
      try {
        outcome = await processStudioTaxonomyJob(body.jobId, env);
        if (outcome.action === "retry" && terminal) {
          outcome = await recoverStudioTaxonomyQueueFailure(body.jobId, env, true);
        }
      } catch {
        outcome = await recoverStudioTaxonomyQueueFailure(
          body.jobId,
          env,
          terminal,
        );
      }
      if (outcome.action === "ack") message.ack();
      else retry(message, outcome);
      continue;
    }

    if (body.type === "notification_send") {
      let outcome: StudioQueueOutcome;
      try {
        outcome = await processStudioNotificationJob(body.jobId, env);
        if (outcome.action === "retry" && terminal) {
          outcome = await recoverStudioNotificationQueueFailure(
            body.jobId,
            env,
            true,
          );
        }
      } catch {
        outcome = await recoverStudioNotificationQueueFailure(
          body.jobId,
          env,
          terminal,
        );
      }
      if (outcome.action === "ack") message.ack();
      else retry(message, outcome);
      continue;
    }

    let outcome: StudioQueueOutcome;
    try {
      outcome = await processStudioDiscordJob(body.jobId, env);
      if (outcome.action === "retry" && terminal) {
        outcome = await recoverStudioDiscordQueueFailure(body.jobId, env, true);
      }
    } catch {
      outcome = await recoverStudioDiscordQueueFailure(
        body.jobId,
        env,
        terminal,
      );
    }
    if (outcome.action === "ack") message.ack();
    else retry(message, outcome);
  }
}
