import { describe, expect, it } from "vitest";
import { normalizeCourseTags } from "../app/lib/course-tags";
import {
  courseImportSchema,
  lectureUpdateSchema,
  requestObjectSchema,
  subtitleProcessSchema,
} from "../app/lib/api-validation";

describe("normalizeCourseTags", () => {
  it("normalizes Unicode, whitespace, and duplicate names", () => {
    expect(normalizeCourseTags([" AI ", "ai", "Ｔｅｓｔ", "Test", "Tiếng Việt", "  Deep   learning "]))
      .toEqual(["AI", "Test", "Tiếng Việt", "Deep learning"]);
  });

  it("rejects invalid lists and names", () => {
    expect(() => normalizeCourseTags("AI")).toThrow("Tags must be a list");
    expect(() => normalizeCourseTags([1])).toThrow("Each tag must be text");
    expect(() => normalizeCourseTags(["a".repeat(33)])).toThrow("1–32 characters");
    expect(() => normalizeCourseTags(Array.from({ length: 13 }, (_, index) => `tag-${index}`)))
      .toThrow("Use up to 12 tags");
  });
});

describe("Worker API request schemas", () => {
  it("accepts object-shaped course and lecture updates and normalizes process IDs", () => {
    expect(requestObjectSchema.safeParse({ url: "https://www.udemy.com/course/example/" }).success).toBe(true);
    expect(courseImportSchema.safeParse({ url: "https://www.udemy.com/course/example/", tags: ["AI"] }).success).toBe(true);
    expect(lectureUpdateSchema.safeParse({ learning_status: "DONE", chatgpt_url: null }).success).toBe(true);
    expect(subtitleProcessSchema.parse({ lecture_ids: ["1", 2], language: "en" }).lecture_ids).toEqual([1, 2]);
  });

  it("rejects non-object payloads, empty imports, and excessive subtitle batches", () => {
    expect(requestObjectSchema.safeParse([]).success).toBe(false);
    expect(courseImportSchema.safeParse({ url: "  " }).success).toBe(false);
    expect(subtitleProcessSchema.safeParse({ lecture_ids: Array.from({ length: 251 }, (_, index) => index + 1) }).success).toBe(false);
  });
});
