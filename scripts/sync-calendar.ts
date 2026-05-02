/**
 * sync-calendar.ts
 * Builds the economic calendar from two sources:
 *   1. Hardcoded central bank meeting dates (update annually from official sources)
 *   2. Algorithmically calculated monthly release dates
 *
 * Central bank sources to verify annually:
 *   Fed:  https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm
 *   ECB:  https://www.ecb.europa.eu/press/govcdec/mopo/html/index.en.html
 *   BoE:  https://www.bankofengland.co.uk/monetary-policy/monetary-policy-committee
 *   BoJ:  https://www.boj.or.jp/en/mopo/mpmsche_mead/mpmsche/index.htm
 *
 * Run: npm run sync:calendar
 */

import { getServiceRoleClient } from "@/lib/supabase-server";

// ---------------------------------------------------------------------------
// Central bank meeting dates
// Decision is announced on the date listed.
// VERIFY these each January from the official sources above.
// ---------------------------------------------------------------------------

const CB_EVENTS: Array<{ event: string; country: string; dates: string[] }> = [
  {
    event: "FOMC Rate Decision",
    country: "United States",
    dates: [
      "2026-01-28", "2026-03-18", "2026-04-29", "2026-06-17",
      "2026-07-29", "2026-09-16", "2026-10-28", "2026-12-09",
      "2027-01-27", "2027-03-17", "2027-04-28", "2027-06-09",
      "2027-07-28", "2027-09-15", "2027-10-27", "2027-12-08",
    ],
  },
  {
    // Verified May 2026 from ecb.europa.eu — decision announced on Day 2
    event: "ECB Rate Decision",
    country: "Eurozone",
    dates: [
      "2026-01-30", "2026-03-06", "2026-04-17", "2026-06-11",
      "2026-07-23", "2026-09-10", "2026-10-29", "2026-12-17",
      "2027-02-04", "2027-03-18", "2027-04-29", "2027-06-10",
      "2027-07-22", "2027-09-09", "2027-10-28", "2027-12-16",
    ],
  },
  {
    // Verified May 2026 from bankofengland.co.uk — provisional 2027 dates
    event: "BoE Rate Decision",
    country: "United Kingdom",
    dates: [
      "2026-02-05", "2026-03-19", "2026-04-30", "2026-06-18",
      "2026-07-30", "2026-09-17", "2026-11-05", "2026-12-17",
      "2027-02-04", "2027-03-18", "2027-04-29", "2027-06-17",
      "2027-07-29", "2027-09-16", "2027-11-04", "2027-12-16",
    ],
  },
  {
    // Verified May 2026 from boj.or.jp — decision announced on second day of meeting
    // 2027 dates not yet available
    event: "BoJ Rate Decision",
    country: "Japan",
    dates: [
      "2026-01-23", "2026-03-19", "2026-04-28", "2026-06-16",
      "2026-07-31", "2026-09-18", "2026-10-30", "2026-12-18",
    ],
  },
];

// ---------------------------------------------------------------------------
// Date calculation helpers
// ---------------------------------------------------------------------------

function isoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// First occurrence of a weekday (0=Sun ... 6=Sat) in a given month
function firstWeekday(year: number, month: number, weekday: number): Date {
  const d = new Date(year, month - 1, 1);
  while (d.getDay() !== weekday) d.setDate(d.getDate() + 1);
  return d;
}

// Nth business day (Mon–Fri) of a month
function nthBusinessDay(year: number, month: number, n: number): Date {
  const d = new Date(year, month - 1, 1);
  let count = 0;
  while (true) {
    const day = d.getDay();
    if (day !== 0 && day !== 6) {
      count++;
      if (count === n) return d;
    }
    d.setDate(d.getDate() + 1);
  }
}

// Last occurrence of a weekday in a month
function lastWeekday(year: number, month: number, weekday: number): Date {
  const d = new Date(year, month, 0); // last day of month
  while (d.getDay() !== weekday) d.setDate(d.getDate() - 1);
  return d;
}

// Approximate mid-month date for CPI-style releases (typically around the 12th–15th)
function approxMidMonth(year: number, month: number, targetDay: number): Date {
  return new Date(year, month - 1, targetDay);
}

// ---------------------------------------------------------------------------
// Generate monthly release events for a rolling window
// ---------------------------------------------------------------------------

type CalendarEvent = {
  event: string;
  country: string;
  event_date: string;
  impact: string;
  actual: string | null;
  estimate: string | null;
  previous: string | null;
  unit: string | null;
};

