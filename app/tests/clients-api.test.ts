import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const dir = mkdtempSync(path.join(tmpdir(), "brain-"));
const cwd = process.cwd();
beforeAll(() => {
  process.chdir(dir);
  vi.resetModules();
});
afterAll(() => {
  process.chdir(cwd);
  rmSync(dir, { recursive: true, force: true });
});

const json = (body: unknown) => new Request("http://x/api/clients", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

describe("clients API (saved on this computer)", () => {
  it("creates, lists, edits and deletes a client, and rejects a bad one", async () => {
    const list = await import("@/app/api/clients/route");
    const one = await import("@/app/api/clients/[id]/route");
    expect((await list.POST(json({ name: "", offer: "logistics" }))).status).toBe(400);
    const created = await (await list.POST(json({ name: "Shree Logistics", offer: "logistics", services: [{ name: "Customs clearance", price: "₹4,500", logistics: "customs" }] }))).json();
    const id = created.client.id as string;
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    expect((await (await list.GET()).json()).clients.map((c: { name: string }) => c.name)).toEqual(["Shree Logistics"]);
    const ctx = { params: Promise.resolve({ id }) };
    const put = await one.PUT(new Request("http://x", { method: "PUT", body: JSON.stringify({ ...created.client, city: "Vadodara", id: "ignored" }) }), ctx);
    const edited = (await put.json()).client;
    expect(edited).toMatchObject({ id, city: "Vadodara", createdAt: created.client.createdAt });
    expect((await one.GET(new Request("http://x"), { params: Promise.resolve({ id: "../../etc/passwd" }) })).status).toBe(404);
    expect((await one.DELETE(new Request("http://x"), ctx)).status).toBe(200);
    expect((await one.GET(new Request("http://x"), ctx)).status).toBe(404);
  });
});
