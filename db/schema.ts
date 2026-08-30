export const draftKinds = ["update", "work"] as const;
export const draftTopics = [
  "character",
  "world",
  "illustration",
  "development",
] as const;

export const studioTableNames = [
  "studio_posts",
  "studio_post_versions",
  "studio_post_version_topics",
  "studio_taxonomy",
  "studio_assets",
  "studio_post_version_assets",
  "delivery_jobs",
] as const;
export const postStatuses = [
  "draft",
  "publishing",
  "published",
  "withheld",
  "unpublished",
  "archiving",
  "archived",
  "restoring",
  "purging",
  "purged",
] as const;
export const postVersionStates = [
  "draft",
  "candidate",
  "published",
  "superseded",
] as const;
export const taxonomyDimensions = ["kind", "topic"] as const;
export const taxonomyStatuses = ["active", "archived"] as const;
export const deliveryOperations = {
  asset: ["process", "delete"],
  discord: ["create", "update", "delete", "taxonomy"],
  notification: ["send"],
  cache: ["purge"],
} as const;

export const draftSchemaVersion = 1;
export const canonicalDatabaseSchemaVersion = 2;
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
export type StudioTableName = (typeof studioTableNames)[number];
export type PostStatus = (typeof postStatuses)[number];
export type PostVersionState = (typeof postVersionStates)[number];
export type TaxonomyDimension = (typeof taxonomyDimensions)[number];
export type TaxonomyStatus = (typeof taxonomyStatuses)[number];
export type DeliveryTarget = keyof typeof deliveryOperations;
export type DeliveryAction =
  (typeof deliveryOperations)[DeliveryTarget][number];
export type AssetStatus = (typeof assetStatuses)[number];
export type DeliveryStatus = (typeof deliveryStatuses)[number];
