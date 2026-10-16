"use client";

import React, { useState } from "react";
import { Lecture } from "../types";
import { api } from "../lib/api";
import { X, Upload, FileText, AlertCircle, Loader2 } from "lucide-react";

interface ManualSubtitleModalProps {
  lecture: Lecture | null;
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (message: string) => void;
}

export default function ManualSubtitleModal({ lecture, isOpen, onClose, onSuccess }: ManualSubtitleModalProps) {
  const [file, setFile] = useState<File | null>(null);
  const [language, setLanguage] = useState("en");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen || !lecture) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file) {
      setError("Please select a subtitle file (.vtt or .srt).");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const res = await api.subtitles.uploadManual(lecture.id, file, language);
      onSuccess(res.message || "Subtitle uploaded and processed successfully!");
      setFile(null);
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to upload subtitle file.");
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
            <Upload className="w-5 h-5 text-white" />
            <span>Upload Subtitle File (.vtt / .srt)</span>
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
            <span className="text-xs text-[#A3A3A3] block mb-1">Target Lecture</span>
            <p className="text-sm font-medium text-[#ECECEC]">{lecture.title}</p>
          </div>

          <div className="space-y-1.5">
            <label className="block text-sm font-medium text-[#ECECEC]">
              Language Code
            </label>
            <input
              type="text"
              required
              value={language}
              onChange={(e) => setLanguage(e.target.value)}
              placeholder="en, es, fr, de, etc."
              className="w-full px-3.5 py-2.5 bg-[#1A1A1A] border border-[#333333] rounded-xl text-sm text-[#ECECEC] focus:outline-none focus:border-white transition-colors"
            />
          </div>

          <div className="space-y-1.5">
            <label className="block text-sm font-medium text-[#ECECEC]">
              Subtitle File (.vtt or .srt)
            </label>
            <div className="border-2 border-dashed border-[#333333] hover:border-neutral-500 rounded-xl p-4 text-center cursor-pointer transition-colors bg-[#1A1A1A]">
              <input
                type="file"
                accept=".vtt,.srt"
                onChange={(e) => {
                  if (e.target.files?.[0]) setFile(e.target.files[0]);
                }}
                className="hidden"
                id="manual-subtitle-file"
              />
              <label htmlFor="manual-subtitle-file" className="cursor-pointer space-y-1 block">
                <FileText className="w-6 h-6 mx-auto text-[#A3A3A3]" />
                <span className="text-xs font-medium text-white hover:underline block">
                  {file ? file.name : "Select a .vtt or .srt file"}
                </span>
                <span className="text-[11px] text-[#737373] block">
                  WebVTT or SubRip format (max 5MB)
                </span>
              </label>
            </div>
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
              disabled={loading || !file}
              className="px-4 py-2 text-sm font-semibold text-black bg-white hover:bg-neutral-200 disabled:opacity-50 rounded-xl transition-colors flex items-center space-x-2 shadow-sm"
            >
              {loading && <Loader2 className="w-4 h-4 animate-spin text-black" />}
              <span>{loading ? "Processing..." : "Upload & Sync"}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
