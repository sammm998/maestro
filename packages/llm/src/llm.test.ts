import { describe, expect, it } from "vitest";
import { z } from "zod";
import { HashEmbedder, MockLLM, createEmbedder, createLLM } from "./index";

const cos = (a: number[], b: number[]) => a.reduce((s, x, i) => s + x * b[i]!, 0);

describe("HashEmbedder", () => {
  it("is deterministic, normalised and puts similar texts closer", async () => {
    const e = new HashEmbedder();
    const [a, a2, b, c] = await e.embed(
      ["sneaker video neon Malmö", "sneaker video neon Malmö", "neon video for sneaker drop in Malmö", "tax return deadline"],
      "document",
    );
    expect(a).toEqual(a2);
    expect(cos(a!, a!)).toBeCloseTo(1, 5);
    expect(cos(a!, b!)).toBeGreaterThan(cos(a!, c!));
  });
});

describe("MockLLM", () => {
  it("routes by task prefix and validates output", async () => {
    const llm = new MockLLM({ echo: (r) => ({ out: r.prompt }) });
    const res = await llm.generateJson({ task: "echo@v1", system: "", prompt: "hi", schema: z.object({ out: z.string() }) });
    expect(res.out).toBe("hi");
    await expect(
      llm.generateJson({ task: "echo@v1", system: "", prompt: "hi", schema: z.object({ n: z.number() }) }),
    ).rejects.toThrow(/schema/);
  });
});

describe("factories", () => {
  it("default to offline providers without keys (empty strings count as unset)", () => {
    expect(createLLM({ LLM_PROVIDER: "" }).name).toBe("mock");
    expect(createLLM({}).name).toBe("mock");
    expect(createEmbedder({}).model).toBe("hash-v1-1024");
    expect(createLLM({ ANTHROPIC_API_KEY: "x" }).name).toBe("claude");
  });
});
