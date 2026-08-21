"use client";

import { useRef, useState } from "react";
import { Trash2, Upload } from "lucide-react";

export interface UploadedMedia {
  id: string;
  type: "IMAGE" | "VIDEO";
  publicUrl: string;
  originalFilename?: string | null;
}

/**
 * Browser-to-bucket upload.
 *
 * The file never passes through the Next.js server: it asks for a presigned
 * URL, PUTs the bytes straight to storage, then registers the finished object.
 * Proxying a large video through a server request would hit body size limits
 * and hold a server process open for the whole upload.
 */
export function MediaUploader({
  media,
  onChange,
}: {
  media: UploadedMedia[];
  onChange: (media: UploadedMedia[]) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<string | null>(null);

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;

    setBusy(true);
    setError(null);
    const uploaded: UploadedMedia[] = [];

    try {
      for (const [index, file] of Array.from(files).entries()) {
        setProgress(`מעלה ${index + 1} מתוך ${files.length}…`);

        const presignResponse = await fetch("/api/media/presign", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            filename: file.name,
            mimeType: file.type,
            sizeBytes: file.size,
          }),
        });

        if (!presignResponse.ok) {
          const body = await presignResponse.json().catch(() => ({}));
          throw new Error(body.error ?? "לא ניתן להתחיל העלאה");
        }

        const { uploadUrl, storageKey } = await presignResponse.json();

        const putResponse = await fetch(uploadUrl, {
          method: "PUT",
          headers: { "content-type": file.type },
          body: file,
        });
        if (!putResponse.ok) {
          throw new Error(`ההעלאה לאחסון נכשלה (${putResponse.status})`);
        }

        // Dimensions are read in the browser: the server never sees the file,
        // and validation needs them to check aspect ratios before publishing.
        const dimensions = await readDimensions(file);

        const registerResponse = await fetch("/api/media", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            storageKey,
            type: file.type.startsWith("video/") ? "VIDEO" : "IMAGE",
            mimeType: file.type,
            sizeBytes: file.size,
            originalFilename: file.name,
            ...dimensions,
          }),
        });

        if (!registerResponse.ok) {
          const body = await registerResponse.json().catch(() => ({}));
          throw new Error(body.error ?? "רישום הקובץ נכשל");
        }

        uploaded.push(await registerResponse.json());
      }

      onChange([...media, ...uploaded]);
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setBusy(false);
      setProgress(null);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  function remove(id: string) {
    onChange(media.filter((m) => m.id !== id));
  }

  function move(index: number, direction: -1 | 1) {
    const next = [...media];
    const target = index + direction;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target]!, next[index]!];
    onChange(next);
  }

  return (
    <div className="space-y-3">
      <input
        ref={inputRef}
        type="file"
        multiple
        accept="image/jpeg,image/png,image/webp,video/mp4,video/quicktime"
        onChange={(e) => handleFiles(e.target.files)}
        className="hidden"
        id="media-input"
      />

      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={busy}
        className="flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-border-subtle px-4 py-6 text-sm text-ink-muted hover:border-brand hover:text-brand disabled:opacity-50"
      >
        <Upload className="size-4" aria-hidden />
        {busy ? (progress ?? "מעלה…") : "בחירת קבצים"}
      </button>

      {error && (
        <p className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>
      )}

      {media.length > 0 && (
        <ul className="space-y-2">
          {media.map((item, index) => (
            <li
              key={item.id}
              className="flex items-center gap-3 rounded-lg border border-border-subtle p-2"
            >
              <div className="size-14 shrink-0 overflow-hidden rounded bg-surface-muted">
                {item.type === "IMAGE" ? (
                  <img src={item.publicUrl} alt="" className="size-full object-cover" />
                ) : (
                  <video src={item.publicUrl} className="size-full object-cover" muted />
                )}
              </div>

              <span className="min-w-0 flex-1 truncate text-sm text-ink" dir="ltr">
                {item.originalFilename ?? item.id}
              </span>

              <div className="flex shrink-0 items-center gap-1">
                <button
                  type="button"
                  onClick={() => move(index, -1)}
                  disabled={index === 0}
                  className="rounded px-2 py-1 text-xs text-ink-muted hover:bg-surface-muted disabled:opacity-30"
                  aria-label="הזזה אחורה"
                >
                  →
                </button>
                <button
                  type="button"
                  onClick={() => move(index, 1)}
                  disabled={index === media.length - 1}
                  className="rounded px-2 py-1 text-xs text-ink-muted hover:bg-surface-muted disabled:opacity-30"
                  aria-label="הזזה קדימה"
                >
                  ←
                </button>
                <button
                  type="button"
                  onClick={() => remove(item.id)}
                  className="rounded px-2 py-1 text-ink-muted hover:bg-danger-soft hover:text-danger"
                  aria-label="הסרה"
                >
                  <Trash2 className="size-4" aria-hidden />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Reads intrinsic dimensions (and duration for video) client-side. */
async function readDimensions(
  file: File,
): Promise<{ width?: number; height?: number; durationSec?: number }> {
  const url = URL.createObjectURL(file);
  try {
    if (file.type.startsWith("video/")) {
      return await new Promise((resolve) => {
        const video = document.createElement("video");
        video.preload = "metadata";
        video.onloadedmetadata = () =>
          resolve({
            width: video.videoWidth,
            height: video.videoHeight,
            durationSec: video.duration,
          });
        video.onerror = () => resolve({});
        video.src = url;
      });
    }

    return await new Promise((resolve) => {
      const image = new Image();
      image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight });
      image.onerror = () => resolve({});
      image.src = url;
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}
