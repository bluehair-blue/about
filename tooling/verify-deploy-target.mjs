import { readFile } from "node:fs/promises";

const target = process.argv[2];

if (target !== "production" && target !== "staging") {
  throw new Error("Expected deployment target: production or staging");
}

const config = JSON.parse(
  await readFile(new URL("../dist/server/wrangler.json", import.meta.url), "utf8"),
);
const expectedEnvironment = target === "staging" ? "staging" : undefined;
const expectedName = target === "staging" ? "about-staging" : "about";

if (
  config.targetEnvironment !== expectedEnvironment ||
  config.name !== expectedName
) {
  throw new Error(
    `Refusing ${target} deploy: built for ${config.targetEnvironment ?? "production"}/${config.name}`,
  );
}

const physicalResources = [
  config.d1_databases?.find(({ binding }) => binding === "STUDIO_DB")
    ?.database_name,
  config.r2_buckets?.find(({ binding }) => binding === "STUDIO_MEDIA")
    ?.bucket_name,
  config.queues?.producers?.find(({ binding }) => binding === "PUBLISH_QUEUE")
    ?.queue,
];

if (
  physicalResources.some(
    (name) => typeof name !== "string" || !name.endsWith(`-${target}`),
  )
) {
  throw new Error(
    `Refusing ${target} deploy: Studio bindings do not target ${target} resources`,
  );
}

if (config.images?.binding !== "IMAGES") {
  throw new Error(`Refusing ${target} deploy without the IMAGES binding`);
}

if (target === "staging" && config.routes?.length !== 0) {
  throw new Error("Refusing staging deploy with public routes");
}

console.log(`Verified ${target} Worker build target.`);
