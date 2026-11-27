import { describe, it, expect } from "vitest";
import { createHmac } from "crypto";
import { clampToInstagramLimit, extractTextMessages, isValidSignature, verifySubscription } from "./webhook";

const OWN = "17841400000000000";

const dm = (over: Record<string, unknown> = {}, message: Record<string, unknown> = {}) => ({
  sender: { id: "9001" },
  recipient: { id: OWN },
  timestamp: 1764230000000,
  message: { mid: "m_1", text: "sema mzee", ...message },
  ...over,
});
const payload = (...events: unknown[]) => ({ object: "instagram", entry: [{ id: OWN, time: 1, messaging: events }] });

describe("verifySubscription", () => {
  const q = { "hub.mode": "subscribe", "hub.verify_token": "s3cret-token", "hub.challenge": "12345" };
  it("echoes the challenge for the right token", () => expect(verifySubscription(q, "s3cret-token")).toBe("12345"));
  it("rejects a wrong token, wrong mode or missing config", () => {
    expect(verifySubscription(q, "other-token")).toBeNull();
    expect(verifySubscription({ ...q, "hub.mode": "unsubscribe" }, "s3cret-token")).toBeNull();
    expect(verifySubscription(q, undefined)).toBeNull();
    expect(verifySubscription({ "hub.mode": "subscribe" }, "s3cret-token")).toBeNull();
  });
});

describe("isValidSignature", () => {
  const body = Buffer.from(JSON.stringify(payload(dm())));
  const sig = "sha256=" + createHmac("sha256", "app-secret").update(body).digest("hex");

  it("accepts Meta's signature over the raw body", () => expect(isValidSignature(body, sig, "app-secret")).toBe(true));
  it("accepts uppercase hex", () =>
    expect(isValidSignature(body, "sha256=" + sig.slice("sha256=".length).toUpperCase(), "app-secret")).toBe(true));
  it("rejects tampering, wrong secret, missing header or prefix", () => {
    expect(isValidSignature(Buffer.from(body.toString() + " "), sig, "app-secret")).toBe(false);
    expect(isValidSignature(body, sig, "other-secret")).toBe(false);
    expect(isValidSignature(body, undefined, "app-secret")).toBe(false);
    expect(isValidSignature(body, sig.replace("sha256=", ""), "app-secret")).toBe(false);
    expect(isValidSignature(body, sig, undefined)).toBe(false);
  });
});

describe("extractTextMessages", () => {
  it("extracts a normal inbound DM", () => {
    expect(extractTextMessages(payload(dm()), OWN)).toEqual([
      { senderId: "9001", recipientId: OWN, mid: "m_1", text: "sema mzee", timestamp: 1764230000000 },
    ]);
  });

  it("skips echoes of our own replies and self-messages", () => {
    expect(extractTextMessages(payload(dm({}, { is_echo: true })), OWN)).toEqual([]);
    expect(extractTextMessages(payload(dm({}, { is_self: true })), OWN)).toEqual([]);
    expect(extractTextMessages(payload(dm({ sender: { id: OWN } })), OWN)).toEqual([]);
  });

  it("skips deleted, unsupported, media-only and empty messages", () => {
    expect(extractTextMessages(payload(dm({}, { is_deleted: true })), OWN)).toEqual([]);
    expect(extractTextMessages(payload(dm({}, { is_unsupported: true })), OWN)).toEqual([]);
    expect(extractTextMessages(payload(dm({}, { text: undefined, attachments: [{ type: "image" }] })), OWN)).toEqual([]);
    expect(extractTextMessages(payload(dm({}, { text: "   " })), OWN)).toEqual([]);
  });

  it("ignores reactions/seen events and non-Instagram payloads", () => {
    expect(extractTextMessages(payload({ sender: { id: "1" }, recipient: { id: OWN }, read: { mid: "x" } }), OWN)).toEqual([]);
    expect(extractTextMessages({ object: "page", entry: [] }, OWN)).toEqual([]);
    expect(extractTextMessages(null, OWN)).toEqual([]);
    expect(extractTextMessages("junk", OWN)).toEqual([]);
  });

  it("handles several events across entries", () => {
    const p = { object: "instagram", entry: [{ messaging: [dm()] }, { messaging: [dm({ sender: { id: "9002" } }, { mid: "m_2", text: "yo" })] }] };
    expect(extractTextMessages(p, OWN).map((m) => m.senderId)).toEqual(["9001", "9002"]);
  });
});

describe("clampToInstagramLimit", () => {
  it("leaves short text alone", () => expect(clampToInstagramLimit("poa")).toBe("poa"));
  it("trims long text to 1000 bytes without splitting emoji", () => {
    const out = clampToInstagramLimit("😂".repeat(400));
    expect(Buffer.byteLength(out, "utf8")).toBeLessThanOrEqual(1000);
    expect(out.endsWith("…")).toBe(true);
    expect(out).not.toContain("�");
  });
});
