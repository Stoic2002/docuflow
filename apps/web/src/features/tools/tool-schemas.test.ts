import { describe, expect, it } from "vitest";
import { ocrSchema, splitPagesSchema } from "./tool-schemas";

describe("direct tool schemas", () => {
  it("requires unique selected pages inside the detected page count", () => {
    const schema = splitPagesSchema(5);
    expect(schema.safeParse({ pages: [1, 2, 5] }).success).toBe(true);
    expect(schema.safeParse({ pages: [] }).success).toBe(false);
    expect(schema.safeParse({ pages: [1, 1] }).success).toBe(false);
    expect(schema.safeParse({ pages: [6] }).success).toBe(false);
  });

  it("allows only the advertised OCR languages", () => {
    expect(ocrSchema.safeParse({ language: "eng" }).success).toBe(true);
    expect(ocrSchema.safeParse({ language: "ind" }).success).toBe(true);
    expect(ocrSchema.safeParse({ language: "deu" }).success).toBe(false);
  });
});
