// Which host_permissions a build ships, by build mode. Its own module, with no
// side effects, so test/store-build.test.ts can ask it the question directly
// instead of regex-reading the answer out of esbuild.config.mjs — the gate is
// the part worth guarding, and a regex cannot evaluate a gate.
//
// The committed manifest.json is the STORE manifest. The popup renders its
// Backend dropdown from host_permissions at runtime, so these entries are the
// whole mechanism by which Local and Staging appear on a laptop and nowhere
// else. Keep in step with DEV_ONLY_OPTIONS in src/engine/api-config.ts.

/** The origins a dev build adds on top of the store manifest. */
export const DEV_HOST_PERMISSIONS = [
  "http://localhost/*",
  "https://paraleagle-family-backend-demo.onrender.com/*",
];

/**
 * Does this argv ask for a DEV extension?
 *
 * Two flags, because they answer different questions. `--watch` asks "stay
 * running and rebuild on save"; `--dev` (npm run build:dev) asks "build the dev
 * extension once and exit" — for side-loading a packed build to file a Local or
 * Staging case without leaving a watcher running. Watching implies dev; dev does
 * not imply watching. Bare `npm run build`, with neither flag, is the only
 * invocation that produces the store build.
 */
export function isDevBuild(argv) {
  return argv.includes("--dev") || argv.includes("--watch");
}

/** The host_permissions to write into dist/manifest.json for this argv. */
export function hostPermissionsFor(argv, storeHostPermissions) {
  const perms = [...storeHostPermissions];
  if (!isDevBuild(argv)) return perms;
  for (const perm of DEV_HOST_PERMISSIONS) {
    if (!perms.includes(perm)) perms.push(perm);
  }
  return perms;
}
