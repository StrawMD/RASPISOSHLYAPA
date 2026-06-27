-- AlterTable
ALTER TABLE "Preference" ADD COLUMN "availabilityMode" TEXT;
ALTER TABLE "Preference" ADD COLUMN "availableDays" TEXT NOT NULL DEFAULT '[]';
ALTER TABLE "Preference" ADD COLUMN "postVarietyPref" TEXT;
