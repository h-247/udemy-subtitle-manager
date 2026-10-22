CREATE INDEX `lectures_section_status_order_idx` ON `lectures` (`section_id`,`learning_status`,`position`,`id`);--> statement-breakpoint
CREATE INDEX `lectures_section_type_idx` ON `lectures` (`section_id`,`lecture_type`,`learning_status`);--> statement-breakpoint
CREATE INDEX `sections_course_position_idx` ON `sections` (`course_id`,`position`,`id`);--> statement-breakpoint
CREATE INDEX `subtitles_lecture_status_idx` ON `subtitles` (`lecture_id`,`status`,`drive_status`);