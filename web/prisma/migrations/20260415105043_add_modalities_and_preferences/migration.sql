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
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_Employee" ("allowedPosts", "createdAt", "id", "maxRate", "name", "rate", "seniority", "updatedAt") SELECT "allowedPosts", "createdAt", "id", "maxRate", "name", "rate", "seniority", "updatedAt" FROM "Employee";
DROP TABLE "Employee";
ALTER TABLE "new_Employee" RENAME TO "Employee";
CREATE UNIQUE INDEX "Employee_name_key" ON "Employee"("name");
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
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_Post" ("createdAt", "id", "name", "shiftHours", "sortOrder", "staffRequired", "updatedAt", "weekdayActive", "weekendActive") SELECT "createdAt", "id", "name", "shiftHours", "sortOrder", "staffRequired", "updatedAt", "weekdayActive", "weekendActive" FROM "Post";
DROP TABLE "Post";
ALTER TABLE "new_Post" RENAME TO "Post";
CREATE TABLE "new_Preference" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "employeeId" TEXT NOT NULL,
    "monthId" TEXT NOT NULL,
    "pref24hFull" TEXT,
    "pref24hDay" TEXT,
    "pref24hNight" TEXT,
    "postPriority" TEXT NOT NULL DEFAULT '[]',
    "postPreferences" TEXT NOT NULL DEFAULT '{}',
    "unavailableDays" TEXT NOT NULL DEFAULT '[]',
    "needsApproval" BOOLEAN NOT NULL DEFAULT false,
    "weekdayPref" TEXT,
    "weekendPref" TEXT,
    "dayOfWeekPrefs" TEXT NOT NULL DEFAULT '{}',
    "desiredDates" TEXT NOT NULL DEFAULT '[]',
    "comment" TEXT,
    "submittedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Preference_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Preference_monthId_fkey" FOREIGN KEY ("monthId") REFERENCES "Month" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Preference" ("employeeId", "id", "monthId", "postPriority", "pref24hDay", "pref24hFull", "pref24hNight", "submittedAt", "updatedAt") SELECT "employeeId", "id", "monthId", "postPriority", "pref24hDay", "pref24hFull", "pref24hNight", "submittedAt", "updatedAt" FROM "Preference";
DROP TABLE "Preference";
ALTER TABLE "new_Preference" RENAME TO "Preference";
CREATE UNIQUE INDEX "Preference_employeeId_monthId_key" ON "Preference"("employeeId", "monthId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
