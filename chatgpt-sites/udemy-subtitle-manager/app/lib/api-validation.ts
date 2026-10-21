import { z } from "zod";

export const requestObjectSchema = z.record(z.string(), z.unknown());

export const courseImportSchema = z.object({
  url: z.string().trim().min(1).max(2048),
  tags: z.array(z.string()).max(100).optional(),
});

export const lectureUpdateSchema = z.object({
  learning_status: z.string().nullable().optional(),
  chatgpt_url: z.string().max(2048).nullable().optional(),
});

export const subtitleProcessSchema = z.object({
  language: z.string().trim().min(1).max(32).optional(),
  lecture_ids: z.array(z.coerce.number().int().positive()).max(250).optional(),
  section_id: z.coerce.number().int().positive().optional(),
  course_id: z.coerce.number().int().positive().optional(),
});
