import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdtemp,
  readFile,
  readdir,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
const migrationPattern = /^([0-9]{4})_[a-z0-9_]+\.sql$/u;
const wranglerPath = fileURLToPath(
  new URL("../node_modules/wrangler/bin/wrangler.js", import.meta.url),
);

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: repositoryRoot,
    encoding: "utf8",
    stdio: options.capture ? "pipe" : "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const detail = options.capture
      ? `${result.stdout ?? ""}${result.stderr ?? ""}`.trim()
      : `exit ${result.status}`;
    throw new Error(`${basename(command)} ${args.join(" ")} failed: ${detail}`);
  }
  return result.stdout ?? "";
}

export function validateMigrationSequence(names) {
  const sorted = [...names].sort();
  for (const [index, name] of sorted.entries()) {
    const match = migrationPattern.exec(name);
    if (!match || Number(match[1]) !== index + 1) {
      throw new Error(`Migration sequence is not contiguous at ${name}`);
    }
  }
  if (sorted.length === 0) throw new Error("No migrations found");
  return sorted;
}

export function pendingMigrations(output) {
  return [...new Set(output.match(/[0-9]{4}_[a-z0-9_]+\.sql/gu) ?? [])].sort();
}

export function validateRemoteMigrationState(
  migrations,
  stagingPending,
  productionPending,
) {
  if (stagingPending.length !== 0) {
    throw new Error(`Staging has pending migrations: ${stagingPending.join(", ")}`);
  }
  const appliedCount = migrations.length - productionPending.length;
  if (
    appliedCount < 0 ||
    productionPending.some((name, index) => name !== migrations[appliedCount + index])
  ) {
    throw new Error(
      "Production pending migrations are not a contiguous suffix of staging",
    );
  }
  return true;
}

async function sha256Files(paths) {
  const hash = createHash("sha256");
  for (const path of paths) {
    hash.update(path.replaceAll("\\", "/"));
    hash.update("\0");
    hash.update(await readFile(resolve(repositoryRoot, path)));
    hash.update("\0");
  }
  return hash.digest("hex");
}

async function main() {
  const status = run("git", ["status", "--porcelain", "--untracked-files=all"], {
    capture: true,
  });
  if (status.trim()) {
    throw new Error("Promotion preflight requires a clean committed worktree");
  }
  const commit = run("git", ["rev-parse", "HEAD"], { capture: true }).trim();

  const migrationNames = validateMigrationSequence(
    (await readdir(resolve(repositoryRoot, "migrations"))).filter((name) =>
      name.endsWith(".sql")
    ),
  );
  const migrationPaths = migrationNames.map((name) => `migrations/${name}`);

  run(process.execPath, ["--test", "tests/studio-schema.test.mjs"]);

  const localState = await mkdtemp(resolve(tmpdir(), "studio-promotion-"));
  try {
    run(process.execPath, [
      wranglerPath,
      "d1",
      "migrations",
      "apply",
      "STUDIO_DB",
      "--local",
      "--persist-to",
      localState,
    ]);
    const secondApply = run(process.execPath, [
      wranglerPath,
      "d1",
      "migrations",
      "list",
      "STUDIO_DB",
      "--local",
      "--persist-to",
      localState,
    ], { capture: true });
    if (pendingMigrations(secondApply).length !== 0) {
      throw new Error("Fresh local D1 still has pending migrations after apply");
    }
  } finally {
    await rm(localState, { recursive: true, force: true });
  }

  const stagingPending = pendingMigrations(run(process.execPath, [
    wranglerPath,
    "d1",
    "migrations",
    "list",
    "STUDIO_DB",
    "--env",
    "staging",
    "--remote",
  ], { capture: true }));
  const productionPending = pendingMigrations(run(process.execPath, [
    wranglerPath,
    "d1",
    "migrations",
    "list",
    "STUDIO_DB",
    "--remote",
  ], { capture: true }));
  validateRemoteMigrationState(
    migrationNames,
    stagingPending,
    productionPending,
  );

  const report = {
    schema: "studio-promotion-preflight/v1",
    commit,
    migrations: migrationNames,
    hashes: {
      migrations: await sha256Files(migrationPaths),
      lockfile: await sha256Files(["package-lock.json"]),
      wrangler: await sha256Files(["wrangler.jsonc"]),
    },
    staging: { pendingMigrations: stagingPending.length },
    production: {
      appliedMigrations: migrationNames.length - productionPending.length,
      pendingMigrations: productionPending.length,
    },
    mutation: "none",
  };
  console.log(JSON.stringify(report, null, 2));
}

if (
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url
) {
  await main();
}
