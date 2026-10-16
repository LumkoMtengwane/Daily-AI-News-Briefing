/**
 * Run the daily job from your own machine, without Trigger.dev.
 *   npm run local               dry run: search, rank, read and summarise, but write nothing to the Sheet
 *   npm run local -- --live     the same, and write to the Sheet
 * Reads keys from .env.
 */
import { runPipeline, type Logger } from "./pipeline";

const print = (level: string) => (message: string, data?: Record<string, unknown>) =>
  console.log(`${new Date().toISOString().slice(11, 19)} ${level} ${message}${data ? ` ${JSON.stringify(data)}` : ""}`);
const log: Logger = { info: print("INFO"), warn: print("WARN"), error: print("ERROR") };

const live = process.argv.includes("--live");
console.log(live ? "LIVE run: results will be written to the Sheet." : "DRY run: nothing is written to the Sheet.");

runPipeline({ dryRun: !live, log })
  .then((stats) => console.log("Done.", stats))
  .catch((err) => {
    console.error("Failed:", err instanceof Error ? err.message : err);
    process.exit(1);
  });
