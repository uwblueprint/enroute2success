-- AlterTable
ALTER TABLE "session_points" ADD COLUMN "sent_at" TIMESTAMP(6);

-- Points recorded before this migration were already visible and already counted in
-- students.points, so treat them as sent.
UPDATE "session_points" SET "sent_at" = "created_at";
