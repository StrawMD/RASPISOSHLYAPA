import { prisma } from "@/lib/db";
import { PostManager } from "./post-manager";

function safeJson<T>(val: string | null | undefined, fallback: T): T {
  if (!val) return fallback;
  try { return JSON.parse(val); } catch { return fallback; }
}

export default async function PostsPage() {
  const posts = await prisma.post.findMany({ orderBy: { sortOrder: "asc" } });
  return (
    <PostManager
      initialPosts={posts.map((p) => ({
        ...p,
        activeWeekdays: safeJson<number[]>(p.activeWeekdays, []),
        specificDays: safeJson<number[]>(p.specificDays, []),
      }))}
    />
  );
}
