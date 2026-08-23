import { z } from "zod";

export const ocrSchema = z.object({ language: z.enum(["eng", "ind"]) });

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
