import { defineConfig } from "@trigger.dev/sdk";

export default defineConfig({
  // Not a secret: identifies the Trigger.dev project.
  project: "proj_kucscsesdwkocgmbinlq",
  dirs: ["./trigger"],
  // Default ceiling per run, in seconds. A normal run takes one to two minutes.
  maxDuration: 600,
  retries: {
    enabledInDev: false,
    default: { maxAttempts: 3, minTimeoutInMs: 5000, maxTimeoutInMs: 60000, factor: 2, randomize: true },
  },
  runtime: "node-22",
});
