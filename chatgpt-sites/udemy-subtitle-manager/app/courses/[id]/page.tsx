"use client";

import React, { useState, useEffect, useCallback, useMemo, Suspense } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "../../lib/auth";
import { api } from "../../lib/api";
import { Course, Section, Lecture, Subtitle, ProcessingJob, LearningStatus, formatUdemyUrl } from "../../types";
import CourseTags from "../../components/CourseTags";
import NextLectureCard from "../../components/NextLectureCard";
import Navbar from "../../components/Navbar";
import ConnectionPanel from "../../components/ConnectionPanel";
import LectureEditModal from "../../components/LectureEditModal";
import ManualSubtitleModal from "../../components/ManualSubtitleModal";
import JobProgressBar from "../../components/JobProgressBar";
import {
  ArrowLeft,
  Search,
  RefreshCw,
  ExternalLink,
  HardDrive,
  MessageSquare,
  Edit,
  Trash2,
  Clock,
  BookOpen,
  CheckCircle2,
  AlertCircle,
  PlayCircle,
  FileText,
  ChevronDown,
  ChevronRight,
  CheckSquare,
  Square,
  Upload,
  Layers,
  Sparkles,
  Circle,
  Loader2,
} from "lucide-react";

function formatDuration(seconds: number): string {
  if (!seconds || seconds <= 0) return "--:--";
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  if (mins >= 60) {
    const hrs = Math.floor(mins / 60);
    const remMins = mins % 60;
    return `${hrs}h ${remMins.toString().padStart(2, "0")}m`;
  }
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

function CourseContentDetail() {
  const { user, loading: authLoading, refreshUser } = useAuth();
  const router = useRouter();
  const params = useParams();
  const searchParams = useSearchParams();

  const courseId = Number(params.id);

  const [course, setCourse] = useState<Course | null>(null);
  const [loading, setLoading] = useState(true);
  const [jobs, setJobs] = useState<ProcessingJob[]>([]);

  // Search & Filters
  const [searchTerm, setSearchTerm] = useState("");
  const [subtitleStatusFilter, setSubtitleStatusFilter] = useState("ALL");
  const [learningStatusFilter, setLearningStatusFilter] = useState("ALL");

  // Selection & collapse state
  const [selectedLectureIds, setSelectedLectureIds] = useState<number[]>([]);
  const [collapsedSections, setCollapsedSections] = useState<Record<number, boolean>>({});

  // Modals
  const [isConnectionsOpen, setIsConnectionsOpen] = useState(false);
  const [editingLecture, setEditingLecture] = useState<Lecture | null>(null);
  const [manualUploadLecture, setManualUploadLecture] = useState<Lecture | null>(null);

  // Notifications
  const [bannerMessage, setBannerMessage] = useState<string | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Next lecture / Continue learning calculation
  const nextLectureInfo = useMemo(() => {
    if (!course?.sections) return null;
    let inProgress: { lecture: Lecture; section: Section } | null = null;
    let firstNotStarted: { lecture: Lecture; section: Section } | null = null;

    for (const sec of course.sections) {
      for (const lec of sec.lectures) {
        if (lec.learning_status === "IN_PROGRESS" && !inProgress) {
          inProgress = { lecture: lec, section: sec };
        }
        if (lec.learning_status === "NOT_STARTED" && !firstNotStarted) {
          firstNotStarted = { lecture: lec, section: sec };
        }
      }
    }
    return inProgress || firstNotStarted || null;
  }, [course]);

  useEffect(() => {
    if (!authLoading && !user) {
      router.push("/login");
    }
  }, [user, authLoading, router]);

  // Handle Drive callback query params
  useEffect(() => {
    if (searchParams.get("drive_connected") === "true") {
      setBannerMessage("Google Drive account connected successfully! Subtitles will automatically upload to Drive.");
      refreshUser();
    } else if (searchParams.get("drive_error")) {
      setBannerMessage(`Drive Connection Error: ${searchParams.get("drive_error")}`);
    }
  }, [searchParams, refreshUser]);

  useEffect(() => {
    if (!bannerMessage) return;
    const t = setTimeout(() => setBannerMessage(null), 6000);
    return () => clearTimeout(t);
  }, [bannerMessage]);

  useEffect(() => {
    if (!toastMessage) return;
    const t = setTimeout(() => setToastMessage(null), 4000);
    return () => clearTimeout(t);
  }, [toastMessage]);

  const loadCourse = useCallback(async (silent = false) => {
    if (!courseId) return;
    if (!silent) setLoading(true);
    try {
      const data = await api.courses.get(courseId);
      setCourse(data);
    } catch (err) {
      console.error("Failed to load course details:", err);
      setToastMessage("Course details not found.");
    } finally {
      if (!silent) setLoading(false);
    }
  }, [courseId]);

  const loadJobs = useCallback(async () => {
    try {
      const activeJobs = await api.jobs.list(courseId);
      setJobs(activeJobs);
    } catch (err) {
      console.error("Failed to load jobs:", err);
    }
  }, [courseId]);

  useEffect(() => {
    if (user && courseId) {
      loadCourse();
      loadJobs();
    }
  }, [user, courseId, loadCourse, loadJobs]);

  // Polling while active jobs exist
  useEffect(() => {
    const hasActiveJob = jobs.some((j) => j.status === "PROCESSING" || j.status === "PENDING");
    if (!hasActiveJob) return;

    const interval = setInterval(() => {
      loadJobs();
      loadCourse(true);
    }, 2500);

    return () => clearInterval(interval);
  }, [jobs, loadJobs, loadCourse]);

  const handleSyncCourse = async () => {
    if (!course) return;
    try {
      const job = await api.courses.sync(course.id);
      setToastMessage(`Course sync started in background (Job #${job.id}).`);
      loadJobs();
    } catch (err: unknown) {
      setToastMessage(err instanceof Error ? err.message : "Sync failed.");
    }
  };

  const handleCancelJob = async (jobId: number) => {
    try {
      await api.jobs.cancel(jobId);
      setToastMessage("Job cancellation requested.");
      loadJobs();
    } catch (err: unknown) {
      setToastMessage(err instanceof Error ? err.message : "Failed to cancel job.");
    }
  };

  const toggleSectionCollapse = (sectionId: number) => {
    setCollapsedSections((prev) => ({
      ...prev,
      [sectionId]: !prev[sectionId],
    }));
  };

  const toggleLectureSelection = (lectureId: number) => {
    setSelectedLectureIds((prev) =>
      prev.includes(lectureId) ? prev.filter((id) => id !== lectureId) : [...prev, lectureId]
    );
  };

  const selectAllSectionLectures = (section: Section) => {
    const ids = section.lectures.map((l) => l.id);
    const allSelected = ids.every((id) => selectedLectureIds.includes(id));
    if (allSelected) {
      setSelectedLectureIds((prev) => prev.filter((id) => !ids.includes(id)));
    } else {
      setSelectedLectureIds((prev) => Array.from(new Set([...prev, ...ids])));
    }
  };

  const handleProcessSelected = async () => {
    if (selectedLectureIds.length === 0) return;
    try {
      const job = await api.subtitles.process({ lecture_ids: selectedLectureIds });
      setToastMessage(`Batch subtitle processing started for ${selectedLectureIds.length} lectures!`);
      setSelectedLectureIds([]);
      loadJobs();
    } catch (err: unknown) {
      setToastMessage(err instanceof Error ? err.message : "Batch processing failed.");
    }
  };

  const handleProcessAllCourse = async () => {
    if (!course) return;
    try {
      const job = await api.subtitles.process({ course_id: course.id });
      setToastMessage(`Started subtitle processing for course '${course.title}'!`);
      loadJobs();
    } catch (err: unknown) {
      setToastMessage(err instanceof Error ? err.message : "Process all failed.");
    }
  };

  const handleRetryFailed = async () => {
    if (!course?.sections) return;
    const failedIds: number[] = [];
    course.sections.forEach((sec) => {
      sec.lectures.forEach((lec) => {
        const sub =
          lec.subtitles.find((s) => s.language === "en" || s.language.startsWith("en")) ||
          lec.subtitles[0];
        if (sub && (sub.status === "FAILED" || sub.drive_status === "FAILED")) {
          failedIds.push(lec.id);
        }
      });
    });
    if (failedIds.length === 0) return;
    try {
      const job = await api.subtitles.process({ lecture_ids: failedIds });
      setToastMessage(`Retrying subtitle processing for ${failedIds.length} failed lectures...`);
      loadJobs();
    } catch (err: unknown) {
      setToastMessage(err instanceof Error ? err.message : "Retry failed.");
    }
  };

  const handleProcessSingle = async (lectureId: number) => {
    try {
      const job = await api.subtitles.processSingle(lectureId);
      setToastMessage(`Fetching subtitle for lecture...`);
      loadJobs();
    } catch (err: unknown) {
      setToastMessage(err instanceof Error ? err.message : "Processing failed.");
    }
  };

  const handleDeleteSubtitle = async (lectureId: number, subtitleId?: number) => {
    if (!confirm("Are you sure you want to delete this lecture's subtitle (including on Google Drive if synced)?")) {
      return;
    }
    try {
      if (subtitleId) {
        await api.subtitles.delete(subtitleId);
      } else {
        await api.subtitles.deleteForLecture(lectureId);
      }
      setToastMessage("Subtitle deletion queued. Cleanup will retry until all files are removed.");
      await loadJobs();
      await loadCourse(true);
    } catch (err: unknown) {
      setToastMessage(err instanceof Error ? err.message : "Failed to delete subtitle.");
    }
  };

  const handleDeleteSelectedSubtitles = async () => {
    if (selectedLectureIds.length === 0) return;
    if (
      !confirm(
        `Are you sure you want to delete subtitles for ${selectedLectureIds.length} selected lectures? This will also remove corresponding files from Google Drive.`
      )
    ) {
      return;
    }
    try {
      for (const id of selectedLectureIds) {
        await api.subtitles.deleteForLecture(id);
      }
      setToastMessage(`Subtitle deletion queued for ${selectedLectureIds.length} lectures.`);
      await loadJobs();
      setSelectedLectureIds([]);
      await loadCourse(true);
    } catch (err: unknown) {
      setToastMessage(err instanceof Error ? err.message : "Failed to delete subtitles.");
    }
  };

  const handleUpdateLearningStatusInline = async (lectureId: number, status: LearningStatus) => {
    try {
      await api.courses.updateLecture(lectureId, { learning_status: status });
      if (course?.sections) {
        let newCompletedCount = 0;
        const updatedSections = course.sections.map((sec) => ({
          ...sec,
          lectures: sec.lectures.map((lec) => {
            const updatedLec = lec.id === lectureId ? { ...lec, learning_status: status } : lec;
            if (updatedLec.learning_status === "COMPLETED") {
              newCompletedCount++;
            }
            return updatedLec;
          }),
        }));
        setCourse({
          ...course,
          completed_lectures: newCompletedCount,
          sections: updatedSections,
        });

        if (status === "COMPLETED") {
          setToastMessage("Lecture marked as Done ✓");
        } else if (status === "IN_PROGRESS") {
          setToastMessage("Lecture marked as Doing ●");
        } else {
          setToastMessage("Lecture set to To do ○");
        }
      }
    } catch (err) {
      console.error("Failed to update status:", err);
      setToastMessage("Failed to update lecture status.");
    }
  };

  const filterLecture = (lec: Lecture): boolean => {
    if (searchTerm.trim()) {
      const term = searchTerm.toLowerCase();
      if (!lec.title.toLowerCase().includes(term)) return false;
    }
    if (learningStatusFilter !== "ALL" && lec.learning_status !== learningStatusFilter) {
      return false;
    }
    if (subtitleStatusFilter !== "ALL") {
      const sub = lec.subtitles.find((s) => s.language === "en") || lec.subtitles[0];
      const subStatus = sub?.status || "PENDING";
      if (subStatus !== subtitleStatusFilter) return false;
    }
    return true;
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#212121] text-[#ECECEC] flex flex-col font-sans">
        <Navbar onOpenConnections={() => setIsConnectionsOpen(true)} />
        <div className="flex-1 flex items-center justify-center p-8">
          <div className="text-center space-y-3">
            <RefreshCw className="w-8 h-8 animate-spin text-[#A3A3A3] mx-auto" />
            <p className="text-sm text-[#A3A3A3]">Loading course curriculum...</p>
          </div>
        </div>
      </div>
    );
  }

  if (!course) {
    return (
      <div className="min-h-screen bg-[#212121] text-[#ECECEC] flex flex-col font-sans">
        <Navbar onOpenConnections={() => setIsConnectionsOpen(true)} />
        <div className="flex-1 flex items-center justify-center p-8">
          <div className="text-center space-y-4 max-w-md bg-[#262626] border border-[#333333] p-8 rounded-3xl">
            <BookOpen className="w-12 h-12 text-[#A3A3A3] mx-auto" />
            <h2 className="text-lg font-bold text-[#ECECEC]">Course Not Found</h2>
            <p className="text-xs text-[#A3A3A3]">
              This course could not be found or may have been deleted.
            </p>
            <a
              href="/dashboard"
              className="inline-flex items-center space-x-2 px-4 py-2 bg-white text-black font-semibold text-xs rounded-xl hover:bg-neutral-200 transition-colors"
            >
              <ArrowLeft className="w-4 h-4" />
              <span>Back to Courses</span>
            </a>
          </div>
        </div>
      </div>
    );
  }

  const completedPercent =
    course.total_lectures > 0
      ? Math.round((course.completed_lectures / course.total_lectures) * 100)
      : 0;

  return (
    <div className="min-h-screen bg-[#212121] text-[#ECECEC] flex flex-col font-sans">
      <Navbar onOpenConnections={() => setIsConnectionsOpen(true)} />

      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
        {/* Banner notification */}
        {bannerMessage && (
          <div className="p-4 bg-[#262626] border border-amber-500/30 rounded-2xl text-amber-300 text-sm flex items-center justify-between shadow-lg">
            <span>{bannerMessage}</span>
            <button
              onClick={() => setBannerMessage(null)}
              className="text-xs text-amber-400 hover:text-amber-200 underline"
            >
              Dismiss
            </button>
          </div>
        )}

        {/* Toast notification */}
        {toastMessage && (
          <div className="fixed bottom-6 right-6 z-50 p-4 bg-[#262626] border border-[#333333] rounded-2xl text-[#ECECEC] text-sm shadow-2xl flex items-center space-x-2 animate-in slide-in-from-bottom duration-200">
            <CheckCircle2 className="w-4 h-4 text-white flex-shrink-0" />
            <span>{toastMessage}</span>
          </div>
        )}

        {/* Breadcrumb Navigation */}
        <div className="flex items-center space-x-3 text-xs text-[#A3A3A3]">
          <a
            href="/dashboard"
            className="inline-flex items-center space-x-1.5 text-[#A3A3A3] hover:text-white transition-colors py-1.5 px-3 rounded-lg bg-[#262626] border border-[#333333] hover:border-[#4f4f4f]"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>Courses</span>
          </a>
          <span>/</span>
          <span className="text-[#ECECEC] truncate max-w-md font-medium">{course.title}</span>
        </div>

        {/* Active background jobs bar */}
        <JobProgressBar jobs={jobs} onCancelJob={handleCancelJob} onReconnect={() => setIsConnectionsOpen(true)} />

        {/* Course Hero & Controls */}
        <div className="p-6 bg-[#262626] border border-[#333333] rounded-2xl shadow-sm space-y-6">
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6">
            <div className="space-y-2 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[11px] font-mono px-2.5 py-0.5 rounded-full bg-[#1A1A1A] text-[#A3A3A3] border border-[#333333]">
                  Course #{course.id}
                </span>
                <span className="text-[11px] font-mono px-2.5 py-0.5 rounded-full bg-[#1A1A1A] text-[#A3A3A3] border border-[#333333]">
                  Udemy ID: {course.course_id}
                </span>
                {course.instructor && (
                  <span className="text-xs text-[#A3A3A3]">Instructor: <a href={`/api/courses/${course.id}/instructor`} target="_blank" rel="noopener noreferrer" className="hover:text-white hover:underline">{course.instructor}</a></span>
                )}
              </div>

              <h1 className="text-2xl font-bold tracking-tight text-[#ECECEC] leading-snug">
                <a href={formatUdemyUrl(course.url, user?.udemy_business_domain)} target="_blank" rel="noopener noreferrer" className="hover:underline">{course.title}</a>
              </h1>

              <CourseTags tags={course.tags} />

              <div className="flex flex-wrap items-center gap-4 text-xs text-[#A3A3A3] pt-1">
                <a
                  href={formatUdemyUrl(course.url, user?.udemy_business_domain)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center space-x-1 text-white hover:underline"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  <span>Open Course on Udemy</span>
                </a>
                <span>•</span>
                <span>Last synced: {new Date(course.last_synced_at).toLocaleDateString()}</span>
              </div>
            </div>

            {/* Quick Actions */}
            <div className="flex flex-wrap items-center gap-3">
              {(course.failed_subtitles + (course.drive_sync_failed || 0)) > 0 && (
                <button
                  onClick={handleRetryFailed}
                  className="px-3.5 py-2.5 bg-rose-500/10 hover:bg-rose-500/20 text-rose-300 text-xs font-semibold rounded-xl border border-rose-500/30 transition-colors flex items-center space-x-1.5 cursor-pointer shadow-sm"
                >
                  <AlertCircle className="w-3.5 h-3.5 text-rose-400" />
                  <span>Retry {course.failed_subtitles + (course.drive_sync_failed || 0)} Failed Stages</span>
                </button>
              )}

              <button
                onClick={handleSyncCourse}
                title="Re-sync curriculum from Udemy"
                className="px-3.5 py-2.5 bg-[#2E2E2E] hover:bg-[#383838] text-[#ECECEC] text-xs font-semibold rounded-xl border border-[#383838] transition-colors flex items-center space-x-1.5"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>Re-sync Curriculum</span>
              </button>

              <button
                onClick={handleProcessAllCourse}
                className="px-4 py-2.5 bg-white hover:bg-neutral-200 text-black text-xs font-semibold rounded-xl transition-colors shadow-md flex items-center space-x-1.5"
              >
                <CheckCircle2 className="w-4 h-4 text-black" />
                <span>Process All Subtitles</span>
              </button>
            </div>
          </div>

          {/* Stats & Progress Overview */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-4 border-t border-[#333333]">
            <div className="p-3 bg-[#1A1A1A] border border-[#333333] rounded-xl">
              <span className="text-[11px] text-[#A3A3A3] block">Total Sections</span>
              <span className="text-lg font-bold text-[#ECECEC]">{course.total_sections}</span>
            </div>
            <div className="p-3 bg-[#1A1A1A] border border-[#333333] rounded-xl">
              <span className="text-[11px] text-[#A3A3A3] block">Total Lectures</span>
              <span className="text-lg font-bold text-[#ECECEC]">{course.total_lectures}</span>
            </div>
            <div className="p-3 bg-[#1A1A1A] border border-[#333333] rounded-xl">
              <span className="text-[11px] text-[#A3A3A3] block">Processed Subtitles</span>
              <span className="text-lg font-bold text-white">
                {course.processed_subtitles} / {course.subtitle_eligible_lectures}
              </span>
            </div>
            <div className="p-3 bg-[#1A1A1A] border border-[#333333] rounded-xl">
              <span className="text-[11px] text-[#A3A3A3] block">Learning Progress</span>
              <span className="text-lg font-bold text-[#ECECEC]">
                {completedPercent}% ({course.completed_lectures} Done)
              </span>
            </div>
          </div>
        </div>

        {/* Next Lecture / Continue Learning Card */}
        {nextLectureInfo ? (
          <NextLectureCard key={nextLectureInfo.lecture.id} lecture={nextLectureInfo.lecture} section={nextLectureInfo.section} businessDomain={user?.udemy_business_domain} onRefresh={() => loadCourse(true)} />
        ) : (
          course.total_lectures > 0 &&
          course.completed_lectures === course.total_lectures && (
            <div className="p-5 bg-gradient-to-r from-emerald-950/25 to-[#262626] border border-emerald-500/40 rounded-2xl shadow-xl flex items-center justify-between">
              <div className="flex items-center space-x-3.5">
                <div className="w-10 h-10 rounded-xl bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center text-emerald-400">
                  <CheckCircle2 className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-white">Course Completed! 🎉</h3>
                  <p className="text-xs text-[#A3A3A3]">
                    You have finished all {course.total_lectures} lectures in this course. Excellent work!
                  </p>
                </div>
              </div>
              <a
                href={formatUdemyUrl(course.url, user?.udemy_business_domain)}
                target="_blank"
                rel="noopener noreferrer"
                className="px-3.5 py-2 bg-[#2E2E2E] hover:bg-[#383838] text-white text-xs font-semibold rounded-xl border border-[#383838] transition-colors flex items-center space-x-1.5"
              >
                <span>Review on Udemy</span>
                <ExternalLink className="w-3.5 h-3.5" />
              </a>
            </div>
          )
        )}

        {/* Bulk Actions Bar if items selected */}
        {selectedLectureIds.length > 0 && (
          <div className="p-4 bg-[#262626] border border-white/20 rounded-2xl flex items-center justify-between shadow-lg animate-in fade-in duration-150">
            <span className="text-xs text-[#ECECEC] font-medium">
              Selected <strong className="text-white">{selectedLectureIds.length}</strong> lectures:
            </span>
            <div className="flex items-center space-x-2">
              <button
                onClick={handleProcessSelected}
                className="px-3.5 py-1.5 bg-white hover:bg-neutral-200 text-black text-xs font-semibold rounded-xl transition-colors flex items-center space-x-1.5 shadow-sm"
              >
                <CheckCircle2 className="w-3.5 h-3.5" />
                <span>Process Subtitles ({selectedLectureIds.length})</span>
              </button>
              <button
                onClick={handleDeleteSelectedSubtitles}
                className="px-3.5 py-1.5 bg-[#2E2E2E] hover:bg-rose-600/20 text-rose-300 border border-[#383838] hover:border-rose-500/30 text-xs font-semibold rounded-xl transition-colors flex items-center space-x-1.5"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Delete Selected Subtitles</span>
              </button>
            </div>
          </div>
        )}

        {/* Filter and Search Toolbar */}
        <div className="flex flex-col sm:flex-row items-center gap-3">
          <div className="relative flex-1 w-full">
            <Search className="w-4 h-4 text-[#A3A3A3] absolute left-3.5 top-3" />
            <input
              type="text"
              placeholder="Search lectures or sections..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-2.5 bg-[#1A1A1A] border border-[#333333] rounded-xl text-xs text-[#ECECEC] placeholder-[#737373] focus:outline-none focus:border-white transition-colors"
            />
          </div>

          {/* Filter Subtitle Status */}
          <select
            value={subtitleStatusFilter}
            onChange={(e) => setSubtitleStatusFilter(e.target.value)}
            className="w-full sm:w-auto px-3.5 py-2.5 bg-[#1A1A1A] border border-[#333333] rounded-xl text-xs text-[#ECECEC] focus:outline-none focus:border-white transition-colors"
          >
            <option value="ALL">All Subtitles</option>
            <option value="COMPLETED">Completed</option>
            <option value="PROCESSING">Processing</option>
            <option value="NO_SUBTITLES">No Subtitles</option>
            <option value="FAILED">Failed</option>
          </select>

          {/* Filter Learning Status */}
          <select
            value={learningStatusFilter}
            onChange={(e) => setLearningStatusFilter(e.target.value)}
            className="w-full sm:w-auto px-3.5 py-2.5 bg-[#1A1A1A] border border-[#333333] rounded-xl text-xs text-[#ECECEC] focus:outline-none focus:border-white transition-colors"
          >
            <option value="ALL">All Learning Statuses</option>
            <option value="NOT_STARTED">To do</option>
            <option value="IN_PROGRESS">Doing</option>
            <option value="COMPLETED">Done</option>
          </select>
        </div>

        {/* Curriculum Sections Accordions */}
        <div className="space-y-4">
          {course.sections?.map((section) => {
            const isCollapsed = collapsedSections[section.id];
            const matchingLectures = section.lectures.filter(filterLecture);
            if (
              matchingLectures.length === 0 &&
              (searchTerm || subtitleStatusFilter !== "ALL" || learningStatusFilter !== "ALL")
            ) {
              return null;
            }

            const allSectionSelected =
              section.lectures.length > 0 &&
              section.lectures.every((l) => selectedLectureIds.includes(l.id));

            return (
              <div
                key={section.id}
                className="bg-[#262626] border border-[#333333] rounded-2xl overflow-hidden shadow-lg shadow-black/20"
              >
                {/* Section Header */}
                <div
                  onClick={() => toggleSectionCollapse(section.id)}
                  className="px-5 py-3.5 bg-[#262626] border-b border-[#333333] flex items-center justify-between cursor-pointer hover:bg-[#2E2E2E]/60 transition-colors"
                >
                  <div className="flex items-center space-x-3">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        selectAllSectionLectures(section);
                      }}
                      className="text-[#A3A3A3] hover:text-white p-0.5"
                      title="Select all in section"
                    >
                      {allSectionSelected ? (
                        <CheckSquare className="w-4 h-4 text-white" />
                      ) : (
                        <Square className="w-4 h-4" />
                      )}
                    </button>
                    {isCollapsed ? (
                      <ChevronRight className="w-4 h-4 text-[#A3A3A3]" />
                    ) : (
                      <ChevronDown className="w-4 h-4 text-[#A3A3A3]" />
                    )}
                    <span className="font-semibold text-sm text-[#ECECEC]">
                      Section {section.position}: {section.title}
                    </span>
                    <span className="text-[11px] text-[#A3A3A3] font-mono bg-[#1A1A1A] border border-[#333333] px-2 py-0.5 rounded-full">
                      {section.lectures.length} {section.lectures.length === 1 ? "lecture" : "lectures"}
                    </span>
                  </div>

                  <div className="text-xs text-[#A3A3A3] font-mono">
                    {section.lectures.filter((l) => l.learning_status === "COMPLETED").length} / {section.lectures.length} Done
                  </div>
                </div>

                {/* Lecture Rows Table */}
                {!isCollapsed && (
                  <div className="divide-y divide-[#333333]/50 overflow-x-auto">
                    <table className="w-full text-left text-xs border-collapse">
                      <thead>
                        <tr className="bg-[#1A1A1A] text-[11px] text-[#A3A3A3] uppercase tracking-wider font-semibold border-b border-[#333333]">
                          <th className="py-2.5 px-4 w-10"></th>
                          <th className="py-2.5 px-4">Lecture</th>
                          <th className="py-2.5 px-4 w-24">Duration</th>
                          <th className="py-2.5 px-4 w-32">Subtitle</th>
                          <th className="py-2.5 px-4 w-32">Drive Link</th>
                          <th className="py-2.5 px-4 w-32">ChatGPT</th>
                          <th className="py-2.5 px-4 w-32">Status</th>
                          <th className="py-2.5 px-4 w-32 text-right">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#333333]/40">
                        {matchingLectures.map((lecture) => {
                          const isChecked = selectedLectureIds.includes(lecture.id);
                          const sub =
                            lecture.subtitles.find((s) => s.language === "en" || s.language.startsWith("en")) ||
                            lecture.subtitles[0];

                          const isCompleted = lecture.learning_status === "COMPLETED";
                          const isInProgress = lecture.learning_status === "IN_PROGRESS";
                          const isNextLecture = nextLectureInfo?.lecture.id === lecture.id;

                          return (
                            <tr
                              key={lecture.id}
                              className={`transition-all duration-150 group border-b border-[#333333]/40 ${
                                isInProgress
                                  ? "bg-amber-500/[0.08] hover:bg-amber-500/[0.14] border-l-4 border-l-amber-400 shadow-sm"
                                  : isCompleted
                                  ? "bg-emerald-500/[0.03] hover:bg-emerald-500/[0.08] border-l-4 border-l-emerald-500/50"
                                  : isNextLecture
                                  ? "bg-white/[0.02] hover:bg-[#2E2E2E]/60 border-l-4 border-l-white/40"
                                  : "hover:bg-[#2E2E2E]/50 border-l-4 border-l-transparent"
                              }`}
                            >
                              {/* Select Checkbox */}
                              <td className="py-3 px-4">
                                <input
                                  type="checkbox"
                                  checked={isChecked}
                                  onChange={() => toggleLectureSelection(lecture.id)}
                                  className="rounded bg-[#1A1A1A] border-[#333333] text-white focus:ring-0 cursor-pointer"
                                />
                              </td>

                              {/* Title & Udemy URL */}
                              <td className="py-3 px-4">
                                <div className="flex items-center space-x-2.5">
                                  {isCompleted ? (
                                    <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0" />
                                  ) : isInProgress ? (
                                    <PlayCircle className="w-4 h-4 text-amber-400 animate-pulse flex-shrink-0" />
                                  ) : lecture.lecture_type === "video" ? (
                                    <PlayCircle className="w-4 h-4 text-[#737373] group-hover:text-white flex-shrink-0 transition-colors" />
                                  ) : (
                                    <FileText className="w-4 h-4 text-[#737373] group-hover:text-white flex-shrink-0 transition-colors" />
                                  )}

                                  <span
                                    className={`transition-colors ${
                                      isInProgress
                                        ? "font-bold text-white text-[13px]"
                                        : isCompleted
                                        ? "font-medium text-[#ECECEC]/90"
                                        : "font-normal text-[#A3A3A3] group-hover:text-[#ECECEC]"
                                    }`}
                                  >
                                    {lecture.position}. {lecture.title}
                                  </span>

                                  {/* High visibility badges */}
                                  {isInProgress && (
                                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-400 text-black font-extrabold uppercase tracking-wider animate-pulse flex-shrink-0 shadow-sm shadow-amber-400/20">
                                      Doing
                                    </span>
                                  )}
                                  {isCompleted && (
                                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 font-medium flex-shrink-0">
                                      Done
                                    </span>
                                  )}
                                  {isNextLecture && !isInProgress && !isCompleted && (
                                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#333333] text-[#ECECEC] border border-[#444444] font-medium flex-shrink-0">
                                      Next Up
                                    </span>
                                  )}

                                  <a
                                    href={formatUdemyUrl(lecture.url, user?.udemy_business_domain)}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-[#A3A3A3] hover:text-white opacity-0 group-hover:opacity-100 transition-opacity p-0.5"
                                    title="Open lecture on Udemy"
                                  >
                                    <ExternalLink className="w-3.5 h-3.5" />
                                  </a>
                                </div>
                              </td>

                              {/* Duration */}
                              <td className="py-3 px-4 font-mono text-[#A3A3A3]">
                                {formatDuration(lecture.duration)}
                              </td>

                              {/* Subtitle status badge */}
                              <td className="py-3 px-4">
                                {sub ? (
                                  <div className="space-y-0.5">
                                    <span
                                      className={`inline-block px-2 py-0.5 rounded text-[10px] font-medium border ${
                                        sub.status === "COMPLETED"
                                          ? "bg-[#262626] text-[#ECECEC] border-[#383838]"
                                          : sub.status === "PROCESSING"
                                          ? "bg-sky-500/10 text-sky-400 border-sky-500/20"
                                          : sub.status === "NO_SUBTITLES"
                                          ? "bg-[#1A1A1A] text-[#A3A3A3] border border-[#333333]"
                                          : "bg-rose-500/10 text-rose-400 border-rose-500/20"
                                      }`}
                                    >
                                      {sub.status}
                                    </span>
                                    {sub.error_message && (
                                      <div className="max-w-[220px] text-[10px] text-[#A3A3A3] leading-snug" title={sub.error_message}>
                                        {sub.error_message}
                                      </div>
                                    )}
                                    {sub.subtitle_type !== "NONE" && (
                                      <div className="text-[10px] text-[#A3A3A3]">
                                        {sub.language.toUpperCase()} ({sub.subtitle_type})
                                      </div>
                                    )}
                                  </div>
                                ) : (
                                  <span className="text-[10px] text-[#A3A3A3]">None</span>
                                )}
                              </td>

                              {/* Google Drive Link */}
                              <td className="py-3 px-4">
                                {sub?.drive_status === "FAILED" ? (<button title={sub.drive_error || "Drive sync failed"} onClick={() => handleProcessSingle(lecture.id)} className="text-rose-400 text-[11px]">Retry Drive sync</button>) : sub?.drive_file_url ? (
                                  <a
                                    href={sub.drive_file_url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="inline-flex items-center space-x-1 text-[#ECECEC] hover:text-white hover:underline text-[11px]"
                                  >
                                    <HardDrive className="w-3.5 h-3.5 text-[#A3A3A3]" />
                                    <span>View in Drive</span>
                                  </a>
                                ) : (
                                  <span className="text-[#666666] text-[11px]">--</span>
                                )}
                              </td>

                              {/* ChatGPT Link */}
                              <td className="py-3 px-4">
                                {lecture.chatgpt_url ? (
                                  <a
                                    href={lecture.chatgpt_url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="inline-flex items-center space-x-1 text-sky-400 hover:underline text-[11px]"
                                  >
                                    <MessageSquare className="w-3.5 h-3.5" />
                                    <span>Open Summary</span>
                                  </a>
                                ) : (
                                  <button
                                    onClick={() => setEditingLecture(lecture)}
                                    className="text-[#A3A3A3] hover:text-[#ECECEC] text-[11px]"
                                  >
                                    + Add Link
                                  </button>
                                )}
                              </td>

                              {/* Learning Status Selector */}
                              <td className="py-3 px-4">
                                <select
                                  value={lecture.learning_status}
                                  onChange={(e) =>
                                    handleUpdateLearningStatusInline(lecture.id, e.target.value as LearningStatus)
                                  }
                                  className={`px-3 py-1.5 rounded-xl text-xs font-semibold border cursor-pointer transition-all shadow-sm focus:outline-none ${
                                    isCompleted
                                      ? "bg-emerald-500/15 text-emerald-300 border-emerald-500/40 hover:bg-emerald-500/25 font-bold"
                                      : isInProgress
                                      ? "bg-amber-500/25 text-amber-300 border-amber-400 hover:bg-amber-500/35 ring-1 ring-amber-400/50 font-extrabold shadow-sm shadow-amber-500/20"
                                      : "bg-[#1A1A1A] text-[#A3A3A3] border-[#383838] hover:text-[#ECECEC] hover:border-[#4f4f4f]"
                                  }`}
                                >
                                  <option value="NOT_STARTED" className="bg-[#262626] text-[#A3A3A3]">○ To do</option>
                                  <option value="IN_PROGRESS" className="bg-[#262626] text-amber-400 font-bold">● Doing</option>
                                  <option value="COMPLETED" className="bg-[#262626] text-emerald-400 font-bold">✓ Done</option>
                                </select>
                              </td>

                              {/* Actions */}
                              <td className="py-3 px-4 text-right">
                                <div className="flex items-center justify-end space-x-1">
                                  <button
                                    onClick={() => handleProcessSingle(lecture.id)}
                                    title="Download & Sync Subtitle"
                                    className="p-1.5 text-[#A3A3A3] hover:text-white hover:bg-[#1A1A1A] rounded-lg transition-colors"
                                  >
                                    <RefreshCw className="w-3.5 h-3.5" />
                                  </button>
                                  <button
                                    onClick={() => setManualUploadLecture(lecture)}
                                    title="Upload Subtitle Manually (.vtt/.srt)"
                                    className="p-1.5 text-[#A3A3A3] hover:text-white hover:bg-[#1A1A1A] rounded-lg transition-colors"
                                  >
                                    <Upload className="w-3.5 h-3.5" />
                                  </button>
                                  <button
                                    onClick={() => setEditingLecture(lecture)}
                                    title="Edit Status & ChatGPT Link"
                                    className="p-1.5 text-[#A3A3A3] hover:text-white hover:bg-[#1A1A1A] rounded-lg transition-colors"
                                  >
                                    <Edit className="w-3.5 h-3.5" />
                                  </button>
                                  {sub && (
                                    <button
                                      onClick={() => handleDeleteSubtitle(lecture.id, sub.id)}
                                      title="Delete lecture subtitle (Google Drive & Database)"
                                      className="p-1.5 text-[#A3A3A3] hover:text-rose-400 hover:bg-rose-500/10 rounded-lg transition-colors"
                                    >
                                      <Trash2 className="w-3.5 h-3.5" />
                                    </button>
                                  )}
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </main>

      {/* Modals */}
      <ConnectionPanel
        isOpen={isConnectionsOpen}
        onClose={() => setIsConnectionsOpen(false)}
        onStatusChange={() => { void refreshUser(); void loadJobs(); }}
      />

      <LectureEditModal
        lecture={editingLecture}
        isOpen={!!editingLecture}
        onClose={() => setEditingLecture(null)}
        onSaved={(updated) => {
          setToastMessage("Lecture updated successfully!");
          if (course?.sections) {
            let newCompletedCount = 0;
            const updatedSections = course.sections.map((sec) => ({
              ...sec,
              lectures: sec.lectures.map((l) => {
                const updatedLec = l.id === updated.id ? updated : l;
                if (updatedLec.learning_status === "COMPLETED") newCompletedCount++;
                return updatedLec;
              }),
            }));
            setCourse({
              ...course,
              completed_lectures: newCompletedCount,
              sections: updatedSections,
            });
          }
        }}
      />

      <ManualSubtitleModal
        lecture={manualUploadLecture}
        isOpen={!!manualUploadLecture}
        onClose={() => setManualUploadLecture(null)}
        onSuccess={(msg) => {
          setToastMessage(msg);
          loadCourse(true);
        }}
      />
    </div>
  );
}

export default function CourseContentPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-[#212121] flex items-center justify-center text-[#A3A3A3]">
          Loading Course Content...
        </div>
      }
    >
      <CourseContentDetail />
    </Suspense>
  );
}
