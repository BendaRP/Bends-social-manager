import type { ReactNode } from "react";
import { Platform, PostStatus, TargetStatus } from "@prisma/client";
import { cn } from "@/lib/cn";

export function Card({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "rounded-xl border border-border-subtle bg-surface p-5 shadow-sm",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function SectionTitle({
  children,
  hint,
}: {
  children: ReactNode;
  hint?: string;
}) {
  return (
    <div className="mb-4">
      <h2 className="text-lg font-semibold text-ink">{children}</h2>
      {hint && <p className="mt-1 text-sm text-ink-muted">{hint}</p>}
    </div>
  );
}

const PLATFORM_LABEL: Record<Platform, string> = {
  INSTAGRAM: "אינסטגרם",
  FACEBOOK: "פייסבוק",
  TIKTOK: "טיקטוק",
};

const PLATFORM_CLASS: Record<Platform, string> = {
  INSTAGRAM: "bg-instagram/10 text-instagram",
  FACEBOOK: "bg-facebook/10 text-facebook",
  TIKTOK: "bg-tiktok/10 text-tiktok dark:text-ink",
};

export function PlatformBadge({ platform }: { platform: Platform }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium",
        PLATFORM_CLASS[platform],
      )}
    >
      {PLATFORM_LABEL[platform]}
    </span>
  );
}

export const POST_STATUS_LABEL: Record<PostStatus, string> = {
  DRAFT: "טיוטה",
  PENDING_APPROVAL: "ממתין לאישורך",
  APPROVED: "מאושר",
  SCHEDULED: "מתוזמן",
  PUBLISHING: "מפרסם כעת",
  PUBLISHED: "פורסם",
  PARTIALLY_PUBLISHED: "פורסם חלקית",
  FAILED: "נכשל",
  CANCELLED: "בוטל",
};

const POST_STATUS_CLASS: Record<PostStatus, string> = {
  DRAFT: "bg-surface-muted text-ink-muted",
  PENDING_APPROVAL: "bg-warning-soft text-warning",
  APPROVED: "bg-brand-soft text-brand",
  SCHEDULED: "bg-brand-soft text-brand",
  PUBLISHING: "bg-brand-soft text-brand",
  PUBLISHED: "bg-success-soft text-success",
  PARTIALLY_PUBLISHED: "bg-warning-soft text-warning",
  FAILED: "bg-danger-soft text-danger",
  CANCELLED: "bg-surface-muted text-ink-muted",
};

export function StatusBadge({ status }: { status: PostStatus }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium",
        POST_STATUS_CLASS[status],
      )}
    >
      {POST_STATUS_LABEL[status]}
    </span>
  );
}

export const TARGET_STATUS_LABEL: Record<TargetStatus, string> = {
  PENDING: "ממתין",
  QUEUED: "בתור",
  PUBLISHING: "מפרסם",
  PUBLISHED: "פורסם",
  FAILED: "נכשל",
  SKIPPED: "דולג",
};

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="rounded-xl border border-dashed border-border-subtle bg-surface p-10 text-center">
      <h3 className="text-base font-semibold text-ink">{title}</h3>
      <p className="mx-auto mt-2 max-w-md text-sm text-ink-muted">{description}</p>
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function Alert({
  tone = "info",
  title,
  children,
}: {
  tone?: "info" | "warning" | "danger" | "success";
  title?: string;
  children: ReactNode;
}) {
  const tones = {
    info: "border-brand/30 bg-brand-soft text-ink",
    warning: "border-warning/40 bg-warning-soft text-ink",
    danger: "border-danger/40 bg-danger-soft text-ink",
    success: "border-success/40 bg-success-soft text-ink",
  } as const;

  return (
    <div className={cn("rounded-lg border p-4 text-sm", tones[tone])}>
      {title && <p className="mb-1 font-semibold">{title}</p>}
      <div className="leading-relaxed">{children}</div>
    </div>
  );
}

/** Wraps numbers and Latin text so bidi does not reorder them inside Hebrew. */
export function Ltr({ children }: { children: ReactNode }) {
  return <span className="ltr-inline">{children}</span>;
}
