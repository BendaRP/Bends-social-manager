"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function ApprovalActions({ postId }: { postId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState<"approve" | "cancel" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function act(action: "approve" | "cancel") {
    if (action === "approve") {
      // The one deliberate confirmation in the app. Everything past this point
      // happens on real, public business accounts.
      if (!confirm("לאשר את הפוסט לפרסום? אחרי האישור הוא ייצא לאוויר במועד שנקבע.")) {
        return;
      }
    } else if (!confirm("לבטל את הפוסט? הוא לא יפורסם.")) {
      return;
    }

    setBusy(action);
    setError(null);

    const response = await fetch(`/api/posts/${postId}/${action}`, { method: "POST" });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      setError(body.error ?? "הפעולה נכשלה");
      setBusy(null);
      return;
    }

    router.refresh();
    setBusy(null);
  }

  return (
    <div className="space-y-3">
      {error && (
        <p className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>
      )}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => act("approve")}
          disabled={busy !== null}
          className="rounded-lg bg-success px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
        >
          {busy === "approve" ? "מאשר…" : "אישור לפרסום"}
        </button>
        <button
          type="button"
          onClick={() => act("cancel")}
          disabled={busy !== null}
          className="rounded-lg border border-border-subtle px-4 py-2 text-sm text-ink-muted hover:border-danger hover:text-danger disabled:opacity-50"
        >
          {busy === "cancel" ? "מבטל…" : "ביטול"}
        </button>
      </div>
    </div>
  );
}
