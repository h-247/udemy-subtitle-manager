"use client";

import React, { useState } from "react";
import { Course } from "../types";
import { api } from "../lib/api";
import { X, Trash2, AlertTriangle, Loader2 } from "lucide-react";

interface DeleteCourseModalProps {
  course: Course | null;
  isOpen: boolean;
  onClose: () => void;
  onDeleted: () => void;
}

export default function DeleteCourseModal({ course, isOpen, onClose, onDeleted }: DeleteCourseModalProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen || !course) return null;

  const handleDelete = async () => {
    setLoading(true);
    setError(null);

    try {
      await api.courses.delete(course.id);
      onDeleted();
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to delete course.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-in fade-in duration-200">
      <div className="w-full max-w-md bg-[#262626] border border-[#333333] rounded-2xl shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#333333] bg-[#262626]">
          <h2 className="text-lg font-semibold text-rose-400 flex items-center space-x-2">
            <AlertTriangle className="w-5 h-5 text-rose-400" />
            <span>Confirm Course Deletion</span>
          </h2>
          <button
            onClick={onClose}
            className="p-1 text-[#A3A3A3] hover:text-[#ECECEC] rounded-lg hover:bg-[#333333] transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="p-6 space-y-4">
          {error && (
            <div className="p-3 bg-rose-500/10 border border-rose-500/20 text-rose-400 text-sm rounded-xl">
              {error}
            </div>
          )}

          <p className="text-sm text-[#ECECEC] leading-relaxed">
            Are you sure you want to delete <span className="font-semibold text-white">&quot;{course.title}&quot;</span>?
          </p>

          <div className="p-3 bg-[#1A1A1A] border border-[#333333] rounded-xl text-xs text-[#A3A3A3] space-y-1.5">
            <p className="font-medium text-[#ECECEC]">Google Drive Notice:</p>
            <p>
              This action will remove the course, sections, and lectures from your local database.
              <span className="text-rose-400 font-medium"> All subtitle files and course folders stored on Google Drive will also be permanently deleted.</span>
            </p>
          </div>

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
              type="button"
              onClick={handleDelete}
              disabled={loading}
              className="px-4 py-2 text-sm font-semibold text-white bg-rose-600 hover:bg-rose-500 disabled:opacity-50 rounded-xl transition-colors flex items-center space-x-2 shadow-sm"
            >
              {loading && <Loader2 className="w-4 h-4 animate-spin text-white" />}
              <span>{loading ? "Deleting..." : "Delete Course"}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
