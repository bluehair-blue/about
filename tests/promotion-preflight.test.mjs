import assert from "node:assert/strict";
import test from "node:test";

import {
  pendingMigrations,
  validateMigrationSequence,
  validateRemoteMigrationState,
} from "../tooling/verify-promotion-preflight.mjs";
import {
  approvalPhrase,
  recoverInterruptedState,
  validateProductionCandidate,
  validateSmokeEvidence,
} from "../tooling/promote.mjs";

const migrations = [
  "0001_phase_a_drafts.sql",
  "0002_phase_a_assets.sql",
  "0003_phase_a_delivery.sql",
];

test("accepts one contiguous immutable migration sequence", () => {
  assert.deepEqual(validateMigrationSequence([...migrations].reverse()), migrations);
  assert.throws(
    () => validateMigrationSequence([migrations[0], migrations[2]]),
    /not contiguous/,
  );
});

test("extracts pending migration names from Wrangler output", () => {
  const output = `
    │ 0002_phase_a_assets.sql │
    │ 0001_phase_a_drafts.sql │
    │ 0002_phase_a_assets.sql │
  `;
  assert.deepEqual(pendingMigrations(output), migrations.slice(0, 2));
  assert.deepEqual(pendingMigrations("No migrations to apply!"), []);
});

test("requires migrated staging and a contiguous production migration suffix", () => {
  assert.equal(validateRemoteMigrationState(migrations, [], migrations), true);
  assert.equal(validateRemoteMigrationState(migrations, [], migrations.slice(1)), true);
  assert.equal(validateRemoteMigrationState(migrations, [], []), true);
  assert.throws(
    () => validateRemoteMigrationState(migrations, [migrations[2]], migrations),
    /Staging has pending/,
  );
  assert.throws(
    () => validateRemoteMigrationState(migrations, [], [migrations[0], migrations[2]]),
    /contiguous suffix/,
  );
});

function promotionState(status = "staging_deployed") {
  return {
    schema: "studio-promotion/v1",
    runId: "10000000-0000-4000-8000-000000000001",
    status,
    commit: "a".repeat(40),
    migrations,
    hashes: { migrations: "m", lockfile: "l", wrangler: "w" },
    staging: {
      deploymentId: "20000000-0000-4000-8000-000000000002",
      versionId: "30000000-0000-4000-8000-000000000003",
      deployedAt: "2026-08-31T10:00:00.000Z",
    },
  };
}

test("accepts only complete smoke evidence for the exact staging deployment", () => {
  const state = promotionState();
  const evidence = {
    schema: "studio-staging-smoke/v1",
    runId: state.runId,
    commit: state.commit,
    deploymentId: state.staging.deploymentId,
    verifiedAt: "2026-08-31T10:05:00.000Z",
    checks: {
      studioAccess: true,
      draftCreate: true,
      publishCreate: true,
      publishUpdate: true,
      archiveDelete: true,
      restoreCreate: true,
      rolePanel: true,
      queueDelivery: true,
      publicProjection: true,
    },
  };
  assert.equal(validateSmokeEvidence(evidence, state), true);
  assert.throws(
    () => validateSmokeEvidence({ ...evidence, deploymentId: "wrong" }, state),
    /does not match/,
  );
  assert.throws(
    () => validateSmokeEvidence({
      ...evidence,
      checks: { ...evidence.checks, queueDelivery: false },
    }, state),
    /incomplete/,
  );
});

test("revokes an interrupted approval and marks an interrupted production unknown", () => {
  const waiting = recoverInterruptedState(promotionState("awaiting_approval"));
  assert.equal(waiting.state.status, "approval_revoked");
  assert.equal(waiting.lastPhase, "awaiting_approval");

  const started = recoverInterruptedState(promotionState("production_started"));
  assert.equal(started.state.status, "production_unknown");
  assert.equal(started.lastPhase, "production_started");
});

test("rejects changed manifests and never retries an unknown production result", () => {
  const state = promotionState("staging_verified");
  const current = {
    commit: state.commit,
    migrations: state.migrations,
    hashes: state.hashes,
  };
  assert.equal(
    validateProductionCandidate(state, current, state.staging.versionId),
    true,
  );
  assert.match(approvalPhrase(state), /^PROMOTE .* a{12}$/u);
  assert.throws(
    () => validateProductionCandidate(
      state,
      { ...current, hashes: { ...current.hashes, wrangler: "changed" } },
      state.staging.versionId,
    ),
    /does not match/,
  );
  assert.throws(
    () => validateProductionCandidate(
      { ...state, status: "production_unknown" },
      current,
      state.staging.versionId,
    ),
    /unknown/,
  );
});
