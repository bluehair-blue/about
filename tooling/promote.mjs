import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  appendFile,
  mkdir,
  open,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { createInterface } from "node:readline/promises";
import { resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { fileURLToPath, pathToFileURL } from "node:url";

import { validateMigrationSequence } from "./verify-promotion-preflight.mjs";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
const stateDirectory = resolve(repositoryRoot, ".wrangler", "promotions");
const statePath = resolve(stateDirectory, "state.json");
const historyPath = resolve(stateDirectory, "history.jsonl");
const lockPath = resolve(stateDirectory, "promotion.lock");
const wranglerPath = fileURLToPath(
  new URL("../node_modules/wrangler/bin/wrangler.js", import.meta.url),
);
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const manualSmokeChecks = [
  "studioAccess",
  "draftCreate",
  "publishCreate",
  "publishUpdate",
  "archiveDelete",
  "restoreCreate",
  "rolePanel",
  "queueDelivery",
  "publicProjection",
];

function run(command, args, { capture = false } = {}) {
  const result = spawnSync(command, args, {
    cwd: repositoryRoot,
    encoding: "utf8",
    stdio: capture ? "pipe" : "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const detail = capture
      ? `${result.stdout ?? ""}${result.stderr ?? ""}`.trim()
      : `exit ${result.status}`;
    throw new Error(`${command} ${args.join(" ")} failed: ${detail}`);
  }
  return result.stdout ?? "";
}

function git(args, options) {
  return run("git", args, options);
}

function wrangler(args, options) {
  return run(process.execPath, [wranglerPath, ...args], options);
}

async function atomicJson(path, value) {
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temporary, path);
}

async function readState() {
  try {
    const value = JSON.parse(await readFile(statePath, "utf8"));
    if (
      value?.schema !== "studio-promotion/v1" ||
      typeof value.runId !== "string" ||
      typeof value.commit !== "string" ||
      typeof value.status !== "string"
    ) {
      throw new Error("invalid promotion state schema");
    }
    return value;
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

async function writeState(state) {
  await atomicJson(statePath, { ...state, updatedAt: new Date().toISOString() });
}

async function appendHistory(state, reason, lastPhase = state.status) {
  const event = {
    runId: state.runId,
    commit: state.commit,
    timestamp: new Date().toISOString(),
    reason,
    lastPhase,
  };
  await appendFile(historyPath, `${JSON.stringify(event)}\n`, "utf8");
}

function processExists(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

async function acquireLock() {
  await mkdir(stateDirectory, { recursive: true });
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const handle = await open(lockPath, "wx");
      await handle.writeFile(JSON.stringify({ pid: process.pid }));
      return async () => {
        await handle.close();
        await rm(lockPath, { force: true });
      };
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      let lock;
      try {
        lock = JSON.parse(await readFile(lockPath, "utf8"));
      } catch {
        throw new Error("Promotion lock is unreadable; inspect it before retrying");
      }
      if (!Number.isInteger(lock.pid) || processExists(lock.pid)) {
        throw new Error(`Another promotion process holds the lock (pid ${lock.pid})`);
      }
      await rm(lockPath, { force: true });
    }
  }
  throw new Error("Could not acquire the promotion lock");
}

export function recoverInterruptedState(state, timestamp = new Date().toISOString()) {
  if (state.status === "awaiting_approval") {
    return {
      state: { ...state, status: "approval_revoked", updatedAt: timestamp },
      reason: "process_ended_while_awaiting_approval",
      lastPhase: "awaiting_approval",
    };
  }
  if (state.status === "production_started") {
    return {
      state: { ...state, status: "production_unknown", updatedAt: timestamp },
      reason: "production_result_unknown_after_process_end",
      lastPhase: "production_started",
    };
  }
  return null;
}

async function recoverState() {
  const current = await readState();
  if (!current) return null;
  const recovered = recoverInterruptedState(current);
  if (!recovered) return current;
  await writeState(recovered.state);
  await appendHistory(recovered.state, recovered.reason, recovered.lastPhase);
  return recovered.state;
}

function requireGitReady() {
  if (git(["status", "--porcelain", "--untracked-files=all"], { capture: true }).trim()) {
    throw new Error("Promotion requires a clean committed worktree");
  }
  git(["fetch", "--quiet", "--no-tags"]);
  const commit = git(["rev-parse", "HEAD"], { capture: true }).trim();
  let upstream;
  try {
    upstream = git(["rev-parse", "@{upstream}"], { capture: true }).trim();
  } catch {
    throw new Error("Promotion requires a configured upstream branch");
  }
  if (commit !== upstream) {
    throw new Error("Promotion requires HEAD and its upstream to be identical");
  }
  return commit;
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

async function fingerprint(commit = requireGitReady()) {
  const migrations = validateMigrationSequence(
    (await readdir(resolve(repositoryRoot, "migrations"))).filter((name) =>
      name.endsWith(".sql")
    ),
  );
  return {
    commit,
    migrations,
    hashes: {
      migrations: await sha256Files(migrations.map((name) => `migrations/${name}`)),
      lockfile: await sha256Files(["package-lock.json"]),
      wrangler: await sha256Files(["wrangler.jsonc"]),
    },
  };
}

async function builtResources() {
  const config = JSON.parse(
    await readFile(resolve(repositoryRoot, "dist", "server", "wrangler.json"), "utf8"),
  );
  const database = config.d1_databases?.find(({ binding }) => binding === "STUDIO_DB");
  const bucket = config.r2_buckets?.find(({ binding }) => binding === "STUDIO_MEDIA");
  const producer = config.queues?.producers?.find(({ binding }) =>
    binding === "PUBLISH_QUEUE"
  );
  const consumer = config.queues?.consumers?.find(({ queue }) =>
    queue === producer?.queue
  );
  const route = config.routes?.[0];
  if (!database || !bucket || !producer || !consumer || !route) {
    throw new Error("Built target is missing a promotion resource");
  }
  return {
    worker: config.name,
    databaseName: database.database_name,
    databaseId: database.database_id,
    bucketName: bucket.bucket_name,
    queueName: producer.queue,
    deadLetterQueue: consumer.dead_letter_queue,
    route: route.pattern,
    publicOrigin: config.vars?.STUDIO_PUBLIC_ORIGIN,
  };
}

function newestDeployment(output) {
  const deployments = JSON.parse(output);
  const latest = [...deployments].sort((left, right) =>
    Date.parse(right.created_on) - Date.parse(left.created_on)
  )[0];
  const version = latest?.versions?.find(({ percentage }) => percentage === 100);
  if (!latest?.id || !version?.version_id) {
    throw new Error("Could not identify the active deployment version");
  }
  return {
    deploymentId: latest.id,
    versionId: version.version_id,
    createdAt: latest.created_on,
  };
}

function deploymentFor(environment) {
  const args = ["deployments", "list"];
  if (environment === "staging") args.push("--env", "staging");
  args.push("--json");
  return newestDeployment(wrangler(args, { capture: true }));
}

async function automaticSmoke(origin) {
  const request = async (pathname) => fetch(new URL(pathname, origin), {
    redirect: "manual",
    signal: AbortSignal.timeout(15_000),
  });
  const [root, community, studio] = await Promise.all([
    request("/"),
    request("/community"),
    request("/studio"),
  ]);
  const result = {
    checkedAt: new Date().toISOString(),
    statuses: {
      root: root.status,
      community: community.status,
      anonymousStudio: studio.status,
    },
    checks: {
      rootHtml: root.status === 200 &&
        root.headers.get("content-type")?.includes("text/html") === true,
      communityHtml: community.status === 200 &&
        community.headers.get("content-type")?.includes("text/html") === true,
      anonymousStudioProtected: studio.status !== 200 && studio.status < 500,
    },
  };
  if (Object.values(result.checks).some((value) => value !== true)) {
    throw new Error(`Staging read-only smoke failed: ${JSON.stringify(result.statuses)}`);
  }
  return result;
}

function sameFingerprint(state, current) {
  return state.commit === current.commit &&
    isDeepStrictEqual(state.migrations, current.migrations) &&
    isDeepStrictEqual(state.hashes, current.hashes);
}

export function validateSmokeEvidence(evidence, state) {
  if (
    evidence?.schema !== "studio-staging-smoke/v1" ||
    evidence.runId !== state.runId ||
    evidence.commit !== state.commit ||
    evidence.deploymentId !== state.staging?.deploymentId ||
    typeof evidence.verifiedAt !== "string" ||
    !Number.isFinite(Date.parse(evidence.verifiedAt)) ||
    Date.parse(evidence.verifiedAt) < Date.parse(state.staging.deployedAt) ||
    Date.parse(evidence.verifiedAt) > Date.now() + 5 * 60_000
  ) {
    throw new Error("Manual staging smoke does not match this deployment");
  }
  const keys = Object.keys(evidence.checks ?? {}).sort();
  if (
    !isDeepStrictEqual(keys, [...manualSmokeChecks].sort()) ||
    manualSmokeChecks.some((name) => evidence.checks[name] !== true)
  ) {
    throw new Error("Manual staging smoke is incomplete");
  }
  return true;
}

export function validateProductionCandidate(state, current, activeVersionId) {
  if (state?.status === "production_unknown") {
    throw new Error("Production result is unknown; reconcile it manually before any retry");
  }
  if (state?.status !== "staging_verified") {
    throw new Error("Production requires a fresh staging_verified manifest");
  }
  if (!sameFingerprint(state, current)) {
    throw new Error("Promotion manifest does not match the current commit or hashes");
  }
  if (state.staging?.versionId !== activeVersionId) {
    throw new Error("The verified staging deployment is no longer active");
  }
  return true;
}

export function approvalPhrase(state) {
  return `PROMOTE ${state.runId} ${state.commit.slice(0, 12)}`;
}

async function writeSmokeTemplate(state) {
  const path = resolve(stateDirectory, `${state.runId}-smoke.json`);
  await atomicJson(path, {
    schema: "studio-staging-smoke/v1",
    runId: state.runId,
    commit: state.commit,
    deploymentId: state.staging.deploymentId,
    verifiedAt: null,
    checks: Object.fromEntries(manualSmokeChecks.map((name) => [name, false])),
  });
  return path;
}

async function finalizeStagingSmoke(state, smokeFile) {
  if (state?.status !== "staging_deployed") {
    throw new Error("Manual smoke can only finish a staging_deployed run");
  }
  const current = await fingerprint();
  const active = deploymentFor("staging");
  if (!sameFingerprint(state, current) || active.versionId !== state.staging.versionId) {
    throw new Error("Staging changed after deployment; start a new staging run");
  }
  await automaticSmoke(state.resources.staging.publicOrigin);
  const evidence = JSON.parse(await readFile(resolve(repositoryRoot, smokeFile), "utf8"));
  validateSmokeEvidence(evidence, state);
  const verified = {
    ...state,
    status: "staging_verified",
    staging: { ...state.staging, manualSmoke: evidence },
  };
  await writeState(verified);
  await appendHistory(verified, "staging_verified", "staging_deployed");
  console.log(`Staging verified for production review: ${statePath}`);
}

async function runStaging(smokeFile) {
  const previous = await recoverState();
  if (previous?.status === "production_unknown") {
    throw new Error("Production result is unknown; staging cannot replace that evidence");
  }
  if (smokeFile) {
    await finalizeStagingSmoke(previous, smokeFile);
    return;
  }
  const commit = requireGitReady();
  if (
    previous?.commit === commit &&
    ["staging_deployed", "staging_verified"].includes(previous.status)
  ) {
    throw new Error(`Current commit is already ${previous.status}; do not redeploy it`);
  }

  run(npmCommand, ["run", "lint"]);
  run(npmCommand, ["test"]);
  const productionResources = await builtResources();
  run(npmCommand, ["run", "build:staging"]);
  run(process.execPath, ["tooling/verify-deploy-target.mjs", "staging"]);
  wrangler(["deploy", "--env", "staging", "--dry-run"]);
  const stagingResources = await builtResources();
  const current = await fingerprint(commit);
  const started = {
    schema: "studio-promotion/v1",
    runId: randomUUID(),
    status: "staging_started",
    commit,
    migrations: current.migrations,
    hashes: current.hashes,
    resources: {
      staging: stagingResources,
      production: productionResources,
    },
    createdAt: new Date().toISOString(),
  };
  await writeState(started);
  try {
    wrangler([
      "d1", "migrations", "apply", "STUDIO_DB", "--env", "staging", "--remote",
    ]);
    run(npmCommand, ["run", "preflight:promotion"]);
    const deployedAt = new Date().toISOString();
    const output = wrangler(["deploy", "--env", "staging"], { capture: true });
    const versionMatch = /Current Version ID:\s*([0-9a-f-]{36})/iu.exec(output);
    const active = deploymentFor("staging");
    if (!versionMatch || versionMatch[1] !== active.versionId) {
      throw new Error("Staging deploy result does not match the active version");
    }
    const smoke = await automaticSmoke(stagingResources.publicOrigin);
    const deployed = {
      ...started,
      status: "staging_deployed",
      staging: { ...active, deployedAt, automaticSmoke: smoke },
    };
    await writeState(deployed);
    await appendHistory(deployed, "staging_deployed", "staging_started");
    const template = await writeSmokeTemplate(deployed);
    console.log(`Staging deployed. Complete the smoke template, then rerun:`);
    console.log(`npm run promote -- staging --smoke-file ${template}`);
  } catch (error) {
    const failed = { ...started, status: "staging_failed" };
    await writeState(failed);
    await appendHistory(failed, "staging_failed", "staging_started");
    throw error;
  }
}

async function askForApproval(state) {
  const expected = approvalPhrase(state);
  const input = createInterface({ input: process.stdin, output: process.stdout });
  let interrupted;
  const interruption = new Promise((_, reject) => {
    interrupted = () => reject(new Error("approval_interrupted"));
    process.once("SIGINT", interrupted);
    process.once("SIGTERM", interrupted);
  });
  try {
    const answer = await Promise.race([
      input.question(`Type exactly '${expected}' to start production: `),
      interruption,
    ]);
    if (answer !== expected) throw new Error("approval_rejected");
  } finally {
    process.off("SIGINT", interrupted);
    process.off("SIGTERM", interrupted);
    input.close();
  }
}

async function revokeApproval(state, reason) {
  const revoked = { ...state, status: "approval_revoked" };
  await writeState(revoked);
  await appendHistory(revoked, reason, "awaiting_approval");
}

async function runProduction() {
  let state = await recoverState();
  if (!state) throw new Error("Production requires a staging manifest");
  if (["approval_revoked", "production_unknown"].includes(state.status)) {
    throw new Error(`${state.status}; run staging again after resolving the recorded state`);
  }
  let current = await fingerprint();
  let activeStaging = deploymentFor("staging");
  validateProductionCandidate(state, current, activeStaging.versionId);

  run(npmCommand, ["run", "lint"]);
  run(npmCommand, ["test"]);
  run(npmCommand, ["run", "preflight:promotion"]);
  run(process.execPath, ["tooling/verify-deploy-target.mjs", "production"]);
  const productionResources = await builtResources();
  if (!isDeepStrictEqual(productionResources, state.resources.production)) {
    throw new Error("Production target changed since staging verification");
  }

  state = { ...state, status: "awaiting_approval" };
  await writeState(state);
  try {
    await askForApproval(state);
  } catch (error) {
    await revokeApproval(state, error.message);
    throw error;
  }

  current = await fingerprint();
  activeStaging = deploymentFor("staging");
  const approvedState = { ...state, status: "staging_verified" };
  validateProductionCandidate(approvedState, current, activeStaging.versionId);
  state = { ...state, status: "production_started" };
  await writeState(state);
  await appendHistory(state, "production_started", "awaiting_approval");
  try {
    wrangler(["d1", "migrations", "apply", "STUDIO_DB", "--remote"]);
    const output = wrangler(["deploy"], { capture: true });
    const versionMatch = /Current Version ID:\s*([0-9a-f-]{36})/iu.exec(output);
    const active = deploymentFor("production");
    if (!versionMatch || versionMatch[1] !== active.versionId) {
      throw new Error("Production deploy result does not match the active version");
    }
    const smoke = await automaticSmoke(productionResources.publicOrigin);
    const completed = {
      ...state,
      status: "completed",
      production: { ...active, deployedAt: new Date().toISOString(), smoke },
    };
    await writeState(completed);
    await appendHistory(completed, "production_completed", "production_started");
    console.log(`Production promotion completed: ${statePath}`);
  } catch (error) {
    const unknown = { ...state, status: "production_unknown" };
    await writeState(unknown);
    await appendHistory(unknown, "production_result_unknown", "production_started");
    throw new Error(
      `Production result is unknown and will not be retried automatically: ${error.message}`,
    );
  }
}

function parseArguments(args) {
  const [phase, ...options] = args;
  if (!new Set(["staging", "production"]).has(phase)) {
    throw new Error("Usage: npm run promote -- staging [--smoke-file PATH] | production");
  }
  let smokeFile;
  for (let index = 0; index < options.length; index += 1) {
    if (options[index] !== "--smoke-file" || !options[index + 1] || smokeFile) {
      throw new Error("Only one --smoke-file PATH option is supported");
    }
    smokeFile = options[index + 1];
    index += 1;
  }
  if (phase === "production" && smokeFile) {
    throw new Error("--smoke-file is only valid for staging");
  }
  return { phase, smokeFile };
}

async function main() {
  const { phase, smokeFile } = parseArguments(process.argv.slice(2));
  const release = await acquireLock();
  try {
    if (phase === "staging") await runStaging(smokeFile);
    else await runProduction();
  } finally {
    await release();
  }
}

if (
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url
) {
  try {
    await main();
  } catch (error) {
    console.error(`Promotion blocked: ${error.message}`);
    process.exitCode = 1;
  }
}
