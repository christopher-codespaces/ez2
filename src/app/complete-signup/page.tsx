"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { getAuth, onAuthStateChanged, User } from "firebase/auth";
import { initFirebaseClient, app } from "@/lib/firebaseClient";
import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  updateDoc,
  serverTimestamp,
} from "firebase/firestore";
import {
  getStorage,
  ref as storageRef,
  uploadBytes,
  getDownloadURL,
} from "firebase/storage";
import { useAuth } from "@/app/context/AuthContext";

type Role = "driver" | "business";

type AddressSuggestion = {
  label: string;
  lat: string;
  lon: string;
};

const routeByRole = (router: ReturnType<typeof useRouter>, role: Role) => {
  if (typeof window !== "undefined") {
    localStorage.setItem("role", role);
  }
  if (role === "driver") router.push("/driver");
  else if (role === "business") router.push("/business");
  else router.push("/");
};

const normalizeZaPhone = (input: string) => input.trim().replace(/\s+/g, "");
const isValidZaPhone = (input: string) => {
  const p = normalizeZaPhone(input);
  if (/^0\d{9}$/.test(p)) return true;
  if (/^\+27\d{9}$/.test(p)) return true;
  return false;
};

export default function CompleteSignupPage() {
  const router = useRouter();

  const auth = useMemo(() => (app ? getAuth(app) : null), []);
  const db = useMemo(() => (app ? getFirestore(app) : null), []);

  const { setRole } = useAuth();

  const [firebaseUser, setFirebaseUser] = useState<User | null>(null);
  const [loadingUser, setLoadingUser] = useState(true);

  // Rehydration guard: after a Google signInWithRedirect, onAuthStateChanged
  // fires ONCE with null before the SDK rehydrates the real user.
  // We wait for a second confirmation window before treating null as "logged out".
  const rehydrationConfirmed = useRef(false);

  const [role, setRoleState] = useState<Role | "">("");
  const [step, setStep] = useState<1 | 2>(1);

  const [phone, setPhone] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");

  const [homeAddress, setHomeAddress] = useState("");
  const [addressQuery, setAddressQuery] = useState("");
  const [addressSuggestions, setAddressSuggestions] = useState<AddressSuggestion[]>([]);
  const [addressLoading, setAddressLoading] = useState(false);
  const [homeLat, setHomeLat] = useState("");
  const [homeLon, setHomeLon] = useState("");

  const [businessName, setBusinessName] = useState("");
  const [businessLocation, setBusinessLocation] = useState("");
  const [businessDescription, setBusinessDescription] = useState("");

  const [driverDocuments, setDriverDocuments] = useState<File[]>([]);
  const [driverDocumentsError, setDriverDocumentsError] = useState<string | null>(null);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Auth + onboarding prefill
  useEffect(() => {
    if (!auth || !db) {
      setError("Firebase is not configured. Missing NEXT_PUBLIC_FIREBASE_* env vars.");
      setLoadingUser(false);
      return;
    }

    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (!user) {
        if (!rehydrationConfirmed.current) {
          // First null fire — SDK may still be rehydrating after Google redirect.
          // Wait 500ms for a second fire with the real user before giving up.
          rehydrationConfirmed.current = true;
          setTimeout(() => {
            // If still no user after rehydration window, genuinely logged out
            setLoadingUser((prev) => {
              if (prev) {
                // loadingUser is still true = no user came through, redirect
                router.push("/login");
              }
              return false;
            });
          }, 500);
          return;
        }
        // Second+ null fire after rehydration window = truly logged out
        router.push("/login");
        return;
      }

      // Real user confirmed — cancel any pending redirect
      rehydrationConfirmed.current = true;
      setFirebaseUser(user);

      const ref = doc(db, "users", user.uid);
      const snap = await getDoc(ref);

      if (snap.exists()) {
        const data = snap.data();

        const existingRole = data?.role as Role | null | undefined;

        // If user already has a role, skip onboarding and go straight to dashboard
        if (existingRole) {
          setRole(existingRole);
          if (typeof window !== "undefined") localStorage.setItem("role", existingRole);
          routeByRole(router, existingRole);
          return;
        }

        const existingPhone = (data?.phone as string | undefined) ?? "";
        const existingFirstName = (data?.firstName as string | undefined) ?? "";
        const existingLastName = (data?.lastName as string | undefined) ?? "";
        const existingName = (data?.name as string | undefined) ?? "";
        const existingHomeAddress = (data?.homeAddress as string | undefined) ?? "";
        const existingHomeLat = (data?.homeLat as string | undefined) ?? "";
        const existingHomeLon = (data?.homeLon as string | undefined) ?? "";
        const existingBusinessName = (data?.businessName as string | undefined) ?? "";
        const existingBusinessLocation = (data?.businessLocation as string | undefined) ?? "";
        const existingBusinessDescription = (data?.businessDescription as string | undefined) ?? "";

        if (existingPhone) setPhone(existingPhone);
        if (existingFirstName) setFirstName(existingFirstName);
        if (existingLastName) setLastName(existingLastName);
        if (existingHomeAddress) {
          setHomeAddress(existingHomeAddress);
          setAddressQuery(existingHomeAddress);
        }
        if (existingHomeLat) setHomeLat(existingHomeLat);
        if (existingHomeLon) setHomeLon(existingHomeLon);
        if (!existingFirstName && existingName) {
          const [fn, ...rest] = existingName.split(" ");
          setFirstName(fn);
          setLastName(rest.join(" "));
        }
        if (existingBusinessName) setBusinessName(existingBusinessName);
        if (existingBusinessLocation) setBusinessLocation(existingBusinessLocation);
        if (existingBusinessDescription) setBusinessDescription(existingBusinessDescription);
      } else {
        await setDoc(ref, {
          email: user.email ?? "",
          role: null,
          phone: "",
          name: "",
          firstName: "",
          lastName: "",
          homeAddress: "",
          homeLat: "",
          homeLon: "",
          businessName: "",
          businessLocation: "",
          businessDescription: "",
          createdAt: Date.now(),
        });
      }

      setLoadingUser(false);
    });

    return () => unsubscribe();
  }, [auth, db, router]);

  // Free address autocomplete (OpenStreetMap / Nominatim)
  useEffect(() => {
    if (step !== 2 || role !== "driver") return;
    const q = addressQuery.trim();
    if (q.length < 5) { setAddressSuggestions([]); return; }

    const controller = new AbortController();
    const t = setTimeout(async () => {
      try {
        setAddressLoading(true);
        const url = `https://nominatim.openstreetmap.org/search?` +
          new URLSearchParams({ q, format: "json", addressdetails: "1", limit: "5", countrycodes: "za" }).toString();
        const res = await fetch(url, { signal: controller.signal, headers: { Accept: "application/json" } });
        if (!res.ok) throw new Error("Address lookup failed");
        const data = (await res.json()) as any[];
        setAddressSuggestions(data.map((item) => ({ label: item.display_name, lat: item.lat, lon: item.lon })));
      } catch { /* ignore aborts */ } finally { setAddressLoading(false); }
    }, 400);

    return () => { controller.abort(); clearTimeout(t); };
  }, [addressQuery, step, role]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!db) { setError("Firebase is not configured. Missing NEXT_PUBLIC_FIREBASE_* env vars."); return; }
    if (!firebaseUser) { setError("You must be signed in to complete setup."); return; }

    if (step === 1) {
      if (!role) { setError("Please select whether you are a driver or a business."); return; }
      setStep(2);
      return;
    }

    if (!role) { setError("Please select a role."); setStep(1); return; }
    if (!phone.trim() || !isValidZaPhone(phone)) {
      setError("Please enter a valid South African phone number (e.g. 0821234567 or +27821234567).");
      return;
    }
    if (role === "driver") {
      if (!firstName.trim() || !lastName.trim()) { setError("Please enter your first and last name."); return; }
      if (!homeAddress.trim()) { setError("Please enter your home address."); return; }
      if (driverDocuments.length === 0) { setError("Please upload at least one document."); return; }
    }
    if (role === "business") {
      if (!businessName.trim()) { setError("Please enter your business name."); return; }
      if (!businessLocation.trim()) { setError("Please enter your business location."); return; }
      if (!businessDescription.trim()) { setError("Please enter a brief description of your business."); return; }
    }

    setSaving(true);
    try {
      const ref = doc(db, "users", firebaseUser.uid);
      const phoneValue = normalizeZaPhone(phone);

      if (role === "driver") {
        // Upload Police Clearance PDF for drivers
        let policeClearanceUrl = "";
        if (policeClearance) {
          const storage = getStorage(app);
          const policeRef = storageRef(storage, `policeClearance/${firebaseUser.uid}/${policeClearance.name}`);
          await uploadBytes(policeRef, policeClearance);
          policeClearanceUrl = await getDownloadURL(policeRef);
        }
        await updateDoc(ref, {
          role, phone: phoneValue,
          firstName: firstName.trim(), lastName: lastName.trim(),
          name: `${firstName.trim()} ${lastName.trim()}`.trim(),
          homeAddress: homeAddress.trim(), homeLat: homeLat || "", homeLon: homeLon || "",
          businessName: "", businessLocation: "", businessDescription: "",
          policeClearanceUrl,
          updatedAt: Date.now(), lastLoginAt: serverTimestamp(),
        });
      } else {
        await updateDoc(ref, {
          role, phone: phoneValue,
          businessName: businessName.trim(), businessLocation: businessLocation.trim(),
          businessDescription: businessDescription.trim(),
          firstName: "", lastName: "", name: "",
          homeAddress: "", homeLat: "", homeLon: "",
          billing: { credits: 3, totalSpent: 0 }, credits: 3,
          updatedAt: Date.now(), lastLoginAt: serverTimestamp(),
        });
      }

      setRole(role);
      if (typeof window !== "undefined") localStorage.setItem("role", role);
      routeByRole(router, role);
    } catch (err: any) {
      console.error(err);
      setError("Failed to save your information. Try again.");
    } finally {
      setSaving(false);
    }
  };

  if (loadingUser) {
    return (
      <div className="flex items-center justify-center h-screen bg-gray-100">
        <div className="bg-white p-8 rounded-xl shadow-md w-full max-w-md text-center">
          <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-600 mx-auto mb-3" />
          <p className="text-gray-700">Checking your account…</p>
        </div>
      </div>
    );
  }

  if (error && !firebaseUser) {
    return (
      <div className="flex items-center justify-center h-screen bg-gray-100">
        <div className="bg-white p-8 rounded-xl shadow-md w-full max-w-md text-center">
          <p className="text-red-600 text-sm">{error}</p>
        </div>
      </div>
    );
  }

  if (!firebaseUser) return null;

  const showDriverFields = step === 2 && role === "driver";
  const showBusinessFields = step === 2 && role === "business";

  return (
    <div className="flex items-center justify-center h-screen bg-gray-100">
      <div className="bg-white p-10 rounded-xl shadow-lg w-full max-w-lg">
        <h1 className="text-2xl text-black font-semibold mb-2 text-center">Complete Your Setup</h1>
        <p className="text-sm text-black mb-6 text-center">
          Signed in as <span className="font-medium">{firebaseUser.email}</span>
        </p>

        <form onSubmit={handleSubmit} className="space-y-5">
          {step === 1 && (
            <div>
              <label className="block font-medium mb-2">Are you a driver or a business?</label>
              <div className="flex gap-3">
                <button type="button" onClick={() => setRoleState("driver")}
                  className={`flex-1 py-3 rounded-lg border text-center ${
                    role === "driver" ? "border-blue-600 bg-blue-50 text-blue-700" : "border-gray-300 text-gray-700"
                  }`}>Driver</button>
                <button type="button" onClick={() => setRoleState("business")}
                  className={`flex-1 py-3 rounded-lg border text-center ${
                    role === "business" ? "border-blue-600 bg-blue-50 text-blue-700" : "border-gray-300 text-gray-700"
                  }`}>Business</button>
              </div>
            </div>
          )}

          {showDriverFields && (
            <div className="space-y-6">
              {/* Personal & Address Information */}
              <div className="space-y-4">
                <h3 className="text-lg font-medium text-black">Personal Information</h3>
                <div>
                  <label className="block text-black font-medium mb-1">Phone Number</label>
                  <input type="tel" className="w-full text-black p-3 border rounded-lg"
                    placeholder="e.g. 0821234567 or +27821234567"
                    value={phone} onChange={(e) => setPhone(e.target.value)} />
                </div>
                <div>
                  <label className="block text-black font-medium mb-1">First Name</label>
                  <input type="text" className="w-full text-black p-3 border rounded-lg"
                    placeholder="e.g. John" value={firstName} onChange={(e) => setFirstName(e.target.value)} />
                </div>
                <div>
                  <label className="block text-black font-medium mb-1">Last Name</label>
                  <input type="text" className="w-full text-black p-3 border rounded-lg"
                    placeholder="e.g. Doe" value={lastName} onChange={(e) => setLastName(e.target.value)} />
                </div>
                <div className="relative">
                  <label className="block text-black font-medium mb-1">Home Address</label>
                  <input type="text" className="w-full text-black p-3 border rounded-lg"
                    placeholder="Start typing your address…" value={addressQuery} autoComplete="off"
                    onChange={(e) => {
                      const v = e.target.value;
                      setAddressQuery(v); setHomeAddress(v); setHomeLat(""); setHomeLon("");
                    }} />
                  {addressLoading && <p className="text-xs text-gray-500 mt-1">Searching addresses…</p>}
                  {addressSuggestions.length > 0 && (
                    <div className="absolute z-10 mt-2 w-full bg-white border rounded-lg shadow-lg max-h-60 overflow-auto">
                      {addressSuggestions.map((s) => (
                        <button key={`${s.lat}-${s.lon}-${s.label}`} type="button"
                          className="w-full text-left px-3 py-2 hover:bg-gray-50 text-sm"
                          onClick={() => { setHomeAddress(s.label); setAddressQuery(s.label); setHomeLat(s.lat); setHomeLon(s.lon); setAddressSuggestions([]); }}>
                          {s.label}
                        </button>
                      ))}
                    </div>
                  )}
                  {homeLat && homeLon && <p className="text-xs text-gray-500 mt-1">Location captured (lat/lon)</p>}
                </div>
              </div>

              {/* Driver Documents Section */}
              <div className="space-y-4">
                <h3 className="text-lg font-medium text-black">Driver Documents</h3>
                <div>
                  <label className="block text-black font-medium mb-1">Upload documents (any file type) *</label>
                  <input type="file" multiple className="w-full text-black p-2 border rounded-lg"
                    onChange={(e) => {
                      const files = Array.from(e.target.files ?? []);
                      setDriverDocuments(files);
                      if (files.length === 0) {
                        setDriverDocumentsError("Please upload at least one document.");
                      } else {
                        setDriverDocumentsError(null);
                      }
                    }} />
                  {driverDocumentsError && <p className="text-red-500 text-sm mt-1">{driverDocumentsError}</p>}
                  {!driverDocuments.length && <p className="text-sm text-gray-500 mt-1">Please upload your documents.</p>}
                  {driverDocuments.length > 0 && (
                    <div className="mt-2">
                      <p className="text-sm text-green-600">Documents selected:</p>
                      <ul className="mt-1">
                        {driverDocuments.map((doc, idx) => (
                          <li key={idx} className="text-sm text-gray-700">{doc.name}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
            <div className="space-y-4">
              <div>
                <label className="block text-black font-medium mb-1">Phone Number</label>
                <input type="tel" className="w-full text-black p-3 border rounded-lg"
                  placeholder="e.g. 0821234567 or +27821234567"
                  value={phone} onChange={(e) => setPhone(e.target.value)} />
              </div>
              <div>
                <label className="block text-black font-medium mb-1">First Name</label>
                <input type="text" className="w-full text-black p-3 border rounded-lg"
                  placeholder="e.g. John" value={firstName} onChange={(e) => setFirstName(e.target.value)} />
              </div>
              <div>
                <label className="block text-black font-medium mb-1">Last Name</label>
                <input type="text" className="w-full text-black p-3 border rounded-lg"
                  placeholder="e.g. Doe" value={lastName} onChange={(e) => setLastName(e.target.value)} />
              </div>
              <div className="relative">
                <label className="block text-black font-medium mb-1">Home Address</label>
                <input type="text" className="w-full text-black p-3 border rounded-lg"
                  placeholder="Start typing your address…" value={addressQuery} autoComplete="off"
                  onChange={(e) => {
                    const v = e.target.value;
                    setAddressQuery(v); setHomeAddress(v); setHomeLat(""); setHomeLon("");
                  }} />
                {addressLoading && <p className="text-xs text-gray-500 mt-1">Searching addresses…</p>}
                {addressSuggestions.length > 0 && (
                  <div className="absolute z-10 mt-2 w-full bg-white border rounded-lg shadow-lg max-h-60 overflow-auto">
                    {addressSuggestions.map((s) => (
                      <button key={`${s.lat}-${s.lon}-${s.label}`} type="button"
                        className="w-full text-left px-3 py-2 hover:bg-gray-50 text-sm"
                        onClick={() => { setHomeAddress(s.label); setAddressQuery(s.label); setHomeLat(s.lat); setHomeLon(s.lon); setAddressSuggestions([]); }}>
                        {s.label}
                      </button>
                    ))}
                  </div>
                )}
                {homeLat && homeLon && <p className="text-xs text-gray-500 mt-1">Location captured (lat/lon)</p>}
              </div>
            </div>
          )}

          {showBusinessFields && (
            <div className="space-y-4">
              <div>
                <label className="block text-black font-medium mb-1">Phone Number</label>
                <input type="tel" className="w-full text-black p-3 border rounded-lg"
                  placeholder="e.g. 0821234567 or +27821234567"
                  value={phone} onChange={(e) => setPhone(e.target.value)} />
              </div>
              <div>
                <label className="block text-black font-medium mb-1">Business Name</label>
                <input type="text" className="w-full text-black p-3 border rounded-lg"
                  placeholder="e.g. Fast Logistics LLC" value={businessName} onChange={(e) => setBusinessName(e.target.value)} />
              </div>
              <div>
                <label className="block text-black font-medium mb-1">Location</label>
                <input type="text" className="w-full text-black p-3 border rounded-lg"
                  placeholder="City / Region" value={businessLocation} onChange={(e) => setBusinessLocation(e.target.value)} />
              </div>
              <div>
                <label className="block text-black font-medium mb-1">Business Description</label>
                <textarea className="w-full text-black p-3 border rounded-lg min-h-20"
                  placeholder="Briefly describe your services…"
                  value={businessDescription} onChange={(e) => setBusinessDescription(e.target.value)} />
              </div>
            </div>
          )}

          {error && <p className="text-red-500 text-sm">{error}</p>}

          <div className="flex justify-between items-center mt-4">
            {step === 2 && (
              <button type="button" className="text-sm text-gray-500 hover:underline" onClick={() => setStep(1)}>Back</button>
            )}
            <button type="submit" disabled={saving}
              className="ml-auto bg-blue-600 text-white px-6 py-3 rounded-lg hover:bg-blue-700 transition disabled:bg-gray-400">
              {saving ? "Saving..." : step === 1 ? "Continue" : "Finish & Continue"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
