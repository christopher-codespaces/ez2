"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { sendPasswordResetEmail, getAuth, ActionCodeSettings } from "firebase/auth";
import { initFirebaseClient } from "@/lib/firebaseClient";

function ForgotPasswordInner() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);

  const emailValid = (em: string) => /\S+@\S+\.\S+/.test(em);

  const getActionCodeSettings = (): ActionCodeSettings => {
    const domain = typeof window !== "undefined" ? window.location.host : "";
    return {
      url: `https://${domain}/reset-password`,
      handleCodeInApp: true,
    };
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!email.trim()) {
      setError("Please enter your email address.");
      return;
    }
    if (!emailValid(email)) {
      setError("Please enter a valid email address.");
      return;
    }

    const firebaseApp = initFirebaseClient();
    if (!firebaseApp) {
      setError("Firebase is not configured. Missing environment variables.");
      return;
    }

    const auth = getAuth(firebaseApp);
    setLoading(true);

    try {
      await sendPasswordResetEmail(auth, email, getActionCodeSettings());
      setSuccess(true);
    } catch (err: any) {
      const code = err?.code ?? "";
      if (code === "auth/invalid-email") {
        setError("That email address is not valid.");
      } else if (code === "auth/user-not-found") {
        // For security, still show success to prevent email enumeration
        setSuccess(true);
      } else {
        setError("Something went wrong. Please try again later.");
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex items-center justify-center min-h-screen bg-gray-100 px-4">
      <div className="bg-white p-8 rounded-xl shadow-lg w-full max-w-md">
        {!success ? (
          <>
            <h1 className="text-2xl font-semibold mb-2 text-center">Forgot Password</h1>
            <p className="text-gray-500 text-sm text-center mb-6">
              Enter your email and we&apos;ll send you a link to reset your password.
            </p>

            {error && (
              <div className="text-red-600 bg-red-50 border border-red-200 text-sm p-3 rounded-lg mb-4">
                {error}
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4">
              <input
                type="email"
                placeholder="Email address"
                className="w-full p-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
              />
              <button
                type="submit"
                disabled={loading}
                className="w-full bg-blue-600 text-white py-3 rounded-lg hover:bg-blue-700 transition disabled:bg-gray-400"
              >
                {loading ? "Sending..." : "Send Reset Link"}
              </button>
            </form>
          </>
        ) : (
          <div className="text-center">
            <div className="text-green-500 text-5xl mb-4">✓</div>
            <h1 className="text-2xl font-semibold mb-2">Check Your Email</h1>
            <p className="text-gray-500 mb-6">
              We sent a password reset link to <strong>{email}</strong>.
              <br />If you don&apos;t see it, check your spam folder.
            </p>
            <button
              onClick={() => router.push("/login")}
              className="text-blue-600 hover:underline text-sm"
            >
              Back to login
            </button>
          </div>
        )}

        <div className="mt-6 text-center">
          <button
            onClick={() => router.push("/login")}
            className="text-gray-500 text-sm hover:underline"
          >
            Remember your password? Sign in
          </button>
        </div>
      </div>
    </div>
  );
}

export default function ForgotPasswordPage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center h-screen bg-gray-100">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600" />
        </div>
      }
    >
      <ForgotPasswordInner />
    </Suspense>
  );
}