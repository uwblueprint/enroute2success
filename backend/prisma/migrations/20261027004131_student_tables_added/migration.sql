-- Preserve the existing staff role column and its values while extending the enum.
ALTER TYPE "staff_type" RENAME TO "role";
ALTER TYPE "role" ADD VALUE 'student';

-- CreateTable
CREATE TABLE "students" (
    "membership_id" INTEGER NOT NULL,
    "manager_id" UUID,
    "first_name" VARCHAR NOT NULL,
    "last_name" VARCHAR,
    "preferred_name" VARCHAR,
    "points" INTEGER NOT NULL DEFAULT 0,
    "allergies" VARCHAR[],
    "notes" VARCHAR,
    "birth_date" DATE NOT NULL,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "students_pkey" PRIMARY KEY ("membership_id")
);

-- CreateIndex
CREATE INDEX "students_manager_id_idx" ON "students"("manager_id");

-- AddForeignKey
ALTER TABLE "students" ADD CONSTRAINT "students_manager_id_fkey" FOREIGN KEY ("manager_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
