/** Google Sheets through a service account. The Sheet must be shared with the service account email. */
import { auth as googleAuth, sheets as sheetsApi, type sheets_v4 } from "@googleapis/sheets";
import { CATEGORIES } from "./config";
import { normaliseUrl } from "./dedupe";
import type { RunStats, Summarised } from "./types";

export const NEWS_TAB = "News";
export const RUNS_TAB = "Runs";
export const NEWS_HEADER = ["Date", "Category", "Importance", "Headline", "Companies", "Summary", "Why it matters", "Source", "URL"];
export const RUNS_HEADER = ["Date", "Candidates", "After dedupe", "Kept", "Written", "Firecrawl credits", "Tokens in",
  "Tokens out", "Est. cost (USD)", "Seconds", "Errors"];

const URL_COL = "I";
const CATEGORY_COLOURS: Record<string, string> = {
  "M&A and funding": "#cfe2f3", "Model releases": "#d9ead3", "Products and tools": "#fff2cc",
  "Policy and regulation": "#ead1dc", Other: "#e6e6e6",
};
const NEWS_WIDTHS = [95, 150, 85, 320, 170, 420, 320, 130, 260];
const HEADER_BG = "#1f3a5f";

export type SheetsClient = sheets_v4.Sheets;

export function connect(): SheetsClient {
  const b64 = process.env.GOOGLE_SERVICE_ACCOUNT_B64;
  if (!b64) throw new Error("GOOGLE_SERVICE_ACCOUNT_B64 is not set");
  const credentials = JSON.parse(Buffer.from(b64, "base64").toString("utf8"));
  // "spreadsheets" only reaches Sheets that are shared with this service account.
  const auth = new googleAuth.GoogleAuth({ credentials, scopes: ["https://www.googleapis.com/auth/spreadsheets"] });
  return sheetsApi({ version: "v4", auth });
}

const rgb = (hex: string) => {
  const h = hex.replace("#", "");
  return { red: parseInt(h.slice(0, 2), 16) / 255, green: parseInt(h.slice(2, 4), 16) / 255, blue: parseInt(h.slice(4, 6), 16) / 255 };
};

/** Create the two tabs and style the News tab the first time. Safe to call every run. */
export async function ensureSetup(api: SheetsClient, spreadsheetId: string): Promise<void> {
  const meta = await api.spreadsheets.get({ spreadsheetId, fields: "sheets.properties(sheetId,title)" });
  const tabs = new Map((meta.data.sheets ?? []).map((s) => [s.properties?.title ?? "", s.properties?.sheetId ?? 0]));

  // A brand-new Sheet starts with an empty "Sheet1". Reuse it as the News tab instead of leaving it behind.
  if (!tabs.has(NEWS_TAB) && tabs.has("Sheet1")) {
    const first = await api.spreadsheets.values.get({ spreadsheetId, range: "Sheet1!A1:Z5" });
    if (!first.data.values?.length) {
      const sheetId = tabs.get("Sheet1")!;
      await api.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: { requests: [{ updateSheetProperties: { properties: { sheetId, title: NEWS_TAB }, fields: "title" } }] },
      });
      tabs.delete("Sheet1");
      tabs.set(NEWS_TAB, sheetId);
    }
  }

  const adds = [NEWS_TAB, RUNS_TAB].filter((t) => !tabs.has(t)).map((title) => ({ addSheet: { properties: { title } } }));
  if (adds.length) {
    const res = await api.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests: adds } });
    for (const r of res.data.replies ?? []) {
      const p = r.addSheet?.properties;
      if (p?.title) tabs.set(p.title, p.sheetId ?? 0);
    }
  }

  for (const [tab, header] of [[NEWS_TAB, NEWS_HEADER], [RUNS_TAB, RUNS_HEADER]] as const) {
    const got = await api.spreadsheets.values.get({ spreadsheetId, range: `${tab}!A1:A1` });
    if (got.data.values?.[0]?.[0]) continue; // already set up
    await api.spreadsheets.values.update({
      spreadsheetId, range: `${tab}!A1`, valueInputOption: "RAW", requestBody: { values: [header as unknown as string[]] },
    });
    await api.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: { requests: styleRequests(tabs.get(tab)!, header.length, tab === NEWS_TAB) },
    });
  }
}

