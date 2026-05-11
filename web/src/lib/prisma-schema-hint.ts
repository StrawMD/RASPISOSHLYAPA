/** Понятное сообщение при устаревшей SQLite-схеме (нет миграций). */
export function prismaSchemaHint(e: unknown): string | null {
  if (
    typeof e === "object" &&
    e !== null &&
    "code" in e &&
    (e as { code?: string }).code === "P2022"
  ) {
    return "Схема базы устарела. В каталоге web выполните: npx prisma migrate deploy && npx prisma generate";
  }
  const msg = e instanceof Error ? e.message : "";
  if (/solverFixedSlots|does not exist|no such column/i.test(msg)) {
    return "Схема базы устарела. В каталоге web выполните: npx prisma migrate deploy && npx prisma generate";
  }
  return null;
}
