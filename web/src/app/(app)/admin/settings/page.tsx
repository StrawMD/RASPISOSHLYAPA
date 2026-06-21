import { prisma } from "@/lib/db";
import { mergeWeights } from "@/lib/solver-weights";
import { mergeSolverConfig } from "@/lib/solver-config";
import { SettingsForm } from "./settings-form";

export const dynamic = "force-dynamic";

export default async function AdminSettingsPage() {
  const [weightsRow, configRow] = await Promise.all([
    prisma.setting.findUnique({ where: { key: "solverWeights" } }),
    prisma.setting.findUnique({ where: { key: "solverConfig" } }),
  ]);
  let savedWeights: Record<string, number> | null = null;
  if (weightsRow) {
    try {
      savedWeights = JSON.parse(weightsRow.value);
    } catch {
      savedWeights = null;
    }
  }
  let savedConfig: Record<string, number> | null = null;
  if (configRow) {
    try {
      savedConfig = JSON.parse(configRow.value);
    } catch {
      savedConfig = null;
    }
  }
  const weights = mergeWeights(savedWeights);
  const solverConfig = mergeSolverConfig(savedConfig);

  return (
    <div className="max-w-3xl">
      <SettingsForm initialWeights={weights} initialSolverConfig={solverConfig} />
    </div>
  );
}