function generateMonthlyEvents(year: number, month: number): CalendarEvent[] {
  const events: CalendarEvent[] = [];

  const add = (event: string, country: string, date: Date) => {
    events.push({
      event,
      country,
      event_date: `${isoDate(date)} 00:00:00`,
      impact: "High",
      actual: null,
      estimate: null,
      previous: null,
      unit: null,
    });
  };

  // ── US releases ───────────────────────────────────────────────────────────

  // NFP: first Friday of the month (covers prior month's data)
  add("Non-Farm Payrolls", "United States", firstWeekday(year, month, 5));

  // ISM Manufacturing PMI: first business day
  add("ISM Manufacturing PMI", "United States", nthBusinessDay(year, month, 1));

  // ISM Services PMI: third business day
  add("ISM Services PMI", "United States", nthBusinessDay(year, month, 3));

  // US CPI: typically around the 10th–13th (BLS schedule varies slightly)
  add("US CPI", "United States", approxMidMonth(year, month, 12));

  // GDP advance estimate: last Thursday of Jan, Apr, Jul, Oct (quarterly)
  if ([1, 4, 7, 10].includes(month)) {
    add("US GDP (Advance)", "United States", lastWeekday(year, month, 4));
  }

  // Flash PMIs (S&P Global): typically around the 22nd–23rd
  add("US Flash Manufacturing PMI", "United States", approxMidMonth(year, month, 22));
  add("US Flash Services PMI",      "United States", approxMidMonth(year, month, 22));

  // ── Eurozone releases ─────────────────────────────────────────────────────

  // Eurozone Flash CPI: last day of the reference month or first of next
  add("Eurozone Flash CPI", "Eurozone", approxMidMonth(year, month, 30));

  // Eurozone Flash PMIs: typically around the 22nd–23rd
  add("Eurozone Flash Manufacturing PMI", "Eurozone", approxMidMonth(year, month, 23));
  add("Eurozone Flash Services PMI",      "Eurozone", approxMidMonth(year, month, 23));

  // Eurozone GDP flash: quarterly — last Thursday of Apr, Jul, Oct, Jan
  if ([1, 4, 7, 10].includes(month)) {
    add("Eurozone GDP (Flash)", "Eurozone", lastWeekday(year, month, 4));
  }

  // ── UK releases ───────────────────────────────────────────────────────────

  // UK CPI: typically mid-month, around the 15th (ONS)
  add("UK CPI", "United Kingdom", approxMidMonth(year, month, 15));

  // UK Flash PMIs: typically around the 23rd
  add("UK Flash Manufacturing PMI", "United Kingdom", approxMidMonth(year, month, 23));
  add("UK Flash Services PMI",      "United Kingdom", approxMidMonth(year, month, 23));

  // ── Germany ───────────────────────────────────────────────────────────────

  // German Flash PMIs: same day as Eurozone (released first, then Eurozone composite)
  add("Germany Flash Manufacturing PMI", "Germany", approxMidMonth(year, month, 23));
  add("Germany Flash Services PMI",      "Germany", approxMidMonth(year, month, 23));

  return events;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const supabase = getServiceRoleClient();
  const now = new Date();
  const rows: Array<CalendarEvent & { last_updated: string }> = [];

  // ── Central bank events ───────────────────────────────────────────────────
  for (const { event, country, dates } of CB_EVENTS) {
    for (const date of dates) {
      rows.push({
        event,
        country,
        event_date: `${date} 00:00:00`,
        impact: "High",
        actual: null,
        estimate: null,
        previous: null,
        unit: null,
        last_updated: now.toISOString(),
      });
    }
  }

  // ── Monthly releases: current month + next 3 months ───────────────────────
  for (let i = 0; i < 4; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
    const events = generateMonthlyEvents(d.getFullYear(), d.getMonth() + 1);
    for (const e of events) {
      rows.push({ ...e, last_updated: now.toISOString() });
    }
  }

  console.log(`[calendar] Upserting ${rows.length} events...`);

  let updated = 0;
  const errors: string[] = [];

  for (const row of rows) {
    const { error } = await supabase
      .from("economic_calendar")
      .upsert(row, { onConflict: "event,event_date,country" });

    if (error) {
      errors.push(`${row.event} (${row.event_date}): ${error.message}`);
    } else {
      updated++;
    }
  }

  // Log what's coming up in the next 14 days
  const soon = new Date(now.getTime() + 14 * 86400_000).toISOString().slice(0, 10);
  const upcoming = rows
    .filter((r) => r.event_date >= now.toISOString().slice(0, 10) && r.event_date <= `${soon} 23:59:59`)
    .sort((a, b) => a.event_date.localeCompare(b.event_date));

  console.log(`\n[calendar] Upcoming events (next 14 days):`);
  for (const e of upcoming) {
    console.log(`  ${e.event_date.slice(0, 10)}  ${e.country.padEnd(15)} ${e.event}`);
  }

  console.log(`\n[calendar] Done — upserted: ${updated} | errors: ${errors.length}`);
  if (errors.length > 0) console.log("[calendar] Errors:", errors);
}

main().catch((e) => {
  console.error(`[calendar] fatal: ${e instanceof Error ? e.message : String(e)}`);
  process.exitCode = 1;
});
