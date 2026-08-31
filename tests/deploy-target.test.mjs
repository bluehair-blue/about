import assert from "node:assert/strict";
import test from "node:test";

import { verifyDeployTarget } from "../tooling/verify-deploy-target.mjs";

const zoneId = "c7a745e8466891e3fc65649de228435a";

function config(target) {
  const staging = target === "staging";
  const suffix = staging ? "staging" : "production";
  return {
    targetEnvironment: staging ? "staging" : undefined,
    name: staging ? "about-staging" : "about",
    vars: {
      ASSET_ORPHAN_RETENTION_DAYS: "7",
      VERSION_ROLLBACK_RETENTION_DAYS: "30",
      STUDIO_PUBLIC_ORIGIN: staging
        ? "https://about-staging.bluehair.blue"
        : "https://about.bluehair.blue",
      CLOUDFLARE_ZONE_ID: zoneId,
    },
    d1_databases: [{
      binding: "STUDIO_DB",
      database_name: `about-studio-${suffix}`,
      database_id: staging
        ? "db93207e-34eb-4369-9aba-b0b2cc193c1d"
        : "15698560-789e-483b-89dd-54ba8ab78093",
    }],
    r2_buckets: [{
      binding: "STUDIO_MEDIA",
      bucket_name: `about-studio-media-${suffix}`,
    }],
    queues: {
      producers: [{
        binding: "PUBLISH_QUEUE",
        queue: `about-studio-publish-${suffix}`,
      }],
      consumers: [{
        queue: `about-studio-publish-${suffix}`,
        max_batch_size: 1,
        max_retries: 3,
        max_concurrency: 1,
        dead_letter_queue: `about-studio-publish-dlq-${suffix}`,
      }],
    },
    images: { binding: "IMAGES" },
    routes: [{
      pattern: staging
        ? "about-staging.bluehair.blue"
        : "about.bluehair.blue",
      custom_domain: true,
    }],
  };
}

test("accepts only the exact production and staging deployment contracts", () => {
  assert.equal(verifyDeployTarget(config("production"), "production"), true);
  assert.equal(verifyDeployTarget(config("staging"), "staging"), true);
});

test("rejects cross-environment and lookalike physical resources", () => {
  const crossEnvironment = config("staging");
  crossEnvironment.d1_databases[0].database_id =
    "15698560-789e-483b-89dd-54ba8ab78093";
  assert.throws(
    () => verifyDeployTarget(crossEnvironment, "staging"),
    /exact staging resources/,
  );

  const lookalike = config("staging");
  lookalike.r2_buckets[0].bucket_name = "untrusted-staging";
  assert.throws(
    () => verifyDeployTarget(lookalike, "staging"),
    /exact staging resources/,
  );
});

test("rejects a foreign purge origin, missing DLQ, or serialized token", () => {
  const foreignOrigin = config("staging");
  foreignOrigin.vars.STUDIO_PUBLIC_ORIGIN =
    "https://about-staging.odeye3217.workers.dev";
  assert.throws(
    () => verifyDeployTarget(foreignOrigin, "staging"),
    /exact cleanup contract/,
  );

  const missingDlq = config("staging");
  delete missingDlq.queues.consumers[0].dead_letter_queue;
  assert.throws(
    () => verifyDeployTarget(missingDlq, "staging"),
    /isolated Queue consumer/,
  );

  const leakedToken = config("staging");
  leakedToken.vars.CLOUDFLARE_CACHE_PURGE_TOKEN = "must-not-be-built";
  assert.throws(
    () => verifyDeployTarget(leakedToken, "staging"),
    /token in build output/,
  );
});
