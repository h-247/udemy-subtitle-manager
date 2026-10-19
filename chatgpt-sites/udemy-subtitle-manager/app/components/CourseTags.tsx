"use client";

import React, { useState } from "react";
import { Tag, Loader2 } from "lucide-react";
import { api } from "../lib/api";
import { normalizeCourseTags } from "../lib/course-tags";

interface Props {
  courseId: number;
  tags: string[];
  onSaved: (tags: string[]) => void;
  onSelect?: (tag: string) => void;
}

export default function CourseTags({ courseId, tags, onSaved, onSelect }: Props) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function save(event: React.FormEvent) {
    event.preventDefault(); setError(null);
    let next: string[];
    try { next = normalizeCourseTags(draft.split(",")); }
    catch (err) { setError(err instanceof Error ? err.message : "Invalid tags."); return; }
    setSaving(true);
    try {
      const result = await api.courses.updateTags(courseId, next);
      onSaved(result.tags); setEditing(false);
    } catch (err) { setError(err instanceof Error ? err.message : "Could not save tags."); }
    finally { setSaving(false); }
  }
  return (
    <section aria-label="Course tags" className="space-y-2" onClick={(event) => event.stopPropagation()}>
      <div className="flex flex-wrap items-center gap-1.5 text-xs">
        <Tag className="w-3.5 h-3.5 text-[#A3A3A3]" />
        {tags.map((tag) => onSelect ? <button key={tag} type="button" onClick={() => onSelect(tag)} title={`Filter by ${tag}`} className="px-2 py-1 rounded-lg border border-sky-500/30 bg-sky-500/10 text-sky-200 hover:bg-sky-500/20">{tag}</button> : <span key={tag} className="px-2 py-1 rounded-lg border border-sky-500/30 bg-sky-500/10 text-sky-200">{tag}</span>)}
        <button type="button" disabled={saving} onClick={() => { setDraft(tags.join(", ")); setError(null); setEditing(true); }} className="px-2 py-1 text-[#A3A3A3] hover:text-white underline underline-offset-2">{tags.length ? "Edit tags" : "Add tags"}</button>
      </div>
      {editing && <form onSubmit={save} className="space-y-2">
        <label htmlFor={`course-tags-${courseId}`} className="block text-xs text-[#A3A3A3]">Tags separated by commas</label>
        <input id={`course-tags-${courseId}`} value={draft} disabled={saving} onChange={(event) => setDraft(event.target.value)} placeholder="AI, English, To learn" className="w-full rounded-xl border border-[#444444] bg-[#1A1A1A] px-3 py-2 text-xs text-white" />
        <p className="text-[11px] text-[#A3A3A3]">Up to 12 tags, 32 characters each. Clear the field to remove all tags.</p>
        <div className="flex gap-2">
          <button type="submit" disabled={saving} className="inline-flex items-center gap-1 px-3 py-1.5 bg-white text-black rounded-lg text-xs disabled:opacity-50">{saving && <Loader2 className="w-3 h-3 animate-spin" />}Save tags</button>
          <button type="button" disabled={saving} onClick={() => { setEditing(false); setError(null); }} className="px-3 py-1.5 bg-[#333333] rounded-lg text-xs">Cancel</button>
        </div>
      </form>}
      {error && <p role="alert" className="text-xs text-rose-300">{error}</p>}
    </section>
  );
}
