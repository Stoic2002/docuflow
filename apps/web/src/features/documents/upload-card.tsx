import { zodResolver } from "@hookform/resolvers/zod";
import { api, userFacingError } from "@pdf-studio/api-client";
import { Button, Card } from "@pdf-studio/ui";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { FileUp } from "lucide-react";
import { useCallback } from "react";
import { useDropzone } from "react-dropzone";
import { useForm } from "react-hook-form";
import { queryKeys } from "../../api/queries";
import { uploadSchema, type UploadForm } from "./upload-schema";

export function UploadCard() {
  const queryClient = useQueryClient();
  const form = useForm<UploadForm>({ resolver: zodResolver(uploadSchema) });
  const mutation = useMutation({
    mutationFn: (values: UploadForm) => api.upload(values.file),
    onSuccess: async () => {
      form.reset();
      await queryClient.invalidateQueries({ queryKey: queryKeys.documents });
    },
  });
  const onDrop = useCallback(
    (files: File[]) => {
      if (files[0]) {
        form.setValue("file", files[0], { shouldDirty: true, shouldValidate: true });
        mutation.reset();
      }
    },
    [form, mutation],
  );
  const dropzone = useDropzone({
    onDrop,
    multiple: false,
    maxFiles: 1,
    accept: { "application/pdf": [".pdf"] },
    noClick: true,
  });
  const selected = form.watch("file");

  return (
    <Card className="p-5">
      <form onSubmit={form.handleSubmit((values) => mutation.mutate(values))}>
        <div
          {...dropzone.getRootProps()}
          className="rounded-[1.5rem] border-2 border-dashed border-line bg-canvas p-8 text-center transition data-[active=true]:border-accent data-[active=true]:bg-accent-soft"
          data-active={dropzone.isDragActive}
        >
          <input {...dropzone.getInputProps()} id="pdf-upload" aria-label="Pilih PDF" />
          <span className="mx-auto flex size-12 items-center justify-center rounded-full bg-accent-soft text-accent"><FileUp className="size-6" aria-hidden="true" /></span>
          <p className="mt-4 font-black text-ink">Tarik PDF ke sini</p>
          <p className="mt-1 text-sm text-muted">Maksimum 50 MB. File asli tidak akan ditimpa.</p>
          <div className="mt-4 flex flex-wrap items-center justify-center gap-3">
            <Button type="button" variant="secondary" onClick={dropzone.open}>
              Pilih PDF
            </Button>
            <Button type="submit" disabled={!selected || mutation.isPending}>
              {mutation.isPending ? "Mengunggah…" : "Unggah"}
            </Button>
          </div>
          {selected ? <p className="mt-3 text-sm text-muted">Dipilih: {selected.name}</p> : null}
        </div>
        {form.formState.errors.file ? (
          <p className="mt-3 text-sm text-red-700" role="alert">
            {form.formState.errors.file.message}
          </p>
        ) : null}
        {mutation.isError ? (
          <p className="mt-3 text-sm text-red-700" role="alert">
            Upload gagal: {userFacingError(mutation.error)} Original lokal tetap aman.
          </p>
        ) : null}
        {mutation.isSuccess ? (
          <p className="mt-3 text-sm text-emerald-700" role="status">
            PDF berhasil disimpan sebagai original immutable.
          </p>
        ) : null}
      </form>
    </Card>
  );
}
