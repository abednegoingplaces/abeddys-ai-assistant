import { describe, it, expect, vi } from "vitest";
import { contactLabel, matchContacts, runNeoTool, type ContactRow, type NeoDeps } from "./tools";

const contacts: ContactRow[] = [
  { id: "c1", key: "254711112222@c.us", platform: "WHATSAPP", displayName: "Kevo", group: "FRIENDS", mode: "IMPERSONATOR" },
  { id: "c2", key: "254733334444@c.us", platform: "WHATSAPP", displayName: "Kevin Magu", group: "UNKNOWN", mode: "IMPERSONATOR" },
  { id: "c3", key: "92522772701345@lid", platform: "WHATSAPP", displayName: null, group: "UNKNOWN", mode: "IMPERSONATOR" },
];

function deps(over: Partial<NeoDeps> = {}): NeoDeps {
  return {
    listContacts: vi.fn(async () => contacts),
    recentMessages: vi.fn(async () => [
      { contactName: "Kevo", direction: "INBOUND" as const, content: "sema", createdAt: new Date("2026-11-27T10:00:00Z") },
      { contactName: "Kevo", direction: "OUTBOUND" as const, content: "poa", createdAt: new Date("2026-11-27T10:00:05Z") },
    ]),
    updateContact: vi.fn(async () => {}),
    setAutoReplies: vi.fn(async () => {}),
    getStatus: vi.fn(async () => ({ autoRepliesOn: true, blackout: "01:00–06:00", repliesToday: 3, alertsToday: 1 })),
    now: () => new Date("2026-11-27T12:00:00Z"),
    timeZone: "Africa/Nairobi",
    ...over,
  };
}

describe("matchContacts", () => {
  it("prefers an exact name match", () => expect(matchContacts("kevo", contacts).map((c) => c.id)).toEqual(["c1"]));
  it("finds partial names and numbers", () => {
    expect(matchContacts("kev", contacts).map((c) => c.id)).toEqual(["c1", "c2"]);
    expect(matchContacts("1345", contacts).map((c) => c.id)).toEqual(["c3"]);
    expect(matchContacts("+254733", contacts).map((c) => c.id)).toEqual(["c2"]);
  });
  it("returns nothing for an empty query", () => expect(matchContacts("  ", contacts)).toEqual([]));
});

describe("contactLabel", () => {
  it("shows the name and last digits", () => {
    expect(contactLabel(contacts[0])).toBe("Kevo (…2222)");
    expect(contactLabel(contacts[2])).toBe("…1345");
  });
});

describe("runNeoTool", () => {
  it("changes a contact's group when exactly one matches", async () => {
    const d = deps();
    expect(await runNeoTool("set_contact_group", { contact: "Kevo", group: "family" }, d)).toEqual({ done: true, contact: "Kevo (…2222)", group: "FAMILY" });
    expect(d.updateContact).toHaveBeenCalledWith("c1", { group: "FAMILY" });
  });

  it("asks which one when several contacts match, and changes nothing", async () => {
    const d = deps();
    const r = await runNeoTool("set_contact_group", { contact: "kev", group: "FRIENDS" }, d);
    expect(r.error).toMatch(/more than one/i);
    expect(r.matches).toEqual(["Kevo (…2222)", "Kevin Magu (…4444)"]);
    expect(d.updateContact).not.toHaveBeenCalled();
  });

  it("rejects an invalid group", async () => {
    const d = deps();
    expect((await runNeoTool("set_contact_group", { contact: "Kevo", group: "BOSS" }, d)).error).toMatch(/must be one of/);
    expect(d.updateContact).not.toHaveBeenCalled();
  });

  it("changes a contact's mode", async () => {
    const d = deps();
    await runNeoTool("set_contact_mode", { contact: "Kevin Magu", mode: "tutor" }, d);
    expect(d.updateContact).toHaveBeenCalledWith("c2", { mode: "TUTOR" });
  });

  it("reads one contact's messages, in Nairobi time", async () => {
    const d = deps();
    const r = (await runNeoTool("read_messages", { contact: "Kevo", hours: 5 }, d)) as { messages: { when: string; from: string }[] };
    expect(d.recentMessages).toHaveBeenCalledWith(new Date("2026-11-27T07:00:00Z"), "c1");
    expect(r.messages[0]).toMatchObject({ when: "Fri 13:00", from: "them" });
    expect(r.messages[1]).toMatchObject({ from: "bot" });
  });

  it("reads everyone's messages for the last 24h by default, capped at a week", async () => {
    const d = deps();
    await runNeoTool("read_messages", {}, d);
    expect(d.recentMessages).toHaveBeenCalledWith(new Date("2026-11-26T12:00:00Z"), undefined);
    await runNeoTool("read_messages", { hours: 10000 }, d);
    expect(d.recentMessages).toHaveBeenLastCalledWith(new Date("2026-11-20T12:00:00Z"), undefined);
  });

  it("turns auto-replies on and off", async () => {
    const d = deps();
    expect(await runNeoTool("set_auto_replies", { enabled: false }, d)).toEqual({ done: true, autoReplies: "off" });
    expect(d.setAutoReplies).toHaveBeenCalledWith(false);
  });

  it("reports status and rejects unknown tools", async () => {
    const d = deps();
    expect(await runNeoTool("bot_status", {}, d)).toMatchObject({ repliesToday: 3 });
    expect((await runNeoTool("delete_everything", {}, d)).error).toMatch(/Unknown tool/);
  });
});
