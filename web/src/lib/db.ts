import { PrismaClient } from "@prisma/client";

function isLockError(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e);
  return /database is locked|database table is locked|SQLITE_BUSY/i.test(msg);
}

function createPrisma() {
  const base = new PrismaClient();

  // SQLite-конкурентность (одновременный опрос ~40 человек):
  //  - WAL: читатели не блокируют писателя и наоборот (persist в файле БД).
  //  - busy_timeout: ждать освобождения блокировки вместо мгновенной ошибки.
  // Fire-and-forget: WAL сохраняется на уровне файла, повторный вызов безвреден.
  base.$executeRawUnsafe("PRAGMA journal_mode=WAL;").catch(() => {});
  base.$executeRawUnsafe("PRAGMA busy_timeout=8000;").catch(() => {});

  // Подстраховка: при кратковременной блокировке БД повторяем операцию,
  // а не отдаём пользователю ошибку «не сохранилось».
  return base.$extends({
    query: {
      async $allOperations({ args, query }) {
        let lastErr: unknown;
        for (let attempt = 0; attempt < 6; attempt++) {
          try {
            return await query(args);
          } catch (e) {
            if (!isLockError(e)) throw e;
            lastErr = e;
            await new Promise((r) => setTimeout(r, 60 * (attempt + 1)));
          }
        }
        throw lastErr;
      },
    },
  });
}

const globalForPrisma = globalThis as unknown as {
  prisma: ReturnType<typeof createPrisma>;
};

export const prisma = globalForPrisma.prisma || createPrisma();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
