import { prisma } from "@/lib/db";
import { mergeWeights } from "@/lib/solver-weights";
import { SettingsForm } from "./settings-form";

export const dynamic = "force-dynamic";

export default async function AdminSettingsPage() {
  const row = await prisma.setting.findUnique({
    where: { key: "solverWeights" },
  });
  let saved: Record<string, number> | null = null;
  if (row) {
    try {
      saved = JSON.parse(row.value);
    } catch {
      saved = null;
    }
  }
  const weights = mergeWeights(saved);

  return (
    <div className="max-w-3xl">
      <SettingsForm initialWeights={weights} />
    </div>
  );
}
