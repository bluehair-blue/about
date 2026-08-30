import { redirect } from "next/navigation";

import { assetStatuses } from "../../../db/schema";
import {
  MediaLibrary,
  type MediaFilter,
} from "../media-library";

const dayPattern = /^\d{4}-\d{2}-\d{2}$/u;

function isDay(value: string) {
  if (value === "") return true;
  if (!dayPattern.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

export default async function StudioMediaPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const values = await searchParams;
  const q = typeof values.q === "string" ? values.q.trim() : "";
  const status = typeof values.status === "string" ? values.status : "all";
  const from = typeof values.from === "string" ? values.from : "";
  const to = typeof values.to === "string" ? values.to : "";
  if (
    Array.from(q).length > 100 ||
    (status !== "all" && !assetStatuses.includes(status as (typeof assetStatuses)[number])) ||
    !isDay(from) ||
    !isDay(to) ||
    (from !== "" && to !== "" && from > to)
  ) {
    redirect("/studio/media");
  }
  const filter: MediaFilter = { q, status, from, to };
  return <MediaLibrary key={JSON.stringify(filter)} filter={filter} />;
}
