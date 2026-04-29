-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Post" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "shiftHours" INTEGER NOT NULL DEFAULT 12,
    "staffRequired" INTEGER NOT NULL DEFAULT 1,
    "staffRequiredDay" INTEGER,
    "staffRequiredNight" INTEGER,
    "modality" TEXT NOT NULL DEFAULT '',
    "weekdayActive" BOOLEAN NOT NULL DEFAULT true,
    "weekendActive" BOOLEAN NOT NULL DEFAULT false,
    "activeWeekdays" TEXT NOT NULL DEFAULT '[]',
    "specificDays" TEXT NOT NULL DEFAULT '[]',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_Post" ("createdAt", "id", "modality", "name", "shiftHours", "sortOrder", "staffRequired", "staffRequiredDay", "staffRequiredNight", "updatedAt", "weekdayActive", "weekendActive") SELECT "createdAt", "id", "modality", "name", "shiftHours", "sortOrder", "staffRequired", "staffRequiredDay", "staffRequiredNight", "updatedAt", "weekdayActive", "weekendActive" FROM "Post";
DROP TABLE "Post";
ALTER TABLE "new_Post" RENAME TO "Post";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
