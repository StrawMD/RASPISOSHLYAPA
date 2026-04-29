-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Employee" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "rate" REAL NOT NULL DEFAULT 1.0,
    "maxRate" REAL NOT NULL DEFAULT 1.5,
    "seniority" INTEGER NOT NULL DEFAULT 0,
    "allowedPosts" TEXT NOT NULL DEFAULT '[]',
    "modalities" TEXT NOT NULL DEFAULT '[]',
    "can24h" BOOLEAN NOT NULL DEFAULT false,
    "postPreferences" TEXT NOT NULL DEFAULT '{}',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_Employee" ("allowedPosts", "can24h", "createdAt", "id", "maxRate", "modalities", "name", "rate", "seniority", "updatedAt") SELECT "allowedPosts", "can24h", "createdAt", "id", "maxRate", "modalities", "name", "rate", "seniority", "updatedAt" FROM "Employee";
DROP TABLE "Employee";
ALTER TABLE "new_Employee" RENAME TO "Employee";
CREATE UNIQUE INDEX "Employee_name_key" ON "Employee"("name");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
