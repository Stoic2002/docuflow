import { describe, expect, it } from "vitest";
import { ocrSchema, splitPagesSchema, splitSchema } from "./tool-schemas";

describe("direct tool schemas", () => {
  it("validates split syntax and detected page bounds", () => {
    const schema = splitSchema(5);
    expect(schema.safeParse({ ranges: "1-3,5" }).success).toBe(true);
    expect(schema.safeParse({ ranges: "0-2" }).success).toBe(false);
    expect(schema.safeParse({ ranges: "4-6" }).success).toBe(false);
    expect(schema.safeParse({ ranges: "3-2" }).success).toBe(false);
  });

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
