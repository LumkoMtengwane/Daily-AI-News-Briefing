# Cost estimate

**Status: measured on dry runs (2026-10-15), not yet on the scheduled production run.** The `Runs` tab records real usage for every live run. Check it after the first week and update these numbers.

## Per daily run (measured)
| Item | Measured | Cost |
|---|---|---|
| Firecrawl: 9 searches (about 90 results) | 2 credits each | 18 credits |
| Firecrawl: article reads | up to 8 pages, 1 credit each | up to 8 credits |
| Firecrawl: retries when a search returns nothing | occasional | 0 to 4 credits |
| Claude Haiku 5.5: ranking and summarising | about 12-23k tokens in, 3-4k out | about $0.003 to $0.004 |
| Trigger.dev | one run, about 2.5 minutes | a tiny part of the free $5 credit |
| Google Sheets and service account | free | $0 |

Haiku 5.5 list price: $0.10 per million input tokens, $0.50 per million output tokens (checked 2026-10-15, prompts up to 100K tokens).

## Per month (30 runs)
- **Firecrawl:** about 26 credits a day, **about 780 of the free 1,000**. The free plan refreshes monthly. Test runs on your own machine use the same pool, so avoid many manual runs late in the month.
- **Anthropic:** about $0.13, roughly R2.30 (assumes about R18 per US dollar, check the rate).
- **Trigger.dev:** about 30 runs, far inside the free $5 monthly credit. Dev runs are not charged.
- **Total: about R2 to R4 a month**, almost all of it Anthropic.

## What could change it
- Firecrawl is the tightest limit. More searches or articles push it over 1,000 credits: at 9 searches and 8 articles there is room for roughly one more search a day. The free plan stops rather than bills, so the worst case is a failed run and an alert.
- Longer articles raise input tokens. Each article is capped at 4,000 characters.
- If Haiku summaries are not good enough, moving the summary call to Sonnet 5.5 ($2 / $10 per million) costs about 20 times more for that call, still under about R40 a month.
