import { redirect } from "next/navigation";

import { loadPublicProjection } from "../lib/public-projection";
import { getRuntimeEnv } from "../lib/runtime-env";
import { Home } from "./home";

export const dynamic = "force-dynamic";

export default async function PortfolioPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const env = await getRuntimeEnv();
  const projection = await loadPublicProjection(
    env.STUDIO_DB,
    await searchParams,
    env.DISCORD_GUILD_ID,
  );
  if (projection.canonicalHref) redirect(projection.canonicalHref);
  return <Home projection={projection} />;
}
