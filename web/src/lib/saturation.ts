/**
 * Оценка «насыщения» аппаратов людьми на конкретный месяц.
 *
 * Это упрощённый, но честный расчёт достаточности через распределение
 * человеко-часов (макс-поток), а не наивная сумма. Он учитывает:
 *   • дележ людей между аппаратами (один человек ограничен своими часами и
 *     не может одновременно «закрыть» несколько постов сверх своей нормы);
 *   • отпуска/недоступность конкретного месяца (через рабочую норму часов);
 *   • допуски и жёсткие запреты (avoid_hard) по постам и сменам.
 *
 * Не моделирует ночные лимиты, чередование смен, парность и т.п. — это уже
 * сама генерация. Здесь цель: быстро показать «хватает ли людей под аппарат».
 */

export type SatPost = {
  id: string;
  name: string;
  shiftHours: number;
  staffRequired: number;
  staffRequiredDay: number | null;
  staffRequiredNight: number | null;
  activeDays: number;
};

export type SatEmployee = {
  name: string;
  /** Доступные человеко-часы за месяц с учётом отпуска (rate × рабочая норма). */
  availableHours: number;
  /** id постов, на которые сотрудник допущен и не полностью запрещён. */
  eligiblePosts: string[];
};

export type SatResult = {
  postId: string;
  demandHours: number;
  coveredHours: number;
  ratio: number; // coveredHours / demandHours (0..1+)
  eligibleCount: number;
};

/** Спрос поста в человеко-часах за месяц. */
export function postDemandHours(p: SatPost): number {
  if (p.shiftHours === 24) {
    const day = p.staffRequiredDay ?? p.staffRequired;
    const night = p.staffRequiredNight ?? p.staffRequired;
    return p.activeDays * (day + night) * 12;
  }
  return p.activeDays * p.staffRequired * 12;
}

// ─────────────────────────── Dinic max-flow ───────────────────────────

class MaxFlow {
  private to: number[] = [];
  private cap: number[] = [];
  private head: number[][];
  private level: number[] = [];
  private iter: number[] = [];

  constructor(private n: number) {
    this.head = Array.from({ length: n }, () => []);
  }

  addEdge(u: number, v: number, c: number) {
    this.head[u].push(this.to.length);
    this.to.push(v);
    this.cap.push(c);
    this.head[v].push(this.to.length);
    this.to.push(u);
    this.cap.push(0);
  }

  private bfs(s: number, t: number): boolean {
    this.level = new Array(this.n).fill(-1);
    const q = [s];
    this.level[s] = 0;
    for (let i = 0; i < q.length; i++) {
      const u = q[i];
      for (const e of this.head[u]) {
        if (this.cap[e] > 0 && this.level[this.to[e]] < 0) {
          this.level[this.to[e]] = this.level[u] + 1;
          q.push(this.to[e]);
        }
      }
    }
    return this.level[t] >= 0;
  }

  private dfs(u: number, t: number, f: number): number {
    if (u === t) return f;
    for (; this.iter[u] < this.head[u].length; this.iter[u]++) {
      const e = this.head[u][this.iter[u]];
      const v = this.to[e];
      if (this.cap[e] > 0 && this.level[v] === this.level[u] + 1) {
        const d = this.dfs(v, t, Math.min(f, this.cap[e]));
        if (d > 0) {
          this.cap[e] -= d;
          this.cap[e ^ 1] += d;
          return d;
        }
      }
    }
    return 0;
  }

  maxflow(s: number, t: number): number {
    let flow = 0;
    const INF = Number.MAX_SAFE_INTEGER;
    while (this.bfs(s, t)) {
      this.iter = new Array(this.n).fill(0);
      let f: number;
      while ((f = this.dfs(s, t, INF)) > 0) flow += f;
    }
    return flow;
  }

  /** Остаточная ёмкость прямого ребра u→v (чётный индекс) — для чтения потока. */
  residual(u: number, v: number): number {
    for (const e of this.head[u]) {
      if (this.to[e] === v && (e & 1) === 0) return this.cap[e];
    }
    return 0;
  }
}

/**
 * Считает покрытие каждого поста: спрос (часы), покрытые часы (сколько людей
 * удалось распределить, в часах) и долю.
 */
export function computeSaturation(
  posts: SatPost[],
  employees: SatEmployee[],
): SatResult[] {
  const P = posts.length;
  const E = employees.length;
  const postIndex = new Map(posts.map((p, i) => [p.id, i]));

  // Узлы: 0 = source, 1..E = люди, E+1..E+P = посты, E+P+1 = sink.
  const source = 0;
  const sink = E + P + 1;
  const mf = new MaxFlow(E + P + 2);

  const caps = employees.map((e) => Math.max(0, Math.round(e.availableHours)));
  for (let i = 0; i < E; i++) {
    if (caps[i] > 0) mf.addEdge(source, 1 + i, caps[i]);
  }

  const demands = posts.map((p) => Math.max(0, Math.round(postDemandHours(p))));
  for (let j = 0; j < P; j++) {
    mf.addEdge(1 + E + j, sink, demands[j]);
  }

  for (let i = 0; i < E; i++) {
    if (caps[i] <= 0) continue;
    for (const pid of employees[i].eligiblePosts) {
      const j = postIndex.get(pid);
      if (j === undefined) continue;
      mf.addEdge(1 + i, 1 + E + j, caps[i]);
    }
  }

  mf.maxflow(source, sink);

  return posts.map((p, j) => {
    const demand = demands[j];
    const covered = Math.max(0, demand - mf.residual(1 + E + j, sink));
    const eligibleCount = employees.filter(
      (e) => e.eligiblePosts.includes(p.id) && e.availableHours > 0,
    ).length;
    return {
      postId: p.id,
      demandHours: demand,
      coveredHours: covered,
      ratio: demand > 0 ? covered / demand : 1,
      eligibleCount,
    };
  });
}
