CREATE TABLE "savings_goals" (
    "id" TEXT NOT NULL,
    "user_id" UUID NOT NULL,
    "name" VARCHAR(128) NOT NULL,
    "target_amount" DECIMAL(10,2) NOT NULL,
    "current_amount" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "target_date" TIMESTAMPTZ,
    "monthly_savings" DECIMAL(10,2),
    "status" VARCHAR(16) NOT NULL DEFAULT 'active',
    "last_progress_notified_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    CONSTRAINT "savings_goals_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "savings_goals_user_id_status_idx" ON "savings_goals"("user_id", "status");
ALTER TABLE "savings_goals" ADD CONSTRAINT "savings_goals_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
