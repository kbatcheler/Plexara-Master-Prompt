CREATE TABLE "imaging_files" (
	"id" serial PRIMARY KEY NOT NULL,
	"study_id" integer NOT NULL,
	"file_index" integer NOT NULL,
	"sop_instance_uid" text,
	"instance_number" integer,
	"slice_location" real,
	"dicom_object_key" text NOT NULL,
	"file_name" text NOT NULL,
	"file_size" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "comprehensive_reports" (
	"id" serial PRIMARY KEY NOT NULL,
	"patient_id" integer NOT NULL,
	"executive_summary" text,
	"patient_narrative" text,
	"clinical_narrative" text,
	"unified_health_score" numeric,
	"sections_json" jsonb,
	"source_record_ids" jsonb,
	"panel_count" integer DEFAULT 0 NOT NULL,
	"generation_model" text,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "interpretations" ADD COLUMN "idempotency_key" text;--> statement-breakpoint
ALTER TABLE "imaging_annotations" ADD COLUMN "file_index" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "imaging_studies" ADD COLUMN "series_uid" text;--> statement-breakpoint
ALTER TABLE "imaging_studies" ADD COLUMN "number_of_frames" integer;--> statement-breakpoint
ALTER TABLE "imaging_studies" ADD COLUMN "number_of_slices" integer;--> statement-breakpoint
ALTER TABLE "imaging_studies" ADD COLUMN "slice_thickness" real;--> statement-breakpoint
ALTER TABLE "imaging_studies" ADD COLUMN "pixel_spacing" text;--> statement-breakpoint
ALTER TABLE "imaging_studies" ADD COLUMN "interpretation" jsonb;--> statement-breakpoint
ALTER TABLE "imaging_studies" ADD COLUMN "interpretation_model" text;--> statement-breakpoint
ALTER TABLE "imaging_studies" ADD COLUMN "interpretation_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "imaging_files" ADD CONSTRAINT "imaging_files_study_id_imaging_studies_id_fk" FOREIGN KEY ("study_id") REFERENCES "public"."imaging_studies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comprehensive_reports" ADD CONSTRAINT "comprehensive_reports_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "imaging_files_study_order_uq" ON "imaging_files" USING btree ("study_id","file_index");--> statement-breakpoint
CREATE INDEX "compreport_patient_generated_idx" ON "comprehensive_reports" USING btree ("patient_id","generated_at");--> statement-breakpoint
ALTER TABLE "extracted_data" ADD CONSTRAINT "extracted_data_record_id_records_id_fk" FOREIGN KEY ("record_id") REFERENCES "public"."records"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "extracted_data" ADD CONSTRAINT "extracted_data_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "records" ADD CONSTRAINT "records_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "biomarker_results" ADD CONSTRAINT "biomarker_results_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "biomarker_results" ADD CONSTRAINT "biomarker_results_record_id_records_id_fk" FOREIGN KEY ("record_id") REFERENCES "public"."records"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interpretations" ADD CONSTRAINT "interpretations_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interpretations" ADD CONSTRAINT "interpretations_trigger_record_id_records_id_fk" FOREIGN KEY ("trigger_record_id") REFERENCES "public"."records"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gauges" ADD CONSTRAINT "gauges_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_related_interpretation_id_interpretations_id_fk" FOREIGN KEY ("related_interpretation_id") REFERENCES "public"."interpretations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplement_recommendations" ADD CONSTRAINT "supplement_recommendations_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplement_recommendations" ADD CONSTRAINT "supplement_recommendations_record_id_records_id_fk" FOREIGN KEY ("record_id") REFERENCES "public"."records"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplements" ADD CONSTRAINT "supplements_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "biological_age" ADD CONSTRAINT "biological_age_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "biological_age" ADD CONSTRAINT "biological_age_record_id_records_id_fk" FOREIGN KEY ("record_id") REFERENCES "public"."records"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "correlations" ADD CONSTRAINT "correlations_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "baselines" ADD CONSTRAINT "baselines_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "baselines" ADD CONSTRAINT "baselines_source_interpretation_id_interpretations_id_fk" FOREIGN KEY ("source_interpretation_id") REFERENCES "public"."interpretations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stack_changes" ADD CONSTRAINT "stack_changes_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stack_changes" ADD CONSTRAINT "stack_changes_supplement_id_supplements_id_fk" FOREIGN KEY ("supplement_id") REFERENCES "public"."supplements"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alert_preferences" ADD CONSTRAINT "alert_preferences_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_conversations" ADD CONSTRAINT "chat_conversations_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_conversation_id_chat_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."chat_conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patient_notes" ADD CONSTRAINT "patient_notes_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "predictions" ADD CONSTRAINT "predictions_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "protocol_adoptions" ADD CONSTRAINT "protocol_adoptions_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "protocol_adoptions" ADD CONSTRAINT "protocol_adoptions_protocol_id_protocols_id_fk" FOREIGN KEY ("protocol_id") REFERENCES "public"."protocols"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "share_link_access" ADD CONSTRAINT "share_link_access_share_link_id_share_links_id_fk" FOREIGN KEY ("share_link_id") REFERENCES "public"."share_links"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "share_links" ADD CONSTRAINT "share_links_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "genetic_profiles" ADD CONSTRAINT "genetic_profiles_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "genetic_variants" ADD CONSTRAINT "genetic_variants_profile_id_genetic_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."genetic_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "imaging_annotations" ADD CONSTRAINT "imaging_annotations_study_id_imaging_studies_id_fk" FOREIGN KEY ("study_id") REFERENCES "public"."imaging_studies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "imaging_studies" ADD CONSTRAINT "imaging_studies_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "imaging_studies" ADD CONSTRAINT "imaging_studies_record_id_records_id_fk" FOREIGN KEY ("record_id") REFERENCES "public"."records"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pgs_weights" ADD CONSTRAINT "pgs_weights_catalog_id_pgs_catalog_id_fk" FOREIGN KEY ("catalog_id") REFERENCES "public"."pgs_catalog"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "polygenic_scores" ADD CONSTRAINT "polygenic_scores_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "polygenic_scores" ADD CONSTRAINT "polygenic_scores_profile_id_genetic_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."genetic_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "polygenic_scores" ADD CONSTRAINT "polygenic_scores_catalog_id_pgs_catalog_id_fk" FOREIGN KEY ("catalog_id") REFERENCES "public"."pgs_catalog"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "biomarker_trends" ADD CONSTRAINT "biomarker_trends_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "change_alerts" ADD CONSTRAINT "change_alerts_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wearable_ingests" ADD CONSTRAINT "wearable_ingests_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wearable_metrics" ADD CONSTRAINT "wearable_metrics_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wearable_metrics" ADD CONSTRAINT "wearable_metrics_ingest_id_wearable_ingests_id_fk" FOREIGN KEY ("ingest_id") REFERENCES "public"."wearable_ingests"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interaction_dismissals" ADD CONSTRAINT "interaction_dismissals_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interaction_dismissals" ADD CONSTRAINT "interaction_dismissals_rule_id_interaction_rules_id_fk" FOREIGN KEY ("rule_id") REFERENCES "public"."interaction_rules"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lens_disagreements" ADD CONSTRAINT "lens_disagreements_interpretation_id_interpretations_id_fk" FOREIGN KEY ("interpretation_id") REFERENCES "public"."interpretations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lens_disagreements" ADD CONSTRAINT "lens_disagreements_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "interp_idempotency_key_idx" ON "interpretations" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "interp_patient_record_idx" ON "interpretations" USING btree ("patient_id","trigger_record_id");--> statement-breakpoint
CREATE UNIQUE INDEX "gauges_patient_domain_idx" ON "gauges" USING btree ("patient_id","domain");--> statement-breakpoint
CREATE INDEX "imaging_studies_patient_uploaded_idx" ON "imaging_studies" USING btree ("patient_id","uploaded_at");