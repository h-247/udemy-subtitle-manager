import { GraduationCap } from "lucide-react";

export default function LoginPage() {
  return (
    <main className="min-h-screen flex items-center justify-center p-6 bg-[#212121]">
      <section className="w-full max-w-md rounded-3xl border border-[#333] bg-[#262626] p-8 text-center shadow-xl">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl border border-[#333] bg-[#1A1A1A]">
          <GraduationCap className="h-8 w-8" />
        </div>
        <h1 className="text-2xl font-bold">Sign in to Udemy Subtitle Manager</h1>
        <p className="mt-2 text-sm text-[#A3A3A3]">This private Site uses your ChatGPT account to protect your courses and subtitle data.</p>
        <a href="/signin-with-chatgpt?return_to=%2Fdashboard" target="_top" className="mt-7 inline-flex w-full justify-center rounded-xl bg-white px-4 py-3 text-sm font-semibold text-black hover:bg-neutral-200">
          Continue with ChatGPT
        </a>
      </section>
    </main>
  );
}
