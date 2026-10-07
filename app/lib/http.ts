/** Small helpers for API routes. */

/** The request body as text, or undefined when it's bigger than `max` bytes (stops reading there). */
export async function readCapped(req: Request, max: number): Promise<string | undefined> {
  if (Number(req.headers.get("content-length") ?? 0) > max) return undefined;
  if (!req.body) return "";
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel().catch(() => {});
      return undefined;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}
