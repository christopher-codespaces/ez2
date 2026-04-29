"use client";

import { Suspense, useState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { confirmPasswordReset, getAuth } from "firebase/auth";
import { initFirebaseClient } from "@/lib/firebaseClient";

function ResetPasswordInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [validating, setValidating] = useState(true);
  const [success, setSuccess] = useState(false);

  const oobCode = searchParams.get("oobCode");
  const mode = searchParams.get("mode");

  useEffect(() => {
    if (mode !== "resetPassword" || !oobCode) {
      setError("This password reset link is invalid or has expired.");
      setValidating(false);
    } else {
      setValidating(false);
    }
  }, [mode, oobCode]);

  const passwordValid = (pwd: string) => {
    if (!pwd || pwd.length < 6) return false;
    const hasUpper = /[A-Z]/.test(pwd);
    const hasNumber = /[0-9]/.test(pwd);
    const hasSymbol = /[\W_]/.test(pwd);
    return hasUpper && hasNumber && hasSymbol;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!password) {
      setError("Please enter a password.");
      return;
    }
    if (!passwordValid(password)) {
      setError("Password must be at least 6 characters and include 1 uppercase letter, 1 number, and 1 symbol.");
      return;
    }
    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }
    if (!oobCode) {
      setError("Reset code is missing. Please request a new password reset.");
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
      await confirmPasswordReset(auth, oobCode, password);
      setSuccess(true);
    } catch (err: any) {
      const code = err?.code ?? "";
      if (code === "auth/expired-action-code") {
        setError("This reset link has expired. Please request a new one.");
      } else if (code === "auth/invalid-action-code") {
        setError("This reset link is invalid. Please request a new one.");
      } else if (code === "auth/weak-password") {
        setError("Password is too weak. Please use at least 6 characters with uppercase, number, and symbol.");
      } else {
        setError("Something went wrong. Please try again later.");
      }
    } finally {
      setLoading(false);
    }
  };

  if (validating) {
    return (
      <div className="flex items-center justify-center h-screen bg-gray-100">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600" />
      </div>
    );
  }

  return (
    <div className="flex items-center justify-center min-h-screen bg-gray-100 px-4">
      <div className="bg-white p-8 rounded-xl shadow-lg w-full max-w-md">
        {!success ? (
          <>
            <h1 className="text-2xl font-semibold mb-2 text-center">Set New Password</h1>
            <p className="text-gray-500 text-sm text-center mb-6">
              Create a strong password for your account.
            </p>

            {error && (
              <div className="text-red-600 bg-red-50 border border-red-200 text-sm p-3 rounded-lg mb-4">
                {error}
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <input
                  type="password"
                  placeholder="New password"
                  className="w-full p-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="new-password"
                />
                <p className="text-xs text-gray-400 mt-1">
                  At least 6 characters with uppercase, number, and symbol.
                </p>
              </div>
              <input
                type="password"
                placeholder="Confirm password"
                className="w-full p-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                autoComplete="new-password"
              />
              <button
                type="submit"
                disabled={loading}
                className="w-full bg-blue-600 text-white py-3 rounded-lg hover:bg-blue-700 transition disabled:bg-gray-400"
              >
                {loading ? "Resetting..." : "Reset Password"}
              </button>
            </form>
          </>
        ) : (
          <div className="text-center">
            <div className="text-green-500 text-5xl mb-4">✓</div>
            <h1 className="text-2xl font-semibold mb-2">Password Reset</h1>
            <p className="text-gray-500 mb-6">
              Your password has been changed successfully.
            </p>
            <button
              onClick={() => router.push("/login")}
              className="w-full bg-blue-600 text-white py-3 rounded-lg hover:bg-blue-700 transition"
            >
              Sign in with your new password
            </button>
          </div>
        )}

        <div className="mt-6 text-center">
          <button
            onClick={() => router.push("/login")}
            className="text-gray-500 text-sm hover:underline"
          >
            Back to login
          </button>
        </div>
      </div>
    </div>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center h-screen bg-gray-100">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600" />
        </div>
      }
    >
      <ResetPasswordInner />
    </Suspense>
  );
}