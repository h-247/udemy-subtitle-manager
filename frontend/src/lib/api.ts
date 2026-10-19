import {
  User,
  Course,
  CourseListResponse,
  Lecture,
  Subtitle,
  ProcessingJob,
  DriveStatus,
  UdemyStatusResponse,
} from "../types";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8050/api";

function getAuthHeader(): Record<string, string> {
  if (typeof window === "undefined") return {};
  const token = localStorage.getItem("token");
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const isFormData = typeof FormData !== "undefined" && options.body instanceof FormData;
  const headers: Record<string, string> = {
    ...getAuthHeader(),
    ...(options.headers as Record<string, string>),
  };

  if (!isFormData && !headers["Content-Type"]) {
    headers["Content-Type"] = "application/json";
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  let response: Response;
  try {
    response = await fetch(`${API_BASE}${endpoint}`, {
      ...options,
      headers,
      signal: options.signal || controller.signal,
    });
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error("The server took too long to respond. Please try again.");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    let errorDetail = "An unexpected error occurred.";
    try {
      const errorJson = await response.json();
      if (Array.isArray(errorJson.detail)) {
        errorDetail = errorJson.detail
          .map((item: { msg?: string; loc?: unknown[] }) => {
            const field = Array.isArray(item.loc) ? item.loc.at(-1) : undefined;
            return field ? `${field}: ${item.msg || "Invalid value"}` : item.msg || "Invalid value";
          })
          .join("; ");
      } else if (typeof errorJson.detail === "string") {
        errorDetail = errorJson.detail;
      } else if (errorJson.detail) {
        errorDetail = JSON.stringify(errorJson.detail);
      }
    } catch {
      errorDetail = response.statusText || errorDetail;
    }
    throw new Error(errorDetail);
  }

  return response.json();
}

export const api = {
  auth: {
    async register(email: string, password: string): Promise<User> {
      return request<User>("/auth/register", {
        method: "POST",
        body: JSON.stringify({ email, password }),
      });
    },

    async login(email: string, password: string): Promise<{ access_token: string; user: User }> {
      return request<{ access_token: string; user: User }>("/auth/login", {
        method: "POST",
        body: JSON.stringify({ email, password }),
      });
    },

    async getMe(): Promise<User> {
      return request<User>("/auth/me");
    },

    async logout(): Promise<void> {
      try {
        await request("/auth/logout", { method: "POST" });
      } finally {
        if (typeof window !== "undefined") {
          localStorage.removeItem("token");
        }
      }
    },
  },

  udemy: {
    async getStatus(): Promise<UdemyStatusResponse> {
      return request<UdemyStatusResponse>("/udemy/status");
    },

    async uploadCookies(fileOrText: File | string): Promise<UdemyStatusResponse> {
      if (typeof fileOrText === "string") {
        const formData = new FormData();
        formData.append("cookie_text", fileOrText);
        return request<UdemyStatusResponse>("/udemy/cookies", {
          method: "POST",
          body: formData,
        });
      } else {
        const formData = new FormData();
        formData.append("file", fileOrText);
        return request<UdemyStatusResponse>("/udemy/cookies", {
          method: "POST",
          body: formData,
        });
      }
    },

    async testConnection(): Promise<UdemyStatusResponse> {
      return request<UdemyStatusResponse>("/udemy/test-connection", {
        method: "POST",
      });
    },

    async disconnect(): Promise<{ message: string }> {
      return request<{ message: string }>("/udemy/disconnect", {
        method: "POST",
      });
    },
  },

  drive: {
    async getStatus(): Promise<DriveStatus> {
      return request<DriveStatus>("/drive/status");
    },

    async getAuthUrl(): Promise<{ url: string }> {
      return request<{ url: string }>("/drive/auth-url");
    },

    async disconnect(): Promise<{ message: string }> {
      return request<{ message: string }>("/drive/disconnect", {
        method: "POST",
      });
    },
  },

  courses: {
    async importCourse(url: string): Promise<ProcessingJob> {
      return request<ProcessingJob>("/courses/import", {
        method: "POST",
        body: JSON.stringify({ url }),
      });
    },

    async list(params: { search?: string; page?: number; page_size?: number } = {}): Promise<CourseListResponse> {
      const q = new URLSearchParams();
      if (params.search) q.set("search", params.search);
      if (params.page) q.set("page", params.page.toString());
      if (params.page_size) q.set("page_size", params.page_size.toString());
      return request<CourseListResponse>(`/courses?${q.toString()}`);
    },

    async get(courseId: number): Promise<Course> {
      return request<Course>(`/courses/${courseId}`);
    },

    async sync(courseId: number): Promise<ProcessingJob> {
      return request<ProcessingJob>(`/courses/${courseId}/sync`, {
        method: "POST",
      });
    },

    async delete(courseId: number): Promise<{ message: string }> {
      return request<{ message: string }>(`/courses/${courseId}`, {
        method: "DELETE",
      });
    },

    async updateLecture(
      lectureId: number,
      data: { learning_status?: string; chatgpt_url?: string }
    ): Promise<Lecture> {
      return request<Lecture>(`/courses/lectures/${lectureId}`, {
        method: "PATCH",
        body: JSON.stringify(data),
      });
    },
  },

  subtitles: {
    async process(params: {
      lecture_ids?: number[];
      course_id?: number;
      section_id?: number;
      language?: string;
    }): Promise<ProcessingJob> {
      return request<ProcessingJob>("/subtitles/process", {
        method: "POST",
        body: JSON.stringify(params),
      });
    },

    async processSingle(lectureId: number, language: string = "en"): Promise<ProcessingJob> {
      return request<ProcessingJob>(`/subtitles/lectures/${lectureId}/process?language=${encodeURIComponent(language)}`, {
        method: "POST",
      });
    },

    async uploadManual(
      lectureId: number,
      file: File,
      language: string = "en"
    ): Promise<{ subtitle: Subtitle; message: string }> {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("language", language);
      return request<{ subtitle: Subtitle; message: string }>(`/subtitles/lectures/${lectureId}/upload`, {
        method: "POST",
        body: formData,
      });
    },

    async delete(subtitleId: number): Promise<{ message: string; id: number }> {
      return request<{ message: string; id: number }>(`/subtitles/${subtitleId}`, {
        method: "DELETE",
      });
    },

    async deleteForLecture(lectureId: number): Promise<{ message: string; lecture_id: number }> {
      return request<{ message: string; lecture_id: number }>(`/subtitles/lectures/${lectureId}`, {
        method: "DELETE",
      });
    },
  },

  jobs: {
    async list(courseId?: number): Promise<ProcessingJob[]> {
      const q = courseId ? `?course_id=${courseId}` : "";
      return request<ProcessingJob[]>(`/jobs${q}`);
    },

    async get(jobId: number): Promise<ProcessingJob> {
      return request<ProcessingJob>(`/jobs/${jobId}`);
    },

    async cancel(jobId: number): Promise<ProcessingJob> {
      return request<ProcessingJob>(`/jobs/${jobId}/cancel`, {
        method: "POST",
      });
    },
  },
};
