import { describe, expect, it } from "vitest";
import { parseMailbox, type Mailbox } from "@/lib/mail/mailboxes";

describe("mailboxes on a sending service (Brevo)", () => {
  it("sends from the from= address, replies go to replyTo, and replies are read from that inbox", () => {
    const m = parseMailbox("MAILBOX_1", "smtp://abc123%40smtp-brevo.com:KEY@smtp-relay.brevo.com:2525?from=divy%40shivakriti.in&replyTo=Me%40gmail.com&imap=imap.gmail.com&imapUser=me%40gmail.com&imapPass=app-pass&name=Divy") as Mailbox;
    expect(m.email).toBe("divy@shivakriti.in");
    expect(m.domain).toBe("shivakriti.in");
    expect(m.replyTo).toBe("me@gmail.com");
    expect(m.smtp).toMatchObject({ host: "smtp-relay.brevo.com", port: 2525, secure: false, user: "abc123@smtp-brevo.com", pass: "KEY" });
    expect(m.imap).toEqual({ host: "imap.gmail.com", port: 993, user: "me@gmail.com", pass: "app-pass" });
  });

  it("doesn't guess an inbox for a sending service", () => {
    const m = parseMailbox("MAILBOX_1", "smtp://abc123%40smtp-brevo.com:KEY@smtp-relay.brevo.com:2525?from=divy%40shivakriti.in") as Mailbox;
    expect(m.imap).toBeUndefined();
  });

  it("rejects a from= that isn't an address", () => {
    expect(parseMailbox("MAILBOX_1", "smtp://abc%40smtp-brevo.com:KEY@smtp-relay.brevo.com:2525?from=nope")).toHaveProperty("error");
  });

  it("leaves ordinary mailboxes as they were", () => {
    const m = parseMailbox("MAILBOX_1", "smtps://riya%40getshivakriti.com:p@smtp.zoho.com:465") as Mailbox;
    expect(m.email).toBe("riya@getshivakriti.com");
    expect(m.imap).toEqual({ host: "imap.zoho.com", port: 993 });
    expect(m.replyTo).toBeUndefined();
  });
});
