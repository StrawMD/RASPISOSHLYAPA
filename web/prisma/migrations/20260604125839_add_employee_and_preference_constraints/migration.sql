-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Employee" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "rate" REAL NOT NULL DEFAULT 1.0,
    "targetRate" REAL NOT NULL DEFAULT 1.0,
    "maxRate" REAL NOT NULL DEFAULT 1.5,
    "seniority" INTEGER NOT NULL DEFAULT 0,
    "hospitalStartYear" INTEGER,
    "careerStartYear" INTEGER,
    "allowedPosts" TEXT NOT NULL DEFAULT '[]',
    "modalities" TEXT NOT NULL DEFAULT '[]',
    "can24h" BOOLEAN NOT NULL DEFAULT false,
    "postPreferences" TEXT NOT NULL DEFAULT '{}',
    "consecutivePref" TEXT NOT NULL DEFAULT 'avoid',
    "medicalRestriction" TEXT NOT NULL DEFAULT 'none',
    "medicalNote" TEXT,
    "recurringUnavailableDows" TEXT NOT NULL DEFAULT '[]',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_Employee" ("allowedPosts", "can24h", "careerStartYear", "createdAt", "hospitalStartYear", "id", "maxRate", "modalities", "name", "postPreferences", "rate", "seniority", "targetRate", "updatedAt") SELECT "allowedPosts", "can24h", "careerStartYear", "createdAt", "hospitalStartYear", "id", "maxRate", "modalities", "name", "postPreferences", "rate", "seniority", "targetRate", "updatedAt" FROM "Employee";
DROP TABLE "Employee";
ALTER TABLE "new_Employee" RENAME TO "Employee";
CREATE UNIQUE INDEX "Employee_name_key" ON "Employee"("name");
CREATE TABLE "new_Preference" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "employeeId" TEXT NOT NULL,
    "monthId" TEXT NOT NULL,
    "pref24hFull" TEXT,
    "pref24hDay" TEXT,
    "pref24hNight" TEXT,
    "shiftTimeMode" TEXT,
    "postPriority" TEXT NOT NULL DEFAULT '[]',
    "postPreferences" TEXT NOT NULL DEFAULT '{}',
    "unavailableDays" TEXT NOT NULL DEFAULT '[]',
    "needsApproval" BOOLEAN NOT NULL DEFAULT false,
    "weekdayPref" TEXT,
    "weekendPref" TEXT,
    "dayOfWeekPrefs" TEXT NOT NULL DEFAULT '{}',
    "desiredDates" TEXT NOT NULL DEFAULT '[]',
    "softUnavailableDays" TEXT NOT NULL DEFAULT '[]',
    "consecutivePrefOverride" TEXT,
    "loadPref" TEXT,
    "maxNights" INTEGER,
    "maxFull" INTEGER,
    "avoidWith" TEXT NOT NULL DEFAULT '[]',
    "preferWith" TEXT NOT NULL DEFAULT '[]',
    "comment" TEXT,
    "submittedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Preference_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Preference_monthId_fkey" FOREIGN KEY ("monthId") REFERENCES "Month" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Preference" ("comment", "dayOfWeekPrefs", "desiredDates", "employeeId", "id", "monthId", "needsApproval", "postPreferences", "postPriority", "pref24hDay", "pref24hFull", "pref24hNight", "shiftTimeMode", "submittedAt", "unavailableDays", "updatedAt", "weekdayPref", "weekendPref") SELECT "comment", "dayOfWeekPrefs", "desiredDates", "employeeId", "id", "monthId", "needsApproval", "postPreferences", "postPriority", "pref24hDay", "pref24hFull", "pref24hNight", "shiftTimeMode", "submittedAt", "unavailableDays", "updatedAt", "weekdayPref", "weekendPref" FROM "Preference";
DROP TABLE "Preference";
ALTER TABLE "new_Preference" RENAME TO "Preference";
CREATE UNIQUE INDEX "Preference_employeeId_monthId_key" ON "Preference"("employeeId", "monthId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
