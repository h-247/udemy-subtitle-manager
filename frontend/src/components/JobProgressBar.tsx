"use client";

import React from "react";
import { ProcessingJob } from "../types";
import { Loader2, XCircle, CheckCircle2, AlertCircle } from "lucide-react";

interface JobProgressBarProps {
  jobs: ProcessingJob[];
  onCancelJob: (jobId: number) => void;
}

export default function JobProgressBar({ jobs, onCancelJob }: JobProgressBarProps) {
  const activeJobs = jobs.filter((j) => j.job_type === "COURSE_IMPORT" || j.status === "PROCESSING" || j.status === "PENDING");
  if (activeJobs.length === 0) return null;

  return (
    <div className="space-y-3 mb-6" role="status" aria-live="polite">
      {activeJobs.map((job) => {
        const running = job.status === "PROCESSING" || job.status === "PENDING";
        const percent = job.status === "COMPLETED" ? 100 : job.total_items > 0 ? Math.min(100, Math.round((job.completed_items / job.total_items) * 100)) : 0;

        return (
          <div
            key={job.id}
            className="p-4 bg-[#262626] border border-[#333333] rounded-2xl shadow-xl shadow-black/30"
          >
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center space-x-2.5">
                {running ? <Loader2 className="w-4 h-4 text-sky-400 animate-spin" /> : job.status === "COMPLETED" ? <CheckCircle2 className="w-4 h-4 text-white" /> : <AlertCircle className="w-4 h-4 text-rose-400" />}
                <span className="text-sm font-semibold text-[#ECECEC]">
                  {job.job_type === "COURSE_IMPORT" ? `Course import · ${job.status.toLowerCase()}` : "Processing Subtitles"}
                </span>
                <span className="text-xs text-[#A3A3A3] font-mono bg-[#1A1A1A] px-2 py-0.5 rounded-full border border-[#333333]">
                  Job #{job.id}
                </span>
              </div>
              {running && <button
                onClick={() => onCancelJob(job.id)}
                className="text-xs font-medium text-[#A3A3A3] hover:text-rose-400 flex items-center space-x-1 px-2.5 py-1 rounded-lg hover:bg-rose-500/10 transition-colors"
              >
                <XCircle className="w-3.5 h-3.5" />
                <span>Cancel</span>
              </button>}
            </div>

            {/* Progress message */}
            <p className="text-xs text-[#A3A3A3] mb-2 break-words">
              {job.error_message || job.progress_message || "Working in background..."}
            </p>

            {/* Progress bar */}
            <div className="w-full bg-[#1A1A1A] h-2 rounded-full overflow-hidden border border-[#333333]">
              <div
                className="bg-white h-full rounded-full transition-all duration-300"
                style={{ width: `${running ? Math.max(5, percent) : percent}%` }}
              />
            </div>

            <div className="flex justify-between items-center text-[11px] text-[#A3A3A3] mt-1.5">
              <span>
                {job.job_type === "COURSE_IMPORT" ? "Steps" : "Items"}: {job.completed_items} / {job.total_items}
                {job.failed_items > 0 && <span className="text-rose-400 ml-1.5">({job.failed_items} failed)</span>}
              </span>
              <span className="font-mono text-white font-medium">{percent}%</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
