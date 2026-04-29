import { prisma } from "@/lib/db";
import { EmployeeManager } from "./employee-manager";

function safeJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try { return JSON.parse(value); } catch { return fallback; }
}

export default async function EmployeesPage() {
  const employees = await prisma.employee.findMany({ orderBy: { name: "asc" } });
  const posts = await prisma.post.findMany({ orderBy: { sortOrder: "asc" } });

  return (
    <EmployeeManager
      initialEmployees={employees.map((e) => ({
        id: e.id,
        name: e.name,
        rate: e.rate,
        targetRate: e.targetRate,
        maxRate: e.maxRate,
        seniority: e.seniority,
        hospitalStartYear: e.hospitalStartYear,
        careerStartYear: e.careerStartYear,
        allowedPosts: safeJson(e.allowedPosts, []),
        modalities: safeJson(e.modalities, []),
        can24h: e.can24h ?? false,
        postPreferences: safeJson(e.postPreferences, {}),
      }))}
      posts={posts.map((p) => ({
        id: p.id,
        name: p.name,
        shiftHours: p.shiftHours,
        modality: p.modality ?? "",
      }))}
    />
  );
}
