import { Suspense } from "react";
import { ScheduleEditPage } from "./editor-page";

export default function Page() {
  return (
    <Suspense fallback={<div className="p-4 text-muted-foreground">Загрузка...</div>}>
      <ScheduleEditPage />
    </Suspense>
  );
}
