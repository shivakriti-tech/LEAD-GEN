import { describe, expect, it } from "vitest";
import { emailLetter, sentences, stripSignOff } from "@/lib/mail/letter";

const me = { name: "Riya Mehta", company: "Pixel Works" };

describe("emails are laid out as a letter, not one block of chat text", () => {
  it("puts the greeting on its own line and splits the text into short paragraphs", () => {
    const msg = "Hi there, I came across Sharma Dental Care on Google. 212 reviews and a 4.6 rating is really good. I had a look at your website (sharmadental.in): it's not mobile-friendly. Most people search on their phone now. I'm Riya Mehta from Pixel Works in Pune. Want me to show you how it could look?";
    expect(emailLetter(msg, me)).toBe(
      "Hello,\n\nI came across Sharma Dental Care on Google. 212 reviews and a 4.6 rating is really good.\n\nI had a look at your website (sharmadental.in): it's not mobile-friendly. Most people search on their phone now.\n\nI'm Riya Mehta from Pixel Works in Pune.\n\nWant me to show you how it could look?",
    );
  });
  it("keeps a named greeting and capitalises the first sentence", () => {
    expect(emailLetter("Hi Anil, just following up on my message. Happy to send samples.", me)).toBe("Hi Anil,\n\nJust following up on my message. Happy to send samples.");
  });
  it("doesn't split inside names, ratings or web addresses", () => {
    expect(sentences("I visited Dr. Mehta's Skin Clinic. It has a 4.6 rating on acme.in today. Nice.")).toEqual(["I visited Dr. Mehta's Skin Clinic.", "It has a 4.6 rating on acme.in today.", "Nice."]);
  });
  it("removes a sign-off that the signature repeats", () => {
    expect(emailLetter("Hi there, one last note. Just reply here. – Riya Mehta, Pixel Works", me)).toBe("Hello,\n\nOne last note. Just reply here.");
    expect(stripSignOff("Hi Jane,\n\nThanks for the reply.\n\nBest regards,\nRiya Mehta\nPixel Works", me)).toBe("Hi Jane,\n\nThanks for the reply.");
    expect(stripSignOff("Hi Jane,\n\nSounds good.\n\nThanks, Riya", { name: "Riya" })).toBe("Hi Jane,\n\nSounds good.");
    // a dash in the middle of a sentence stays
    expect(stripSignOff("Prices start low – Riya can explain more.", me)).toBe("Prices start low – Riya can explain more.");
  });
  it("leaves text you laid out yourself alone", () => {
    const mine = "Hi Jane,\n\nShort note from me.\nTwo lines.";
    expect(emailLetter(mine, me)).toBe(mine);
  });
});
