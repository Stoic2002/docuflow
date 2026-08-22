import { describe, expect, it } from "vitest";
import { flipY, fontStack, overflowsCover } from "./geometry";

describe("flipY", () => {
  it("converts between the PDF and screen origins", () => {
    expect(flipY(0, 842)).toBe(842);
    expect(flipY(842, 842)).toBe(0);
    expect(flipY(421, 842)).toBe(421);
  });

  it("is its own inverse", () => {
    const height = 792;
    expect(flipY(flipY(123.45, height), height)).toBeCloseTo(123.45);
  });
});

describe("fontStack", () => {
  const fonts = [
    { id: "arialmt", family: "ArialMT", serif: false, fixed: false },
    { id: "georgia", family: "Georgia", serif: true, fixed: false },
    { id: "couriernewpsmt", family: "CourierNewPSMT", serif: true, fixed: true },
  ];

  it("pairs each face with a matching generic fallback", () => {
    expect(fontStack("arialmt", fonts)).toBe('"ArialMT", sans-serif');
    expect(fontStack("georgia", fonts)).toBe('"Georgia", serif');
    expect(fontStack("couriernewpsmt", fonts)).toBe('"CourierNewPSMT", monospace');
  });

  it("falls back to Helvetica for the built-in font", () => {
    expect(fontStack("", fonts)).toBe("Helvetica, Arial, sans-serif");
    expect(fontStack("belum-terpasang", fonts)).toBe("Helvetica, Arial, sans-serif");
  });
});

describe("overflowsCover", () => {
  it("stays quiet for text that was never a retype replacement", () => {
    expect(overflowsCover("apa pun", 12, "sans-serif", undefined)).toBe(false);
  });

  it("stays quiet when the browser cannot measure text", () => {
    // jsdom has no canvas backend, so measurement returns null and the panel
    // must not raise a false alarm.
    expect(overflowsCover("teks yang jauh lebih panjang dari aslinya", 12, "sans-serif", 10)).toBe(false);
  });
});
