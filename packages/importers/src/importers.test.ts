import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { strToU8, zipSync } from "fflate";
import { detectExportKind, parseExport, readExportFile } from "./index";

const fixture = (name: string) => readFileSync(new URL(`./__fixtures__/${name}`, import.meta.url));

describe("ChatGPT export", () => {
  it("follows the current branch, skips hidden/system/tool/image parts", () => {
    const { kind, conversations } = parseExport(fixture("chatgpt-conversations.json"));
    expect(kind).toBe("chatgpt");
    expect(conversations).toHaveLength(1);
    const c = conversations[0]!;
    expect(c.externalId).toBe("6909a0c0-1111-4000-8000-000000000001");
    expect(c.messages.map((m) => m.role)).toEqual(["user", "assistant", "user"]);
    expect(c.messages[1]!.content).toContain("Lilla Torg");
    expect(c.messages.some((m) => m.content.includes("abandoned"))).toBe(false);
    expect(c.messages[2]!.content).toBe("Ja! Och avsluta med loggan i rosa neon.");
    expect(c.startedAt?.toISOString()).toBe("2025-11-04T10:00:00.000Z");
  });

  it("reads the zip produced by the export", () => {
    const zip = zipSync({ "chat.html": strToU8("<html/>"), "conversations.json": new Uint8Array(fixture("chatgpt-conversations.json")) });
    expect(detectExportKind(readExportFile(zip))).toBe("chatgpt");
  });
});

describe("Claude export", () => {
  it("parses messages and content blocks", () => {
    const { kind, conversations } = parseExport(fixture("claude-conversations.json"));
    expect(kind).toBe("claude");
    expect(conversations).toHaveLength(1);
    expect(conversations[0]!.title).toBe("Manus för videon");
    expect(conversations[0]!.messages.map((m) => m.role)).toEqual(["user", "assistant"]);
    expect(conversations[0]!.messages[0]!.content).toBe("Skriv ett manus för sneaker-videon.");
  });
});

describe("errors", () => {
  it("rejects unknown formats", () => {
    expect(() => parseExport(strToU8(JSON.stringify([{ foo: 1 }])))).toThrow(/recognise/);
    expect(() => parseExport(strToU8("not json"))).toThrow(/valid JSON/);
  });
});
