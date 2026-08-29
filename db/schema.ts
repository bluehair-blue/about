export const draftKinds = ["update", "work"] as const;
export const draftTopics = [
  "character",
  "world",
  "illustration",
  "development",
] as const;

export const draftSchemaVersion = 1;

export type DraftKind = (typeof draftKinds)[number];
export type DraftTopic = (typeof draftTopics)[number];
