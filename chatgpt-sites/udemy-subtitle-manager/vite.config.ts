import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import vinext from "vinext";
import { defineConfig } from "vite";
import hostingConfig from "./.openai/hosting.json";
import localWorkerConfig from "./wrangler.local.json";
import { readExecutionProfile } from "./scripts/execution-profile.mjs";
import { sites } from "@openai/sites-vite-plugin";
import { connectorPreview } from "./build/connector-preview-plugin.mjs";

const { d1, r2 } = hostingConfig;

// macOS Seatbelt blocks FSEvents, so Codex previews need polling for HMR.
const isCodexSeatbeltSandbox = process.env.CODEX_SANDBOX === "seatbelt";
const managedLinux = readExecutionProfile() === "managed-linux";

const localBindingConfig = {
  ...localWorkerConfig,
  d1_databases: d1 ? localWorkerConfig.d1_databases : [],
  r2_buckets: r2 ? localWorkerConfig.r2_buckets : [],
};

export default defineConfig(async ({ command }) => {
  // Use Miniflare's local Request.cf placeholder unless fetching is requested.
  process.env.CLOUDFLARE_CF_FETCH_ENABLED ??= "false";
  process.env.WRANGLER_SEND_METRICS ??= "false";

  // Keep Wrangler and Miniflare state project-local. These are non-secret tool
  // settings; application environment belongs in ignored `.env*` files.
  process.env.WRANGLER_WRITE_LOGS ??= "false";
  process.env.WRANGLER_LOG_PATH ??= ".wrangler/logs";
  process.env.WRANGLER_REGISTRY_PATH ??= ".wrangler/dev-registry";
  process.env.MINIFLARE_REGISTRY_PATH ??= ".wrangler/registry";

  // Wrangler snapshots its log path while the Cloudflare plugin is imported.
  const { cloudflare } = await import("@cloudflare/vite-plugin");

  // Keep /api/health aligned with the source commit packaged for Sites.
  const releaseCommit = existsSync(".openai/release.json")
    ? JSON.parse(readFileSync(".openai/release.json", "utf8")).commit
    : execFileSync("git", ["-C", existsSync("../../.git") ? "../.." : ".", "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  if (!/^[a-f0-9]{40}$/.test(releaseCommit)) throw new Error("Invalid release commit provenance");
  return {
    define: { __RELEASE_COMMIT__: JSON.stringify(releaseCommit) },
    server: {
      ...(managedLinux
        ? { host: "0.0.0.0", allowedHosts: ["terminal.local"] }
        : {}),
      ...(isCodexSeatbeltSandbox
        ? { watch: { useFsEvents: false, usePolling: true } }
        : {}),
    },
    plugins: [
      vinext(),
      sites(),
      connectorPreview(),
      cloudflare({
        viteEnvironment: { name: "rsc", childEnvironments: ["ssr"] },
        inspectorPort: false,
        persistState: {
          path: process.env.SITES_LOCAL_STATE_PATH || ".wrangler/state",
        },
        config: {
          ...localBindingConfig,
          ...(command === "serve"
            ? {
                services: [
                  {
                    binding: "CONNECTORS",
                    service: "sites-connector-preview",
                    entrypoint: "ConnectorPreview",
                  },
                ],
              }
            : {}),
        },
        ...(command === "serve"
          ? {
              auxiliaryWorkers: [
                {
                  config: {
                    name: "sites-connector-preview",
                    main: "./build/connector-preview-worker.mjs",
                    compatibility_date: "2026-05-15",
                  },
                },
              ],
            }
          : {}),
      }),
    ],
  };
});
