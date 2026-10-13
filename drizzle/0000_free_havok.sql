CREATE TABLE `demo_limits` (
	`key` text PRIMARY KEY NOT NULL,
	`count` integer NOT NULL,
	`expires` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `limit_expiry_idx` ON `demo_limits` (`expires`);--> statement-breakpoint
CREATE TABLE `demo_sandboxes` (
	`id` text PRIMARY KEY NOT NULL,
	`payload` text NOT NULL,
	`revision` integer NOT NULL,
	`expires` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `sandbox_expiry_idx` ON `demo_sandboxes` (`expires`);