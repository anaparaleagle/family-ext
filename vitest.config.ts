import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // happy-dom gives us a real-enough DOM for value-setter + page-walk tests.
    // The Formik React-fiber bridge cannot be unit-tested here (no React fiber);
    // it is covered by live agent-browser verification instead.
    environment: "happy-dom",
    globals: true,
    include: ["test/**/*.test.ts"],
  },
});
