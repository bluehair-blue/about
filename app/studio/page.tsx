import { redirect } from "next/navigation";

import { DraftList, type DraftFilter } from "./draft-list";

const filters = new Set<DraftFilter>(["all", "working", "attention"]);

export default async function StudioPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string | string[] }>;
}) {
  const value = (await searchParams).filter;
  if (typeof value !== "string" || !filters.has(value as DraftFilter)) {
    redirect("/studio?filter=all");
  }
  return <DraftList key={value} filter={value as DraftFilter} />;
}
