# Local security inventory

Generated from the full 23-step PGlite schema, with managed Auth/Storage fixtures. This is catalog inspection, not hosted verification or exhaustive per-table authorization proof. Remote role/write matrix remains pending for every row.

## Application tables

| Schema | Table | RLS | Remote verification |
| --- | --- | --- | --- |
| eazily_private | arrival | Private schema ACL; no table RLS | Pending |
| eazily_private | legacy_order_details | Private schema ACL; no table RLS | Pending |
| eazily_private | payment_events | Private schema ACL; no table RLS | Pending |
| eazily_private | payment_requests | Private schema ACL; no table RLS | Pending |
| eazily_private | quotes | Private schema ACL; no table RLS | Pending |
| eazily_private | refunds | Private schema ACL; no table RLS | Pending |
| eazily_private | service_post_operations | Private schema ACL; no table RLS | Pending |
| eazily_private | service_post_publication_state | Private schema ACL; no table RLS | Pending |
| public | admin_audit_events | Enabled | Pending |
| public | app_configuration | Enabled | Pending |
| public | automation_configuration | Enabled | Pending |
| public | automation_financial_cases | Enabled | Pending |
| public | automation_job_audit | Enabled | Pending |
| public | automation_provider_events | Enabled | Pending |
| public | automation_worker_runs | Enabled | Pending |
| public | background_jobs | Enabled | Pending |
| public | business_expenses | Enabled | Pending |
| public | cashfree_collaborations | Enabled | Pending |
| public | categories | Enabled | Pending |
| public | chat_attachments | Enabled | Pending |
| public | chat_configuration | Enabled | Pending |
| public | chat_conversations | Enabled | Pending |
| public | chat_participant_state | Enabled | Pending |
| public | chat_reports | Enabled | Pending |
| public | chat_staff_access | Enabled | Pending |
| public | chat_staff_audit | Enabled | Pending |
| public | consent_events | Enabled | Pending |
| public | consultant_assessment_attempts | Enabled | Pending |
| public | consultant_assessment_banks | Enabled | Pending |
| public | consultant_assessment_questions | Enabled | Pending |
| public | consultant_rates | Enabled | Pending |
| public | customer_addresses | Enabled | Pending |
| public | customer_memberships | Enabled | Pending |
| public | customer_notification_preferences | Enabled | Pending |
| public | customer_payment_methods | Enabled | Pending |
| public | customer_payments | Enabled | Pending |
| public | customer_refunds | Enabled | Pending |
| public | customer_support_requests | Enabled | Pending |
| public | excel_lead_outbox | Enabled | Pending |
| public | finance_entries | Enabled | Pending |
| public | finance_transactions | Enabled | Pending |
| public | legal_documents | Enabled | Pending |
| public | messages | Enabled | Pending |
| public | notification_outbox | Enabled | Pending |
| public | operational_review_tasks | Enabled | Pending |
| public | partner_applications | Enabled | Pending |
| public | partner_audit_log | Enabled | Pending |
| public | partner_availability | Enabled | Pending |
| public | partner_config | Enabled | Pending |
| public | partner_dashboard_banners | Enabled | Pending |
| public | partner_earnings | Enabled | Pending |
| public | partner_orders | Enabled | Pending |
| public | partner_payouts | Enabled | Pending |
| public | partner_posts | Enabled | Pending |
| public | platform_ratings | Enabled | Pending |
| public | profiles | Enabled | Pending |
| public | realtime_events | Enabled | Pending |
| public | referral_codes | Enabled | Pending |
| public | referral_config | Enabled | Pending |
| public | referrals | Enabled | Pending |
| public | review_invitations | Enabled | Pending |
| public | reviews | Enabled | Pending |
| public | saved_partner_profiles | Enabled | Pending |
| public | saved_vendors | Enabled | Pending |
| public | seller_leads | Enabled | Pending |
| public | seller_messages | Enabled | Pending |
| public | seller_notifications | Enabled | Pending |
| public | seller_order_events | Enabled | Pending |
| public | seller_plans | Enabled | Pending |
| public | seller_pricing_rules | Enabled | Pending |
| public | seller_redemptions | Enabled | Pending |
| public | seller_reviews | Enabled | Pending |
| public | seller_reward_config | Enabled | Pending |
| public | seller_reward_ledger | Enabled | Pending |
| public | seller_rewards_catalog | Enabled | Pending |
| public | seller_subscription_config | Enabled | Pending |
| public | seller_subscription_requests | Enabled | Pending |
| public | seller_subscriptions | Enabled | Pending |
| public | seller_training | Enabled | Pending |
| public | seller_training_progress | Enabled | Pending |
| public | service_policies | Enabled | Pending |
| public | service_requests | Enabled | Pending |
| public | services | Enabled | Pending |
| public | staff_access | Enabled | Pending |
| public | support_ticket_replies | Enabled | Pending |
| public | support_tickets | Enabled | Pending |
| public | vendors | Enabled | Pending |
| public | wallet_ledger | Enabled | Pending |
| public | wallet_lots | Enabled | Pending |
| public | workbook_delivery_confirmations | Enabled | Pending |

