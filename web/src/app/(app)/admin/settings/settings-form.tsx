"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { toast } from "sonner";
import {
  DEFAULT_WEIGHTS,
  WEIGHT_GROUPS,
  WEIGHT_PRESETS,
} from "@/lib/solver-weights";
import {
  DEFAULT_SOLVER_CONFIG,
  type SolverConfig,
} from "@/lib/solver-config";

export function SettingsForm({
  initialWeights,
  initialSolverConfig,
}: {
  initialWeights: Record<string, number>;
  initialSolverConfig: SolverConfig;
}) {
  const router = useRouter();
  const [weights, setWeights] = useState<Record<string, number>>(initialWeights);
  const [solverConfig, setSolverConfig] =
    useState<SolverConfig>(initialSolverConfig);
  const [isPending, startTransition] = useTransition();

  function setOne(key: string, value: number) {
    setWeights((w) => ({ ...w, [key]: Math.max(0, Math.round(value || 0)) }));
  }

  function applyPreset(presetKey: string) {
    const preset = WEIGHT_PRESETS[presetKey];
    if (!preset) return;
    setWeights({ ...preset.weights });
    toast.success(`Пресет «${preset.label}» применён — не забудьте сохранить`);
  }

  function resetDefaults() {
    setWeights({ ...DEFAULT_WEIGHTS });
    setSolverConfig({ ...DEFAULT_SOLVER_CONFIG });
  }

  function save() {
    startTransition(async () => {
      const res = await fetch("/api/admin/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ weights, solverConfig }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => null);
        toast.error(d?.error ?? "Ошибка сохранения");
        return;
      }
      toast.success("Настройки сохранены. Применятся при следующей генерации.");
      router.refresh();
    });
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Настройки солвера</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Жёсткие лимиты и веса целевой функции. Изменения применяются при
          следующей генерации черновика.
        </p>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Общие лимиты</CardTitle>
          <CardDescription>
            Жёсткие правила и дефолт времени расчёта на странице «Генерация».
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex-1 min-w-[200px]">
              <div className="text-sm font-medium">Потолок доли ночных (%)</div>
              <div className="text-[11px] text-muted-foreground">
                Жёсткий запрет: у сотрудника ночных смен не больше этой доли от
                всех его смен (кроме зафиксированных админом).
              </div>
            </div>
            <Input
              type="number"
              min={1}
              max={100}
              value={solverConfig.nightShareCapPercent}
              onChange={(e) =>
                setSolverConfig((c) => ({
                  ...c,
                  nightShareCapPercent: Math.min(
                    100,
                    Math.max(1, parseInt(e.target.value, 10) || 50),
                  ),
                }))
              }
              className="w-24 h-8"
            />
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex-1 min-w-[200px]">
              <div className="text-sm font-medium">
                Лимит солвера по умолчанию (сек)
              </div>
              <div className="text-[11px] text-muted-foreground">
                Подставляется на странице генерации. На одноядерном сервере
                полный прогон обычно 10–15 мин (900 сек).
              </div>
            </div>
            <Input
              type="number"
              min={10}
              max={1800}
              value={solverConfig.defaultTimeLimitSeconds}
              onChange={(e) =>
                setSolverConfig((c) => ({
                  ...c,
                  defaultTimeLimitSeconds: Math.min(
                    1800,
                    Math.max(10, parseInt(e.target.value, 10) || 900),
                  ),
                }))
              }
              className="w-24 h-8"
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Веса целевой функции</CardTitle>
          <CardDescription>
            Удобная отправная точка — потом можно докрутить вручную.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          {Object.entries(WEIGHT_PRESETS).map(([k, p]) => (
            <Button key={k} variant="outline" size="sm" onClick={() => applyPreset(k)}>
              {p.label}
            </Button>
          ))}
          <Button variant="ghost" size="sm" onClick={resetDefaults}>
            Сбросить к умолчаниям
          </Button>
        </CardContent>
      </Card>

      <div className="rounded-md border border-amber-500/30 bg-amber-950/10 px-4 py-3 text-sm">
        <strong>Важно про масштаб:</strong> штрафы за часы считаются «за каждый
        час» (недобор/переработка), а пожелания — «за смену». Поэтому недобор 12
        ч ≈ {12 * weights.under_hours} — это обычно больше любого личного
        пожелания. Если хотите, чтобы система сильнее слушала людей, поднимайте
        пожелания и/или снижайте «часы».
      </div>

      {WEIGHT_GROUPS.map((group) => (
        <Card key={group.title}>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">{group.title}</CardTitle>
            <CardDescription>{group.description}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {group.weights.map((meta) => {
              const value = weights[meta.key] ?? 0;
              const enabled = value > 0;
              return (
                <div
                  key={meta.key}
                  className="flex flex-wrap items-center gap-3 border-b last:border-0 pb-3 last:pb-0"
                >
                  <div className="flex-1 min-w-[200px]">
                    <div className="text-sm font-medium">{meta.label}</div>
                    {meta.hint && (
                      <div className="text-[11px] text-muted-foreground">
                        {meta.hint}
                      </div>
                    )}
                  </div>
                  {meta.toggleable && (
                    <label className="flex items-center gap-1.5 text-xs cursor-pointer">
                      <Checkbox
                        checked={enabled}
                        onCheckedChange={(c) =>
                          setOne(meta.key, c ? DEFAULT_WEIGHTS[meta.key] : 0)
                        }
                      />
                      вкл
                    </label>
                  )}
                  <Input
                    type="number"
                    min={0}
                    max={meta.max}
                    value={value}
                    disabled={meta.toggleable && !enabled}
                    onChange={(e) => setOne(meta.key, parseInt(e.target.value, 10))}
                    className="w-24 h-8"
                  />
                </div>
              );
            })}
          </CardContent>
        </Card>
      ))}

      <div className="flex gap-2 sticky bottom-4">
        <Button onClick={save} disabled={isPending}>
          {isPending ? "Сохранение..." : "Сохранить настройки"}
        </Button>
      </div>
    </div>
  );
}