function styleRequests(sheetId: number, cols: number, isNews: boolean): sheets_v4.Schema$Request[] {
  const grid = { sheetId, startColumnIndex: 0, endColumnIndex: cols };
  const reqs: sheets_v4.Schema$Request[] = [
    { repeatCell: { range: { ...grid, startRowIndex: 1 }, cell: { userEnteredFormat: { wrapStrategy: "WRAP", verticalAlignment: "TOP" } },
        fields: "userEnteredFormat(wrapStrategy,verticalAlignment)" } },
    { repeatCell: { range: { ...grid, startRowIndex: 0, endRowIndex: 1 },
        cell: { userEnteredFormat: { backgroundColor: rgb(HEADER_BG), verticalAlignment: "MIDDLE", wrapStrategy: "WRAP",
          textFormat: { bold: true, foregroundColor: rgb("#ffffff") } } },
        fields: "userEnteredFormat(backgroundColor,verticalAlignment,wrapStrategy,textFormat)" } },
    { updateSheetProperties: { properties: { sheetId, gridProperties: { frozenRowCount: 1 } }, fields: "gridProperties.frozenRowCount" } },
    { setBasicFilter: { filter: { range: { ...grid, startRowIndex: 0 } } } },
  ];
  const widths = isNews ? NEWS_WIDTHS : Array(cols).fill(120);
  widths.forEach((pixelSize, i) => reqs.push({ updateDimensionProperties: {
    range: { sheetId, dimension: "COLUMNS", startIndex: i, endIndex: i + 1 }, properties: { pixelSize }, fields: "pixelSize" } }));
  if (isNews) {
    // Colour the Category cell. Rows are written with OVERWRITE, so these ranges never shift.
    const category = { sheetId, startRowIndex: 1, startColumnIndex: 1, endColumnIndex: 2 };
    for (const name of CATEGORIES) {
      reqs.push({ addConditionalFormatRule: { index: 0, rule: { ranges: [category], booleanRule: {
        condition: { type: "TEXT_EQ", values: [{ userEnteredValue: name }] },
        format: { backgroundColor: rgb(CATEGORY_COLOURS[name]) } } } } });
    }
    // Bold the importance of the biggest stories (4 and 5).
    reqs.push({ addConditionalFormatRule: { index: 0, rule: {
      ranges: [{ sheetId, startRowIndex: 1, startColumnIndex: 2, endColumnIndex: 3 }],
      booleanRule: { condition: { type: "NUMBER_GREATER_THAN_EQ", values: [{ userEnteredValue: "4" }] },
        format: { textFormat: { bold: true, foregroundColor: rgb("#cc0000") } } } } } });
  }
  return reqs;
}

/** Normalised URLs of the most recent rows, so stories are never logged twice. */
export async function recentUrls(api: SheetsClient, spreadsheetId: string, lastN: number): Promise<Set<string>> {
  const res = await api.spreadsheets.values.get({ spreadsheetId, range: `${NEWS_TAB}!${URL_COL}2:${URL_COL}` });
  const urls = (res.data.values ?? []).map((r) => String(r[0] ?? "")).filter(Boolean);
  return new Set(urls.slice(-lastN).map(normaliseUrl));
}

/** Headlines of the most recent rows, so the model can spot a story that is already logged. */
export async function recentHeadlines(api: SheetsClient, spreadsheetId: string, lastN: number): Promise<string[]> {
  const res = await api.spreadsheets.values.get({ spreadsheetId, range: `${NEWS_TAB}!A2:E` });
  return (res.data.values ?? [])
    .map((r) => {
      const headline = String(r[3] ?? "").trim();
      const companies = String(r[4] ?? "").trim();
      return headline && companies ? `${headline} (${companies})` : headline; // companies help match the same event
    })
    .filter(Boolean)
    .slice(-lastN);
}

/** OVERWRITE writes into the next empty row, so styling and conditional-format ranges stay put. */
async function appendRow(api: SheetsClient, spreadsheetId: string, tab: string, rows: (string | number)[][]) {
  if (!rows.length) return;
  await api.spreadsheets.values.append({
    spreadsheetId, range: `${tab}!A1`,
    valueInputOption: "RAW", // RAW stores text as text, so a headline starting with "=" can never run as a formula
    insertDataOption: "OVERWRITE", requestBody: { values: rows },
  });
}

export const newsRow = (date: string, s: Summarised): (string | number)[] => [
  date, s.category, s.importance, s.candidate.title, s.companies.join(", "), s.summary,
  s.whyItMatters, s.candidate.source, s.candidate.url,
];

export async function appendNews(api: SheetsClient, id: string, date: string, items: Summarised[]) {
  await appendRow(api, id, NEWS_TAB, items.map((s) => newsRow(date, s)));
}

export async function appendRun(api: SheetsClient, id: string, r: RunStats) {
  await appendRow(api, id, RUNS_TAB, [[r.date, r.candidates, r.afterDedupe, r.kept, r.written, r.firecrawlCredits,
    r.tokensIn, r.tokensOut, Number(r.estCostUsd.toFixed(4)), r.seconds, r.errors]]);
}

