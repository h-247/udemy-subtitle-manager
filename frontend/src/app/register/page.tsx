"use client";

import React, { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "../../lib/auth";
import { GraduationCap, Lock, Mail, AlertCircle, Loader2 } from "lucide-react";

export default function RegisterPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const { register } = useAuth();
  const router = useRouter();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      await register(email, password);
      router.push("/dashboard");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to register.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-[#212121]">
      <div className="w-full max-w-md bg-[#262626] border border-[#333333] rounded-3xl p-8 shadow-xl shadow-black/40">
        <div className="text-center mb-8">
          <div className="w-14 h-14 rounded-2xl bg-[#1A1A1A] border border-[#333333] flex items-center justify-center text-white mx-auto mb-4 shadow-sm">
            <GraduationCap className="w-8 h-8" />
          </div>
          <h1 className="text-2xl font-bold text-[#ECECEC] tracking-tight">Create an Account</h1>
          <p className="text-xs text-[#A3A3A3] mt-1">Get started with Udemy Subtitle Manager</p>
        </div>

        {error && (
          <div className="mb-6 p-3 bg-rose-500/10 border border-rose-500/20 text-rose-400 text-xs rounded-xl flex items-center space-x-2">
            <AlertCircle className="w-4 h-4 flex-shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <label className="block text-xs font-medium text-[#A3A3A3]">Email Address</label>
            <div className="relative">
              <Mail className="w-4 h-4 text-[#737373] absolute left-3.5 top-3" />
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                className="w-full pl-10 pr-4 py-2.5 bg-[#1A1A1A] border border-[#333333] rounded-xl text-sm text-[#ECECEC] placeholder-[#737373] focus:outline-none focus:border-white transition-colors"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="block text-xs font-medium text-[#A3A3A3]">Password</label>
            <div className="relative">
              <Lock className="w-4 h-4 text-[#737373] absolute left-3.5 top-3" />
              <input
                type="password"
                required
                minLength={6}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="At least 6 characters"
                className="w-full pl-10 pr-4 py-2.5 bg-[#1A1A1A] border border-[#333333] rounded-xl text-sm text-[#ECECEC] placeholder-[#737373] focus:outline-none focus:border-white transition-colors"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="block text-xs font-medium text-[#A3A3A3]">Confirm Password</label>
            <div className="relative">
              <Lock className="w-4 h-4 text-[#737373] absolute left-3.5 top-3" />
              <input
                type="password"
                required
                minLength={6}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Repeat your password"
                className="w-full pl-10 pr-4 py-2.5 bg-[#1A1A1A] border border-[#333333] rounded-xl text-sm text-[#ECECEC] placeholder-[#737373] focus:outline-none focus:border-white transition-colors"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full py-2.5 mt-2 bg-white hover:bg-neutral-200 disabled:opacity-50 text-black text-sm font-semibold rounded-xl transition-colors flex items-center justify-center space-x-2 shadow-sm"
          >
            {loading && <Loader2 className="w-4 h-4 animate-spin text-black" />}
            <span>{loading ? "Creating Account..." : "Create Account"}</span>
          </button>
        </form>

        <p className="mt-8 text-center text-xs text-[#A3A3A3]">
          Already have an account?{" "}
          <Link href="/login" className="text-white font-semibold hover:underline">
            Sign In
          </Link>
        </p>
      </div>
    </div>
  );
}
