"use client";

import { useState } from "react";
import type { RobotChat } from "@/lib/server/helpChat";
import { etDateTime } from "@/lib/time";

/**
 * /admin/robot (10-14, Chris: "treat every support ticket or social comment as a learning
 * experience"): every robot conversation of the last 7 days, thumbs-down first, then the
 * ones where the robot got stuck, then newest. Click a row to read the whole thread.
 */
export default function RobotChats({ chats }: { chats: RobotChat[] }) {
  const [openId, setOpenId] = useState<string | null>(chats[0]?.thumbsDown ? chats[0].userId : null);
  if (chats.length === 0) return <p className="rounded-2xl border border-edge bg-surface-1 p-6 text-sm text-zinc-500">No robot chats in the last 7 days.</p>;
  return (
    <ul className="divide-y divide-edge overflow-hidden rounded-2xl border border-edge bg-surface-1">
      {chats.map((c) => {
        const open = openId === c.userId;
        const questions = c.messages.filter((m) => m.role === "user").length;
        return (
          <li key={c.userId}>
            <button
              type="button"
              onClick={() => setOpenId(open ? null : c.userId)}
              aria-expanded={open}
              className="flex w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-white/5"
            >
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-2">
                  <span className="truncate font-medium text-white">{c.name}</span>
                  <span className="truncate text-xs text-zinc-500">{c.email}</span>
                  {c.thumbsDown > 0 && (
                    <span className="rounded-full bg-red-400/15 px-2 py-0.5 text-[10px] font-semibold text-red-300">
                      {c.thumbsDown} not helpful
                    </span>
                  )}
                  {c.stuck && <span className="rounded-full bg-amber-400/10 px-2 py-0.5 text-[10px] font-semibold text-amber-300">robot stuck</span>}
                  {c.ticket && <span className="rounded-full bg-brand-500/15 px-2 py-0.5 text-[10px] font-semibold text-brand-300">ticket opened</span>}
                </span>
                <span className="mt-0.5 block truncate text-xs text-zinc-500">
                  {questions} question{questions === 1 ? "" : "s"} · last {etDateTime(c.lastAt)}
                </span>
              </span>
              <span className="text-xs text-zinc-500">{open ? "Hide" : "Read"}</span>
            </button>
            {open && (
              <div className="space-y-2 border-t border-edge bg-surface-2/40 px-4 py-3">
                {c.messages.map((m) => (
                  <div key={m.id} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                    <div className={`max-w-[85%] rounded-2xl px-3.5 py-2 text-sm leading-relaxed ${m.role === "user" ? "rounded-br-md bg-brand-500/80 text-white" : "rounded-bl-md bg-surface-2 text-zinc-200"}`}>
                      <p className="whitespace-pre-wrap">{m.content}</p>
                      <p className="mt-1 text-[10px] text-white/50">
                        {etDateTime(m.createdAt)}
                        {m.role === "assistant" && m.rating === -1 && <span className="ml-2 font-semibold text-red-300">seller: not helpful</span>}
                        {m.role === "assistant" && m.rating === 1 && <span className="ml-2 font-semibold text-emerald-300">seller: helpful</span>}
                        {m.actions.length > 0 && <span className="ml-2">{m.actions.map((a) => `${a.type}${a.value ? `:${a.value}` : ""}`).join(" · ")}</span>}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
