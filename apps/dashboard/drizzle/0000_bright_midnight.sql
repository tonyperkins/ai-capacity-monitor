CREATE TABLE `metrics` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`collected_at` text NOT NULL,
	`metric_key` text NOT NULL,
	`provider` text NOT NULL,
	`label` text NOT NULL,
	`kind` text NOT NULL,
	`value` integer NOT NULL,
	`display` text NOT NULL,
	`reset_text` text
);
