import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const expected = {
  production: {
    targetEnvironment: undefined,
    name: "about",
    databaseName: "about-studio-production",
    databaseId: "15698560-789e-483b-89dd-54ba8ab78093",
    bucketName: "about-studio-media-production",
    queueName: "about-studio-publish-production",
    deadLetterQueue: "about-studio-publish-dlq-production",
    route: "about.bluehair.blue",
    publicOrigin: "https://about.bluehair.blue",
  },
  staging: {
    targetEnvironment: "staging",
    name: "about-staging",
    databaseName: "about-studio-staging",
    databaseId: "db93207e-34eb-4369-9aba-b0b2cc193c1d",
    bucketName: "about-studio-media-staging",
    queueName: "about-studio-publish-staging",
    deadLetterQueue: "about-studio-publish-dlq-staging",
    route: "about-staging.bluehair.blue",
    publicOrigin: "https://about-staging.bluehair.blue",
  },
};

function exactBinding(items, binding) {
  return items?.filter((item) => item.binding === binding) ?? [];
}

export function verifyDeployTarget(config, target) {
  const contract = expected[target];
  if (!contract) {
    throw new Error("Expected deployment target: production or staging");
  }

  if (
    config.targetEnvironment !== contract.targetEnvironment ||
    config.name !== contract.name
  ) {
    throw new Error(
      `Refusing ${target} deploy: built for ${config.targetEnvironment ?? "production"}/${config.name}`,
    );
  }

  const databases = exactBinding(config.d1_databases, "STUDIO_DB");
  const buckets = exactBinding(config.r2_buckets, "STUDIO_MEDIA");
  const producers = exactBinding(config.queues?.producers, "PUBLISH_QUEUE");
  if (
    databases.length !== 1 ||
    databases[0].database_name !== contract.databaseName ||
    databases[0].database_id !== contract.databaseId ||
    buckets.length !== 1 ||
    buckets[0].bucket_name !== contract.bucketName ||
    producers.length !== 1 ||
    producers[0].queue !== contract.queueName
  ) {
    throw new Error(
      `Refusing ${target} deploy: Studio bindings do not match the exact ${target} resources`,
    );
  }

  const consumers = config.queues?.consumers?.filter(
    ({ queue }) => queue === contract.queueName,
  ) ?? [];
  const queueConsumer = consumers[0];
  if (
    consumers.length !== 1 ||
    queueConsumer.max_batch_size !== 1 ||
    queueConsumer.max_retries !== 3 ||
    queueConsumer.max_concurrency !== 1 ||
    queueConsumer.dead_letter_queue !== contract.deadLetterQueue
  ) {
    throw new Error(
      `Refusing ${target} deploy without the isolated Queue consumer and DLQ contract`,
    );
  }

  if (config.images?.binding !== "IMAGES") {
    throw new Error(`Refusing ${target} deploy without the IMAGES binding`);
  }

  if (
    config.routes?.length !== 1 ||
    config.routes[0].pattern !== contract.route ||
    config.routes[0].custom_domain !== true
  ) {
    throw new Error(`Refusing ${target} deploy without its exact custom domain`);
  }

  const vars = config.vars ?? {};
  if (
    vars.ASSET_ORPHAN_RETENTION_DAYS !== "7" ||
    vars.VERSION_ROLLBACK_RETENTION_DAYS !== "30" ||
    vars.STUDIO_PUBLIC_ORIGIN !== contract.publicOrigin ||
    vars.CLOUDFLARE_ZONE_ID !== "c7a745e8466891e3fc65649de228435a"
  ) {
    throw new Error(`Refusing ${target} deploy without the exact cleanup contract`);
  }

  if (
    Object.keys(vars).some((name) => name.endsWith("_TOKEN")) ||
    JSON.stringify(config).includes("CLOUDFLARE_CACHE_PURGE_TOKEN")
  ) {
    throw new Error(`Refusing ${target} deploy with a cache purge token in build output`);
  }

  return true;
}

async function main() {
  const target = process.argv[2];
  const config = JSON.parse(
    await readFile(
      new URL("../dist/server/wrangler.json", import.meta.url),
      "utf8",
    ),
  );
  verifyDeployTarget(config, target);
  console.log(`Verified ${target} Worker build target.`);
}

if (
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url
) {
  await main();
}
