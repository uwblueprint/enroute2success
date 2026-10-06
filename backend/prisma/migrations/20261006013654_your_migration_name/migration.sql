-- CreateEnum
CREATE TYPE "session_type" AS ENUM ('golf', 'chess');

-- CreateEnum
CREATE TYPE "session_status" AS ENUM ('draft', 'scheduled', 'cancelled');

-- CreateTable
CREATE TABLE "session" (
    "id" UUID NOT NULL,
    "session_series_id" UUID,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "location" TEXT,
    "max_attendees" INTEGER,
    "status" "session_status" NOT NULL DEFAULT 'draft',
    "session_type" "session_type" NOT NULL,
    "start_datetime" TIMESTAMP(6) NOT NULL,
    "end_datetime" TIMESTAMP(6) NOT NULL,
    "notes" TEXT,
    "image_urls" TEXT[],
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "session_series" (
    "id" UUID NOT NULL,
    "recurrence" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "location" TEXT,
    "max_attendees" INTEGER,
    "session_type" "session_type" NOT NULL,
    "start_date" DATE NOT NULL,
    "end_date" DATE,
    "start_time" TIME(6) NOT NULL,
    "end_time" TIME(6) NOT NULL,
    "image_urls" TEXT[],
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "session_series_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "session_start_datetime_idx" ON "session"("start_datetime");

-- AddForeignKey
ALTER TABLE "session" ADD CONSTRAINT "session_session_series_id_fkey" FOREIGN KEY ("session_series_id") REFERENCES "session_series"("id") ON DELETE SET NULL ON UPDATE CASCADE;
