"use client";

import React from "react";
import { api } from "../lib/api";
import { ProcessingJob } from "../types";
import { Loader2, XCircle, CheckCircle2, AlertCircle } from "lucide-react";

interface JobProgressBarProps {
  jobs: ProcessingJob[];
  onCancelJob: (jobId: number) => void;
  onReconnect: () => void;
}

export default function JobProgressBar({ jobs, onCancelJob, onReconnect }: JobProgressBarProps) {
  const activeJobs = jobs.filter((j) => j.status === "PROCESSING" || j.status === "PENDING" || j.status === "FAILED" || j.status === "WAITING_SESSION");
  if (activeJobs.length === 0) return null;

  return (
    <div className="space-y-3 mb-6">
      {activeJobs.map((job) => {
        const hasKnownTotal = job.total_items > 0;
        const percent = hasKnownTotal ? Math.round((job.completed_items / job.total_items) * 100) : 0;

        return (
          <div
            key={job.id}
            className="p-4 bg-[#262626] border border-[#333333] rounded-2xl shadow-xl shadow-black/30"
          >
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center space-x-2.5">
                {["FAILED","WAITING_SESSION"].includes(job.status) ? <AlertCircle className="w-4 h-4 text-rose-400" /> : <Loader2 className="w-4 h-4 text-sky-400 animate-spin" />}
                <span className="text-sm font-semibold text-[#ECECEC]">
                  {job.status === "WAITING_SESSION" ? "Reconnect Udemy" : job.job_type === "CLEANUP" ? "Deleting files" : job.job_type === "COURSE_IMPORT" ? "Importing Course Curriculum" : "Processing Subtitles"}
                </span>
                <span className="text-xs text-[#A3A3A3] font-mono bg-[#1A1A1A] px-2 py-0.5 rounded-full border border-[#333333]">
                  Job #{job.id}
                </span>
              </div>
              {job.job_type !== "CLEANUP" && <button
                onClick={async () => { if (job.status === "FAILED") { await api.jobs.retry(job.id); window.location.reload(); } else onCancelJob(job.id); }}
                className="text-xs font-medium text-[#A3A3A3] hover:text-rose-400 flex items-center space-x-1 px-2.5 py-1 rounded-lg hover:bg-rose-500/10 transition-colors"
              >
                <XCircle className="w-3.5 h-3.5" />
                <span>{job.status === "FAILED" ? "Retry job" : "Cancel"}</span>
              </button>}
            </div>

            {job.status === "WAITING_SESSION" && <button onClick={onReconnect} className="text-sm text-sky-300 underline">Reconnect Udemy</button>}
            {/* Progress message */}
            <p className="text-xs text-[#A3A3A3] mb-2 truncate">
              {job.progress_message || "Queued for background processing."}
            </p>

            {job.error_message && <p role="alert" className="text-xs text-rose-300 mb-2">{job.error_message}</p>}
            {job.retry_at && job.status === "PENDING" && <p className="text-xs text-amber-300 mb-2">Retry {job.attempts}{job.job_type === "CLEANUP" ? "" : "/8"} scheduled for {new Date(job.retry_at * 1000).toLocaleTimeString()}.</p>}
            {/* Progress bar */}
            <div className="w-full bg-[#1A1A1A] h-2 rounded-full overflow-hidden border border-[#333333]">
              <div
                className={`bg-white h-full rounded-full transition-all duration-300 ${!hasKnownTotal ? "animate-pulse" : ""}`}
                style={{ width: hasKnownTotal ? `${percent}%` : "38%" }}
              />
            </div>

            <div className="flex justify-between items-center text-[11px] text-[#A3A3A3] mt-1.5">
              <span>
                {hasKnownTotal ? `Items: ${job.completed_items} / ${job.total_items}` : `Lectures imported so far: ${job.completed_items}`}
                {job.failed_items > 0 && <span className="text-rose-400 ml-1.5">({job.failed_items} failed)</span>}
              </span>
              {hasKnownTotal && <span className="font-mono text-white font-medium">{percent}%</span>}
            </div>
          </div>
        );
      })}
    </div>
  );
}
