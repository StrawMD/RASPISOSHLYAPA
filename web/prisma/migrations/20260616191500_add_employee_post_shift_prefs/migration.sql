-- AlterTable: базовые посменные (с/д/н) предпочтения сотрудника на суточных постах
ALTER TABLE "Employee" ADD COLUMN "postShiftPrefs" TEXT NOT NULL DEFAULT '{}';
