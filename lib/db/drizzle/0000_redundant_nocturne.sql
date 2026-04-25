CREATE TABLE "patients" (
	"id" serial PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"display_name" text NOT NULL,
	"date_of_birth" text,
	"sex" text,
	"ethnicity" text,
	"is_primary" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "extracted_data" (
	"id" serial PRIMARY KEY NOT NULL,
	"record_id" integer NOT NULL,
	"patient_id" integer NOT NULL,
	"data_type" text,
	"structured_json" jsonb,
	"extraction_confidence" text,
	"extraction_model" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "records" (
	"id" serial PRIMARY KEY NOT NULL,
	"patient_id" integer NOT NULL,
	"record_type" text NOT NULL,
	"file_path" text,
	"file_name" text NOT NULL,
	"upload_date" timestamp with time zone DEFAULT now() NOT NULL,
	"test_date" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "biomarker_reference" (
	"id" serial PRIMARY KEY NOT NULL,
	"biomarker_name" text NOT NULL,
	"category" text,
	"unit" text,
	"clinical_range_low" numeric,
	"clinical_range_high" numeric,
	"optimal_range_low" numeric,
	"optimal_range_high" numeric,
	"age_adjusted" boolean DEFAULT false,
	"sex_adjusted" boolean DEFAULT false,
	"description" text,
	"clinical_significance" text
);
--> statement-breakpoint
CREATE TABLE "biomarker_results" (
	"id" serial PRIMARY KEY NOT NULL,
	"patient_id" integer NOT NULL,
	"record_id" integer NOT NULL,
	"biomarker_name" text NOT NULL,
	"category" text,
	"value" numeric,
	"unit" text,
	"lab_reference_low" numeric,
	"lab_reference_high" numeric,
	"optimal_range_low" numeric,
	"optimal_range_high" numeric,
	"test_date" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "interpretations" (
	"id" serial PRIMARY KEY NOT NULL,
	"patient_id" integer NOT NULL,
	"trigger_record_id" integer,
	"version" integer DEFAULT 1 NOT NULL,
	"lens_a_output" jsonb,
	"lens_b_output" jsonb,
	"lens_c_output" jsonb,
	"reconciled_output" jsonb,
	"patient_narrative" text,
	"clinical_narrative" text,
	"unified_health_score" numeric,
	"lenses_completed" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gauges" (
	"id" serial PRIMARY KEY NOT NULL,
	"patient_id" integer NOT NULL,
	"domain" text NOT NULL,
	"current_value" numeric,
	"clinical_range_low" numeric,
	"clinical_range_high" numeric,
	"optimal_range_low" numeric,
	"optimal_range_high" numeric,
	"trend" text,
	"confidence" text,
	"lens_agreement" text,
	"label" text,
	"description" text,
	"last_updated" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "alerts" (
	"id" serial PRIMARY KEY NOT NULL,
	"patient_id" integer NOT NULL,
	"severity" text DEFAULT 'info' NOT NULL,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"trigger_type" text,
	"related_interpretation_id" integer,
	"related_biomarkers" jsonb,
	"status" text DEFAULT 'active' NOT NULL,
	"dismissed_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"patient_id" integer,
	"action_type" text NOT NULL,
	"llm_provider" text,
	"data_sent_hash" text,
	"timestamp" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "supplement_recommendations" (
	"id" serial PRIMARY KEY NOT NULL,
	"patient_id" integer NOT NULL,
	"record_id" integer,
	"name" text NOT NULL,
	"dosage" text,
	"rationale" text NOT NULL,
	"target_biomarkers" text,
	"evidence_level" text,
	"priority" text NOT NULL,
	"citation" text,
	"status" text DEFAULT 'suggested' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "supplements" (
	"id" serial PRIMARY KEY NOT NULL,
	"patient_id" integer NOT NULL,
	"name" text NOT NULL,
	"dosage" text,
	"frequency" text,
	"started_at" text,
	"notes" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "biological_age" (
	"id" serial PRIMARY KEY NOT NULL,
	"patient_id" integer NOT NULL,
	"record_id" integer NOT NULL,
	"test_date" text,
	"chronological_age" numeric NOT NULL,
	"phenotypic_age" numeric NOT NULL,
	"age_delta" numeric NOT NULL,
	"mortality_score" numeric,
	"method" text DEFAULT 'phenoage_levine_2018' NOT NULL,
	"inputs_json" text,
	"missing_markers" text,
	"confidence" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "correlations" (
	"id" serial PRIMARY KEY NOT NULL,
	"patient_id" integer NOT NULL,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"record_count" integer NOT NULL,
	"earliest_record_date" text,
	"latest_record_date" text,
	"trends_json" text NOT NULL,
	"patterns_json" text NOT NULL,
	"narrative_summary" text NOT NULL,
	"model_used" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "baselines" (
	"id" serial PRIMARY KEY NOT NULL,
	"patient_id" integer NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"source_interpretation_id" integer,
	"established_at" timestamp with time zone DEFAULT now() NOT NULL,
	"snapshot_json" jsonb NOT NULL,
	"notes" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stack_changes" (
	"id" serial PRIMARY KEY NOT NULL,
	"patient_id" integer NOT NULL,
	"supplement_id" integer,
	"supplement_name" text NOT NULL,
	"event_type" text NOT NULL,
	"dosage_before" text,
	"dosage_after" text,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "alert_preferences" (
	"id" serial PRIMARY KEY NOT NULL,
	"patient_id" integer NOT NULL,
	"enable_urgent" boolean DEFAULT true NOT NULL,
	"enable_watch" boolean DEFAULT true NOT NULL,
	"enable_info" boolean DEFAULT true NOT NULL,
	"custom_thresholds" jsonb,
	"email_notifications" boolean DEFAULT false NOT NULL,
	"push_notifications" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "alert_preferences_patient_id_unique" UNIQUE("patient_id")
);
--> statement-breakpoint
CREATE TABLE "chat_conversations" (
	"id" serial PRIMARY KEY NOT NULL,
	"patient_id" integer NOT NULL,
	"account_id" text NOT NULL,
	"subject_type" text NOT NULL,
	"subject_ref" text,
	"title" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chat_messages" (
	"id" serial PRIMARY KEY NOT NULL,
	"conversation_id" integer NOT NULL,
	"role" text NOT NULL,
	"content" text NOT NULL,
	"citations" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "patient_notes" (
	"id" serial PRIMARY KEY NOT NULL,
	"patient_id" integer NOT NULL,
	"author_account_id" text NOT NULL,
	"author_role" text DEFAULT 'patient' NOT NULL,
	"subject_type" text NOT NULL,
	"subject_id" text,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "predictions" (
	"id" serial PRIMARY KEY NOT NULL,
	"patient_id" integer NOT NULL,
	"biomarker_name" text NOT NULL,
	"method" text DEFAULT 'linear' NOT NULL,
	"slope_per_day" real,
	"intercept" real,
	"r_squared" real,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"projection_6mo" real,
	"projection_12mo" real,
	"projection_24mo" real,
	"optimal_crossing_date" text,
	"review_json" jsonb
);
--> statement-breakpoint
CREATE TABLE "protocol_adoptions" (
	"id" serial PRIMARY KEY NOT NULL,
	"patient_id" integer NOT NULL,
	"protocol_id" integer NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone,
	"next_retest_at" timestamp with time zone,
	"notes" text,
	"progress_json" jsonb
);
--> statement-breakpoint
CREATE TABLE "protocols" (
	"id" serial PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"category" text NOT NULL,
	"description" text NOT NULL,
	"evidence_level" text NOT NULL,
	"duration_weeks" integer,
	"requires_physician" boolean DEFAULT false NOT NULL,
	"eligibility_rules" jsonb NOT NULL,
	"components_json" jsonb NOT NULL,
	"retest_biomarkers" jsonb,
	"retest_interval_weeks" integer,
	"citations" jsonb,
	"is_seed" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "protocols_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "share_link_access" (
	"id" serial PRIMARY KEY NOT NULL,
	"share_link_id" integer NOT NULL,
	"accessed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ip_hash" text,
	"user_agent" text,
	"action" text DEFAULT 'view' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "share_links" (
	"id" serial PRIMARY KEY NOT NULL,
	"patient_id" integer NOT NULL,
	"created_by" text NOT NULL,
	"token" text NOT NULL,
	"label" text,
	"recipient_name" text,
	"permissions" text DEFAULT 'read' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "share_links_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "admin_actions" (
	"id" serial PRIMARY KEY NOT NULL,
	"admin_user_id" text NOT NULL,
	"action_type" text NOT NULL,
	"target_account_id" text,
	"target_resource" text,
	"notes_json" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "consent_records" (
	"id" serial PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"scope_key" text NOT NULL,
	"granted" boolean NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "data_requests" (
	"id" serial PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"type" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"details" text,
	"assigned_admin_id" text,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"resolution_notes" text
);
--> statement-breakpoint
CREATE TABLE "data_residency_preferences" (
	"id" serial PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"region" text DEFAULT 'us-east' NOT NULL,
	"set_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "data_residency_preferences_account_id_unique" UNIQUE("account_id")
);
--> statement-breakpoint
CREATE TABLE "genetic_profiles" (
	"id" serial PRIMARY KEY NOT NULL,
	"patient_id" integer NOT NULL,
	"source" text NOT NULL,
	"file_object_key" text NOT NULL,
	"file_name" text NOT NULL,
	"file_sha256" text NOT NULL,
	"snp_count" integer DEFAULT 0 NOT NULL,
	"uploaded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"interpretation" jsonb,
	"interpretation_model" text,
	"interpretation_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "genetic_variants" (
	"id" serial PRIMARY KEY NOT NULL,
	"profile_id" integer NOT NULL,
	"rsid" text NOT NULL,
	"chromosome" text NOT NULL,
	"position" integer NOT NULL,
	"genotype" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "imaging_annotations" (
	"id" serial PRIMARY KEY NOT NULL,
	"study_id" integer NOT NULL,
	"type" text NOT NULL,
	"geometry_json" jsonb NOT NULL,
	"label" text,
	"measurement_value" real,
	"measurement_unit" text,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "imaging_studies" (
	"id" serial PRIMARY KEY NOT NULL,
	"patient_id" integer NOT NULL,
	"record_id" integer,
	"modality" text,
	"body_part" text,
	"description" text,
	"study_date" text,
	"sop_instance_uid" text,
	"rows" integer,
	"columns" integer,
	"file_name" text NOT NULL,
	"dicom_object_key" text NOT NULL,
	"file_size" integer,
	"uploaded_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pgs_catalog" (
	"id" serial PRIMARY KEY NOT NULL,
	"pgs_id" text NOT NULL,
	"name" text NOT NULL,
	"trait" text NOT NULL,
	"short_description" text,
	"citation" text,
	"snp_count" integer DEFAULT 0 NOT NULL,
	"weights_loaded" boolean DEFAULT false NOT NULL,
	"population_mean" real,
	"population_std_dev" real,
	"loaded_at" timestamp with time zone,
	CONSTRAINT "pgs_catalog_pgs_id_unique" UNIQUE("pgs_id")
);
--> statement-breakpoint
CREATE TABLE "pgs_weights" (
	"id" serial PRIMARY KEY NOT NULL,
	"catalog_id" integer NOT NULL,
	"rsid" text NOT NULL,
	"effect_allele" text NOT NULL,
	"other_allele" text,
	"weight" real NOT NULL
);
--> statement-breakpoint
CREATE TABLE "polygenic_scores" (
	"id" serial PRIMARY KEY NOT NULL,
	"patient_id" integer NOT NULL,
	"profile_id" integer NOT NULL,
	"catalog_id" integer NOT NULL,
	"raw_score" real NOT NULL,
	"z_score" real,
	"percentile" real,
	"snps_matched" integer NOT NULL,
	"snps_total" integer NOT NULL,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "biomarker_trends" (
	"id" serial PRIMARY KEY NOT NULL,
	"patient_id" integer NOT NULL,
	"biomarker_name" text NOT NULL,
	"slope_per_day" real,
	"intercept" real,
	"unit" text,
	"r2" real,
	"window_days" integer NOT NULL,
	"sample_count" integer NOT NULL,
	"first_at" timestamp with time zone,
	"last_at" timestamp with time zone,
	"last_value" real,
	"projection_30d" real,
	"projection_90d" real,
	"projection_365d" real,
	"band_low_30d" real,
	"band_high_30d" real,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "change_alerts" (
	"id" serial PRIMARY KEY NOT NULL,
	"patient_id" integer NOT NULL,
	"biomarker_name" text NOT NULL,
	"window_days" integer NOT NULL,
	"baseline_value" real NOT NULL,
	"current_value" real NOT NULL,
	"percent_change" real NOT NULL,
	"direction" text NOT NULL,
	"severity" text NOT NULL,
	"unit" text,
	"fired_at" timestamp with time zone DEFAULT now() NOT NULL,
	"acknowledged_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "wearable_connections" (
	"id" serial PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"provider" text NOT NULL,
	"access_token_enc" text,
	"refresh_token_enc" text,
	"expires_at" timestamp with time zone,
	"scopes" text,
	"external_user_id" text,
	"connected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_sync_at" timestamp with time zone,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "wearable_ingests" (
	"id" serial PRIMARY KEY NOT NULL,
	"patient_id" integer NOT NULL,
	"provider" text NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"record_count" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"error" text
);
--> statement-breakpoint
CREATE TABLE "wearable_metrics" (
	"id" serial PRIMARY KEY NOT NULL,
	"patient_id" integer NOT NULL,
	"provider" text NOT NULL,
	"metric_key" text NOT NULL,
	"value" real NOT NULL,
	"unit" text,
	"recorded_at" timestamp with time zone NOT NULL,
	"source" text,
	"external_id" text DEFAULT '' NOT NULL,
	"ingest_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "interaction_dismissals" (
	"id" serial PRIMARY KEY NOT NULL,
	"patient_id" integer NOT NULL,
	"rule_id" integer NOT NULL,
	"dismissed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"note" text
);
--> statement-breakpoint
CREATE TABLE "interaction_rules" (
	"id" serial PRIMARY KEY NOT NULL,
	"substance_a" text NOT NULL,
	"substance_b" text NOT NULL,
	"severity" text NOT NULL,
	"mechanism" text NOT NULL,
	"clinical_effect" text NOT NULL,
	"source" text,
	"citation" text
);
--> statement-breakpoint
CREATE TABLE "lens_disagreements" (
	"id" serial PRIMARY KEY NOT NULL,
	"interpretation_id" integer NOT NULL,
	"patient_id" integer NOT NULL,
	"finding" text NOT NULL,
	"lens_a_view" text,
	"lens_b_view" text,
	"lens_c_view" text,
	"severity" text DEFAULT 'medium' NOT NULL,
	"category" text,
	"resolved_at" timestamp with time zone,
	"resolution_note" text,
	"extracted_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "consents_account_scope_idx" ON "consent_records" USING btree ("account_id","scope_key");--> statement-breakpoint
CREATE INDEX "variants_rsid_idx" ON "genetic_variants" USING btree ("rsid");--> statement-breakpoint
CREATE INDEX "variants_profile_idx" ON "genetic_variants" USING btree ("profile_id");--> statement-breakpoint
CREATE INDEX "weights_catalog_rsid_idx" ON "pgs_weights" USING btree ("catalog_id","rsid");--> statement-breakpoint
CREATE UNIQUE INDEX "scores_patient_profile_catalog_idx" ON "polygenic_scores" USING btree ("patient_id","profile_id","catalog_id");--> statement-breakpoint
CREATE UNIQUE INDEX "trends_patient_biomarker_idx" ON "biomarker_trends" USING btree ("patient_id","biomarker_name");--> statement-breakpoint
CREATE INDEX "ca_patient_fired_idx" ON "change_alerts" USING btree ("patient_id","fired_at");--> statement-breakpoint
CREATE UNIQUE INDEX "wc_acct_provider_idx" ON "wearable_connections" USING btree ("account_id","provider");--> statement-breakpoint
CREATE INDEX "wm_patient_key_time_idx" ON "wearable_metrics" USING btree ("patient_id","metric_key","recorded_at");--> statement-breakpoint
CREATE UNIQUE INDEX "wm_dedup_idx" ON "wearable_metrics" USING btree ("patient_id","provider","metric_key","recorded_at","external_id");--> statement-breakpoint
CREATE UNIQUE INDEX "id_patient_rule_idx" ON "interaction_dismissals" USING btree ("patient_id","rule_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ir_pair_idx" ON "interaction_rules" USING btree ("substance_a","substance_b");--> statement-breakpoint
CREATE INDEX "ir_a_idx" ON "interaction_rules" USING btree ("substance_a");--> statement-breakpoint
CREATE INDEX "ir_b_idx" ON "interaction_rules" USING btree ("substance_b");--> statement-breakpoint
CREATE INDEX "ld_patient_extracted_idx" ON "lens_disagreements" USING btree ("patient_id","extracted_at");--> statement-breakpoint
CREATE INDEX "ld_interpretation_idx" ON "lens_disagreements" USING btree ("interpretation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ld_uniq_interp_finding_idx" ON "lens_disagreements" USING btree ("interpretation_id","finding");