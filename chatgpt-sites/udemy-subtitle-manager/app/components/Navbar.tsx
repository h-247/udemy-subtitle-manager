"use client";

import React from "react";
import { useAuth } from "../lib/auth";
import Link from "next/link";
import {
  GraduationCap,
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
}

export default function Navbar({ onOpenConnections, onOpenImport }: NavbarProps) {
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
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
        {/* Brand */}
        <Link href="/dashboard" className="flex items-center space-x-3 group cursor-pointer">
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
        </Link>

        {/* Status Pills and Actions */}
        <div className="flex items-center space-x-2 sm:space-x-3">
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
