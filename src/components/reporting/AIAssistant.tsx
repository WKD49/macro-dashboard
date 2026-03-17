"use client";

import * as React from "react";

type Citation = { url: string; title?: string };

export function AIAssistant({ apiPath }: { apiPath: string }) {
  const [summary, setSummary] = React.useState<string>("");
  const [summaryCitations, setSummaryCitations] = React.useState<Citation[]>([]);
  const [loadingSummary, setLoadingSummary] = React.useState(true);

  const [q, setQ] = React.useState("");
  const [answer, setAnswer] = React.useState<string>("");
  const [answerCitations, setAnswerCitations] = React.useState<Citation[]>([]);
  const [loadingAnswer, setLoadingAnswer] = React.useState(false);

  const [useWeb, setUseWeb] = React.useState(false);
  const [error, setError] = React.useState<string>("");

  async function fetchSummary() {
    setLoadingSummary(true);
    setError("");
    try {
      const res = await fetch(apiPath, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "summary", useWeb }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? "Failed to load summary");
      setSummary(json.text ?? "");
      setSummaryCitations(Array.isArray(json.citations) ? json.citations : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoadingSummary(false);
    }
  }

  async function ask() {
    const question = q.trim();
    if (!question) return;

    setLoadingAnswer(true);
    setAnswer("");
    setAnswerCitations([]);
    setError("");

    try {
      const res = await fetch(apiPath, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "question", question, useWeb }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? "Failed to get answer");
      setAnswer(json.text ?? "");
      setAnswerCitations(Array.isArray(json.citations) ? json.citations : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoadingAnswer(false);
    }
  }

  React.useEffect(() => {
    fetchSummary();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function Citations({ items }: { items: Citation[] }) {
    if (!items?.length) return null;
    return (
      <div className="mt-3 rounded-md border bg-gray-50 p-3">
        <div className="text-xs font-semibold text-gray-700">Sources</div>
        <ul className="mt-2 list-disc pl-5 text-xs text-gray-700">
          {items.slice(0, 8).map((c) => (
            <li key={c.url} className="break-all">
              <a className="underline" href={c.url} target="_blank" rel="noreferrer">
                {c.title ? c.title : c.url}
              </a>
            </li>
          ))}
        </ul>
        {items.length > 8 ? <div className="mt-2 text-xs text-gray-500">+ {items.length - 8} more</div> : null}
      </div>
    );
  }

  return (
    <div className="rounded-lg border bg-white p-4">
      <div className="flex items-baseline justify-between">
        <h2 className="text-lg font-semibold">AI summary</h2>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-xs text-gray-700">
            <input
              type="checkbox"
              checked={useWeb}
              onChange={(e) => setUseWeb(e.target.checked)}
            />
            Use web context (slower)
          </label>
          <button
            onClick={fetchSummary}
            className="rounded-md border px-3 py-1 text-sm"
            disabled={loadingSummary}
          >
            Refresh
          </button>
        </div>
      </div>

      {loadingSummary ? (
        <p className="mt-2 text-sm text-gray-600">Generating summary…</p>
      ) : summary ? (
        <>
          <p className="mt-2 whitespace-pre-wrap text-sm text-gray-800">{summary}</p>
          <Citations items={summaryCitations} />
        </>
      ) : (
        <p className="mt-2 text-sm text-gray-600">No summary yet.</p>
      )}

      <div className="mt-4 border-t pt-4">
        <label className="block text-sm font-medium text-gray-700">Ask a question</label>
        <div className="mt-1 flex gap-2">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="e.g. Which stocks have been the biggest risers of late?"
            className="w-full rounded-md border px-3 py-2 text-sm outline-none focus:ring"
            onKeyDown={(e) => {
              if (e.key === "Enter") ask();
            }}
          />
          <button onClick={ask} className="rounded-md border px-3 py-2 text-sm" disabled={loadingAnswer}>
            Ask
          </button>
        </div>
        {loadingAnswer ? <p className="mt-2 text-sm text-gray-600">Thinking…</p> : null}
        {answer ? (
          <>
            <p className="mt-2 whitespace-pre-wrap text-sm text-gray-800">{answer}</p>
            <Citations items={answerCitations} />
          </>
        ) : null}
        {error ? <p className="mt-2 text-sm text-red-600">{error}</p> : null}
      </div>
    </div>
  );
}
