-- CreateEnum
CREATE TYPE "OnboardingStatus" AS ENUM ('pending', 'connecting', 'active', 'suspended', 'deleted');

-- CreateEnum
CREATE TYPE "Provider" AS ENUM ('truelayer', 'yapily');

-- CreateEnum
CREATE TYPE "ConsentStatus" AS ENUM ('active', 'expired', 'revoked', 'error');

-- CreateEnum
CREATE TYPE "AccountType" AS ENUM ('current', 'savings', 'credit_card', 'mortgage', 'loan', 'pension');

-- CreateEnum
CREATE TYPE "TransactionType" AS ENUM ('debit', 'credit', 'transfer');

-- CreateEnum
CREATE TYPE "TransactionStatus" AS ENUM ('pending', 'settled', 'declined');

-- CreateEnum
CREATE TYPE "CategoryMethod" AS ENUM ('rule', 'ml', 'llm', 'user_override');

-- CreateEnum
CREATE TYPE "ConversationRole" AS ENUM ('user', 'assistant', 'tool');

-- CreateEnum
CREATE TYPE "RecurringFrequency" AS ENUM ('weekly', 'monthly', 'quarterly', 'annual', 'irregular');

-- CreateEnum
CREATE TYPE "RecurringStatus" AS ENUM ('active', 'cancelled', 'paused');