## SECURITY DEFINER functions

Every listed function has a configured search path ending in pg_temp after step 23. All application trigger functions have browser execute revoked. Grants alone do not prove authorization; review argument ownership and caller checks using synthetic accounts. post_price is an intentional sanitized directory helper in the private schema.

| Schema | Function | anon execute | authenticated execute |
| --- | --- | --- | --- |
| eazily_private | audit_seller_configuration() | false | false |
| eazily_private | award_seller_points() | false | false |
| eazily_private | calculate(p_role text, p_input jsonb) | false | false |
| eazily_private | guard_profile_changes() | false | false |
| eazily_private | guard_published_post() | false | false |
| eazily_private | post_price(p partner_posts) | true | true |
| eazily_private | remember_service_publication() | false | false |
| public | accept_influencer_terms(p_application_id uuid, p_document_id text, p_version text) | false | true |
| public | adjust_reversed_credit() | false | false |
| public | admin_cancel_automation_job(p_job uuid, p_reason text) | false | true |
| public | admin_correct_seller_subscription(p_partner uuid, p_approval_started_at timestamp with time zone, p_status text) | false | true |
| public | admin_dashboard_summary() | false | true |
| public | admin_retry_automation_job(p_job uuid, p_reason text) | false | true |
| public | admin_review_partner(p_id uuid, p_status text, p_notes text) | false | true |
| public | admin_review_post(p_id uuid, p_status text, p_notes text) | false | true |
| public | admin_seller_finance() | false | true |
| public | automation_health_summary() | false | true |
| public | book_free_introduction(p_post_id uuid, p_slot timestamp with time zone) | false | true |
| public | book_partner_offering(p_post uuid, p_slot timestamp with time zone, p_key uuid) | false | true |
| public | cancel_obsolete_jobs(p_entity_type text, p_entity_id text, p_job_types text[], p_except_key text) | false | false |
| public | change_seller_order(p_order uuid, p_action text, p_reason text) | false | true |
| public | chat_can_access(p_conversation uuid, p_account uuid) | false | true |
| public | chat_order_event_system_message() | false | false |
| public | chat_order_system_message() | false | false |
| public | claim_background_jobs(p_worker_id text, p_limit integer, p_now timestamp with time zone) | false | false |
| public | claim_referral(p_code text) | false | true |
| public | complete_background_job(p_job uuid, p_worker text, p_now timestamp with time zone) | false | false |
| public | consultant_application_assessments_complete(p_application_id uuid, p_details jsonb) | false | false |
| public | consultant_assessment_payload(p_attempt consultant_assessment_attempts, p_language text) | false | false |
| public | create_operational_review_task() | false | false |
| public | create_order_chat() | false | false |
| public | create_seller_quote(p_order uuid, p_input jsonb, p_scope text, p_key uuid) | false | true |
| public | emit_automation_attention_event() | false | false |
| public | emit_chat_event() | false | false |
| public | emit_chat_report_event() | false | false |
| public | emit_chat_state_event() | false | false |
| public | emit_realtime_account_owned_event() | false | false |
| public | emit_realtime_all_roles_event() | false | false |
| public | emit_realtime_application_event() | false | false |
| public | emit_realtime_assessment_event() | false | false |
| public | emit_realtime_availability_event() | false | false |
| public | emit_realtime_consultant_rate_event() | false | false |
| public | emit_realtime_event(p_audience_kind text, p_audience_key text, p_scope text, p_entity_type text, p_entity_id text) | false | false |
| public | emit_realtime_order_child_event() | false | false |
| public | emit_realtime_order_child_event_for(p_order uuid, p_scope text, p_type text, p_id text) | false | false |
| public | emit_realtime_order_event() | false | false |
| public | emit_realtime_partner_owned_event() | false | false |
| public | emit_realtime_post_event() | false | false |
| public | emit_realtime_private_quote_event() | false | false |
| public | emit_realtime_review_event() | false | false |
| public | emit_realtime_role_event() | false | false |
| public | emit_realtime_vendor_event() | false | false |
| public | enforce_current_service_partner_registration() | false | false |
| public | enforce_service_partner_policy_records() | false | false |
| public | enqueue_background_job(p_job_type text, p_entity_type text, p_entity_id text, p_scheduled_at timestamp with time zone, p_deduplication_key text, p_entity_version bigint, p_payload jsonb, p_max_attempts integer) | false | false |
| public | enqueue_due_maintenance(p_now timestamp with time zone) | false | false |
| public | ensure_order_chat(p_order uuid) | false | false |
| public | execute_background_job(p_job uuid, p_worker text, p_external_result jsonb, p_now timestamp with time zone) | false | false |
| public | expire_wallet(p_customer uuid) | false | false |
| public | fail_background_job(p_job uuid, p_worker text, p_failure_class text, p_code text, p_safe_message text, p_now timestamp with time zone) | false | false |
| public | get_booking_otp(p_order uuid) | false | true |
| public | get_chat_messages(p_conversation uuid, p_before timestamp with time zone, p_limit integer) | false | true |
| public | get_chat_unread_total(p_role text) | false | true |
| public | get_consultant_assessment_eligibility(p_application_id uuid) | false | true |
| public | get_order_quote(p_order uuid) | false | true |
| public | get_referral_code() | false | true |
| public | get_seller_gateway_status(p_order uuid) | false | true |
| public | guard_subscription_post_access() | false | false |
| public | handle_new_user() | false | false |
| public | has_staff_permission(p_permission text) | false | true |
| public | is_admin() | false | true |
| public | list_chat_conversations(p_role text, p_before timestamp with time zone, p_limit integer) | false | true |
| public | mark_abandoned_chat_attachments() | false | false |
| public | mark_chat_read(p_conversation uuid, p_message uuid) | false | true |
| public | mark_seller_notifications_read(p_id uuid) | false | true |
| public | open_reported_chat(p_report uuid, p_reason text) | false | true |
| public | prepare_seller_gateway(p_request uuid, p_customer uuid) | false | false |
| public | purge_realtime_events(p_before timestamp with time zone) | false | true |
| public | queue_automation_notification(p_account uuid, p_type text, p_entity_type text, p_entity_id text, p_template text, p_key text) | false | false |
| public | record_automation_payment_confirmation(p_event_id text, p_payment uuid, p_amount bigint, p_currency text, p_reference text) | false | false |
| public | record_automation_payout_confirmation(p_event_id text, p_payout uuid, p_amount bigint, p_currency text, p_reference text) | false | false |
| public | record_automation_refund_confirmation(p_event_id text, p_refund uuid, p_amount bigint, p_currency text, p_reference text) | false | false |
| public | record_chat_staff_view(p_conversation uuid, p_reason text) | false | true |
| public | record_verified_seller_payment(p_request uuid, p_event text, p_amount bigint, p_currency text) | false | false |
| public | record_verified_seller_refund(p_refund uuid, p_event text, p_amount bigint) | false | false |
| public | redact_service_partner_audit_details() | false | false |
| public | redeem_seller_reward(p_partner uuid, p_reward uuid, p_key uuid) | false | true |
| public | register_chat_attachment(p_conversation uuid, p_path text, p_name text, p_mime text, p_size bigint, p_key uuid) | false | true |
| public | reply_seller_review(p_review uuid, p_reply text) | false | true |
| public | report_chat(p_conversation uuid, p_message uuid, p_reason text, p_details text) | false | true |
| public | request_booking_cancellation(p_booking_id uuid, p_reason text, p_idempotency_key uuid) | false | true |
| public | request_official_payment(p_order uuid, p_quote uuid) | false | true |
| public | request_seller_refund(p_order uuid, p_reason text) | false | true |
| public | request_seller_subscription(p_partner uuid, p_plan text, p_key uuid) | false | true |
| public | require_consultant_assessment_for_work() | false | false |
| public | require_consultant_assessment_pass() | false | false |
| public | reserve_wallet(p_booking uuid) | false | true |
| public | respond_to_quote(p_order uuid, p_quote uuid, p_approve boolean, p_reason text) | false | true |
| public | return_booking_wallet() | false | false |
| public | review_seller_order(p_order uuid, p_rating integer, p_body text) | false | true |
| public | reward_completed_referral() | false | false |
| public | save_consultant_assessment_answer(p_attempt_id uuid, p_question_id uuid, p_option_id text) | false | true |
| public | save_partner_application(p_role text, p_details jsonb, p_submit boolean) | false | true |
| public | save_partner_post(p_role text, p_details jsonb, p_action text, p_post_id uuid) | false | true |
| public | save_service_partner_post(p_details jsonb, p_action text, p_post_id uuid, p_operation_key uuid) | false | true |
| public | schedule_availability_expiry() | false | false |
| public | schedule_financial_automation() | false | false |
| public | schedule_partner_order_automation() | false | false |
| public | schedule_service_request_automation() | false | false |
| public | schedule_subscription_automation() | false | false |
| public | seller_can_publish_post(p_partner uuid) | false | false |
| public | seller_can_receive_booking(p_partner uuid) | false | false |
| public | seller_subscription_timeline(p_partner uuid) | false | true |
| public | send_chat_message(p_conversation uuid, p_body text, p_type text, p_attachment uuid, p_reply_to uuid, p_key uuid) | false | true |
| public | send_seller_message(p_order uuid, p_body text, p_key uuid) | false | true |
| public | set_chat_block(p_conversation uuid, p_blocked boolean) | false | true |
| public | set_default_address(p_address_id uuid) | false | true |
| public | set_partner_availability(p_online boolean) | false | true |
| public | start_chat(p_post uuid, p_order uuid, p_request uuid, p_key uuid) | false | true |
| public | start_or_resume_consultant_assessment(p_application_id uuid, p_category text, p_specialisation text, p_language text) | false | true |
| public | start_seller_trial() | false | false |
| public | submit_consultant_assessment(p_attempt_id uuid) | false | true |
| public | submit_request(p_category text, p_service text, p_kind text, p_details jsonb, p_key uuid, p_vendor uuid) | false | true |
| public | submit_service_partner_application(p_details jsonb) | false | true |
| public | sync_seller_subscription_on_approval() | false | false |
| public | track_wallet_credit() | false | false |
| public | update_chat_preferences(p_conversation uuid, p_archived boolean, p_muted boolean) | false | true |
| public | validate_service_partner_registration(p_details jsonb, p_owner uuid) | false | false |
| public | verify_booking_arrival(p_order uuid, p_otp text) | false | true |
| public | wallet_balance() | false | true |
