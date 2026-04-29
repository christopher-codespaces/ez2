"use client";

import { Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  sendPasswordResetEmail,
  GoogleAuthProvider,
  signInWithPopup,
  type Auth,
  type User,
} from "firebase/auth";
import { getAuth } from "firebase/auth";
import { initFirebaseClient } from "@/lib/firebaseClient";
import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  updateDoc,
  serverTimestamp,
  type Firestore,
} from "firebase/firestore";
import { useAuth } from "@/app/context/AuthContext";

const ONBOARDING_ROUTE = "/complete-signup";

type Role = "driver" | "business" | "admin";

// ─── Session Cookie Helper ────────────────────────────────────────────────────
async function createServerSession(user: User): Promise<void> {
  // forceRefresh=true ensures Admin SDK always gets a fresh token (<5 min old)
  const idToken = await user.getIdToken(/* forceRefresh= */ true);
  const res = await fetch("/api/session/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ idToken }),
  });
  if (!res.ok) throw new Error("Could not create server session");
}

// ─── Inner component — owns all logic + useSearchParams ──────────────────────
function LoginPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user, role, initialized } = useAuth();

  // Firebase instances — initialized once on mount
  const [auth, setAuth] = useState<Auth | null>(null);
  const [db, setDb] = useState<Firestore | null>(null);
  const [firebaseReady, setFirebaseReady] = useState(false);

  // UI state
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [resetSent, setResetSent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);

  // ─── Guard: true while a submit / Google popup is in flight ──────────────
  const isSubmitting = useRef(false);

  // ─── Initialize Firebase instances ───────────────────────────────────────
  useEffect(() => {
    const firebaseApp = initFirebaseClient();
    if (!firebaseApp) return;
    setAuth(getAuth(firebaseApp));
    setDb(getFirestore(firebaseApp));
    setFirebaseReady(true);
  }, []);

  // ─── Page-load redirect (already-authed users only) ──────────────────────
  useEffect(() => {
    if (!initialized) return;
    if (isSubmitting.current) return;

    if (user && role) {
      routeByRole(role);
    } else if (user && !role) {
      router.push(ONBOARDING_ROUTE);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, role, initialized]);

  // ─── Helpers ─────────────────────────────────────────────────────────────
  const routeByRole = (userRole: Role) => {
    const redirectTo = searchParams.get("redirect");
    if (redirectTo && redirectTo.startsWith("/")) {
      router.push(redirectTo);
    } else if (userRole === "driver") {
      router.push("/driver");
    } else if (userRole === "business") {
      router.push("/business");
    } else if (userRole === "admin") {
      router.push("/admin");
    } else {
      router.push("/");
    }
  };

  const passwordValid = (pwd: string) => {
    const hasUpper = /[A-Z]/.test(pwd);
    const hasNumber = /[0-9]/.test(pwd);
    const hasSymbol = /[\W_]/.test(pwd);
    const longEnough = pwd.length >= 6;
    return hasUpper && hasNumber && hasSymbol && longEnough;
  };

  const emailValid = (em: string) => /\S+@\S+\.\S+/.test(em);

  const translateError = (code: string, message?: string) => {
    switch (code) {
      case "auth/invalid-email": return "Please enter a valid email address.";
      case "auth/email-already-in-use": return "That email is already registered. Try logging in or use a different email.";
      case "auth/wrong-password": return "Incorrect password. Check your password and try again.";
      case "auth/user-not-found": return "No account found with that email. Please check your email or sign up.";
      case "auth/weak-password": return "Your password is too weak.";
      case "auth/too-many-requests": return "Too many attempts. Please wait a moment and try again.";
      case "auth/popup-closed-by-user": return "Sign-in popup was closed. Please try again.";
      case "auth/popup-blocked": return "Popup was blocked. Please allow popups for this site, or use email/password.";
      case "auth/cancelled-popup-request": return "Sign-in was cancelled. Please try again.";
      case "auth/network-request-failed": return "Network error. Check your internet connection and try again.";
      case "auth/invalid-credential": return "Invalid credentials. Please check your email and password.";
      case "auth/user-disabled": return "This account has been disabled. Contact support for help.";
      default:
        if (message?.includes("Cross-Origin-Opener-Policy")) {
          return "Browser security policy blocked the popup. Please try again or use email/password login.";
        }
        if (code?.startsWith("auth/")) {
          return `Login failed (${code}). Please try again or contact support if this persists.`;
        }
        return message || "Something went wrong. Please try again.";
    }
  };

  const handleForgotPassword = async () => {
    setError(null);
    if (!email) { setError("Please enter your email first."); return; }
    if (!emailValid(email)) { setError("Please enter a valid email."); return; }
    if (!auth) { setError("Firebase is not configured."); return; }
    try {
      const domain = typeof window !== "undefined" ? window.location.host : "";
      const actionCodeSettings = {
        url: `https://${domain}/reset-password`,
        handleCodeInApp: true,
      };
      await sendPasswordResetEmail(auth, email, actionCodeSettings);
      setResetSent(true);
    } catch (err: any) {
      setError(translateError(err?.code, err?.message));
    }
  };

  // ─── Email / password submit ──────────────────────────────────────────────
  const handleSubmit = async () => {
    setError(null);
    if (!auth || !db) { setError("Firebase is not configured. Missing NEXT_PUBLIC_FIREBASE_* env vars."); return; }
    if (!emailValid(email)) { setError("Please enter a valid email."); return; }
    if (mode === "signup" && !passwordValid(password)) {
      setError("Password must have 6+ characters, 1 uppercase, 1 number, and 1 symbol.");
      return;
    }

    isSubmitting.current = true;
    setLoading(true);

    try {
      if (mode === "login") {
        const userCred = await signInWithEmailAndPassword(auth, email, password);
        await createServerSession(userCred.user);

        const uid = userCred.user.uid;
        const ref = doc(db, "users", uid);
        const snap = await getDoc(ref);

        if (!snap.exists()) {
          router.push(ONBOARDING_ROUTE);
          return;
        }

        const data = snap.data();
        const userRole = data?.role as Role | undefined;

        if (!userRole) {
          router.push(ONBOARDING_ROUTE);
          return;
        }

        await updateDoc(doc(db, "users", uid), { lastLoginAt: serverTimestamp() });
        routeByRole(userRole);

      } else {
        const userCred = await createUserWithEmailAndPassword(auth, email, password);
        await createServerSession(userCred.user);

        const uid = userCred.user.uid;
        await setDoc(
          doc(db, "users", uid),
          {
            email,
            role: null,
            phone: "",
            name: "",
            firstName: "",
            lastName: "",
            businessName: null,
            businessLocation: "",
            businessDescription: "",
            homeAddress: "",
            homeLat: "",
            homeLon: "",
            billing: { credits: 3, totalSpent: 0 },
            credits: 3,
            createdAt: Date.now(),
          },
          { merge: true }
        );

        router.push(ONBOARDING_ROUTE);
      }
    } catch (err: any) {
      isSubmitting.current = false;
      const msg = translateError(err?.code, err?.message);
      if (msg) setError(msg);
    } finally {
      setLoading(false);
    }
  };

  // ─── Google popup login ───────────────────────────────────────────────────
  // Uses signInWithPopup instead of signInWithRedirect.
  // signInWithRedirect is broken on Next.js App Router + Vercel: the router
  // intercepts the return navigation before Firebase can read the pending
  // credential from IndexedDB, so getRedirectResult() always returns null.
  // signInWithPopup resolves in the same JS execution context — no page
  // navigation, no race condition, no infinite loop.
  const handleGoogleLogin = async () => {
    setError(null);
    if (!auth || !db) { setError("Firebase is not configured. Missing NEXT_PUBLIC_FIREBASE_* env vars."); return; }

    isSubmitting.current = true;
    setGoogleLoading(true);

    try {
      const provider = new GoogleAuthProvider();
      provider.setCustomParameters({ prompt: "select_account" });

      // Popup resolves here — no page navigation, result is guaranteed
      const result = await signInWithPopup(auth, provider);

      await createServerSession(result.user);

      const uid = result.user.uid;
      const ref = doc(db, "users", uid);
      const snap = await getDoc(ref);

      if (!snap.exists()) {
        await setDoc(ref, {
          email: result.user.email ?? "",
          role: null,
          phone: "",
          name: result.user.displayName ?? "",
          businessName: null,
          credits: 3,
          createdAt: Date.now(),
        });
        router.push(ONBOARDING_ROUTE);
        return;
      }

      const data = snap.data();
      const userRole = data?.role as Role | undefined;

      if (!userRole) {
        router.push(ONBOARDING_ROUTE);
        return;
      }

      routeByRole(userRole);

    } catch (err: any) {
      console.error("[Login] Google popup error:", err);
      isSubmitting.current = false;
      setGoogleLoading(false);
      const msg = err?.message?.includes("server session")
        ? "Login succeeded but session creation failed. Please try again."
        : translateError(err?.code, err?.message);
      if (msg) setError(msg);
    }
  };

  // ─── Render guards ────────────────────────────────────────────────────────

  if (!initialized) {
    return (
      <div className="flex items-center justify-center h-screen bg-gray-100">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Loading...</p>
        </div>
      </div>
    );
  }

  if (user && role && !isSubmitting.current) {
    return (
      <div className="flex items-center justify-center h-screen bg-gray-100">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Redirecting...</p>
        </div>
      </div>
    );
  }

  // ─── Login / Signup form ──────────────────────────────────────────────────
  return (
    <div className="flex items-center justify-center h-screen bg-gray-100">
      <div className="bg-white p-10 rounded-xl shadow-lg w-full max-w-md">
        <div className="flex justify-center mb-6">
          <button
            className={`px-4 py-2 font-semibold ${
              mode === "login" ? "text-blue-600 border-b-2 border-blue-600" : "text-gray-500"
            }`}
            onClick={() => setMode("login")}
          >
            Login
          </button>
          <button
            className={`px-4 py-2 font-semibold ${
              mode === "signup" ? "text-blue-600 border-b-2 border-blue-600" : "text-gray-500"
            }`}
            onClick={() => setMode("signup")}
          >
            Sign Up
          </button>
        </div>

        <h1 className="text-2xl font-semibold mb-6 text-center">
          {mode === "login" ? "Welcome Back" : "Create an Account"}
        </h1>

        <form
          onSubmit={(e) => { e.preventDefault(); handleSubmit(); }}
          className="space-y-4"
        >
          <input
            type="email"
            placeholder="Email"
            className={`w-full p-3 border rounded-lg ${
              !!error && !emailValid(email) ? "border-red-400" : ""
            }`}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <input
            type="password"
            placeholder="Password"
            className={`w-full p-3 border rounded-lg ${
              !!error && mode === "signup" && !passwordValid(password) ? "border-red-400" : ""
            }`}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />

          {error && !resetSent && (
            <div className="flex items-start gap-3 text-red-600 bg-red-50 border border-red-200 text-sm p-3 rounded-lg" role="alert">
              <svg className="w-5 h-5 mt-0.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <div>{error}</div>
            </div>
          )}

          {resetSent && (
            <div className="text-green-600 bg-green-50 border border-green-200 text-sm p-3 rounded-lg">
              Password reset email sent! Check your inbox. If you don&apos;t see it, check your spam folder.
            </div>
          )}

          {mode === "login" && !resetSent && (
            <button
              type="button"
              className="text-blue-600 text-sm mt-2 hover:underline text-center w-full"
              onClick={handleForgotPassword}
            >
              Forgot password?
            </button>
          )}

          <button
            type="submit"
            disabled={loading || googleLoading}
            className="w-full bg-blue-600 text-white py-3 rounded-lg mt-6 hover:bg-blue-700 transition disabled:bg-gray-400"
          >
            {loading ? "Loading..." : mode === "login" ? "Login" : "Sign Up"}
          </button>
        </form>

        <div className="flex items-center gap-2 my-6">
          <span className="h-px flex-1 bg-gray-300" />
          <span className="text-xs text-gray-400">OR</span>
          <span className="h-px flex-1 bg-gray-300" />
        </div>

        <button
          type="button"
          onClick={handleGoogleLogin}
          disabled={googleLoading || loading || !firebaseReady}
          className="w-full flex items-center justify-center gap-2 border border-gray-300 py-3 rounded-lg hover:bg-gray-50 transition disabled:bg-gray-200"
        >
          <svg className="w-5 h-5" viewBox="0 0 533.5 544.3" xmlns="http://www.w3.org/2000/svg">
            <path d="M533.5 278.4c0-17.4-1.5-34.1-4.3-50.4H272.1v95.3h147.2c-6.4 34.5-25.7 63.7-54.8 83.3v68h88.6c51.8-47.7 80.4-118.1 80.4-196.2z" fill="#4285f4" />
            <path d="M272.1 544.3c73.7 0 135.6-24.4 180.8-66.1l-88.6-68c-24.6 16.5-56.2 26-92.2 26-70.9 0-131-47.9-152.6-112.3h-91.3v70.6c45.1 89.2 137.7 149.8 243.9 149.8z" fill="#34a853" />
            <path d="M119.5 323.9c-10.5-31.5-10.5-65.4 0-96.9v-70.6H28.2c-37.9 75.8-37.9 162.3 0 238.1l91.3-70.6z" fill="#fbbc04" />
            <path d="M272.1 107.7c38.9-.6 76.2 14 104.6 40.9l77.9-77.9C407.5 24.5 344.1-.3 272.1 0 165.9 0 73.3 60.6 28.2 149.8l91.3 70.6c21.6-64.4 81.7-112.3 152.6-112.7z" fill="#ea4335" />
          </svg>
          <span className="text-sm font-medium text-gray-700">
            {googleLoading ? "Signing in with Google..." : "Continue with Google"}
          </span>
        </button>
      </div>
    </div>
  );
}

// ─── Page export — Suspense boundary required for useSearchParams SSR ─────────
export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center h-screen bg-gray-100">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600" />
        </div>
      }
    >
      <LoginPageInner />
    </Suspense>
  );
}
