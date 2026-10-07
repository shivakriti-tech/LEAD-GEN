import { describe, expect, it } from "vitest";
import { savedUsage } from "@/lib/usage";

const now = () => new Date("2026-10-07T10:00:00Z");
function doc(saved: Record<string, unknown>, fail = false) {
  const d = { value: saved as any, writes: 0 };
  return Object.assign(d, {
    read: async () => (fail ? Promise.reject(new Error("down")) : structuredClone(d.value)),
    write: async (x: any) => void ((d.value = structuredClone(x)), d.writes++),
  });
}
const tick = () => new Promise((r) => setTimeout(r, 0));

describe("savedUsage", () => {
  it("adds calls made before the saved counts loaded, and saves the total", async () => {
    const d = doc({ serper: { day: "2026-10-07", dayCount: 5, month: "2026-10", monthCount: 40 } });
    const u = savedUsage(d, now);
    u.add("serper");
    await tick();
    expect(u.used("serper", "day")).toBe(6);
    expect(u.used("serper", "month")).toBe(41);
    u.add("serper");
    await tick();
    expect(d.value.serper.monthCount).toBe(42);
  });
  it("never overwrites saved counts it couldn't load", async () => {
    const d = doc({}, true);
    const u = savedUsage(d, now);
    u.add("tavily");
    await tick();
    expect(u.used("tavily", "day")).toBe(1);
    expect(d.writes).toBe(0);
  });
});
