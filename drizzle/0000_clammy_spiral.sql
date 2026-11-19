CREATE TABLE `connections` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`box_id` text NOT NULL,
	`a` text NOT NULL,
	`b` text NOT NULL,
	`created_at` text DEFAULT (current_timestamp) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`box_id`) REFERENCES `elements`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `connections_project` ON `connections` (`project_id`);--> statement-breakpoint
CREATE TABLE `elements` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`layer_id` text NOT NULL,
	`kind` text NOT NULL,
	`name` text NOT NULL,
	`address` text DEFAULT '' NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	`lat` real NOT NULL,
	`lng` real NOT NULL,
	`created_at` text DEFAULT (current_timestamp) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`layer_id`) REFERENCES `layers`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `elements_project` ON `elements` (`project_id`);--> statement-breakpoint
CREATE TABLE `layers` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`name` text NOT NULL,
	`visible` integer DEFAULT true NOT NULL,
	`created_at` text DEFAULT (current_timestamp) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `layers_project` ON `layers` (`project_id`);--> statement-breakpoint
CREATE TABLE `port_uses` (
	`box_id` text NOT NULL,
	`port` text NOT NULL,
	`connection_id` text NOT NULL,
	PRIMARY KEY(`box_id`, `port`),
	FOREIGN KEY (`box_id`) REFERENCES `elements`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`connection_id`) REFERENCES `connections`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `project_members` (
	`project_id` text NOT NULL,
	`email` text NOT NULL,
	`role` text NOT NULL,
	`created_at` text DEFAULT (current_timestamp) NOT NULL,
	PRIMARY KEY(`project_id`, `email`),
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `projects` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`owner_id` text NOT NULL,
	`name` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`center_lat` real NOT NULL,
	`center_lng` real NOT NULL,
	`olt_class` text DEFAULT 'gpon_b_plus' NOT NULL,
	`attenuation_db_km` real DEFAULT 0.35 NOT NULL,
	`splice_loss_db` real DEFAULT 0.1 NOT NULL,
	`connector_loss_db` real DEFAULT 0.5 NOT NULL,
	`overlength_pct` real DEFAULT 3 NOT NULL,
	`closure_reserve_m` real DEFAULT 30 NOT NULL,
	`splitter_reserve_m` real DEFAULT 20 NOT NULL,
	`created_at` text DEFAULT (current_timestamp) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `projects_org` ON `projects` (`org_id`);--> statement-breakpoint
CREATE TABLE `routes` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`layer_id` text NOT NULL,
	`name` text NOT NULL,
	`fiber_count` integer NOT NULL,
	`kind` text NOT NULL,
	`points` text NOT NULL,
	`length_m` real NOT NULL,
	`from_element_id` text,
	`to_element_id` text,
	`created_at` text DEFAULT (current_timestamp) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`layer_id`) REFERENCES `layers`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`from_element_id`) REFERENCES `elements`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`to_element_id`) REFERENCES `elements`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `routes_project` ON `routes` (`project_id`);--> statement-breakpoint
CREATE TABLE `splitters` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`box_id` text NOT NULL,
	`ratio` integer NOT NULL,
	`created_at` text DEFAULT (current_timestamp) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`box_id`) REFERENCES `elements`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `splitters_project` ON `splitters` (`project_id`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`created_at` text DEFAULT (current_timestamp) NOT NULL
);
