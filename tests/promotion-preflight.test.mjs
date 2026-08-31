import assert from "node:assert/strict";
import test from "node:test";

import {
  pendingMigrations,
  validateMigrationSequence,
  validateRemoteMigrationState,
} from "../tooling/verify-promotion-preflight.mjs";

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

test("requires migrated staging and untouched production before promotion", () => {
  assert.equal(validateRemoteMigrationState(migrations, [], migrations), true);
  assert.throws(
    () => validateRemoteMigrationState(migrations, [migrations[2]], migrations),
    /Staging has pending/,
  );
  assert.throws(
    () => validateRemoteMigrationState(migrations, [], migrations.slice(1)),
    /untouched baseline/,
  );
});
