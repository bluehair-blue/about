export const draftKinds = ["update", "work"] as const;
export const draftTopics = [
  "character",
  "world",
  "illustration",
  "development",
] as const;

export const draftSchemaVersion = 1;
export const assetStatuses = [
  "uploading",
  "processing",
  "ready",
  "orphan",
  "failed",
  "deleting",
] as const;
export const deliveryStatuses = [
  "queued",
  "processing",
  "retrying",
  "queue_failed",
  "verifying",
  "finalizing",
  "succeeded",
  "failed",
  "outcome_unknown",
] as const;

export type DraftKind = (typeof draftKinds)[number];
export type DraftTopic = (typeof draftTopics)[number];
export type AssetStatus = (typeof assetStatuses)[number];
export type DeliveryStatus = (typeof deliveryStatuses)[number];
