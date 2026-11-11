// Types for dev-manifest.mjs. The module stays plain ESM because
// esbuild.config.mjs runs it under bare `node`, with no compile step — but
// test/store-build.test.ts imports it too, and `tsc --noEmit` covers the tests.

/** The origins a dev build adds on top of the store manifest. */
export declare const DEV_HOST_PERMISSIONS: string[];

/** Does this argv ask for a dev extension (`--dev` or `--watch`)? */
export declare function isDevBuild(argv: string[]): boolean;

/** The host_permissions to write into dist/manifest.json for this argv. */
export declare function hostPermissionsFor(
  argv: string[],
  storeHostPermissions: string[],
): string[];
