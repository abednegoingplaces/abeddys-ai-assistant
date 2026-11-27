import { describe, it, expect } from "vitest";
import { decodedSize, mediaKindFor, mediaLabel, normalizeMimeType } from "./media";

describe("normalizeMimeType", () => {
  it("drops codec parameters and lowercases", () => {
    expect(normalizeMimeType("audio/ogg; codecs=opus")).toBe("audio/ogg");
    expect(normalizeMimeType("IMAGE/JPEG")).toBe("image/jpeg");
  });
});

describe("mediaKindFor", () => {
  it.each([
    ["image/jpeg", "image"],
    ["image/png", "image"],
    ["video/mp4", "video"],
    ["audio/ogg; codecs=opus", "audio"],
    ["audio/mpeg", "audio"],
    ["image/webp", "sticker"],
  ])("%s → %s", (mime, kind) => expect(mediaKindFor(mime)).toBe(kind));

  it("treats WhatsApp stickers as stickers whatever the type", () => {
    expect(mediaKindFor("image/png", true)).toBe("sticker");
  });

  it.each(["application/pdf", "text/vcard", ""])("ignores %j", (mime) => expect(mediaKindFor(mime)).toBeNull());
});

describe("decodedSize", () => {
  it("computes the real byte size of base64 data", () => {
    expect(decodedSize(Buffer.from("hello").toString("base64"))).toBe(5);
    expect(decodedSize(Buffer.from("hell").toString("base64"))).toBe(4);
    expect(decodedSize(Buffer.alloc(1000).toString("base64"))).toBe(1000);
  });
});

describe("mediaLabel", () => {
  it("labels media with its caption", () => {
    expect(mediaLabel("image", " look at this ")).toBe("[photo] look at this");
    expect(mediaLabel("audio", "")).toBe("[voice note]");
    expect(mediaLabel("video", "😂")).toBe("[video] 😂");
    expect(mediaLabel("sticker", "")).toBe("[sticker]");
  });
});
