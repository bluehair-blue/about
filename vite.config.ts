import vinext from "vinext";
import { readdir } from "node:fs/promises";
import { defineConfig } from "vite";
import { sites } from "./tooling/sites-vite-plugin";

// macOS Seatbelt blocks FSEvents, so Codex previews need polling for HMR.
const isCodexSeatbeltSandbox = process.env.CODEX_SANDBOX === "seatbelt";

const localBindingConfig = {
  main: "./worker/index.ts",
  compatibility_flags: ["nodejs_compat"],
};

export default defineConfig(async ({ command, mode }) => {
  // Keep Wrangler and Miniflare state project-local. These are non-secret tool
  // settings; application environment belongs in ignored `.env*` files.
  process.env.WRANGLER_WRITE_LOGS ??= "false";
  process.env.WRANGLER_LOG_PATH ??= ".wrangler/logs";
  process.env.MINIFLARE_REGISTRY_PATH ??= ".wrangler/registry";

  // The Cloudflare plugin otherwise serializes local dotenv secrets into the
  // deployable server output. Development still loads `.env*` as usual.
  if (command === "build") {
    if (mode === "staging") {
      process.env.CLOUDFLARE_ENV = "staging";
    }

    const localDevVarFiles = (await readdir(".")).filter(
      (name) => name === ".dev.vars" || name.startsWith(".dev.vars."),
    );

    if (localDevVarFiles.length > 0) {
      throw new Error(
        "Refusing to build while local .dev.vars files are present. Use ignored .env.local for local-only secrets.",
      );
    }

    process.env.CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV = "false";
  }

  // Wrangler snapshots its log path while the Cloudflare plugin is imported.
  const { cloudflare } = await import("@cloudflare/vite-plugin");

  return {
    server: isCodexSeatbeltSandbox
      ? { watch: { useFsEvents: false, usePolling: true } }
      : undefined,
    plugins: [
      vinext(),
      sites(),
      cloudflare({
        viteEnvironment: { name: "rsc", childEnvironments: ["ssr"] },
        config: localBindingConfig,
      }),
    ],
  };
});
