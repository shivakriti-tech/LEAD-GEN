import { describe, expect, it } from "vitest";
import { aiName, chainDrafters, geminiDrafter, GEMINI_DEFAULT_MODEL, openaiDrafter, pickDrafter } from "@/lib/brainAnalyze";

const answer = (text: string, finishReason = "STOP") => new Response(JSON.stringify({ candidates: [{ finishReason, content: { parts: [{ text }] } }] }), { status: 200 });
const good = { name: "Shree Logistics", offer: "logistics", summary: "Customs and freight.", services: [{ name: "Customs clearance", price: "₹4,500", logistics: "customs" }], audience_categories: ["exporter", "not-a-type"], usps: ["Own licence"] };

describe("Gemini reads client websites (free Google AI Studio key)", () => {
  it("sends the pages with the key and a JSON answer request, and fills what the model left out", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const f = (async (url: string, init: RequestInit) => (calls.push({ url, init }), answer("```json\n" + JSON.stringify(good) + "\n```"))) as never;
    const d = geminiDrafter({ GEMINI_API_KEY: "g-key" }, f)!;
    expect(d.by).toBe("gemini");
    const out = await d.draft("SYSTEM", "<page>…</page>");
    expect(calls[0].url).toBe(`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_DEFAULT_MODEL}:generateContent`);
    expect((calls[0].init.headers as Record<string, string>)["x-goog-api-key"]).toBe("g-key");
    const body = JSON.parse(String(calls[0].init.body));
    expect(body.generationConfig.responseMimeType).toBe("application/json");
    expect(body.systemInstruction.parts[0].text).toMatch(/^SYSTEM[\s\S]*JSON Schema[\s\S]*"banned_phrases"/);
    expect(out).toMatchObject({ name: "Shree Logistics", audience_categories: ["exporter"], dos: [], price_hook: null, services: [{ name: "Customs clearance", price: "₹4,500", logistics: "customs", description: null }] });
  });

  it("asks again once when the answer doesn't fit the format", async () => {
    let n = 0;
    const f = (async () => (++n === 1 ? answer('{"name": "X"}') : answer(JSON.stringify(good)))) as never;
    const out = await geminiDrafter({ GEMINI_API_KEY: "k" }, f)!.draft("S", "P");
    expect(n).toBe(2);
    expect(out.name).toBe("Shree Logistics");
  });

  it("moves to the newest stable Flash model when the default one is gone", async () => {
    const urls: string[] = [];
    const f = (async (url: string) => {
      urls.push(url);
      if (url.includes(`${GEMINI_DEFAULT_MODEL}:`)) return new Response(JSON.stringify({ error: { message: "not found" } }), { status: 404 });
      if (url.includes("/models?")) return new Response(JSON.stringify({ models: [
        { name: "models/gemini-2.5-flash", supportedGenerationMethods: ["generateContent"] },
        { name: "models/gemini-3.5-flash-lite", supportedGenerationMethods: ["generateContent"] },
        { name: "models/gemini-3.5-flash", supportedGenerationMethods: ["generateContent"] },
        { name: "models/gemini-3.5-pro", supportedGenerationMethods: ["generateContent"] },
        { name: "models/text-embedding-004", supportedGenerationMethods: ["embedContent"] },
      ] }));
      return answer(JSON.stringify(good));
    }) as never;
    await geminiDrafter({ GEMINI_API_KEY: "k" }, f)!.draft("S", "P");
    expect(urls.at(-1)).toContain("/models/gemini-3.5-flash:generateContent");
  });

  it("says plainly when the free limit is used up", async () => {
    const f = (async () => new Response(JSON.stringify({ error: { message: "Resource exhausted" } }), { status: 429 })) as never;
    await expect(geminiDrafter({ GEMINI_API_KEY: "k" }, f)!.draft("S", "P")).rejects.toThrow(/free limit is used up/);
  });

  it("tries GPT, then Gemini, then Claude; BRAIN_AI picks one or turns it off", async () => {
    expect(aiName({ OPENAI_API_KEY: "o", GEMINI_API_KEY: "g", ANTHROPIC_API_KEY: "a" })).toBe("GPT → Gemini → Claude");
    expect(aiName({ GEMINI_API_KEY: "g", ANTHROPIC_API_KEY: "a" })).toBe("Gemini → Claude");
    expect(aiName({ ANTHROPIC_API_KEY: "a" })).toBe("Claude");
    expect(aiName({ GEMINI_API_KEY: "g", ANTHROPIC_API_KEY: "a", BRAIN_AI: "claude" })).toBe("Claude");
    expect(aiName({ OPENAI_API_KEY: "o", GEMINI_API_KEY: "g", BRAIN_AI: "gemini" })).toBe("Gemini");
    expect(aiName({ GEMINI_API_KEY: "g", BRAIN_AI: "off" })).toBeUndefined();
    expect((await pickDrafter({ GEMINI_API_KEY: "g", ANTHROPIC_API_KEY: "a" }))?.by).toBe("gemini");
    expect((await pickDrafter({ OPENAI_API_KEY: "o", GEMINI_API_KEY: "g" }))?.by).toBe("gpt");
    expect(await pickDrafter({})).toBeUndefined();
  });

  it("GPT (OpenAI-compatible gateway) reads the site through the configured base URL and model", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const f = (async (url: string, init: RequestInit) => (calls.push({ url, init }), new Response(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify(good) } }] })))) as never;
    const d = openaiDrafter({ OPENAI_API_KEY: "o-key", OPENAI_BASE_URL: "https://gw.example/v1/", OPENAI_MODEL: "gpt-x" }, f)!;
    const out = await d.draft("SYSTEM", "<page/>");
    expect(calls[0].url).toBe("https://gw.example/v1/chat/completions");
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBe("Bearer o-key");
    expect(JSON.parse(String(calls[0].init.body)).model).toBe("gpt-x");
    expect(out.name).toBe("Shree Logistics");
  });

  it("falls to the next AI when GPT is down or its answer is bad, and reports who answered", async () => {
    const down = openaiDrafter({ OPENAI_API_KEY: "o" }, (async () => new Response(JSON.stringify({ error: { message: "No available channel" } }), { status: 503 })) as never)!;
    const gem = geminiDrafter({ GEMINI_API_KEY: "g" }, (async () => answer(JSON.stringify(good))) as never)!;
    const chain = chainDrafters([down, gem])!;
    expect((await chain.draft("S", "P")).name).toBe("Shree Logistics");
    expect(chain.by).toBe("gemini");
    const empty = { by: "gpt" as const, draft: async () => ({ ...(await gem.draft("S", "P")), name: " ", services: [], summary: "" }) };
    const c2 = chainDrafters([empty, gem])!;
    await c2.draft("S", "P");
    expect(c2.by).toBe("gemini");
    await expect(chainDrafters([down, down])!.draft("S", "P")).rejects.toThrow(/GPT: No available channel/);
  });
});
