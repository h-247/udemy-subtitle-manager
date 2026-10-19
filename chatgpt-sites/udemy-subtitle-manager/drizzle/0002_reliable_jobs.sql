ALTER TABLE processing_jobs ADD COLUMN attempts INTEGER NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE processing_jobs ADD COLUMN retry_at INTEGER;
--> statement-breakpoint
CREATE TABLE job_leases (user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, token TEXT NOT NULL, expires_at INTEGER NOT NULL);
--> statement-breakpoint
ALTER TABLE subtitles ADD COLUMN caption_language TEXT;
--> statement-breakpoint
ALTER TABLE subtitles ADD COLUMN drive_status TEXT NOT NULL DEFAULT 'NOT_REQUESTED';
--> statement-breakpoint
ALTER TABLE subtitles ADD COLUMN drive_error TEXT;
--> statement-breakpoint
UPDATE subtitles SET caption_language=language,drive_status=CASE WHEN error_category='DRIVE_ERROR' THEN 'FAILED' WHEN drive_file_id IS NOT NULL THEN 'COMPLETED' ELSE 'NOT_REQUESTED' END,drive_error=CASE WHEN error_category='DRIVE_ERROR' THEN error_message ELSE NULL END;
--> statement-breakpoint
UPDATE subtitles SET error_message=NULL,error_category=NULL WHERE error_category='DRIVE_ERROR' AND status='COMPLETED';
--> statement-breakpoint
-- Keep the best record per selected base language, preferring durable captions and Drive files.
-- Existing storage keys remain valid; do not delete R2 objects or external Drive files.
DELETE FROM subtitles WHERE id IN (
 SELECT id FROM (
 SELECT id,ROW_NUMBER() OVER (PARTITION BY lecture_id,lower(replace(replace(language,'_','-'),' ','')) ORDER BY CASE WHEN status='COMPLETED' AND storage_key IS NOT NULL THEN 0 ELSE 1 END,CASE WHEN drive_file_id IS NOT NULL THEN 0 ELSE 1 END,id DESC) AS rank FROM subtitles
 ) WHERE rank>1
);
--> statement-breakpoint
DELETE FROM subtitles WHERE id IN (
 SELECT id FROM (
 SELECT id,ROW_NUMBER() OVER (PARTITION BY lecture_id,lower(substr(replace(language,'_','-'),1,instr(replace(language,'_','-')||'-','-')-1)) ORDER BY CASE WHEN status='COMPLETED' AND storage_key IS NOT NULL THEN 0 ELSE 1 END,CASE WHEN drive_file_id IS NOT NULL THEN 0 ELSE 1 END,id DESC) AS rank FROM subtitles
 ) WHERE rank>1
);
--> statement-breakpoint
UPDATE subtitles SET language=lower(substr(replace(language,'_','-'),1,instr(replace(language,'_','-')||'-','-')-1));
--> statement-breakpoint
CREATE INDEX processing_jobs_dispatch_idx ON processing_jobs(status,retry_at,user_id);
