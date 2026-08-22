import { z } from "zod";

export const MAX_CLIENT_UPLOAD_BYTES = 50 * 1024 * 1024;

export const uploadSchema = z.object({
  file: z
    .instanceof(File, { message: "Pilih file PDF." })
    .refine((file) => file.name.toLowerCase().endsWith(".pdf"), "Ekstensi file harus .pdf.")
    .refine(
      (file) => file.type === "application/pdf" || file.type === "application/octet-stream",
      "Tipe file harus application/pdf.",
    )
    .refine((file) => file.size > 0, "File tidak boleh kosong.")
    .refine((file) => file.size <= MAX_CLIENT_UPLOAD_BYTES, "Ukuran file melebihi 50 MB."),
});

export type UploadForm = z.infer<typeof uploadSchema>;
