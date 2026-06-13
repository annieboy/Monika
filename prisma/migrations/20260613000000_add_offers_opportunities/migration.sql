-- CreateEnum
CREATE TYPE "OpportunityStatus" AS ENUM ('PENDING', 'SCHEDULED', 'DELIVERED', 'CLICKED', 'CONVERTED', 'DISMISSED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "CommissionStatus" AS ENUM ('PENDING', 'CONFIRMED', 'PAID', 'REVERSED', 'SUSPECTED_FRAUD');

-- CreateEnum
CREATE TYPE "AffiliateNetwork" AS ENUM ('awin', 'cj', 'impact', 'partnerize', 'direct');

-- CreateEnum
CREATE TYPE "CommissionType" AS ENUM ('cpa', 'cpl', 'cpc', 'revenue_share');

-- CreateTable
CREATE TABLE "user_opportunity_preferences" (
    "id" TEXT NOT NULL,
    "user_id" UUID NOT NULL,
    "opportunities_consent" BOOLEAN NOT NULL DEFAULT false,
    "consent_given_at" TIMESTAMPTZ,
    "consent_method" VARCHAR(64),
    "consent_withdrawn_at" TIMESTAMPTZ,
    "max_messages_per_week" INTEGER NOT NULL DEFAULT 2,
    "max_messages_per_month" INTEGER NOT NULL DEFAULT 6,
    "quiet_hours_start" VARCHAR(5) NOT NULL DEFAULT '21:00',
    "quiet_hours_end" VARCHAR(5) NOT NULL DEFAULT '08:00',
    "disabled_categories" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "last_message_sent_at" TIMESTAMPTZ,
    "cooling_off_until" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "user_opportunity_preferences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "offer_categories" (
    "id" TEXT NOT NULL,
    "slug" VARCHAR(64) NOT NULL,
    "name" VARCHAR(128) NOT NULL,
    "description" TEXT,
    "icon_emoji" VARCHAR(8),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "offer_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "offers" (
    "id" TEXT NOT NULL,
    "category_id" TEXT NOT NULL,
    "provider_name" VARCHAR(128) NOT NULL,
    "provider_slug" VARCHAR(64) NOT NULL,
    "provider_logo_url" VARCHAR(512),
    "title" VARCHAR(200) NOT NULL,
    "short_description" VARCHAR(200) NOT NULL,
    "key_benefits" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "key_terms" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "parameters" JSONB NOT NULL DEFAULT '{}',
    "affiliate_network" "AffiliateNetwork" NOT NULL,
    "affiliate_program_id" VARCHAR(128) NOT NULL,
    "affiliate_base_url" VARCHAR(1024) NOT NULL,
    "commission_type" "CommissionType" NOT NULL,
    "commission_value" DECIMAL(10,4) NOT NULL,
    "commission_currency" CHAR(3) NOT NULL DEFAULT 'GBP',
    "cookie_duration_days" INTEGER NOT NULL DEFAULT 30,
    "target_merchant_slugs" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "target_categories" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "min_monthly_spend" DECIMAL(10,2),
    "max_monthly_spend" DECIMAL(10,2),
    "requires_bank_link" BOOLEAN NOT NULL DEFAULT false,
    "fca_disclaimer" TEXT,
    "is_regulated" BOOLEAN NOT NULL DEFAULT false,
    "regulatory_body" VARCHAR(32),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "starts_at" TIMESTAMPTZ,
    "expires_at" TIMESTAMPTZ,
    "last_refreshed_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "refresh_interval_hours" INTEGER NOT NULL DEFAULT 24,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "offers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "opportunities" (
    "id" TEXT NOT NULL,
    "user_id" UUID NOT NULL,
    "offer_id" TEXT NOT NULL,
    "recurring_payment_id" UUID,
    "detection_method" VARCHAR(64) NOT NULL,
    "annual_saving_estimate" DECIMAL(10,2),
    "saving_confidence" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "relevance_score" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "rank_position" INTEGER,
    "status" "OpportunityStatus" NOT NULL DEFAULT 'PENDING',
    "scheduled_delivery_at" TIMESTAMPTZ,
    "delivered_at" TIMESTAMPTZ,
    "expires_at" TIMESTAMPTZ,
    "wa_message_id" VARCHAR(255),
    "clicked_at" TIMESTAMPTZ,
    "converted_at" TIMESTAMPTZ,
    "dismissed_at" TIMESTAMPTZ,
    "dismiss_reason" VARCHAR(64),
    "consent_verified_at" TIMESTAMPTZ,
    "compliance_flags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "opportunities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "affiliate_clicks" (
    "id" TEXT NOT NULL,
    "user_id" UUID NOT NULL,
    "opportunity_id" TEXT,
    "offer_id" TEXT NOT NULL,
    "click_ref" VARCHAR(128) NOT NULL,
    "short_code" VARCHAR(16) NOT NULL,
    "platform" VARCHAR(32) NOT NULL DEFAULT 'whatsapp',
    "redirected_to_url" VARCHAR(2048) NOT NULL,
    "redirected_at" TIMESTAMPTZ,
    "affiliate_network" "AffiliateNetwork" NOT NULL,
    "affiliate_click_id" VARCHAR(255),
    "transaction_id" VARCHAR(255),
    "commission_status" "CommissionStatus" NOT NULL DEFAULT 'PENDING',
    "commission_amount" DECIMAL(10,4),
    "commission_currency" CHAR(3) NOT NULL DEFAULT 'GBP',
    "commission_locked_at" TIMESTAMPTZ,
    "is_suspicious" BOOLEAN NOT NULL DEFAULT false,
    "fraud_flags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "postback_received_at" TIMESTAMPTZ,
    "postback_payload" JSONB,
    "clicked_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "affiliate_clicks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "offer_ingestion_runs" (
    "id" TEXT NOT NULL,
    "source" VARCHAR(64) NOT NULL,
    "status" VARCHAR(16) NOT NULL,
    "offers_created" INTEGER NOT NULL DEFAULT 0,
    "offers_updated" INTEGER NOT NULL DEFAULT 0,
    "offers_expired" INTEGER NOT NULL DEFAULT 0,
    "error_count" INTEGER NOT NULL DEFAULT 0,
    "errors" JSONB,
    "started_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMPTZ,
    "triggered_by" VARCHAR(128),

    CONSTRAINT "offer_ingestion_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "user_opportunity_preferences_user_id_key" ON "user_opportunity_preferences"("user_id");
CREATE UNIQUE INDEX "offer_categories_slug_key" ON "offer_categories"("slug");
CREATE INDEX "offers_category_id_idx" ON "offers"("category_id");
CREATE INDEX "offers_provider_slug_idx" ON "offers"("provider_slug");
CREATE INDEX "offers_is_active_expires_at_idx" ON "offers"("is_active", "expires_at");
CREATE UNIQUE INDEX "opportunities_user_id_offer_id_key" ON "opportunities"("user_id", "offer_id");
CREATE INDEX "opportunities_user_id_status_idx" ON "opportunities"("user_id", "status");
CREATE INDEX "opportunities_scheduled_delivery_at_idx" ON "opportunities"("scheduled_delivery_at");
CREATE INDEX "opportunities_relevance_score_idx" ON "opportunities"("relevance_score" DESC);
CREATE UNIQUE INDEX "affiliate_clicks_click_ref_key" ON "affiliate_clicks"("click_ref");
CREATE UNIQUE INDEX "affiliate_clicks_short_code_key" ON "affiliate_clicks"("short_code");
CREATE INDEX "affiliate_clicks_user_id_idx" ON "affiliate_clicks"("user_id");
CREATE INDEX "affiliate_clicks_offer_id_idx" ON "affiliate_clicks"("offer_id");
CREATE INDEX "offer_ingestion_runs_source_started_at_idx" ON "offer_ingestion_runs"("source", "started_at" DESC);

-- AddForeignKey
ALTER TABLE "user_opportunity_preferences" ADD CONSTRAINT "user_opportunity_preferences_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "offers" ADD CONSTRAINT "offers_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "offer_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_offer_id_fkey" FOREIGN KEY ("offer_id") REFERENCES "offers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_recurring_payment_id_fkey" FOREIGN KEY ("recurring_payment_id") REFERENCES "recurring_payments"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "affiliate_clicks" ADD CONSTRAINT "affiliate_clicks_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "affiliate_clicks" ADD CONSTRAINT "affiliate_clicks_opportunity_id_fkey" FOREIGN KEY ("opportunity_id") REFERENCES "opportunities"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "affiliate_clicks" ADD CONSTRAINT "affiliate_clicks_offer_id_fkey" FOREIGN KEY ("offer_id") REFERENCES "offers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
