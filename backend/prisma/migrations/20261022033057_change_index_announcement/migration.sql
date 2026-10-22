/*
  Warnings:

  - Made the column `end_date` on table `announcements` required. This step will fail if there are existing NULL values in that column.

*/
-- DropIndex
DROP INDEX "announcements_created_by_idx";

-- AlterTable
ALTER TABLE "announcements" ALTER COLUMN "end_date" SET NOT NULL;

-- CreateIndex
CREATE INDEX "announcements_end_date_idx" ON "announcements"("end_date");