-- CreateEnum
CREATE TYPE "TokenPurpose" AS ENUM ('bank_connect', 'email_verify', 'account_delete');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "whatsapp_phone_hash" VARCHAR(64) NOT NULL,
    "whatsapp_waba_id" VARCHAR(64) NOT NULL,
    "full_name_enc" BYTEA,
    "email_enc" BYTEA,
    "onboarding_status" "OnboardingStatus" NOT NULL DEFAULT 'pending',
    "terms_accepted_at" TIMESTAMPTZ,
    "terms_version" VARCHAR(16),
    "gdpr_consent_at" TIMESTAMPTZ,
    "marketing_consent" BOOLEAN NOT NULL DEFAULT false,
    "identity_verified" BOOLEAN NOT NULL DEFAULT false,
    "risk_score" SMALLINT NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "deleted_at" TIMESTAMPTZ,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bank_connections" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "provider" "Provider" NOT NULL,
    "provider_consent_id" VARCHAR(255) NOT NULL,
    "bank_id" VARCHAR(64) NOT NULL,
    "bank_display_name" VARCHAR(128) NOT NULL,
    "bank_logo_url" VARCHAR(512),
    "access_token_enc" BYTEA NOT NULL,
    "refresh_token_enc" BYTEA,
    "token_expires_at" TIMESTAMPTZ,
    "consent_status" "ConsentStatus" NOT NULL DEFAULT 'active',
    "consent_expires_at" TIMESTAMPTZ,
    "consent_scopes" TEXT[],
    "last_sync_at" TIMESTAMPTZ,
    "last_sync_status" VARCHAR(32),
    "last_sync_error" TEXT,
    "sync_cursor" VARCHAR(255),
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "bank_connections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accounts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "connection_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "provider_account_id" VARCHAR(255) NOT NULL,
    "account_type" "AccountType" NOT NULL,
    "display_name" VARCHAR(128),
    "currency" CHAR(3) NOT NULL DEFAULT 'GBP',
    "current_balance" DECIMAL(15,2),
    "available_balance" DECIMAL(15,2),
    "credit_limit" DECIMAL(15,2),
    "balance_updated_at" TIMESTAMPTZ,
    "account_number_enc" BYTEA,
    "sort_code_enc" BYTEA,
    "account_last4" CHAR(4),
    "is_primary" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transactions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "account_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "provider_transaction_id" VARCHAR(255) NOT NULL,
    "provider_raw_data" JSONB,
    "amount" DECIMAL(15,2) NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'GBP',
    "transaction_type" "TransactionType" NOT NULL,
    "status" "TransactionStatus" NOT NULL DEFAULT 'settled',
    "merchant_name" VARCHAR(255),
    "merchant_name_clean" VARCHAR(255),
    "merchant_category_code" VARCHAR(8),
    "merchant_logo_url" VARCHAR(512),
    "transaction_date" DATE NOT NULL,
    "value_date" DATE,
    "category" VARCHAR(64),
    "category_confidence" DECIMAL(4,3),
    "category_method" "CategoryMethod",
    "subcategory" VARCHAR(64),
    "raw_description" VARCHAR(500),
    "clean_description" VARCHAR(255),
    "is_recurring" BOOLEAN NOT NULL DEFAULT false,
    "is_subscription" BOOLEAN NOT NULL DEFAULT false,
    "subscription_name" VARCHAR(128),
    "is_internal_transfer" BOOLEAN NOT NULL DEFAULT false,
    "is_refund" BOOLEAN NOT NULL DEFAULT false,
    "is_salary" BOOLEAN NOT NULL DEFAULT false,
    "anomaly_score" DECIMAL(4,3) NOT NULL DEFAULT 0,
    "dedup_hash" VARCHAR(64) NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "role" "ConversationRole" NOT NULL,
    "content" TEXT NOT NULL,
    "content_tokens" INTEGER,
    "tool_calls" JSONB,
    "tool_results" JSONB,
    "model_used" VARCHAR(64),
    "latency_ms" INTEGER,
    "wa_message_id" VARCHAR(255),
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "monthly_summaries" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "year_month" CHAR(7) NOT NULL,
    "total_spend" DECIMAL(15,2),
    "total_income" DECIMAL(15,2),
    "net" DECIMAL(15,2),
    "spend_by_category" JSONB,
    "transaction_count" INTEGER,
    "computed_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "monthly_summaries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recurring_payments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "merchant_name" VARCHAR(255) NOT NULL,
    "typical_amount" DECIMAL(15,2) NOT NULL,
    "amount_variance" DECIMAL(15,2),
    "frequency" "RecurringFrequency" NOT NULL,
    "next_expected_date" DATE,
    "first_seen_date" DATE NOT NULL,
    "last_seen_date" DATE NOT NULL,
    "occurrence_count" INTEGER NOT NULL DEFAULT 1,
    "is_confirmed" BOOLEAN NOT NULL DEFAULT false,
    "user_label" VARCHAR(128),
    "status" "RecurringStatus" NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "recurring_payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_log" (
    "id" BIGSERIAL NOT NULL,
    "user_id" UUID,
    "event_type" VARCHAR(64) NOT NULL,
    "event_data" JSONB,
    "ip_address_hash" VARCHAR(64),
    "user_agent" VARCHAR(255),
    "request_id" VARCHAR(64),
    "service_name" VARCHAR(64),
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "onboarding_tokens" (
    "token" VARCHAR(64) NOT NULL,
    "user_id" UUID NOT NULL,
    "purpose" "TokenPurpose" NOT NULL,
    "expires_at" TIMESTAMPTZ NOT NULL,
    "used_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "onboarding_tokens_pkey" PRIMARY KEY ("token")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_whatsapp_phone_hash_key" ON "users"("whatsapp_phone_hash");

-- CreateIndex
CREATE INDEX "bank_connections_consent_status_idx" ON "bank_connections"("consent_status");

-- CreateIndex
CREATE UNIQUE INDEX "bank_connections_user_id_provider_consent_id_key" ON "bank_connections"("user_id", "provider_consent_id");

-- CreateIndex
CREATE INDEX "accounts_user_id_is_active_idx" ON "accounts"("user_id", "is_active");

-- CreateIndex
CREATE UNIQUE INDEX "accounts_connection_id_provider_account_id_key" ON "accounts"("connection_id", "provider_account_id");

-- CreateIndex
CREATE INDEX "transactions_user_id_transaction_date_idx" ON "transactions"("user_id", "transaction_date" DESC);

-- CreateIndex
CREATE INDEX "transactions_user_id_category_transaction_date_idx" ON "transactions"("user_id", "category", "transaction_date" DESC);

-- CreateIndex
CREATE INDEX "transactions_user_id_merchant_name_clean_idx" ON "transactions"("user_id", "merchant_name_clean");

-- CreateIndex
CREATE INDEX "transactions_user_id_is_subscription_idx" ON "transactions"("user_id", "is_subscription");

-- CreateIndex
CREATE INDEX "transactions_user_id_anomaly_score_idx" ON "transactions"("user_id", "anomaly_score" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "transactions_account_id_provider_transaction_id_key" ON "transactions"("account_id", "provider_transaction_id");

-- CreateIndex
CREATE UNIQUE INDEX "transactions_account_id_dedup_hash_key" ON "transactions"("account_id", "dedup_hash");

-- CreateIndex
CREATE INDEX "conversations_user_id_session_id_created_at_idx" ON "conversations"("user_id", "session_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "conversations_user_id_created_at_idx" ON "conversations"("user_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "monthly_summaries_user_id_year_month_idx" ON "monthly_summaries"("user_id", "year_month" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "monthly_summaries_user_id_year_month_key" ON "monthly_summaries"("user_id", "year_month");

-- CreateIndex
CREATE INDEX "recurring_payments_user_id_status_idx" ON "recurring_payments"("user_id", "status");

-- CreateIndex
CREATE INDEX "audit_log_user_id_created_at_idx" ON "audit_log"("user_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "audit_log_event_type_created_at_idx" ON "audit_log"("event_type", "created_at" DESC);

-- CreateIndex
CREATE INDEX "onboarding_tokens_user_id_idx" ON "onboarding_tokens"("user_id");

-- AddForeignKey
ALTER TABLE "bank_connections" ADD CONSTRAINT "bank_connections_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_connection_id_fkey" FOREIGN KEY ("connection_id") REFERENCES "bank_connections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "monthly_summaries" ADD CONSTRAINT "monthly_summaries_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recurring_payments" ADD CONSTRAINT "recurring_payments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "onboarding_tokens" ADD CONSTRAINT "onboarding_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
