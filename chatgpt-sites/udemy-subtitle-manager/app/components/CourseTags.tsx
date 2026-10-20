"use client";

import { Tag } from "lucide-react";

interface Props { tags: string[]; onSelect?: (tag: string) => void; }

export default function CourseTags({ tags, onSelect }: Props) {
  if (!tags.length) return null;
  return (
    <section aria-label="Course tags" className="flex flex-wrap items-center gap-1.5 text-xs" onClick={(event) => event.stopPropagation()}>
      <Tag className="w-3.5 h-3.5 text-[#A3A3A3]" />
      {tags.map((tag) => onSelect
        ? <button key={tag} type="button" onClick={() => onSelect(tag)} title={`Filter by ${tag}`} className="px-2 py-1 rounded-lg border border-sky-500/30 bg-sky-500/10 text-sky-200 hover:bg-sky-500/20">{tag}</button>
        : <span key={tag} className="px-2 py-1 rounded-lg border border-sky-500/30 bg-sky-500/10 text-sky-200">{tag}</span>)}
    </section>
  );
}
