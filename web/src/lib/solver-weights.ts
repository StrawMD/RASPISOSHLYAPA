/**
 * Конфигурация весов целевой функции солвера.
 *
 * Значения по умолчанию ДОЛЖНЫ совпадать с DEFAULT_WEIGHTS в
 * `web/solver/solver.py` — иначе UI покажет одно, а солвер посчитает другое.
 * Любой вес = 0 означает «фактор выключен».
 */

export const DEFAULT_WEIGHTS: Record<string, number> = {
  under_hours: 500,
  under_floor: 6000,
  over_hours: 90,
  over_ceiling: 300,
  consec_avoid: 1000,
  block_reward: 150,
  overrun_penalty: 800,
  rest2: 80,
  full_reward: 500,
  partial_penalty: 200,
  post_prefer: 120,
  post_prefer_strong: 350,
  post_avoid: 400,
  post_ban: 80000,
  legacy_24h_prefer: 120,
  shift_time_bias: 600,
  weekend_fairness: 30,
  weekday_prefer: 30,
  weekday_avoid: 120,
  dow_prefer: 10,
  dow_avoid: 25,
  desired_date: 20,
  soft_unavailable: 200,
  pt_soft_unavailable: 8000,
  pt_desired_date: 600,
  avoid_with: 300,
  prefer_with: 40,
  same_post_repeat: 40,
  same_post_keep: 40,
  min_shifts_short: 600,
  dow_shift_avoid: 3000,
  prefer_night_bias: 600,
  night_share: 200,
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
      { key: "under_hours", label: "Недобор часов до цели (за час)", hint: "Насколько важно догрузить человека от базовой ставки до целевых часов.", max: 1500, toggleable: false },
      { key: "under_floor", label: "Недобор НИЖЕ базовой ставки (за час)", hint: "Почти жёсткий штраф за недозаполнение договорной ставки (0.5/1.0). Гарантирует, что ставка заполняется точно, прежде чем кого-то перегружать.", max: 20000, toggleable: false },
      { key: "over_hours", label: "Переработка в пределах потолка (за час)", hint: "Цена часа переработки между целью и желаемым потолком (maxRate). Дёшево = «потолок позволяет».", max: 1500, toggleable: false },
      { key: "over_ceiling", label: "Аварийная переработка сверх потолка (за час)", hint: "База штрафа за часы СВЕРХ желаемого потолка, когда иначе месяц не закрыть. Растёт выпукло и сильнее у тех, кто старше/ограничил себя потолком — лишние смены честно достаются молодым и тем, у кого есть запас.", max: 2000, toggleable: false },
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
      { key: "prefer_night_bias", label: "Сила режима «предпочитаю ночные»", hint: "Насколько отдавать ночные смены тем, кто их предпочёл.", max: 1500, toggleable: true },
      { key: "night_share", label: "Размазывание ночных (мягкий штраф)", hint: "Не даёт ночным (н) концентрироваться у нескольких людей: штраф за долю ночных сверх настроенного жёсткого потолка. Мягко — ночные всё равно закроются, но размажутся по людям.", max: 3000, toggleable: true },
      { key: "dow_shift_avoid", label: "Не ставить тип смены в день недели", hint: "Сила пожелания «в этот день недели не сутки/не ночь» (напр. «в пятницу не сутки»). Сильный мягкий запрет.", max: 8000, toggleable: true },
      { key: "legacy_24h_prefer", label: "Легаси: предпочтение типов 24ч", hint: "Старый механизм; можно держать на 0.", max: 400, toggleable: true },
    ],
  },
  {
    title: "Личные пожелания (мягкие)",
    description:
      "Эти факторы по величине обычно меньше часов — это тонкая настройка.",
    weights: [
      { key: "post_prefer", label: "Аппарат «скорее хочу»", hint: "База; усиливается стажем.", max: 300, toggleable: true },
      { key: "post_prefer_strong", label: "Аппарат «очень хочу»", hint: "Сильнее обычного «хочу»; усиливается стажем.", max: 500, toggleable: true },
      { key: "post_avoid", label: "Аппарат «лучше не ставить»", hint: "Заметный мягкий штраф; усиливается стажем.", max: 2000, toggleable: true },
      { key: "post_ban", label: "Аппарат «вообще не ставить»", hint: "Квази-запрет: огромный штраф, солвер ставит лишь в крайнем случае (лучше переработка у тех, кто аппарат допускает). Админ может переопределить вручную/фикс-слотом.", max: 200000, toggleable: false },
      { key: "weekday_prefer", label: "Предпочтение будней/выходных", hint: "", max: 200, toggleable: true },
      { key: "weekday_avoid", label: "Избегание будней/выходных", hint: "", max: 300, toggleable: true },
      { key: "dow_prefer", label: "Предпочтение дня недели", hint: "", max: 200, toggleable: true },
      { key: "dow_avoid", label: "Избегание дня недели", hint: "", max: 300, toggleable: true },
      { key: "desired_date", label: "Желаемая дата", hint: "", max: 300, toggleable: true },
      { key: "soft_unavailable", label: "Мягко нежелательный день", hint: "Штраф за работу в день «лучше не ставить».", max: 1000, toggleable: true },
      { key: "pt_soft_unavailable", label: "Полставка: нежелательный день (жёстко)", hint: "Для полставочников (0.5) дни «лучше не ставить» трактуются ЖЁСТКО (как «не могу»). Форма гарантирует, что они оставляют минимум свободных дней под ставку. Этот вес-заглушка оставлен для совместимости; фактически работает как запрет.", max: 30000, toggleable: true },
      { key: "pt_desired_date", label: "Полставка: желаемый день", hint: "Сильный приоритет желаемых дней для полставочников (выбор дня, без раздувания часов).", max: 3000, toggleable: true },
      { key: "avoid_with", label: "Не ставить с коллегой", hint: "В одном кабинете (на одном посту) в один день.", max: 1000, toggleable: true },
      { key: "prefer_with", label: "Хочу работать с коллегой", hint: "В одном кабинете (на одном посту) в один день.", max: 400, toggleable: true },
      { key: "same_post_repeat", label: "Тот же аппарат два дня подряд (штраф)", hint: "Сила штрафа за повтор аппарата в соседние дни. Для тех, кто выбрал «хочу разные аппараты».", max: 400, toggleable: true },
      { key: "same_post_keep", label: "Тот же аппарат подряд (награда)", hint: "Награда за один и тот же аппарат в соседние рабочие дни. Для тех, кто выбрал «хочу один и тот же аппарат».", max: 400, toggleable: true },
      { key: "min_shifts_short", label: "Недобор до минимума смен", hint: "Сила пожелания «хочу не меньше N смен». Подтягивает вверх при наличии мест.", max: 3000, toggleable: true },
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
