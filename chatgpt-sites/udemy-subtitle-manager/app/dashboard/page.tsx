"use client";

import React, { useState, useEffect, useCallback, useRef, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { useAuth } from "../lib/auth";
import { api } from "../lib/api";
import { Course, ProcessingJob, formatUdemyUrl } from "../types";
import CourseTags from "../components/CourseTags";
import NextLectureCard from "../components/NextLectureCard";
import Navbar from "../components/Navbar";
import ConnectionPanel from "../components/ConnectionPanel";
import CourseImportModal from "../components/CourseImportModal";
import DeleteCourseModal from "../components/DeleteCourseModal";
import JobProgressBar from "../components/JobProgressBar";
import {
  Search,
  Plus,
  RefreshCw,
  ExternalLink,
  Trash2,
  BookOpen,
  CheckCircle2,
  ArrowRight,
  Sparkles,
  PlayCircle,
} from "lucide-react";

function CoursesListContent() {
  const { user, loading: authLoading, refreshUser } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const searchString = searchParams.toString();
  const driveConnected = searchParams.get("drive_connected");
  const driveError = searchParams.get("drive_error");

  // Courses state
  const [courses, setCourses] = useState<Course[]>([]);
  const courseRequestInFlight = useRef(false);
  const [coursesError, setCoursesError] = useState<string | null>(null);
  const [coursesLoading, setCoursesLoading] = useState(true);
  const [tagFilter, setTagFilter] = useState("all");
  const [courseSearch, setCourseSearch] = useState("");

  // Active Jobs state
  const [jobs, setJobs] = useState<ProcessingJob[]>([]);

  // Modals
  const [isConnectionsOpen, setIsConnectionsOpen] = useState(false);
  const [isImportOpen, setIsImportOpen] = useState(false);
  const [deletingCourse, setDeletingCourse] = useState<Course | null>(null);

  // Notification Banner & Toast
  const [bannerMessage, setBannerMessage] = useState<string | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!authLoading && !user) {
      router.push("/login");
    }
  }, [user, authLoading, router]);

  // Handle Google Drive OAuth redirect params
  useEffect(() => {
    if (driveConnected === "true") {
      setBannerMessage("Google Drive account connected successfully! Subtitles will automatically upload to Drive.");
      void refreshUser();
    } else if (driveError) {
      setBannerMessage(`Drive Connection Error: ${driveError}`);
    } else {
      return;
    }

    const remainingParams = new URLSearchParams(searchString);
    remainingParams.delete("drive_connected");
    remainingParams.delete("drive_error");
    const remainingQuery = remainingParams.toString();
    router.replace(remainingQuery ? `/dashboard?${remainingQuery}` : "/dashboard", { scroll: false });
  }, [driveConnected, driveError, refreshUser, router, searchString]);

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

  const loadCourses = useCallback(async (silent = false) => {
    if (courseRequestInFlight.current) return;
    courseRequestInFlight.current = true;
    if (!silent) setCoursesLoading(true);
    setCoursesError(null);
    try {
      const data = await api.courses.list();
      setCourses(data.items);
    } catch (err) {
      setCoursesError(err instanceof Error ? err.message : "Failed to load courses.");
    } finally {
      courseRequestInFlight.current = false;
      if (!silent) setCoursesLoading(false);
    }
  }, []);

  const loadJobs = useCallback(async () => {
    try {
      const activeJobs = await api.jobs.list();
      setJobs(activeJobs);
    } catch (err) {
      console.error("Failed to load jobs:", err);
    }
  }, []);

  useEffect(() => {
    if (user) {
      loadCourses();
      loadJobs();
    }
  }, [user, loadCourses, loadJobs]);

  // Polling while active jobs exist
  useEffect(() => {
    const hasActiveJob = jobs.some((j) => j.status === "PROCESSING" || j.status === "PENDING");
    if (!hasActiveJob) return;

    const interval = setInterval(() => {
      loadJobs();
      loadCourses(true);
    }, 2500);

    return () => clearInterval(interval);
  }, [jobs, loadJobs, loadCourses]);

  const handleSyncCourse = async (courseId: number, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      const job = await api.courses.sync(courseId);
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

  const tagOptions = [...new Map(courses.flatMap((course) => course.tags.map((tag) => [tag.toLowerCase(), tag] as const))).entries()].sort((a, b) => a[1].localeCompare(b[1]));
  const filteredCourses = courses.filter((c) => {
    if (tagFilter === "untagged" && c.tags.length) return false;
    if (tagFilter.startsWith("tag:") && !c.tags.some((tag) => tag.toLowerCase() === tagFilter.slice(4))) return false;
    if (!courseSearch.trim()) return true;
    const q = courseSearch.toLowerCase();
    return (
      c.title.toLowerCase().includes(q) ||
      (c.instructor && c.instructor.toLowerCase().includes(q)) || c.tags.some((tag) => tag.toLowerCase().includes(q))
    );
  });

  return (
    <div className="min-h-screen bg-[#212121] text-[#ECECEC] flex flex-col font-sans">
      <Navbar
        wide
        onOpenConnections={() => setIsConnectionsOpen(true)}
        onOpenImport={() => setIsImportOpen(true)}
      />

      {/* Main Content Area */}
      <main aria-label="Courses dashboard" className="flex-1 w-full max-w-[1360px] mx-auto px-4 sm:px-6 lg:px-8 py-3 space-y-4">
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

        {/* Active background jobs bar */}
        <JobProgressBar jobs={jobs} onCancelJob={handleCancelJob} />

        <div className="flex flex-wrap items-center justify-between gap-3">
          {courses.length > 0 && <div className="flex flex-wrap items-center gap-2 text-xs">
            <label htmlFor="filter-course-tags" className="text-[#A3A3A3]">Filter by tag</label>
            <select id="filter-course-tags" value={tagFilter} onChange={(event) => setTagFilter(event.target.value)} className="px-3 py-2 rounded-full bg-[#262626] border border-[#383838]">
              <option value="all">All tags</option>
              <option value="untagged">Untagged</option>
              {tagFilter.startsWith("tag:") && !tagOptions.some(([key]) => `tag:${key}` === tagFilter) && <option value={tagFilter}>{tagFilter.slice(4)}</option>}
              {tagOptions.map(([key, tag]) => <option key={key} value={`tag:${key}`}>{tag}</option>)}
            </select>
            {(tagFilter !== "all" || courseSearch) && <button onClick={() => { setTagFilter("all"); setCourseSearch(""); }} className="underline text-[#A3A3A3] hover:text-white">Clear filters</button>}
          </div>}
          <div className="flex items-center gap-2 w-full sm:w-auto sm:ml-auto">
            {courses.length > 0 && <div className="relative flex-1 sm:w-[360px]">
              <Search className="w-4 h-4 text-[#A3A3A3] absolute left-3 top-2.5" />
              <input aria-label="Search courses" type="search" placeholder="Search courses, instructors or tags..." value={courseSearch} onChange={(event) => setCourseSearch(event.target.value)} className="w-full pl-9 pr-3 py-2 bg-[#1A1A1A] border border-[#383838] rounded-xl text-xs text-[#ECECEC] placeholder-[#737373] focus:outline-none focus:border-white" />
            </div>}
            <button onClick={() => loadCourses()} title="Refresh courses" className="p-2 bg-[#262626] hover:bg-[#333333] border border-[#383838] rounded-xl"><RefreshCw className="w-4 h-4" /></button>
          </div>
        </div>

        {/* Course Cards Grid */}
        {coursesLoading ? (
          <div className="p-16 text-center text-[#A3A3A3] text-sm animate-pulse">
            Loading courses...
          </div>
        ) : coursesError ? (
          <div role="alert" className="p-6 rounded-2xl border border-rose-500/30 space-y-3">
            <p>{coursesError}</p>
            <button onClick={() => loadCourses()} className="px-4 py-2 bg-white text-black rounded-xl">Try again</button>
          </div>
        ) : courses.length === 0 ? (
          <div className="p-16 text-center bg-[#262626] border border-[#333333] rounded-3xl space-y-4">
            <div className="w-16 h-16 rounded-2xl bg-[#1A1A1A] border border-[#333333] flex items-center justify-center text-white mx-auto">
              <BookOpen className="w-8 h-8" />
            </div>
            <h3 className="text-lg font-semibold text-[#ECECEC]">No Courses Imported Yet</h3>
            <p className="text-xs text-[#A3A3A3] max-w-md mx-auto">
              Paste any Udemy course URL to import curriculum and manage subtitles directly.
            </p>
            <button
              onClick={() => setIsImportOpen(true)}
              className="px-4 py-2.5 bg-white hover:bg-neutral-200 text-black text-xs font-semibold rounded-xl transition-colors inline-flex items-center space-x-1.5 cursor-pointer shadow-md"
            >
              <Plus className="w-4 h-4" />
              <span>Import Your First Course</span>
            </button>
          </div>
        ) : filteredCourses.length === 0 ? (
          <div className="p-12 text-center text-[#A3A3A3] text-xs">
            No courses match the current search and tag filter.
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-x-4 gap-y-8 items-start">
            {filteredCourses.map((course) => {
              const completedPercent =
                course.total_lectures > 0
                  ? Math.round((course.completed_lectures / course.total_lectures) * 100)
                  : 0;

              return (
                <div
                  key={course.id}
                  data-testid="course-card"
                  className="min-w-0 overflow-hidden rounded-2xl border border-[#333333] bg-[#262626] hover:border-[#555555] transition-colors group"
                >
                  <a href={`/courses/${course.id}`} aria-label={`View ${course.title} curriculum`} className="relative block aspect-video bg-[#1A1A1A] overflow-hidden">
                    <BookOpen className="absolute w-10 h-10 text-[#555555] left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2" />
                    {course.thumbnail_url && <img src={course.thumbnail_url} alt={course.title} width={480} height={270} loading="lazy" decoding="async" className="relative w-full h-full object-cover" onError={(event) => { event.currentTarget.style.visibility = "hidden"; }} />}
                  </a>
                  <div className="p-3.5">
                  <div className="space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <h3 className="font-semibold text-sm text-[#ECECEC] group-hover:text-white line-clamp-2 leading-snug transition-colors">
                        <a href={formatUdemyUrl(course.url, user?.udemy_business_domain)} target="_blank" rel="noopener noreferrer" className="hover:underline">{course.title}</a>
                      </h3>
                      <a
                        href={formatUdemyUrl(course.url, user?.udemy_business_domain)}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="text-[#A3A3A3] hover:text-white p-1 rounded-lg hover:bg-[#1A1A1A] transition-colors"
                        title="Open on Udemy"
                      >
                        <ExternalLink className="w-4 h-4" />
                      </a>
                    </div>

                    {course.instructor && (
                      <p className="text-xs text-[#A3A3A3]">Instructor: <a href={`/api/courses/${course.id}/instructor`} target="_blank" rel="noopener noreferrer" className="hover:text-white hover:underline">{course.instructor}</a></p>
                    )}

                    {/* Progress Bar */}
                    <div className="space-y-1">
                      <div className="flex justify-between text-[11px] text-[#A3A3A3]">
                        <span>Learning Progress</span>
                        <span className="font-mono text-[#ECECEC]">{completedPercent}%</span>
                      </div>
                      <div className="w-full bg-[#1A1A1A] h-1 rounded-full overflow-hidden border border-[#333333]/40">
                        <div
                          className="bg-white h-full rounded-full transition-all duration-300"
                          style={{ width: `${completedPercent}%` }}
                        />
                      </div>
                    </div>

                    {/* Statistics Badges */}
                    <div className="flex flex-wrap gap-1.5 text-[10px]">
                      <span className="px-2 py-0.5 rounded-md bg-[#1A1A1A] text-[#A3A3A3] border border-[#333333]">
                        {course.total_sections} Sections
                      </span>
                      <span className="px-2 py-0.5 rounded-md bg-[#1A1A1A] text-[#A3A3A3] border border-[#333333]">
                        {course.total_lectures} Lectures
                      </span>
                      <span className="px-2 py-0.5 rounded-md bg-[#1A1A1A] text-[#ECECEC] border border-[#333333]">
                        {course.processed_subtitles} / {course.subtitle_eligible_lectures} Subtitles
                      </span>
                      {course.failed_subtitles > 0 && (
                        <span className="px-2 py-0.5 rounded-md bg-rose-500/10 text-rose-400 border border-rose-500/20">
                          {course.failed_subtitles} Failed
                        </span>
                      )}
                    </div>

                    {/* Next Lecture Preview */}
                    {course.next_lecture ? (
                      <NextLectureCard key={course.next_lecture.id} lecture={course.next_lecture} section={course.next_lecture_section} businessDomain={user?.udemy_business_domain} onRefresh={() => loadCourses(true)} compact />
                    ) : (
                      course.total_lectures > 0 &&
                      course.completed_lectures === course.total_lectures && (
                        <div className="mt-3 p-2 bg-emerald-950/20 border border-emerald-500/30 rounded-xl flex items-center space-x-2 text-xs text-emerald-300 font-medium">
                          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0" />
                          <span>All {course.total_lectures} lectures completed!</span>
                        </div>
                      )
                    )}
                  </div>

                  <div className="mt-2">
                    <CourseTags tags={course.tags} onSelect={(tag) => setTagFilter(`tag:${tag.toLowerCase()}`)} />
                  </div>
                  {/* Bottom Footer & CTA */}
                  <div className="pt-2 mt-2 border-t border-[#333333] space-y-1">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-[10px] text-[#A3A3A3] font-mono">
                        Synced: {new Date(course.last_synced_at).toLocaleDateString()}
                      </span>
                      <div
                        className="flex items-center space-x-1"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <button
                          onClick={(e) => handleSyncCourse(course.id, e)}
                          title="Re-sync curriculum"
                          className="p-1.5 text-[#A3A3A3] hover:text-white hover:bg-[#1A1A1A] rounded-lg transition-colors cursor-pointer"
                        >
                          <RefreshCw className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => setDeletingCourse(course)}
                          title="Delete course"
                          className="p-1.5 text-[#A3A3A3] hover:text-rose-400 hover:bg-rose-500/10 rounded-lg transition-colors cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>

                    {/* View Course Content Button */}
                    <a href={`/courses/${course.id}`} className="w-full py-1.5 text-[#ECECEC] hover:text-white text-xs font-medium flex items-center justify-between">
                      <span>View Course Content</span>
                      <ArrowRight className="w-3.5 h-3.5" />
                    </a>
                  </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </main>

      {/* Modals */}
      <ConnectionPanel
        isOpen={isConnectionsOpen}
        onClose={() => setIsConnectionsOpen(false)}
        onStatusChange={() => refreshUser()}
      />

      <CourseImportModal
        isOpen={isImportOpen}
        onClose={() => setIsImportOpen(false)}
        onSuccess={(msg, job) => {
          setToastMessage(msg);
          setJobs((current) => [job, ...current.filter((item) => item.id !== job.id)].slice(0, 10));
          void loadJobs();
          void loadCourses(true);
        }}
      />

      <DeleteCourseModal
        course={deletingCourse}
        isOpen={!!deletingCourse}
        onClose={() => setDeletingCourse(null)}
        onDeleted={() => {
          setToastMessage("Course deleted successfully.");
          loadCourses();
        }}
      />
    </div>
  );
}

export default function DashboardPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-[#212121] flex items-center justify-center text-[#A3A3A3]">
          Loading Courses...
        </div>
      }
    >
      <CoursesListContent />
    </Suspense>
  );
}
