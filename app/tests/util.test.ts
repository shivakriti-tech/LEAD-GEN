import { describe, expect, it } from "vitest";
import { domainOf, isSocialHost, normalizePhone, simplifyName } from "@/lib/util";

describe("normalizePhone", () => {
  it.each([
    ["098220 12345", "+919822012345"],
    ["+91 90000 11111", "+919000011111"],
    ["919000011111", "+919000011111"],
    ["020 2543 1234", "+912025431234"],
    ["+91-20-2543-1234", "+912025431234"],
    ["12345", undefined],
    [undefined, undefined],
  ])("%s → %s", (input, out) => expect(normalizePhone(input as string)).toBe(out));
});

describe("domains", () => {
  it("strips www and lowercases", () => expect(domainOf("https://WWW.Example.in/x")).toBe("example.in"));
  it("handles bare domains", () => expect(domainOf("example.in")).toBe("example.in"));
  it("spots social hosts", () => {
    expect(isSocialHost("m.facebook.com")).toBe(true);
    expect(isSocialHost("instagram.com")).toBe(true);
    expect(isSocialHost("sharmadental.in")).toBe(false);
  });
  it("simplifies names", () => expect(simplifyName("Dr. Sharma's Dental Clinic Pvt Ltd")).toBe("sharma s dental"));
});
