import { logger, schedules, task } from "@trigger.dev/sdk";
import { runPipeline } from "../src/pipeline";

/** Runs by itself every day at 07:00 South African time (production only). */
export const dailyAiNews = schedules.task({
  id: "daily-ai-news",
  cron: {
    pattern: "0 7 * * *",
    timezone: "Africa/Johannesburg",
    // Production only, so the dev server never runs a second copy of the job.
    environments: ["PRODUCTION"],
  },
  maxDuration: 600,
  retry: { maxAttempts: 3, factor: 2, minTimeoutInMs: 5000, maxTimeoutInMs: 60000, randomize: true },
  run: async () => {
    const stats = await runPipeline({ dryRun: false, log: logger });
    return stats;
  },
});

/**
 * Manual trigger for testing from the dashboard or the MCP.
 * Payload: { "dryRun": true } searches and summarises but writes nothing to the Sheet.
 */
export const aiNewsManual = task({
  id: "ai-news-manual",
  maxDuration: 600,
  run: async (payload: { dryRun?: boolean }) => {
    return runPipeline({ dryRun: payload?.dryRun ?? true, log: logger });
  },
});
