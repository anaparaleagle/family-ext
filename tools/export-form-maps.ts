// Prints the built-in form maps as the JSON the backend serves at /forms/ext-maps/.
//   bun tools/export-form-maps.ts > <backend>/family_visa/forms/ext/form_maps.json
import { FLAG_CONFIGS } from "../src/flag/registry";
import { FORM_CONFIGS } from "../src/runner/registry";

const MIN_EXT_VERSION = "0.11.0";

const forms: Record<string, unknown> = {};
for (const c of FORM_CONFIGS) forms[c.formType] = { portal: "myuscis", ...c };
for (const c of FLAG_CONFIGS) forms[c.formType] = { portal: "flag", ...c, urlPattern: c.urlPattern.source };

process.stdout.write(
  JSON.stringify({ schema: 1, min_ext_version: MIN_EXT_VERSION, tuning: {}, forms }, null, 2) + "\n",
);
