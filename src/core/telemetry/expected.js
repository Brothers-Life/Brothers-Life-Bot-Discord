// What bl_telemetry 1.6 is documented to send: the "Réception des données" page shows what never arrived.
// Nothing here filters anything: unknown types and tables are stored all the same.

// Periodic readings (every telemetry_business_s seconds, 300 by default)
export const READINGS = [
	{ type: 'business_snapshot', label: 'Entreprises', table: 'tel_business_totals' },
	{ type: 'gang_snapshot', label: 'Gangs', table: 'tel_gang_latest' },
	{ type: 'money_flow', label: 'Flux d’argent', table: 'tel_money_flows' },
	{ type: 'health_snapshot', label: 'Santé du serveur', table: 'tel_health' },
];

// events[].type stored in tel_events
export const EVENT_TYPES = ['event', 'game_log', 'player_snapshot', 'economy_snapshot', 'vehicle_snapshot', 'purchase', 'death', 'session_start', 'session_end', 'admin_action', 'anticheat'];

// subtype of type = "event" added by 1.6
export const EVENT_SUBTYPES = ['duty', 'job_change', 'gang_change', 'business_open', 'money_move', 'item_move', 'jail', 'laststand', 'join_timing', 'resource_start', 'resource_stop'];

// subtype of type = "game_log" added by 1.6 (name of the followed table)
export const GAME_LOG_SUBTYPES = ['store_sales', 'bl_shops_buyback_log', 'blf_shop_purchases', 'blh_shop_purchases', 'blf_audit', 'blh_audit', 'blf_repair_log', 'bl_heists_log',
	'bl_heists_runs', 'bl_jc_logs', 'bl_rental_log', 'nightclub_entries', 'nightclub_bounces', 'nightclub_seizures', 'bl_gouv_history', 'bl_instance_log', 'bl_doors_usage',
	'bl_pets_logs', 'bl_lb_rewards', 'gang_territory_log', 'bl_news_invoices', 'bl_phone_transfers', 'bl_phone_staff_log', 'bl_phone_payphone_log', 'bl_phone_wiretaps'];

// db_snapshot cards added by 1.6
export const DB_CARDS = ['wealth_top', 'wealth_stats', 'biz_sales_7d', 'biz_sales_daily', 'biz_items_7d', 'biz_payroll_30d', 'biz_duty_week', 'biz_levels', 'biz_open', 'vehicleshop_7d',
	'jobcenter_7d', 'buyback_7d', 'buyback_daily', 'heists_7d', 'heists_gangs_30d', 'heists_results_30d', 'gangs_xp', 'gangs_territories', 'fishing_species_7d', 'fishing_daily',
	'fishing_crews', 'hunting_species_7d', 'hunting_crews', 'nightclub_7d', 'rental_active', 'pets_species', 'leaderboard_7d', 'doors_7d', 'news_articles', 'census', 'census_by_job',
	'vip_ranks', 'premium_tx_daily', 'premium_items_30d', 'playtime_brackets', 'phone_calls_daily', 'phone_transfers_daily', 'phone_social_7d', 'mdt_invoices_30d'];

// Mirror tables copied (POST /v1/mirror) added by 1.6
export const MIRROR_TABLES = ['store_sales', 'store_orders', 'store_catalog', 'store_warehouses', 'store_wholesale_events', 'store_wholesale_cartons', 'shops', 'shop_items',
	'bl_shops_buyback_log', 'vehicleshop_sales', 'mdt_invoices', 'mdt_vehicle_acts', 'gang_territories', 'gang_territory_log', 'bl_heists_runs', 'bl_heists_log', 'bl_heists_coups',
	'bl_jc_logs', 'bl_jc_progress', 'bl_jc_jobs', 'blf_catch_log', 'blf_player_stats', 'blf_crews', 'blf_crew_members', 'blf_shop_purchases', 'blf_tournaments',
	'blf_tournament_entries', 'blf_audit', 'blf_crusher_log', 'blf_repair_log', 'blh_catch_log', 'blh_sessions', 'blh_player_stats', 'blh_crews', 'blh_crew_members',
	'blh_shop_purchases', 'blh_licenses', 'blh_audit', 'bl_rental_log', 'bl_rental_active', 'nightclub_entries', 'nightclub_bounces', 'nightclub_seizures', 'nightclub_members',
	'bl_lb_stats', 'bl_lb_values', 'bl_lb_daily', 'bl_lb_player_badges', 'bl_lb_rewards', 'bl_lb_badges', 'bl_lb_boards', 'premium_tebex_tx', 'premium_vip_state',
	'premium_vip_ranks', 'premium_playtime', 'premium_stats_daily', 'premium_purchases', 'premium_owned', 'premium_sales', 'premium_boost_active', 'premium_login_state',
	'premium_staff_gifts', 'bl_gouv_records', 'bl_gouv_requests', 'bl_gouv_history', 'bl_gouv_documents', 'bl_gouv_unknowns', 'instances', 'bl_hotels', 'bl_instance_log',
	'bl_instance_deleted', 'bl_doors_usage', 'bl_doors_devices', 'bl_doors_badges', 'bl_doors_temp', 'bl_news_articles', 'bl_news_campaigns', 'bl_news_clients',
	'bl_news_invoices', 'bl_pets', 'bl_pets_logs', 'bl_fuel_config', 'bl_ac_detections', 'bl_phone_calls', 'bl_phone_transfers', 'bl_phone_payphone_log', 'bl_phone_staff_log',
	'bl_phone_wiretaps', 'bl_phone_devices', 'bl_phone_accounts', 'bl_phone_account_numbers', 'bl_phone_mailboxes', 'bl_phone_social_profiles', 'bl_phone_social_posts',
	'bl_phone_ads', 'bl_phone_ad_reports', 'bl_phone_chess_players', 'bl_phone_bunker_mp', 'bl_phone_game_scores', 'bl_phone_ee_unlocks'];

// Mirror tables only counted (mode = "count") added by 1.6
export const COUNTED_TABLES = ['bl_phone_messages', 'bl_phone_mails', 'bl_phone_media', 'bl_phone_contacts', 'bl_phone_notes', 'bl_phone_social_dm_messages', 'bl_phone_eclair_snaps',
	'bl_phone_clips_videos', 'bl_phone_ombre_msgs', 'bl_doors_codes', 'bl_gouv_photos', 'bl_gouv_kiosks', 'bl_rental_points', 'bl_instance_furniture', 'bl_lb_hourly', 'bl_lb_daily_players'];
