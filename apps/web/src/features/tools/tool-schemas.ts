import { z } from "zod";

export const ocrSchema = z.object({ language: z.enum(["eng", "ind"]) });

const splitRangeValue = z
  .string()
  .trim()
  .min(1, "Masukkan rentang halaman.")
  .regex(/^\d+(?:-\d+)?(?:,\s*\d+(?:-\d+)?)*$/, "Gunakan format seperti 1-3,5.");

export function splitPagesSchema(pageCount?: number) {
  return z.object({
    pages: z.array(z.number().int().positive()).min(1, "Pilih minimal satu halaman."),
  }).superRefine(({ pages }, context) => {
    if (new Set(pages).size !== pages.length) {
      context.addIssue({ code: "custom", path: ["pages"], message: "Pilihan halaman tidak boleh duplikat." });
      return;
    }
    if (pageCount && pages.some((page) => page > pageCount)) {
      context.addIssue({ code: "custom", path: ["pages"], message: `Halaman harus berada di 1-${pageCount}.` });
    }
  });
}

export function splitSchema(pageCount?: number) {
  return z.object({
    ranges: splitRangeValue,
  }).superRefine(({ ranges }, context) => {
    if (!pageCount) return;
    for (const token of ranges.split(",")) {
      const [start, end = start] = token.trim().split("-").map(Number);
      if (start < 1 || end < start || end > pageCount) {
        context.addIssue({ code: "custom", path: ["ranges"], message: `Rentang harus berada di halaman 1-${pageCount}.` });
        return;
      }
    }
  });
}
