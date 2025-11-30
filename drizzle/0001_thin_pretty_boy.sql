CREATE TABLE `audit_logs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`action` text NOT NULL,
	`actor_id` integer NOT NULL,
	`target_id` integer,
	`entity_type` text NOT NULL,
	`entity_id` integer,
	`metadata` text,
	`created_at` integer NOT NULL
);
