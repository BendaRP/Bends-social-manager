import { redirect } from "next/navigation";
import { PostStatus } from "@prisma/client";
import { getCurrentUser } from "@/server/auth";
import { prisma } from "@/server/db";
import { Nav } from "@/components/nav";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const pendingCount = await prisma.post.count({
    where: { status: PostStatus.PENDING_APPROVAL },
  });

  return (
    <div className="flex min-h-screen">
      <aside className="w-60 shrink-0">
        <Nav pendingCount={pendingCount} />
      </aside>
      <main className="flex-1 overflow-x-hidden p-6 lg:p-8">{children}</main>
    </div>
  );
}
