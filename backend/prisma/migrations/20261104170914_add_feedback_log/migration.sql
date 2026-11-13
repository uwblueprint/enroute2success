-- CreateTable
CREATE TABLE "feedback_log" (
    "id" UUID NOT NULL,
    "receiver" INTEGER NOT NULL,
    "giver" UUID NOT NULL,
    "updated_by" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "text" TEXT NOT NULL,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "feedback_log_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "feedback_log_session_id_idx" ON "feedback_log"("session_id");

-- CreateIndex
CREATE INDEX "feedback_log_receiver_idx" ON "feedback_log"("receiver");

-- CreateIndex
CREATE UNIQUE INDEX "feedback_log_receiver_session_id_key" ON "feedback_log"("receiver", "session_id");

-- AddForeignKey
ALTER TABLE "feedback_log" ADD CONSTRAINT "feedback_log_receiver_fkey" FOREIGN KEY ("receiver") REFERENCES "students"("membership_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feedback_log" ADD CONSTRAINT "feedback_log_giver_fkey" FOREIGN KEY ("giver") REFERENCES "staff_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feedback_log" ADD CONSTRAINT "feedback_log_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "staff_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feedback_log" ADD CONSTRAINT "feedback_log_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "session"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
