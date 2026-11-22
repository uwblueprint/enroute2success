-- AlterTable
ALTER TABLE "feedback_log" ADD COLUMN "sent_at" TIMESTAMP(6);

-- Feedback written before this migration was already visible to students and parents,
-- so treat it as sent.
UPDATE "feedback_log" SET "sent_at" = "created_at";
