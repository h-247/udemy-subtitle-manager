"use client";

import React, { useState } from "react";
import { normalizeCourseTags } from "../lib/course-tags";
import { api } from "../lib/api";
import { ProcessingJob } from "../types";
import { X, BookOpen, AlertCircle, Loader2 } from "lucide-react";

interface CourseImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (message: string, job: ProcessingJob) => void;
}

export default function CourseImportModal({ isOpen, onClose, onSuccess }: CourseImportModalProps) {
  const [url, setUrl] = useState("");
  const [tags, setTags] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!url.trim()) return;

    setLoading(true);
    setError(null);

    try {
      const job = await api.courses.importCourse(url.trim(), normalizeCourseTags(tags.split(",")));
      onSuccess(`Import started for Job #${job.id}. Subtitles will download automatically after the curriculum is imported.`, job);
      setUrl("");
      setTags("");
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to import course.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-in fade-in duration-200">
      <div className="w-full max-w-lg bg-[#262626] border border-[#333333] rounded-2xl shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#333333] bg-[#262626]">
          <h2 className="text-lg font-semibold text-[#ECECEC] flex items-center space-x-2">
            <BookOpen className="w-5 h-5 text-white" />
            <span>Import Udemy Course</span>
          </h2>
          <button
            onClick={onClose}
            className="p-1 text-[#A3A3A3] hover:text-[#ECECEC] rounded-lg hover:bg-[#333333] transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {error && (
            <div className="p-3 bg-rose-500/10 border border-rose-500/20 text-rose-400 text-sm rounded-xl flex items-center space-x-2">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <div className="space-y-1.5">
            <label className="block text-sm font-medium text-[#ECECEC]">
              Udemy Course URL
            </label>
            <input
              type="text"
              required
              placeholder="https://www.udemy.com/course/the-complete-web-development-bootcamp/"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              className="w-full px-3.5 py-2.5 bg-[#1A1A1A] border border-[#333333] rounded-xl text-sm text-[#ECECEC] placeholder-[#737373] focus:outline-none focus:border-white transition-colors"
            />
            <div className="text-[11px] text-[#A3A3A3] space-y-1 pt-1">
              <p>Supported URL formats:</p>
              <ul className="list-disc list-inside font-mono text-[10px] text-[#737373] space-y-0.5">
                <li>https://www.udemy.com/course/&lt;course-slug&gt;/</li>
                <li>https://www.udemy.com/course/&lt;course-slug&gt;/learn/</li>
                <li>https://www.udemy.com/course/&lt;course-slug&gt;/learn/lecture/&lt;id&gt;</li>
              </ul>
            </div>
          </div>

          <div className="space-y-1.5">
            <label htmlFor="import-course-tags" className="block text-sm font-medium text-[#ECECEC]">Tags (optional)</label>
            <input id="import-course-tags" value={tags} onChange={(event) => setTags(event.target.value)} disabled={loading}
              placeholder="AI, English, To learn" className="w-full px-3.5 py-2.5 bg-[#1A1A1A] border border-[#333333] rounded-xl text-sm text-[#ECECEC] placeholder-[#737373] focus:outline-none focus:border-white" />
            <p className="text-[11px] text-[#A3A3A3]">Separate tags with commas. Up to 12 tags, 32 characters each.</p>
          </div>
          <p className="text-xs text-[#A3A3A3]">The course curriculum imports first, then subtitles download and sync to connected Drive automatically. Processing starts in the background and continues after you close this page.</p>
          <div className="flex justify-end space-x-3 pt-3 border-t border-[#333333]">
            <button
              type="button"
              onClick={onClose}
              disabled={loading}
              className="px-4 py-2 text-sm font-medium text-[#ECECEC] bg-[#2E2E2E] hover:bg-[#383838] border border-[#383838] rounded-xl transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading || !url.trim()}
              className="px-4 py-2 text-sm font-semibold text-black bg-white hover:bg-neutral-200 disabled:opacity-50 rounded-xl transition-colors flex items-center space-x-2 shadow-sm"
            >
              {loading && <Loader2 className="w-4 h-4 animate-spin text-black" />}
              <span>{loading ? "Importing..." : "Import & Download Subtitles"}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
