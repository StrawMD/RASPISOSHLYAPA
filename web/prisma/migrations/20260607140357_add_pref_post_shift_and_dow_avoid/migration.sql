-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
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
    "postShiftPrefs" TEXT NOT NULL DEFAULT '{}',
    "dowShiftAvoid" TEXT NOT NULL DEFAULT '{}',
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
    "minShifts" INTEGER,
    "avoidSamePost" BOOLEAN NOT NULL DEFAULT false,
    "avoidWith" TEXT NOT NULL DEFAULT '[]',
    "preferWith" TEXT NOT NULL DEFAULT '[]',
    "comment" TEXT,
    "submittedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Preference_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Preference_monthId_fkey" FOREIGN KEY ("monthId") REFERENCES "Month" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Preference" ("avoidSamePost", "avoidWith", "comment", "consecutivePrefOverride", "dayOfWeekPrefs", "desiredDates", "employeeId", "id", "loadPref", "maxFull", "maxNights", "minShifts", "monthId", "needsApproval", "postPreferences", "postPriority", "pref24hDay", "pref24hFull", "pref24hNight", "preferWith", "shiftTimeMode", "softUnavailableDays", "submittedAt", "unavailableDays", "updatedAt", "weekdayPref", "weekendPref") SELECT "avoidSamePost", "avoidWith", "comment", "consecutivePrefOverride", "dayOfWeekPrefs", "desiredDates", "employeeId", "id", "loadPref", "maxFull", "maxNights", "minShifts", "monthId", "needsApproval", "postPreferences", "postPriority", "pref24hDay", "pref24hFull", "pref24hNight", "preferWith", "shiftTimeMode", "softUnavailableDays", "submittedAt", "unavailableDays", "updatedAt", "weekdayPref", "weekendPref" FROM "Preference";
DROP TABLE "Preference";
ALTER TABLE "new_Preference" RENAME TO "Preference";
CREATE UNIQUE INDEX "Preference_employeeId_monthId_key" ON "Preference"("employeeId", "monthId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
