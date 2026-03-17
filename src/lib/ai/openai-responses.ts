type WebCitation = { url: string; title?: string };

type AIResult = {
  text: string;
  citations: WebCitation[];
};

function getTextFromResponse(json: any): string {
  if (typeof json?.output_text === "string" && json.output_text.trim()) return json.output_text.trim();

  const out = json?.output;
  if (!Array.isArray(out)) return "";
  const parts: string[] = [];
  for (const item of out) {
    if (item?.type === "message" && Array.isArray(item?.content)) {
      for (const c of item.content) {
        if (c?.type === "output_text" && typeof c?.text === "string") parts.push(c.text);
      }
    }
  }
  return parts.join("\n").trim();
}

function getCitationsFromResponse(json: any): WebCitation[] {
  const out = json?.output;
  if (!Array.isArray(out)) return [];

  const citations: WebCitation[] = [];

  for (const item of out) {
    if (item?.type === "message" && Array.isArray(item?.content)) {
      for (const c of item.content) {
        const annotations = c?.annotations;
        if (!Array.isArray(annotations)) continue;

        for (const a of annotations) {
          const url = a?.url || a?.source?.url;
          const title = a?.title || a?.source?.title;
          if (typeof url === "string" && url.startsWith("http")) {
            citations.push({ url, title });
          }
        }
      }
    }
  }

  const map = new Map<string, WebCitation>();
  for (const c of citations) if (!map.has(c.url)) map.set(c.url, c);
  return Array.from(map.values());
}

export async function askOpenAI({
  model,
  input,
  useWebSearch,
}: {
  model: string;
  input: string;
  useWebSearch: boolean;
}): Promise<AIResult> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("Missing OPENAI_API_KEY in env");

  const body: any = {
    model,
    input,
    store: false,
  };

  if (useWebSearch) {
    body.tools = [
      {
        type: "web_search",
        user_location: {
          type: "approximate",
          country: "GB",
          city: "London",
          region: "London",
        },
      },
    ];
  }

  const resp = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const t = await resp.text().catch(() => "");
    throw new Error(`OpenAI Responses API error (${resp.status}): ${t.slice(0, 500)}`);
  }

  const json = await resp.json();
  const text = getTextFromResponse(json);
  const citations = useWebSearch ? getCitationsFromResponse(json) : [];

  return { text, citations };
}
