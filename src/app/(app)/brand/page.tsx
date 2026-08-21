import { prisma } from "@/server/db";
import { BRAND_ID } from "@/ai/brand";
import { isAiConfigured } from "@/ai/client";
import { Alert, Ltr } from "@/components/ui";
import { BrandForm } from "./brand-form";

export const dynamic = "force-dynamic";

export default async function BrandPage() {
  const brand = await prisma.brandProfile.findUnique({ where: { id: BRAND_ID } });
  const aiReady = isAiConfigured();

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <header>
        <h1 className="text-2xl font-semibold text-ink">זהות המותג</h1>
        <p className="mt-1 text-sm text-ink-muted">
          מה שתמלא כאן הוא מה שה-AI יודע על העסק שלך. ככל שתהיה ספציפי יותר,
          כך התוכן יישמע פחות כמו פרסומת גנרית ויותר כמוך.
        </p>
      </header>

      {!aiReady && (
        <Alert tone="warning" title="יצירת תוכן ב-AI עדיין לא מוגדרת">
          יש להוסיף <Ltr>ANTHROPIC_API_KEY</Ltr> לקובץ <Ltr>.env</Ltr> ולהפעיל מחדש.
          המפתח נוצר ב-<Ltr>console.anthropic.com/settings/keys</Ltr>. אפשר למלא את
          הטופס הזה כבר עכשיו.
        </Alert>
      )}

      <BrandForm brand={brand} />
    </div>
  );
}
