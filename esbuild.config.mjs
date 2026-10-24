import * as esbuild from "esbuild";
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from "fs";
import { hostPermissionsFor, isDevBuild } from "./tools/dev-manifest.mjs";

// `--watch` asks "stay running and rebuild on save"; `--dev` asks "build the dev
// extension once and exit". Watching implies dev, dev does not imply watching —
// see tools/dev-manifest.mjs, which owns that rule and the dev origins.
const isWatch = process.argv.includes("--watch");
const isDev = isDevBuild(process.argv);

// Start from an empty dist. The store package is "the CONTENTS of dist/" (see
// store-assets/LISTING.md), and esbuild only ever overwrites the files it is
// emitting now — so a `npm run build:dev` followed by `npm run build` used to
// leave that dev build's .js.map files sitting in the zip. Sourcemaps of an
// unminified build are not a rejection on their own, but they ship our source
// to anyone who unzips the item, and nothing downstream was checking.
rmSync("dist", { recursive: true, force: true });
mkdirSync("dist", { recursive: true });

// Copy the manifest, widening host_permissions for a dev build. Guarded by
// test/store-build.test.ts.
const manifest = JSON.parse(readFileSync("manifest.json", "utf-8"));
manifest.host_permissions = hostPermissionsFor(process.argv, manifest.host_permissions);
writeFileSync("dist/manifest.json", JSON.stringify(manifest, null, 2));
cpSync("src/popup/popup.html", "dist/popup.html");
cpSync("src/popup/popup.css", "dist/popup.css");
if (existsSync("icons")) cpSync("icons", "dist/icons", { recursive: true });

// Slack telemetry webhook, injected at build time — never committed (GitHub push
// protection blocks a webhook URL in source). Set SLACK_TELEMETRY_WEBHOOK in the
// env, or drop the URL into a gitignored `.slack-webhook` file. Unset → the
// telemetry silently no-ops.
let slackWebhook = process.env.SLACK_TELEMETRY_WEBHOOK ?? "";
if (!slackWebhook && existsSync(".slack-webhook")) {
  slackWebhook = readFileSync(".slack-webhook", "utf-8").trim();
}

const buildOptions = {
  bundle: true,
  minify: !isDev,
  sourcemap: isDev,
  target: "chrome120",
  format: "iife",
  define: { __SLACK_WEBHOOK__: JSON.stringify(slackWebhook) },
  ...(!isDev && { drop: ["console"] }),
};

const entries = [
  { in: "src/popup/popup.ts", out: "dist/popup.js" },
  { in: "src/runner/content.ts", out: "dist/content.js" },
  { in: "src/flag/content.ts", out: "dist/flag-content.js" },
  { in: "src/engine/formik-bridge.ts", out: "dist/formik-bridge.js" },
  { in: "src/engine/download-proxy.ts", out: "dist/download-proxy.js" },
];

async function build() {
  if (isWatch) {
    const contexts = await Promise.all(
      entries.map((e) => esbuild.context({ ...buildOptions, entryPoints: [e.in], outfile: e.out })),
    );
    await Promise.all(contexts.map((ctx) => ctx.watch()));
    console.log("Watching for changes…");
  } else {
    await Promise.all(
      entries.map((e) => esbuild.build({ ...buildOptions, entryPoints: [e.in], outfile: e.out })),
    );
    console.log(isDev ? "Dev build complete (Local + Staging offered)." : "Build complete.");
  }
}

build().catch((e) => {
  console.error(e);
  process.exit(1);
});
