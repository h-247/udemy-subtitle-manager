"use client";

import React, { useState } from "react";
import { api } from "../lib/api";
import { Lecture, Section, LearningStatus, formatUdemyUrl } from "../types";
import { CheckCircle2, Clock, ExternalLink, HardDrive, Loader2, MessageSquare, PlayCircle, Sparkles } from "lucide-react";

interface Props {
  lecture: Lecture;
  section?: Pick<Section, "id" | "title" | "position"> | null;
  businessDomain?: string | null;
  onRefresh: () => Promise<void>;
  compact?: boolean;
}

export default function NextLectureCard({ lecture, section, businessDomain, onRefresh, compact = false }: Props) {
  const [editing, setEditing] = useState(false);
  const [input, setInput] = useState(lecture.chatgpt_url ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const subtitle = lecture.subtitles.find((sub) => sub.status === "COMPLETED" && sub.language.startsWith("en"))
    ?? lecture.subtitles.find((sub) => sub.language.startsWith("en")) ?? lecture.subtitles[0];
  const drive = lecture.subtitles.find((sub) => sub.drive_file_url);
  const button = `${compact ? "px-2 py-1 rounded-lg text-[11px]" : "px-3 py-2 rounded-xl text-xs"} border border-[#444444] font-medium hover:bg-[#383838] disabled:opacity-50 disabled:cursor-wait`;

  async function update(fields: { learning_status?: LearningStatus; chatgpt_url?: string }) {
    setBusy(true); setError(null);
    try {
      await api.courses.updateLecture(lecture.id, fields);
      await onRefresh();
      setEditing(false);
    } catch (err) { setError(err instanceof Error ? err.message : "Could not save lecture."); }
    finally { setBusy(false); }
  }

  async function saveLink(value: string) {
    const clean = value.trim();
    if (clean) {
      try {
        const parsed = new URL(clean);
        if (!["https:", "http:"].includes(parsed.protocol) || !["chatgpt.com", "chat.openai.com"].includes(parsed.hostname)) throw new Error();
      } catch { setError("Enter a ChatGPT URL from chatgpt.com or chat.openai.com."); return; }
    }
    await update({ chatgpt_url: clean });
  }

  return (
    <section aria-label="Next Lecture" onClick={(event) => event.stopPropagation()} className={compact ? "space-y-2 pt-1" : "p-5 sm:p-6 bg-gradient-to-r from-[#262626] to-[#1F1F1F] border border-amber-500/30 rounded-2xl space-y-3"}>
      <div className="flex flex-wrap items-center gap-2 text-[11px]">
        <span className="flex items-center gap-1 font-bold text-amber-300"><Sparkles className="w-3.5 h-3.5" />{compact ? "Next Lecture" : "CONTINUE LEARNING"}</span>
        {!compact && section && <span className="text-[#A3A3A3]">Section {section.position}: {section.title}</span>}
        <span className="px-2 py-0.5 rounded bg-[#1A1A1A] text-amber-300">{lecture.learning_status === "IN_PROGRESS" ? "Doing" : "To do"}</span>
      </div>
      <h2 title={lecture.title} className={`${compact ? "text-[13px] font-medium leading-5 line-clamp-2" : "text-xl font-bold"} text-white`}>{lecture.position}. {lecture.title}</h2>
      <div className={`flex flex-wrap items-center ${compact ? "gap-x-2 gap-y-1 text-[10px]" : "gap-3 text-xs"} text-[#A3A3A3]`}>
        <span className="inline-flex items-center gap-1"><Clock className="w-3.5 h-3.5" />{Math.floor(lecture.duration / 60)}:{String(lecture.duration % 60).padStart(2, "0")}</span>
        <span>Subtitle: {subtitle?.status === "COMPLETED" ? `${subtitle.language.toUpperCase()} (Ready)` : subtitle?.status ?? "None"}</span>
        {!compact && drive?.drive_file_url && <a href={drive.drive_file_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 hover:underline text-white"><HardDrive className="w-3.5 h-3.5" />View in Drive</a>}
        {!compact && lecture.chatgpt_url && <a href={lecture.chatgpt_url} target="_blank" rel="noopener noreferrer" className="text-sky-300 hover:underline">ChatGPT Summary</a>}
        {!compact && <button type="button" disabled={busy} onClick={() => { setInput(lecture.chatgpt_url ?? ""); setEditing(true); setError(null); }} className="text-sky-300 hover:underline">{lecture.chatgpt_url ? "Edit ChatGPT link" : "+ Add ChatGPT Link"}</button>}
      </div>
      {editing && <form onSubmit={(event) => { event.preventDefault(); void saveLink(input); }} className="space-y-2">
        <input aria-label="ChatGPT conversation URL" type="url" value={input} onChange={(event) => setInput(event.target.value)} disabled={busy} placeholder="https://chatgpt.com/c/..." className="w-full px-3 py-2 rounded-xl bg-[#1A1A1A] border border-sky-500/50 text-xs" />
        <div className="flex gap-2">
          <button className={button} disabled={busy} type="submit">Save</button>
          {lecture.chatgpt_url && <button className={button} disabled={busy} type="button" onClick={() => void saveLink("")}>Remove</button>}
          <button className={button} disabled={busy} type="button" onClick={() => { setEditing(false); setError(null); }}>Cancel</button>
        </div>
      </form>}
      {error && <p role="alert" className="text-xs text-rose-300">{error}</p>}
      <div className="flex flex-wrap items-center gap-2">
        {compact && <select aria-label="Lecture status" disabled={busy} value={lecture.learning_status} onChange={(event) => void update({ learning_status: event.target.value as LearningStatus })} className={`${button} bg-[#262626] text-[#ECECEC]`}><option value="NOT_STARTED">To do</option><option value="IN_PROGRESS">Doing</option><option value="COMPLETED">Done</option></select>}
        {!compact && <button type="button" disabled={busy} onClick={() => void update({ learning_status: "COMPLETED" })} className={`${button} text-emerald-300 inline-flex items-center gap-1`}><CheckCircle2 className="w-3.5 h-3.5" />Mark as Done</button>}
        {!compact && lecture.learning_status === "NOT_STARTED" && <button type="button" disabled={busy} onClick={() => void update({ learning_status: "IN_PROGRESS" })} className={`${button} text-amber-300`}>Mark as Doing</button>}
        {lecture.chatgpt_url ? <a href={lecture.chatgpt_url} target="_blank" rel="noopener noreferrer" className={`${button} text-sky-300 inline-flex items-center gap-1`}><MessageSquare className="w-3.5 h-3.5" />ChatGPT</a> : <button type="button" disabled={busy} onClick={() => { setInput(""); setEditing(true); }} className={`${button} text-sky-300`}>+ ChatGPT</button>}
        {compact && lecture.chatgpt_url && <button type="button" disabled={busy} onClick={() => { setInput(lecture.chatgpt_url ?? ""); setEditing(true); setError(null); }} className={button}>Edit Link</button>}
        {compact && drive?.drive_file_url && <a href={drive.drive_file_url} target="_blank" rel="noopener noreferrer" className={`${button} inline-flex items-center gap-1`}><HardDrive className="w-3 h-3" />Drive<ExternalLink className="w-3 h-3" /></a>}
        <a href={formatUdemyUrl(lecture.url, businessDomain)} target="_blank" rel="noopener noreferrer" className={`${button} bg-white text-black inline-flex items-center gap-1`}><PlayCircle className="w-3.5 h-3.5" />{compact ? "Play" : "Play on Udemy"}<ExternalLink className="w-3 h-3" /></a>
        {busy && <Loader2 aria-label="Saving lecture" className="w-4 h-4 animate-spin" />}
      </div>
    </section>
  );
}
