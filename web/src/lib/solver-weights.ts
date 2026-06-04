/**
 * Конфигурация весов целевой функции солвера.
 *
 * Значения по умолчанию ДОЛЖНЫ совпадать с DEFAULT_WEIGHTS в
 * `web/solver/solver.py` — иначе UI покажет одно, а солвер посчитает другое.
 * Любой вес = 0 означает «фактор выключен».
 */

export const DEFAULT_WEIGHTS: Record<string, number> = {
  under_hours: 500,
  over_hours: 200,
  consec_avoid: 1000,
  block_reward: 150,
  overrun_penalty: 800,
  rest2: 80,
  full_reward: 500,
  partial_penalty: 200,
  post_prefer: 30,
  post_avoid: 50,
  legacy_24h_prefer: 120,
  shift_time_bias: 600,
  weekend_fairness: 30,
  weekday_prefer: 10,
  weekday_avoid: 30,
  dow_prefer: 10,
  dow_avoid: 25,
  desired_date: 20,
  soft_unavailable: 200,
  avoid_with: 300,
  prefer_with: 40,
};

export interface WeightMeta {
  key: string;
  label: string;
  hint: string;
  max: number;
  /** Можно ли выключать (показывать тогл). */
  toggleable: boolean;
}

export interface WeightGroup {
  title: string;
  description: string;
  weights: WeightMeta[];
}

export const WEIGHT_GROUPS: WeightGroup[] = [
  {
    title: "Часы и справедливость",
    description:
      "Самые «тяжёлые» факторы — обычно перевешивают личные пожелания.",
    weights: [
      { key: "under_hours", label: "Недобор часов (за час)", hint: "Насколько важно догрузить человека до целевых часов.", max: 1500, toggleable: false },
      { key: "over_hours", label: "Переработка (за час)", hint: "Насколько важно не перегружать сверх цели.", max: 1500, toggleable: false },
      { key: "weekend_fairness", label: "Равномерность выходных", hint: "Чтобы выходные/праздники делились поровну между людьми.", max: 300, toggleable: true },
    ],
  },
  {
    title: "Очерёдность и отдых",
    description: "Как чередуются смены и отдых между ними.",
    weights: [
      { key: "consec_avoid", label: "Штраф за смены подряд (для «не люблю подряд»)", hint: "Сила избегания двух смен в соседние дни.", max: 2000, toggleable: true },
      { key: "block_reward", label: "Награда за «блоки» (для «люблю подряд»)", hint: "Поощряет ставить смены группами тем, кто так предпочитает.", max: 600, toggleable: true },
      { key: "overrun_penalty", label: "Штраф за серию длиннее желаемой", hint: "Ограничивает длину блока смен сверху.", max: 2000, toggleable: true },
      { key: "rest2", label: "2-й день отдыха после суток/ночи", hint: "Желательно дать второй выходной после тяжёлой смены.", max: 400, toggleable: true },
    ],
  },
  {
    title: "Тип смены (сутки/день/ночь)",
    description: "Поведение на суточных постах.",
    weights: [
      { key: "full_reward", label: "Награда за монолитные сутки (с)", hint: "Предпочесть полные сутки вместо двух 12-часовых.", max: 1500, toggleable: true },
      { key: "partial_penalty", label: "Штраф за дробление суток на день+ночь", hint: "", max: 1000, toggleable: true },
      { key: "shift_time_bias", label: "Сила личного режима (сутки/день)", hint: "Насколько уважать выбор «предпочитаю сутки/дневные».", max: 1500, toggleable: false },
      { key: "legacy_24h_prefer", label: "Легаси: предпочтение типов 24ч", hint: "Старый механизм; можно держать на 0.", max: 400, toggleable: true },
    ],
  },
  {
    title: "Личные пожелания (мягкие)",
    description:
      "Эти факторы по величине обычно меньше часов — это тонкая настройка.",
    weights: [
      { key: "post_prefer", label: "Предпочитаемый аппарат", hint: "База; усиливается стажем.", max: 300, toggleable: true },
      { key: "post_avoid", label: "Нежелательный аппарат", hint: "База; усиливается стажем.", max: 300, toggleable: true },
      { key: "weekday_prefer", label: "Предпочтение будней/выходных", hint: "", max: 200, toggleable: true },
      { key: "weekday_avoid", label: "Избегание будней/выходных", hint: "", max: 300, toggleable: true },
      { key: "dow_prefer", label: "Предпочтение дня недели", hint: "", max: 200, toggleable: true },
      { key: "dow_avoid", label: "Избегание дня недели", hint: "", max: 300, toggleable: true },
      { key: "desired_date", label: "Желаемая дата", hint: "", max: 300, toggleable: true },
      { key: "soft_unavailable", label: "Мягко нежелательный день", hint: "Штраф за работу в день «лучше не ставить».", max: 1000, toggleable: true },
      { key: "avoid_with", label: "Не ставить с коллегой", hint: "", max: 1000, toggleable: true },
      { key: "prefer_with", label: "Хочу работать с коллегой", hint: "", max: 400, toggleable: true },
    ],
  },
];

/** Пресеты — быстрые наборы значений поверх дефолтов. */
export const WEIGHT_PRESETS: Record<string, { label: string; weights: Record<string, number> }> = {
  balanced: {
    label: "Сбалансированно (по умолчанию)",
    weights: { ...DEFAULT_WEIGHTS },
  },
  fair_hours: {
    label: "Справедливее по часам",
    weights: {
      ...DEFAULT_WEIGHTS,
      under_hours: 800,
      over_hours: 400,
      weekend_fairness: 60,
      post_prefer: 15,
      post_avoid: 25,
      desired_date: 10,
    },
  },
  listen_people: {
    label: "Больше слушать пожелания",
    weights: {
      ...DEFAULT_WEIGHTS,
      under_hours: 350,
      over_hours: 150,
      post_prefer: 60,
      post_avoid: 90,
      weekday_prefer: 25,
      weekday_avoid: 60,
      dow_prefer: 25,
      dow_avoid: 50,
      desired_date: 50,
      soft_unavailable: 350,
    },
  },
};

/** Слить сохранённые веса с дефолтами (отбрасываем неизвестные ключи). */
export function mergeWeights(saved: Record<string, number> | null | undefined): Record<string, number> {
  const out = { ...DEFAULT_WEIGHTS };
  if (saved) {
    for (const [k, v] of Object.entries(saved)) {
      if (k in DEFAULT_WEIGHTS && typeof v === "number" && Number.isFinite(v)) {
        out[k] = Math.max(0, Math.round(v));
      }
    }
  }
  return out;
}
