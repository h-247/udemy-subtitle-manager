CREATE TABLE `dispatcher_status` (
	`id` integer PRIMARY KEY NOT NULL,
	`run_id` text,
	`status` text DEFAULT 'NEVER_RUN' NOT NULL,
	`last_started_at` text,
	`heartbeat_at` text,
	`last_finished_at` text,
	`advanced` integer DEFAULT 0 NOT NULL,
	`error_message` text
);
