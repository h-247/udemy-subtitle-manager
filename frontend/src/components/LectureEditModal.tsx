"use client";

import React, { useState, useEffect } from "react";
import { Lecture, LearningStatus } from "../types";
import { api } from "../lib/api";
import { X, Edit3, MessageSquare, ExternalLink, AlertCircle, Loader2 } from "lucide-react";

interface LectureEditModalProps {
  lecture: Lecture | null;
  isOpen: boolean;
  onClose: () => void;
  onSaved: (updated: Lecture) => void;
}

export default function LectureEditModal({ lecture, isOpen, onClose, onSaved }: LectureEditModalProps) {
  const [learningStatus, setLearningStatus] = useState<LearningStatus>("NOT_STARTED");
  const [chatgptUrl, setChatgptUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (lecture) {
      setLearningStatus(lecture.learning_status);
      setChatgptUrl(lecture.chatgpt_url || "");
      setError(null);
    }
  }, [lecture]);

  if (!isOpen || !lecture) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const updated = await api.courses.updateLecture(lecture.id, {
        learning_status: learningStatus,
        chatgpt_url: chatgptUrl.trim() || undefined,
      });
      onSaved(updated);
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to update lecture.");
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
            <Edit3 className="w-5 h-5 text-white" />
            <span>Edit Lecture Details</span>
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

          <div>
            <span className="text-xs text-[#A3A3A3] block mb-1">Lecture Title</span>
            <p className="text-sm font-medium text-[#ECECEC]">{lecture.title}</p>
          </div>

          <div className="space-y-1.5">
            <label className="block text-sm font-medium text-[#ECECEC]">
              Learning Status
            </label>
            <select
              value={learningStatus}
              onChange={(e) => setLearningStatus(e.target.value as LearningStatus)}
              className="w-full px-3.5 py-2.5 bg-[#1A1A1A] border border-[#333333] rounded-xl text-sm text-[#ECECEC] focus:outline-none focus:border-white transition-colors"
            >
              <option value="NOT_STARTED">To do</option>
              <option value="IN_PROGRESS">Doing</option>
              <option value="COMPLETED">Done</option>
            </select>
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="block text-sm font-medium text-[#ECECEC]">
                ChatGPT Conversation URL
              </label>
              {chatgptUrl && (
                <a
                  href={chatgptUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-white hover:underline flex items-center space-x-1"
                >
                  <span>Open Link</span>
                  <ExternalLink className="w-3 h-3" />
                </a>
              )}
            </div>
            <div className="relative">
              <input
                type="url"
                placeholder="https://chatgpt.com/c/..."
                value={chatgptUrl}
                onChange={(e) => setChatgptUrl(e.target.value)}
                className="w-full px-3.5 py-2.5 bg-[#1A1A1A] border border-[#333333] rounded-xl text-sm text-[#ECECEC] placeholder-[#737373] focus:outline-none focus:border-white transition-colors"
              />
            </div>
            <p className="text-[11px] text-[#A3A3A3]">
              Save your manual lecture summary conversation URL from chatgpt.com or chat.openai.com.
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
              type="submit"
              disabled={loading}
              className="px-4 py-2 text-sm font-semibold text-black bg-white hover:bg-neutral-200 disabled:opacity-50 rounded-xl transition-colors flex items-center space-x-2 shadow-sm"
            >
              {loading && <Loader2 className="w-4 h-4 animate-spin text-black" />}
              <span>{loading ? "Saving..." : "Save Changes"}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
