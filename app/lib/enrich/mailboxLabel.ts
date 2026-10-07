/** Mailbox check results in words (safe to use in the browser). */
export type MailboxStatus = "valid" | "invalid" | "catch_all" | "unknown";

export const MAILBOX_LABEL: Record<MailboxStatus, string> = {
  valid: "mailbox verified",
  invalid: "mailbox doesn't exist",
  catch_all: "accepts any address (can't confirm)",
  unknown: "couldn't confirm",
};
