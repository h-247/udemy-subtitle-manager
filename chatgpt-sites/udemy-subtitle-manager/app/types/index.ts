export type UdemySessionStatus =
  | 'CONNECTED'
  | 'EXPIRED_SESSION'
  | 'INVALID_COOKIES'
  | 'AUTH_REQUIRED'
  | 'ACCESS_DENIED'
  | 'UNSUPPORTED_AUTH'
  | 'DISCONNECTED';

export type LearningStatus = 'NOT_STARTED' | 'IN_PROGRESS' | 'COMPLETED';

export type SubtitleStatus =
  | 'PENDING'
  | 'PROCESSING'
  | 'COMPLETED'
  | 'NO_SUBTITLES'
  | 'FAILED';

export type SubtitleType = 'MANUAL' | 'AUTO' | 'IMPORTED' | 'NONE';

export interface User {
  id: number;
  email: string;
  is_active: boolean;
  has_drive_connected: boolean;
  has_udemy_connected: boolean;
  udemy_status?: UdemySessionStatus;
  udemy_account_name?: string | null;
  udemy_business_domain?: string | null;
  created_at: string;
}

export interface Subtitle {
  id: number;
  lecture_id: number;
  language: string;
  subtitle_type: SubtitleType;
  download_status: SubtitleStatus;
  caption_language: string;
  drive_status: "NOT_REQUESTED" | "PENDING" | "COMPLETED" | "FAILED";
  drive_error: string | null;
  status: SubtitleStatus;
  drive_file_id?: string | null;
  drive_file_url?: string | null;
  error_message?: string | null;
  error_category?: string | null;
  last_processed_at?: string | null;
}

export interface Lecture {
  id: number;
  section_id: number;
  lecture_id: string;
  title: string;
  url: string;
  lecture_type: string;
  duration: number; // in seconds
  position: number;
  learning_status: LearningStatus;
  chatgpt_url?: string | null;
  subtitles: Subtitle[];
}

export interface Section {
  id: number;
  course_id: number;
  title: string;
  position: number;
  lectures: Lecture[];
}

export interface Course {
  id: number;
  course_id: string;
  title: string;
  url: string;
  instructor?: string | null;
  tags: string[];
  thumbnail_url?: string | null;
  total_sections: number;
  total_lectures: number;
  completed_lectures: number;
  processed_subtitles: number;
  subtitle_eligible_lectures: number;
  failed_subtitles: number;
  drive_sync_failed: number;
  next_lecture?: Lecture | null;
  next_lecture_section?: Pick<Section, "id" | "title" | "position"> | null;
  last_synced_at: string;
  created_at: string;
  sections?: Section[];
}

export interface CourseListResponse {
  items: Course[];
  total: number;
}

export type JobType = 'COURSE_IMPORT' | 'SUBTITLE_BATCH' | 'SUBTITLE_SINGLE';
export type JobStatus = 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED' | 'CANCELLED';

export interface ProcessingJob {
  id: number;
  user_id: number;
  course_id?: number | null;
  job_type: JobType;
  status: JobStatus;
  total_items: number;
  completed_items: number;
  failed_items: number;
  progress_message?: string | null;
  error_message?: string | null;
  created_at: string;
  updated_at: string;
}

export interface DriveStatus {
  is_configured: boolean;
  is_connected: boolean;
}

export interface UdemyStatusResponse {
  status: UdemySessionStatus;
  account_name?: string | null;
  business_domain?: string | null;
  last_validated_at?: string | null;
  error_message?: string | null;
}

export function formatUdemyUrl(rawUrl: string, activeDomain?: string | null): string {
  if (!rawUrl) return "";
  if (!activeDomain) return rawUrl;
  try {
    const cleanDomain = activeDomain.trim().toLowerCase();
    const parsed = new URL(rawUrl);
    if (parsed.hostname.toLowerCase().endsWith("udemy.com")) {
      parsed.hostname = cleanDomain;
      return parsed.toString();
    }
  } catch {
    // If not a full URL or parse fails, return rawUrl
  }
  return rawUrl;
}
