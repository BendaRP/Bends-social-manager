"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function DisconnectButton({ accountId }: { accountId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function disconnect() {
    if (
      !confirm(
        "לנתק את החשבון? הפוסטים שכבר פורסמו ונתוני הביצועים שלהם יישמרו, " +
          "אבל לא ניתן יהיה לפרסם לחשבון עד חיבור מחדש.",
      )
    ) {
      return;
    }

    setBusy(true);
    await fetch(`/api/accounts/${accountId}`, { method: "DELETE" });
    router.refresh();
    setBusy(false);
  }

  return (
    <button
      type="button"
      onClick={disconnect}
      disabled={busy}
      className="shrink-0 rounded-lg border border-border-subtle px-3 py-1.5 text-xs text-ink-muted hover:border-danger hover:text-danger disabled:opacity-50"
    >
      ניתוק
    </button>
  );
}
