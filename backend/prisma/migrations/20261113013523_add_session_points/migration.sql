-- CreateTable
CREATE TABLE "session_points" (
    "id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "membership_id" INTEGER NOT NULL,
    "attendance" INTEGER NOT NULL DEFAULT 0,
    "punctuality" INTEGER NOT NULL DEFAULT 0,
    "teamwork" INTEGER NOT NULL DEFAULT 0,
    "focus" INTEGER NOT NULL DEFAULT 0,
    "discipline" INTEGER NOT NULL DEFAULT 0,
    "respect" INTEGER NOT NULL DEFAULT 0,
    "sportsmanship" INTEGER NOT NULL DEFAULT 0,
    "extra_recognition" INTEGER NOT NULL DEFAULT 0,
    "attended_workshop" INTEGER NOT NULL DEFAULT 0,
    "won_tournament" INTEGER NOT NULL DEFAULT 0,
    "given_by" UUID NOT NULL,
    "updated_by" UUID NOT NULL,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) NOT NULL,

    CONSTRAINT "session_points_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "session_points_session_id_idx" ON "session_points"("session_id");

-- CreateIndex
CREATE INDEX "session_points_membership_id_idx" ON "session_points"("membership_id");

-- CreateIndex
CREATE UNIQUE INDEX "session_points_session_id_membership_id_key" ON "session_points"("session_id", "membership_id");

-- AddForeignKey
ALTER TABLE "session_points" ADD CONSTRAINT "session_points_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "session"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session_points" ADD CONSTRAINT "session_points_membership_id_fkey" FOREIGN KEY ("membership_id") REFERENCES "students"("membership_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session_points" ADD CONSTRAINT "session_points_given_by_fkey" FOREIGN KEY ("given_by") REFERENCES "staff_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session_points" ADD CONSTRAINT "session_points_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "staff_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
