import { describe, expect, it } from "vitest";
import { MAX_CLIENT_UPLOAD_BYTES, uploadSchema } from "./upload-schema";

describe("upload schema", () => {
  it("accepts a non-empty PDF", () => {
    const file = new File(["%PDF-1.4"], "fixture.pdf", { type: "application/pdf" });
    expect(uploadSchema.safeParse({ file }).success).toBe(true);
  });

  it("rejects an invalid extension and MIME", () => {
    const file = new File(["hello"], "fixture.txt", { type: "text/plain" });
    expect(uploadSchema.safeParse({ file }).success).toBe(false);
  });

  it("rejects files above the client limit", () => {
    const fakeLargeFile = new File(["%PDF"], "large.pdf", { type: "application/pdf" });
    Object.defineProperty(fakeLargeFile, "size", { value: MAX_CLIENT_UPLOAD_BYTES + 1 });
    expect(uploadSchema.safeParse({ file: fakeLargeFile }).success).toBe(false);
  });
});
