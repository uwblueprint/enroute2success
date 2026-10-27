-- CreateTable
CREATE TABLE "account_setup_tokens" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "membership_id" INTEGER NOT NULL,
    "user_id" UUID,
    "token_hash" VARCHAR NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "used_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "account_setup_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "account_setup_tokens_token_hash_key" ON "account_setup_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "account_setup_tokens_membership_id_idx" ON "account_setup_tokens"("membership_id");

-- CreateIndex
CREATE INDEX "account_setup_tokens_user_id_idx" ON "account_setup_tokens"("user_id");

-- AddForeignKey
ALTER TABLE "account_setup_tokens" ADD CONSTRAINT "account_setup_tokens_membership_id_fkey" FOREIGN KEY ("membership_id") REFERENCES "students"("membership_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account_setup_tokens" ADD CONSTRAINT "account_setup_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
