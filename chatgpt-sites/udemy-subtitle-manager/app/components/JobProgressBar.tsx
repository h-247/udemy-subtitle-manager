"use client";

import React from "react";
import { api } from "../lib/api";
import { DispatcherHealth, ProcessingJob } from "../types";
import { Loader2, XCircle, CheckCircle2, AlertCircle } from "lucide-react";

interface JobProgressBarProps {
  jobs: ProcessingJob[];
  onCancelJob: (jobId: number) => void;
  onReconnect: () => void;
  onWake: () => void;
  dispatcher?: DispatcherHealth | null;
  runtimeStatus?: string;
  queueHealth?: { oldest_queued_at: string | null; oldest_queued_age_seconds: number; runnable_jobs: number; overdue_runnable_jobs: number; stalled_jobs: number };
}

export default function JobProgressBar({ jobs, onCancelJob, onReconnect, onWake, dispatcher, runtimeStatus, queueHealth }: JobProgressBarProps) {
  const activeJobs = jobs.filter((j) => j.status === "PROCESSING" || j.status === "PENDING" || j.status === "FAILED" || j.status === "WAITING_SESSION");
  const runtimeDegraded = runtimeStatus === "degraded";
  const dispatcherFailed = dispatcher?.status === "FAILED";
  const queuedWorkStalled = (queueHealth?.overdue_runnable_jobs ?? queueHealth?.stalled_jobs ?? 0) > 0;
  if (activeJobs.length === 0 && !runtimeDegraded) return null;

  return (
    <div className="space-y-3 mb-6">
      {runtimeDegraded && <div role="alert" className="p-4 bg-rose-500/10 border border-rose-500/30 rounded-2xl flex flex-wrap items-center justify-between gap-3">
        <div><p className="text-sm font-semibold text-rose-200">{dispatcherFailed ? "Last background dispatcher run failed" : queuedWorkStalled ? "Runnable background jobs are overdue" : "Background dispatcher heartbeat is missing or stale"}</p>
          <p className="text-xs text-rose-200/80">{dispatcher?.error || (queuedWorkStalled ? `${queueHealth?.overdue_runnable_jobs ?? queueHealth?.stalled_jobs ?? 0} runnable job(s) have had no progress for at least 15 minutes. Saved checkpoints are retained.` : dispatcher?.stale_reason || "The hosted dispatcher is unhealthy. Run the manual dispatcher workflow to resume queued work. Saved checkpoints are retained." )}</p>
        </div>
        {(queueHealth?.runnable_jobs ?? 0) > 0 && <button onClick={onWake} className="text-sm text-sky-200 underline">Resume this account's jobs now</button>}
      </div>}
      {activeJobs.map((job) => {
        const hasKnownTotal = job.total_items > 0;
        const percent = hasKnownTotal ? Math.round((job.completed_items / job.total_items) * 100) : 0;
        const waitingForSession = job.status === "WAITING_SESSION";
        const stalled = Boolean(job.stalled);

        return (
          <div
            key={job.id}
            className="p-4 bg-[#262626] border border-[#333333] rounded-2xl shadow-xl shadow-black/30"
          >
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center space-x-2.5">
                {["FAILED","WAITING_SESSION"].includes(job.status) || stalled ? <AlertCircle className="w-4 h-4 text-rose-400" /> : <Loader2 className="w-4 h-4 text-sky-400 animate-spin" />}
                <span className="text-sm font-semibold text-[#ECECEC]">
                {waitingForSession ? "Udemy session expired" : stalled ? "Background job stalled" : job.job_type === "CLEANUP" ? "Deleting files" : job.job_type === "COURSE_IMPORT" ? "Importing Course Curriculum" : "Processing Subtitles"}
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

            {waitingForSession && <div className="mb-2 flex flex-wrap items-center gap-3 text-sm"><span className="text-amber-200">Progress is saved. Reconnect your Udemy session to continue from this lecture.</span><button onClick={onReconnect} className="text-sky-300 underline">Reconnect Udemy</button></div>}
            {stalled && <div className="mb-2 flex flex-wrap items-center gap-3 text-sm"><span className="text-rose-300">No progress has been recorded for at least 15 minutes. Your saved progress is safe.</span><button onClick={onWake} className="text-sky-300 underline">Resume this account's jobs now</button></div>}
            {/* Progress message */}
            <p className="text-xs text-[#A3A3A3] mb-2 truncate">
              {job.progress_message || "Queued for background processing."}
            </p>

            {job.error_message && <p role="alert" className="text-xs text-rose-300 mb-2">{job.error_message}</p>}
            {job.retry_at && job.status === "PENDING" && job.retry_at * 1000 > Date.now() && <p className="text-xs text-amber-300 mb-2">Retry {job.attempts}{job.job_type === "CLEANUP" ? "" : "/8"} is waiting until {new Date(job.retry_at * 1000).toLocaleTimeString()}. Saved progress will resume automatically.</p>}
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
