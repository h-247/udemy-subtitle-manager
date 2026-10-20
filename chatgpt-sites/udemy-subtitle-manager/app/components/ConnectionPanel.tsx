"use client";

import React, { useState } from "react";
import { useAuth } from "../lib/auth";
import { api } from "../lib/api";
import {
  X,
  Upload,
  HardDrive,
  KeyRound,
  CheckCircle2,
  AlertCircle,
  XCircle,
  RefreshCw,
  Trash2,
  FileText,
  ExternalLink,
  ShieldAlert,
} from "lucide-react";

interface ConnectionPanelProps {
  isOpen: boolean;
  onClose: () => void;
  onStatusChange: () => void;
}

export default function ConnectionPanel({ isOpen, onClose, onStatusChange }: ConnectionPanelProps) {
  const { user, refreshUser } = useAuth();
  const [activeTab, setActiveTab] = useState<"udemy" | "drive">("udemy");

  // Udemy state
  const [cookieFile, setCookieFile] = useState<File | null>(null);
  const [cookieText, setCookieText] = useState("");
  const [loading, setLoading] = useState(false);
  const [testLoading, setTestLoading] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Drive state
  const [driveLoading, setDriveLoading] = useState(false);

  if (!isOpen) return null;

  const handleUploadCookies = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!cookieFile && !cookieText.trim()) {
      setErrorMessage("Please select a cookies.txt file or paste cookie text.");
      return;
    }

    setLoading(true);
    setStatusMessage(null);
    setErrorMessage(null);

    try {
      const res = await api.udemy.uploadCookies(cookieFile || cookieText);
      setStatusMessage(res.status === "CONNECTED"
        ? `Cookies saved and connection verified. Account: ${res.account_name || "Active"}.`
        : `Cookies saved. Verification: ${res.status}. ${res.error_message || "Use Test Connection to check access again."}`);
      setCookieFile(null);
      setCookieText("");
      try { await refreshUser(); onStatusChange(); }
      catch { setErrorMessage("Cookies were saved, but the connection display could not refresh. Reopen this panel to check the status."); }
    } catch (err: unknown) {
      setErrorMessage(err instanceof Error && /timed out|timeout/i.test(err.message)
        ? "The save request timed out. Your input is retained. Please try Save & Verify Cookies again."
        : err instanceof Error ? err.message : "Failed to upload cookies.");
    } finally {
      setLoading(false);
    }
  };

  const handleTestConnection = async () => {
    setTestLoading(true);
    setStatusMessage(null);
    setErrorMessage(null);

    try {
      const res = await api.udemy.testConnection();
      setStatusMessage(
        res.status === "CONNECTED"
          ? `Connection verified! Account: ${res.account_name || "Active"}`
          : `Status: ${res.status}${res.error_message ? ` - ${res.error_message}` : ""}`
      );
      await refreshUser();
      onStatusChange();
    } catch (err: unknown) {
      setErrorMessage(err instanceof Error ? err.message : "Connection test failed.");
    } finally {
      setTestLoading(false);
    }
  };

  const handleDisconnectUdemy = async () => {
    if (!confirm("Are you sure you want to disconnect Udemy and delete stored session cookies?")) return;

    setLoading(true);
    try {
      await api.udemy.disconnect();
      setStatusMessage("Udemy cookies deleted successfully.");
      await refreshUser();
      onStatusChange();
    } catch (err: unknown) {
      setErrorMessage(err instanceof Error ? err.message : "Failed to disconnect.");
    } finally {
      setLoading(false);
    }
  };

  const handleConnectDrive = async () => {
    setDriveLoading(true);
    try {
      const { url } = await api.drive.getAuthUrl();
      window.location.href = url;
    } catch (err: unknown) {
      setErrorMessage(err instanceof Error ? err.message : "Failed to initiate Google Drive OAuth.");
      setDriveLoading(false);
    }
  };

  const handleDisconnectDrive = async () => {
    if (!confirm("Are you sure you want to disconnect Google Drive? Subtitles will no longer sync to Drive.")) return;

    setDriveLoading(true);
    try {
      await api.drive.disconnect();
      await refreshUser();
      onStatusChange();
    } catch (err: unknown) {
      setErrorMessage(err instanceof Error ? err.message : "Failed to disconnect Drive.");
    } finally {
      setDriveLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-in fade-in duration-200">
      <div className="w-full max-w-2xl bg-[#262626] border border-[#333333] rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#333333] bg-[#262626]">
          <h2 className="text-lg font-semibold text-[#ECECEC] flex items-center space-x-2">
            <KeyRound className="w-5 h-5 text-white" />
            <span>Connection & Session Management</span>
          </h2>
          <button
            onClick={onClose}
            className="p-1 text-[#A3A3A3] hover:text-[#ECECEC] rounded-lg hover:bg-[#333333] transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tab Navigation */}
        <div className="flex border-b border-[#333333] bg-[#1A1A1A]">
          <button
            onClick={() => setActiveTab("udemy")}
            className={`flex-1 py-3 px-4 text-sm font-medium border-b-2 transition-colors flex items-center justify-center space-x-2 ${
              activeTab === "udemy"
                ? "border-white text-white bg-[#262626]"
                : "border-transparent text-[#A3A3A3] hover:text-[#ECECEC] hover:bg-[#2A2A2A]"
            }`}
          >
            <KeyRound className="w-4 h-4" />
            <span>Udemy Session Cookies</span>
          </button>
          <button
            onClick={() => setActiveTab("drive")}
            className={`flex-1 py-3 px-4 text-sm font-medium border-b-2 transition-colors flex items-center justify-center space-x-2 ${
              activeTab === "drive"
                ? "border-white text-white bg-[#262626]"
                : "border-transparent text-[#A3A3A3] hover:text-[#ECECEC] hover:bg-[#2A2A2A]"
            }`}
          >
            <HardDrive className="w-4 h-4" />
            <span>Google Drive OAuth</span>
          </button>
        </div>

        {/* Body */}
        <div className="p-6 overflow-y-auto space-y-6 flex-1">
          {/* Notification Alerts */}
          {statusMessage && (
            <div className="p-3 bg-[#1A1A1A] border border-[#383838] text-[#ECECEC] text-sm rounded-xl flex items-center space-x-2">
              <CheckCircle2 className="w-4 h-4 text-white flex-shrink-0" />
              <span>{statusMessage}</span>
            </div>
          )}
          {errorMessage && (
            <div className="p-3 bg-rose-500/10 border border-rose-500/20 text-rose-400 text-sm rounded-xl flex items-center space-x-2">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              <span>{errorMessage}</span>
            </div>
          )}

          {activeTab === "udemy" ? (
            <div className="space-y-6">
              {/* Current Status Card */}
              <div className="p-4 bg-[#1A1A1A] border border-[#333333] rounded-xl space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs uppercase tracking-wider text-[#A3A3A3] font-semibold">
                    Current Connection State
                  </span>
                  <span
                    className={`px-2.5 py-1 text-xs font-medium rounded-full border ${
                      user?.udemy_status === "CONNECTED"
                        ? "bg-[#262626] text-[#ECECEC] border-[#383838]"
                        : user?.udemy_status === "EXPIRED_SESSION"
                        ? "bg-amber-500/10 text-amber-400 border-amber-500/20"
                        : "bg-[#2E2E2E] text-[#A3A3A3] border-[#383838]"
                    }`}
                  >
                    {user?.udemy_status || "DISCONNECTED"}
                  </span>
                </div>
                {user?.udemy_account_name && (
                  <p className="text-sm text-[#ECECEC]">
                    Account: <span className="font-semibold text-white">{user.udemy_account_name}</span>
                  </p>
                )}

                <div className="flex flex-wrap gap-2 pt-2 border-t border-[#333333]">
                  <button
                    onClick={handleTestConnection}
                    disabled={testLoading || !user?.has_udemy_connected}
                    className="flex items-center space-x-1.5 px-3 py-1.5 bg-[#2E2E2E] hover:bg-[#383838] border border-[#383838] disabled:opacity-50 text-[#ECECEC] text-xs font-medium rounded-lg transition-colors"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${testLoading ? "animate-spin" : ""}`} />
                    <span>{testLoading ? "Testing..." : "Test Connection"}</span>
                  </button>
                  {user?.has_udemy_connected && (
                    <button
                      onClick={handleDisconnectUdemy}
                      disabled={loading}
                      className="flex items-center space-x-1.5 px-3 py-1.5 bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 text-xs font-medium rounded-lg border border-rose-500/20 transition-colors"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>Disconnect & Delete Cookies</span>
                    </button>
                  )}
                </div>
              </div>

              {/* Upload Form */}
              <form onSubmit={handleUploadCookies} className="space-y-4">
                <div className="space-y-2">
                  <label className="block text-sm font-medium text-[#ECECEC]">
                    Upload <code className="text-white bg-[#1A1A1A] px-1.5 py-0.5 rounded border border-[#333333] text-xs">cookies.txt</code> or JSON Cookie File
                  </label>
                  <p className="text-xs text-[#A3A3A3] leading-relaxed">
                    Export your logged-in cookies for Udemy from your browser using extensions like &quot;Cookie-Editor&quot; (JSON export) or &quot;Get cookies.txt LOCALLY&quot; (Netscape format). Supports standard Udemy and Udemy Business (<code className="text-[#ECECEC] text-xs">*.udemy.com</code>). Credentials are encrypted with Fernet symmetric keys at rest and never exposed in raw form.
                  </p>
                </div>

                {/* File input */}
                <div className="border-2 border-dashed border-[#333333] hover:border-neutral-500 rounded-xl p-4 text-center cursor-pointer transition-colors bg-[#1A1A1A]">
                  <input
                    type="file"
                    accept=".txt,.json"
                    onChange={(e) => {
                      if (e.target.files?.[0]) setCookieFile(e.target.files[0]);
                    }}
                    className="hidden"
                    id="cookie-file-input"
                  />
                  <label htmlFor="cookie-file-input" className="cursor-pointer space-y-1 block">
                    <Upload className="w-6 h-6 mx-auto text-[#A3A3A3]" />
                    <span className="text-xs font-medium text-white hover:underline block">
                      {cookieFile ? cookieFile.name : "Choose a cookies.txt or cookies.json file"}
                    </span>
                    <span className="text-[11px] text-[#737373] block">Netscape (.txt) or JSON (.json) format (max 2MB)</span>
                  </label>
                </div>

                <div className="text-center text-xs text-[#737373] uppercase tracking-widest font-semibold">
                  Or Paste Text / JSON Array
                </div>

                <textarea
                  aria-label="Udemy cookie text"
                  rows={4}
                  placeholder={`Paste Netscape text or JSON array from Cookie-Editor / EditThisCookie:\n[\n  {"domain": ".ifg.udemy.com", "name": "access_token", "value": "..."}\n]`}
                  value={cookieText}
                  onChange={(e) => setCookieText(e.target.value)}
                  className="w-full bg-[#1A1A1A] border border-[#333333] rounded-xl p-3 text-xs text-[#ECECEC] font-mono focus:outline-none focus:border-white resize-none placeholder-[#737373]"
                />

                <button
                  type="submit"
                  disabled={loading || (!cookieFile && !cookieText.trim())}
                  className="w-full py-2.5 bg-white hover:bg-neutral-200 disabled:opacity-50 text-black text-sm font-semibold rounded-xl transition-colors shadow-sm"
                >
                  {loading ? "Validating & Encrypting..." : "Save & Verify Cookies"}
                </button>
              </form>
            </div>
          ) : (
            <div className="space-y-6">
              {/* Google Drive Status */}
              <div className="p-4 bg-[#1A1A1A] border border-[#333333] rounded-xl space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs uppercase tracking-wider text-[#A3A3A3] font-semibold">
                    Google Drive Status
                  </span>
                  <span
                    className={`px-2.5 py-1 text-xs font-medium rounded-full border ${
                      user?.has_drive_connected
                        ? "bg-[#262626] text-[#ECECEC] border-[#383838]"
                        : "bg-[#2E2E2E] text-[#A3A3A3] border-[#383838]"
                    }`}
                  >
                    {user?.has_drive_connected ? "CONNECTED" : "NOT CONNECTED"}
                  </span>
                </div>

                <p className="text-xs text-[#A3A3A3] leading-relaxed">
                  When connected, subtitle files are automatically uploaded to your Google Drive in an organized folder structure:
                  <br />
                  <code className="text-[#ECECEC] text-[11px] block mt-1 font-mono">
                    Udemy Subtitles / [Course Title] / Section 01 - [Title] / 001 - [Lecture].vtt
                  </code>
                </p>

                <div className="pt-2 border-t border-[#333333]">
                  {user?.has_drive_connected ? (
                    <button
                      onClick={handleDisconnectDrive}
                      disabled={driveLoading}
                      className="px-3 py-1.5 bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 text-xs font-medium rounded-lg border border-rose-500/20 transition-colors"
                    >
                      {driveLoading ? "Disconnecting..." : "Disconnect Google Drive"}
                    </button>
                  ) : (
                    <button
                      onClick={handleConnectDrive}
                      disabled={driveLoading}
                      className="px-4 py-2 bg-white hover:bg-neutral-200 disabled:opacity-50 text-black text-xs font-semibold rounded-xl transition-colors flex items-center space-x-1.5 shadow-sm"
                    >
                      <HardDrive className="w-4 h-4 text-black" />
                      <span>{driveLoading ? "Connecting..." : "Connect Google Drive"}</span>
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
