"use client";

import React from "react";
import { useAuth } from "../lib/auth";
import {
  GraduationCap,
  Plus,
  HardDrive,
  KeyRound,
  LogOut,
  User as UserIcon,
  CheckCircle2,
  AlertCircle,
  XCircle,
} from "lucide-react";

interface NavbarProps {
  onOpenConnections: () => void;
  onOpenImport?: () => void;
  wide?: boolean;
}

export default function Navbar({ onOpenConnections, onOpenImport, wide = false }: NavbarProps) {
  const { user, logout } = useAuth();

  const getUdemyBadge = () => {
    const status = user?.udemy_status || "DISCONNECTED";
    switch (status) {
      case "CONNECTED":
        return {
          text: user?.udemy_account_name ? `Udemy: ${user.udemy_account_name}` : "Udemy: Connected",
          bg: "bg-[#262626] text-[#ECECEC] border-[#383838]",
          icon: <CheckCircle2 className="w-3.5 h-3.5 text-white" />,
        };
      case "EXPIRED_SESSION":
        return {
          text: "Udemy: Expired Session",
          bg: "bg-amber-500/10 text-amber-400 border-amber-500/30",
          icon: <AlertCircle className="w-3.5 h-3.5 text-amber-400" />,
        };
      case "VERIFICATION_FAILED":
        return { text: "Udemy: Needs Check", bg: "bg-amber-500/10 text-amber-400 border-amber-500/30", icon: <AlertCircle className="w-3.5 h-3.5 text-amber-400" /> };
      case "ACCESS_DENIED":
      case "INVALID_COOKIES":
        return {
          text: "Udemy: Auth Error",
          bg: "bg-rose-500/10 text-rose-400 border-rose-500/30",
          icon: <XCircle className="w-3.5 h-3.5 text-rose-400" />,
        };
      default:
        return {
          text: "Udemy: Disconnected",
          bg: "bg-[#262626] text-[#A3A3A3] border-[#333333]",
          icon: <KeyRound className="w-3.5 h-3.5 text-[#A3A3A3]" />,
        };
    }
  };

  const udemyBadge = getUdemyBadge();

  return (
    <header className="sticky top-0 z-40 w-full border-b border-[#333333] bg-[#212121]/95 backdrop-blur-md">
      <div className={`${wide ? "max-w-none lg:px-10" : "max-w-7xl lg:px-8"} w-full mx-auto px-4 sm:px-6 min-h-16 py-3 flex flex-wrap gap-3 items-center justify-between`}>
        {/* Brand */}
        <a href="/dashboard" className="flex items-center space-x-3 group cursor-pointer">
          <div className="w-10 h-10 rounded-xl bg-[#262626] border border-[#333333] flex items-center justify-center text-white shadow-sm group-hover:border-neutral-500 transition-colors">
            <GraduationCap className="w-5 h-5 text-white" />
          </div>
          <div>
            <span className="font-bold text-base sm:text-lg text-[#ECECEC] tracking-tight group-hover:text-white transition-colors">
              Udemy Subtitle Manager
            </span>
            <span className="hidden sm:inline-block ml-2 text-xs text-[#A3A3A3] font-mono bg-[#262626] px-2 py-0.5 rounded-full border border-[#333333]">
              Personal Edition
            </span>
          </div>
        </a>

        {/* Status Pills and Actions */}
        <div className="flex flex-wrap items-center gap-2 sm:gap-3">
          {/* Udemy Status Pill */}
          <button
            onClick={onOpenConnections}
            title="Manage Udemy Session Cookies"
            className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors hover:brightness-110 ${udemyBadge.bg}`}
          >
            {udemyBadge.icon}
            <span className="hidden sm:inline">{udemyBadge.text}</span>
            <span className="sm:hidden">Udemy</span>
          </button>

          {/* Drive Status Pill */}
          <button
            onClick={onOpenConnections}
            title="Manage Google Drive Connection"
            className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors hover:brightness-110 ${
              user?.has_drive_connected
                ? "bg-[#262626] text-[#ECECEC] border-[#383838]"
                : "bg-[#262626] text-[#A3A3A3] border-[#333333]"
            }`}
          >
            <HardDrive className={`w-3.5 h-3.5 ${user?.has_drive_connected ? "text-white" : "text-[#A3A3A3]"}`} />
            <span className="hidden sm:inline">
              {user?.has_drive_connected ? "Drive: Connected" : "Drive: Disconnected"}
            </span>
            <span className="sm:hidden">Drive</span>
          </button>

          {onOpenImport && <button type="button" onClick={onOpenImport} className="inline-flex items-center gap-1.5 px-3 py-2 bg-white hover:bg-neutral-200 text-black text-xs font-semibold rounded-xl"><Plus className="w-4 h-4" />Import Course</button>}

          {/* User & Logout */}
          <div className="flex items-center pl-2 sm:pl-3 border-l border-[#333333] space-x-2">
            <span className="hidden md:flex items-center text-xs text-[#A3A3A3]">
              <UserIcon className="w-3.5 h-3.5 mr-1 text-[#737373]" />
              {user?.email}
            </span>
            <button
              onClick={logout}
              title="Logout"
              className="p-2 text-[#A3A3A3] hover:text-rose-400 hover:bg-rose-500/10 rounded-lg transition-colors"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    </header>
  );
}
