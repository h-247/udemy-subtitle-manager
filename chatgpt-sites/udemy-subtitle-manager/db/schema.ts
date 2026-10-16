import { sql } from "drizzle-orm";
import { integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

const timestamp = (name: string) => text(name).notNull().default(sql`CURRENT_TIMESTAMP`);

export const users = sqliteTable("users", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  platformUserId: text("platform_user_id").notNull().unique(),
  email: text("email").notNull(),
  driveCredentials: text("drive_credentials"),
  isActive: integer("is_active").notNull().default(1),
  createdAt: timestamp("created_at"),
  updatedAt: timestamp("updated_at"),
});

export const udemySessions = sqliteTable("udemy_sessions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  encryptedCookieData: text("encrypted_cookie_data"),
  status: text("status").notNull().default("DISCONNECTED"),
  accountName: text("account_name"),
  businessDomain: text("business_domain"),
  errorMessage: text("error_message"),
  lastValidatedAt: text("last_validated_at"),
  createdAt: timestamp("created_at"),
  updatedAt: timestamp("updated_at"),
}, (table) => [uniqueIndex("udemy_sessions_user_idx").on(table.userId)]);

export const courses = sqliteTable("courses", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  courseId: text("course_id").notNull(),
  title: text("title").notNull(),
  url: text("url").notNull(),
  instructor: text("instructor"),
  thumbnailUrl: text("thumbnail_url"),
  lastSyncedAt: timestamp("last_synced_at"),
  createdAt: timestamp("created_at"),
  updatedAt: timestamp("updated_at"),
}, (table) => [uniqueIndex("courses_user_course_idx").on(table.userId, table.courseId)]);

export const sections = sqliteTable("sections", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  courseId: integer("course_id").notNull().references(() => courses.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  position: integer("position").notNull().default(1),
});

export const lectures = sqliteTable("lectures", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  sectionId: integer("section_id").notNull().references(() => sections.id, { onDelete: "cascade" }),
  lectureId: text("lecture_id").notNull(),
  title: text("title").notNull(),
  url: text("url").notNull(),
  lectureType: text("lecture_type").notNull().default("video"),
  duration: integer("duration").notNull().default(0),
  position: integer("position").notNull().default(1),
  learningStatus: text("learning_status").notNull().default("NOT_STARTED"),
  chatgptUrl: text("chatgpt_url"),
  captionsJson: text("captions_json").notNull().default("[]"),
  createdAt: timestamp("created_at"),
  updatedAt: timestamp("updated_at"),
}, (table) => [uniqueIndex("lectures_section_uid_idx").on(table.sectionId, table.lectureId)]);

export const subtitles = sqliteTable("subtitles", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  lectureId: integer("lecture_id").notNull().references(() => lectures.id, { onDelete: "cascade" }),
  language: text("language").notNull().default("en"),
  subtitleType: text("subtitle_type").notNull().default("NONE"),
  status: text("status").notNull().default("PENDING"),
  storageKey: text("storage_key"),
  driveFileId: text("drive_file_id"),
  driveFileUrl: text("drive_file_url"),
  errorMessage: text("error_message"),
  errorCategory: text("error_category"),
  lastProcessedAt: text("last_processed_at"),
  createdAt: timestamp("created_at"),
  updatedAt: timestamp("updated_at"),
}, (table) => [uniqueIndex("subtitles_lecture_language_idx").on(table.lectureId, table.language)]);

export const processingJobs = sqliteTable("processing_jobs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  courseId: integer("course_id").references(() => courses.id, { onDelete: "cascade" }),
  jobType: text("job_type").notNull(),
  status: text("status").notNull().default("PENDING"),
  totalItems: integer("total_items").notNull().default(0),
  completedItems: integer("completed_items").notNull().default(0),
  failedItems: integer("failed_items").notNull().default(0),
  progressMessage: text("progress_message"),
  errorMessage: text("error_message"),
  payloadJson: text("payload_json").notNull().default("{}"),
  createdAt: timestamp("created_at"),
  updatedAt: timestamp("updated_at"),
});

export const oauthStates = sqliteTable("oauth_states", {
  state: text("state").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  expiresAt: text("expires_at").notNull(),
});
