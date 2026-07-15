import * as esbuild from "esbuild";
import { cpSync, mkdirSync, readFileSync, writeFileSync, existsSync } from "fs";

const isWatch = process.argv.includes("--watch");

mkdirSync("dist", { recursive: true });

// Copy + (in watch) widen the manifest for local dev.
const manifest = JSON.parse(readFileSync("manifest.json", "utf-8"));
if (isWatch && !manifest.host_permissions.includes("http://localhost/*")) {
  manifest.host_permissions.push("http://localhost/*");
}
writeFileSync("dist/manifest.json", JSON.stringify(manifest, null, 2));
cpSync("src/popup/popup.html", "dist/popup.html");
cpSync("src/popup/popup.css", "dist/popup.css");
if (existsSync("icons")) cpSync("icons", "dist/icons", { recursive: true });

const buildOptions = {
  bundle: true,
  minify: !isWatch,
  sourcemap: isWatch,
  target: "chrome120",
  format: "iife",
  ...(!isWatch && { drop: ["console"] }),
};

const entries = [
  { in: "src/popup/popup.ts", out: "dist/popup.js" },
  { in: "src/runner/content.ts", out: "dist/content.js" },
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
    console.log("Build complete.");
  }
}

build().catch((e) => {
  console.error(e);
  process.exit(1);
});
