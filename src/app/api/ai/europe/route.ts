import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { askOpenAI } from "@/lib/ai/openai-responses";
import { startOfWeek, endOfWeek } from "@/lib/europe/eurofirst";

type Mode = "summary" | "question";

function getAnonClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) throw new Error("Missing Supabase env vars");
  return createClient(url, anon, { auth: { persistSession: false } });
}

function iso(d: Date) {
  return d.toISOString().slice(0, 10);
}

function inRange(d: string | null, a: Date, b: Date) {
  if (!d) return false;
  const x = new Date(d);
  return x >= a && x <= b;
}

function fmtPct(x: number | null | undefined) {
  if (x === null || x === undefined) return "n/a";
  return `${x >= 0 ? "+" : ""}${x.toFixed(2)}%`;
}

function fmtW(x: number | null | undefined) {
  if (x === null || x === undefined) return "n/a";
  return `${(x * 100).toFixed(2)}%`;
}

function median(nums: number[]): number | null {
  const a = nums.filter((n) => Number.isFinite(n)).sort((x, y) => x - y);
  if (a.length === 0) return null;
  const mid = Math.floor(a.length / 2);
  return a.length % 2 ? a[mid] : (a[mid - 1] + a[mid]) / 2;
}

function sectorAggregates(all: any[]) {
  const map = new Map<string, { r5: number[]; r30: number[]; r252: number[] }>();
  for (const r of all) {
    const sector = (r.sector ?? "Unknown") as string;
    if (!map.has(sector)) map.set(sector, { r5: [], r30: [], r252: [] });
    const bucket = map.get(sector)!;
    if (typeof r.return_5d === "number" && Number.isFinite(r.return_5d)) bucket.r5.push(r.return_5d);
    if (typeof r.return_30d === "number" && Number.isFinite(r.return_30d)) bucket.r30.push(r.return_30d);
    if (typeof r.return_252d === "number" && Number.isFinite(r.return_252d)) bucket.r252.push(r.return_252d);
  }
  return Array.from(map.entries()).map(([sector, b]) => ({
    sector,
    n: Math.max(b.r5.length, b.r30.length),
    med5d: median(b.r5),
    med30d: median(b.r30),
    med252d: median(b.r252),
  }));
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { mode: Mode; question?: string; useWeb?: boolean };
    const mode = body.mode;
    const useWeb = !!body.useWeb;

    const supabase = getAnonClient();
    const { data: rows, error } = await supabase
      .from("eu_earnings_companies")
      .select("symbol,name,sector,country,report_date,return_5d,return_30d,return_252d,index_weight")
      .limit(310);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    const all = rows ?? [];
    const now = new Date();
    const wkStart = startOfWeek(now);
    const wkEnd = endOfWeek(now);
    const nextRef = new Date(now.getTime() + 7 * 86400_000);
    const nextWkStart = startOfWeek(nextRef);
    const nextWkEnd = endOfWeek(nextRef);

    const thisWeek = all.filter((r) => inRange(r.report_date, wkStart, wkEnd));
    const nextWeek = all.filter((r) => inRange(r.report_date, nextWkStart, nextWkEnd));

    const topByWeight = [...nextWeek]
      .filter((r) => r.index_weight != null)
      .sort((a, b) => (b.index_weight ?? 0) - (a.index_weight ?? 0))
      .slice(0, 10)
      .map((r) => `${r.symbol} (${fmtW(r.index_weight)}; ${r.name}; ${r.country ?? ""})`)
      .join("\n");

    const topAll5d = [...all]
      .filter((r) => r.return_5d != null)
      .sort((a, b) => (b.return_5d ?? 0) - (a.return_5d ?? 0))
      .slice(0, 10)
      .map((r) => `${r.symbol} (${fmtPct(r.return_5d)}; ${r.name}; ${r.country ?? ""})`)
      .join("\n");

    const topAll30d = [...all]
      .filter((r) => r.return_30d != null)
      .sort((a, b) => (b.return_30d ?? 0) - (a.return_30d ?? 0))
      .slice(0, 10)
      .map((r) => `${r.symbol} (${fmtPct(r.return_30d)}; ${r.name}; ${r.country ?? ""})`)
      .join("\n");

    const sectorAgg = sectorAggregates(all);
    const sector30 = [...sectorAgg].filter((s) => s.med30d !== null).sort((a, b) => (b.med30d ?? -999) - (a.med30d ?? -999));
    const sector5 = [...sectorAgg].filter((s) => s.med5d !== null).sort((a, b) => (b.med5d ?? -999) - (a.med5d ?? -999));

    const context = `
Today: ${now.toDateString()}
This week: ${iso(wkStart)} to ${iso(wkEnd)} (${thisWeek.length} companies reporting)
Next week: ${iso(nextWkStart)} to ${iso(nextWkEnd)} (${nextWeek.length} companies reporting)
Total companies: ${all.length} (European large cap universe)

SECTOR PERFORMANCE (median returns):
Top sectors (30D): ${sector30.slice(0, 5).map((s) => `${s.sector}: ${fmtPct(s.med30d)}`).join(", ")}
Bottom sectors (30D): ${sector30.slice(-5).reverse().map((s) => `${s.sector}: ${fmtPct(s.med30d)}`).join(", ")}
Top sectors (5D): ${sector5.slice(0, 5).map((s) => `${s.sector}: ${fmtPct(s.med5d)}`).join(", ")}

Next week — top by index weight: ${topByWeight || "(no data)"}

European large caps — biggest risers (5D): ${topAll5d || "(no data)"}
European large caps — biggest risers (30D): ${topAll30d || "(no data)"}
`.trim();

    let prompt = "";
    if (mode === "summary") {
      prompt = `Write a concise European large cap market briefing in 3–4 bullet points. Cover: sector rotation, notable movers, and upcoming earnings. No conclusion. No investment advice. If web search is enabled, add recent context with citations.\n\nCONTEXT:\n${context}`;
    } else {
      const q = (body.question ?? "").trim();
      if (!q) return NextResponse.json({ error: "Missing question" }, { status: 400 });
      prompt = `Answer using ONLY the context below. No investment advice. If web search is enabled, add recent context with citations.\n\nUSER QUESTION:\n${q}\n\nCONTEXT:\n${context}`;
    }

    const model = process.env.OPENAI_MODEL || "gpt-4o-mini";
    const result = await askOpenAI({ model, input: prompt, useWebSearch: useWeb });
    return NextResponse.json({ text: result.text, citations: result.citations });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
