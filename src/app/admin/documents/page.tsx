"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { getAuth, onAuthStateChanged } from "firebase/auth";
import {
  getFirestore,
  collection,
  query,
  orderBy,
  getDocs,
  doc,
  getDoc,
  updateDoc,
  serverTimestamp,
} from "firebase/firestore";
import { app } from "@/lib/firebase";

type DocType =
  | "id"
  | "drivers_license"
  | "proof_of_address"
  | "vehicle_registration"
  | "police_clearance";

const REQUIRED: { type: DocType; label: string }[] = [
  { type: "id", label: "ID / Passport" },
  { type: "drivers_license", label: "Driver's License" },
  { type: "proof_of_address", label: "Proof of Address" },
  { type: "vehicle_registration", label: "Vehicle Registration" },
  { type: "police_clearance", label: "Police Clearance" },
];

type Status = "uploaded" | "approved" | "rejected" | string;

type DriverDocRow = {
  id: string;
  uid: string;
  docType: DocType;
  fileName: string;
  fileType: string;
  fileSize: number;
  downloadURL: string;
  status: Status;
  createdAt?: Date | null;
};

type UserProfile = {
  uid: string;
  name?: string;
  email?: string;
  role?: string | null;
};

const formatBytes = (bytes: number) => {
  if (!Number.isFinite(bytes)) return "—";
  const mb = bytes / (1024 * 1024);
  if (mb >= 1) return `${mb.toFixed(2)} MB`;
  const kb = bytes / 1024;
  return `${kb.toFixed(0)} KB`;
};

const formatDateTime = (d?: Date | null) => {
  if (!d) return "—";
  try {
    return new Intl.DateTimeFormat(undefined, {
      year: "numeric",
      month: "short",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }).format(d);
  } catch {
    return d.toLocaleString();
  }
};

const chipBase =
  "inline-flex items-center rounded-full px-3 py-1 text-sm font-extrabold ring-1";

const statusChip = (status: string) => {
  const s = (status || "uploaded").toLowerCase();
  if (s === "approved")
    return "bg-emerald-100 text-emerald-900 ring-emerald-200 dark:bg-emerald-950 dark:text-emerald-100 dark:ring-emerald-900/60";
  if (s === "rejected")
    return "bg-rose-100 text-rose-900 ring-rose-200 dark:bg-rose-950 dark:text-rose-100 dark:ring-rose-900/60";
  return "bg-amber-100 text-amber-900 ring-amber-200 dark:bg-amber-950 dark:text-amber-100 dark:ring-amber-900/60";
};

const typeChip = (docType: DocType) => {
  if (docType === "id")
    return "bg-blue-100 text-blue-900 ring-blue-200 dark:bg-blue-950 dark:text-blue-100 dark:ring-blue-900/60";
  if (docType === "drivers_license")
    return "bg-indigo-100 text-indigo-900 ring-indigo-200 dark:bg-indigo-950 dark:text-indigo-100 dark:ring-indigo-900/60";
  if (docType === "proof_of_address")
    return "bg-purple-100 text-purple-900 ring-purple-200 dark:bg-purple-950 dark:text-purple-100 dark:ring-purple-900/60";
  return "bg-zinc-100 text-zinc-900 ring-zinc-200 dark:bg-zinc-900 dark:text-zinc-100 dark:ring-zinc-700";
};

export default function AdminDriverDocumentsPage() {
  const router = useRouter();

  const auth = useMemo(() => (app ? getAuth(app) : null), []);
  const db = useMemo(() => (app ? getFirestore(app) : null), []);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [docs, setDocs] = useState<DriverDocRow[]>([]);
  const [usersByUid, setUsersByUid] = useState<Record<string, UserProfile>>({});

  const [actingOn, setActingOn] = useState<string | null>(null);

  // UI
  const [selectedDriverUid, setSelectedDriverUid] = useState<string | null>(
    null,
  );
  const [tab, setTab] = useState<"pending" | "drivers">("pending");
  const [search, setSearch] = useState("");

  const ensureAdmin = async (uid: string) => {
    if (!db) return false;

    // NOTE: If you migrate to custom-claims admin, replace this check:
    // const token = await getAuth(app).currentUser?.getIdTokenResult();
    // return token?.claims?.admin === true;

    const snap = await getDoc(doc(db, "users", uid));
    return snap.exists() && (snap.data() as any)?.role === "admin";
  };

  const loadAllDocs = async () => {
    if (!db) return;

    setLoading(true);
    setError(null);

    try {
      const q = query(
        collection(db, "driverDocuments"),
        orderBy("createdAt", "desc"),
      );

      const snap = await getDocs(q);

      const list: DriverDocRow[] = snap.docs.map((d) => {
        const data = d.data() as any;
        return {
          id: d.id,
          uid: data.uid,
          docType: data.docType,
          fileName: data.fileName,
          fileType: data.fileType,
          fileSize: data.fileSize,
          downloadURL: data.downloadURL,
          status: data.status,
          createdAt: data.createdAt?.toDate ? data.createdAt.toDate() : null,
        };
      });

      setDocs(list);

      // Fetch user profiles for any uid we saw (name/email)
      const uids = Array.from(new Set(list.map((r) => r.uid))).slice(0, 500);
      const pairs = await Promise.all(
        uids.map(async (uid) => {
          const us = await getDoc(doc(db, "users", uid));
          if (!us.exists()) return [uid, { uid }] as const;

          const d = us.data() as any;
          return [
            uid,
            {
              uid,
              name:
                (d.name as string) ||
                `${d.firstName || ""} ${d.lastName || ""}`.trim(),
              email: d.email as string,
              role: d.role as string,
            },
          ] as const;
        }),
      );

      const map: Record<string, UserProfile> = {};
      for (const [uid, profile] of pairs) map[uid] = profile;
      setUsersByUid(map);
    } catch (e: any) {
      console.error(e);
      setError(e?.message || "Failed to load documents.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!auth || !db) {
      setError(
        "Firebase is not configured. Missing NEXT_PUBLIC_FIREBASE_* env vars.",
      );
      setLoading(false);
      return;
    }

    const unsub = onAuthStateChanged(auth, async (u) => {
      if (!u) {
        router.push("/login");
        return;
      }

      const ok = await ensureAdmin(u.uid);
      if (!ok) {
        router.push("/");
        return;
      }

      await loadAllDocs();
    });

    return () => unsub();
  }, [auth, db, router]);

  // Group docs by driver uid
  const grouped = useMemo(() => {
    const map = new Map<string, DriverDocRow[]>();
    for (const r of docs) {
      const arr = map.get(r.uid) ?? [];
      arr.push(r);
      map.set(r.uid, arr);
    }

    return Array.from(map.entries()).map(([uid, list]) => {
      const latest: Partial<Record<DocType, DriverDocRow>> = {};
      for (const row of list) {
        if (!latest[row.docType]) latest[row.docType] = row;
      }

      const statusOf = (row?: DriverDocRow) =>
        String(row?.status || "uploaded").toLowerCase();

      const submittedCount = REQUIRED.reduce(
        (acc, req) => acc + (latest[req.type] ? 1 : 0),
        0,
      );

      const approvedCount = REQUIRED.reduce(
        (acc, req) => acc + (statusOf(latest[req.type]) === "approved" ? 1 : 0),
        0,
      );

      return { uid, list, latest, submittedCount, approvedCount };
    });
  }, [docs]);

  const pending = useMemo(
    () =>
      docs.filter(
        (d) => String(d.status || "uploaded").toLowerCase() === "uploaded",
      ),
    [docs],
  );

  const setStatus = async (docId: string, status: "approved" | "rejected") => {
    if (!db) return;

    setActingOn(docId);
    setError(null);

    try {
      await updateDoc(doc(db, "driverDocuments", docId), {
        status,
        reviewedAt: serverTimestamp(),
      });

      await loadAllDocs();
    } catch (e: any) {
      console.error(e);
      setError(e?.message || "Failed to update status.");
    } finally {
      setActingOn(null);
    }
  };

  const displayName = (uid: string) =>
    usersByUid[uid]?.name || usersByUid[uid]?.email || uid;

  const driverView = selectedDriverUid
    ? grouped.find((g) => g.uid === selectedDriverUid)
    : null;

  const filteredDrivers = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = grouped
      .slice()
      .sort((a, b) => b.approvedCount - a.approvedCount);
    if (!q) return list;

    return list.filter((g) => {
      const name = displayName(g.uid).toLowerCase();
      return name.includes(q) || g.uid.toLowerCase().includes(q);
    });
  }, [grouped, search, usersByUid]);

  const filteredPending = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return pending;

    return pending.filter((d) => {
      const name = displayName(d.uid).toLowerCase();
      const file = (d.fileName || "").toLowerCase();
      const type = String(d.docType || "").toLowerCase();
      return (
        name.includes(q) ||
        d.uid.toLowerCase().includes(q) ||
        file.includes(q) ||
        type.includes(q)
      );
    });
  }, [pending, search, usersByUid]);

  return (
    <div className="min-h-screen bg-zinc-50 text-zinc-950 dark:bg-zinc-950 dark:text-zinc-50">
      <div className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 lg:px-8 space-y-6">
        {/* Header */}
        <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div className="space-y-2">
            <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight">
              Driver Documents
            </h1>
            <p className="text-base text-zinc-700 dark:text-zinc-300">
              Review uploads and browse documents by driver.
            </p>
          </div>

          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <button
              onClick={() => router.push("/admin")}
              className="h-12 rounded-xl border border-zinc-300 bg-white px-4 text-base font-semibold text-zinc-950 shadow-sm transition hover:bg-zinc-50 focus:outline-none focus:ring-4 focus:ring-zinc-200 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50 dark:hover:bg-zinc-800 dark:focus:ring-zinc-800">
              Back
            </button>
          </div>
        </div>

        {/* Search + Tabs */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="w-full sm:max-w-md">
            <label className="sr-only" htmlFor="search">
              Search
            </label>
            <input
              id="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name, email, UID, file…"
              className="h-12 w-full rounded-xl border border-zinc-300 bg-white px-4 text-base font-semibold text-zinc-950 shadow-sm outline-none transition focus:border-zinc-400 focus:ring-4 focus:ring-zinc-200 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50 dark:placeholder:text-zinc-400 dark:focus:border-zinc-500 dark:focus:ring-zinc-800"
            />
          </div>

          <div className="flex w-full gap-2 sm:w-auto">
            <button
              onClick={() => setTab("pending")}
              className={`h-12 flex-1 sm:flex-none rounded-xl px-4 text-base font-extrabold shadow-sm ring-1 transition focus:outline-none focus:ring-4 ${
                tab === "pending"
                  ? "bg-zinc-950 text-white ring-zinc-950 hover:bg-zinc-900 focus:ring-zinc-200 dark:bg-white dark:text-zinc-950 dark:ring-white dark:hover:bg-zinc-100 dark:focus:ring-zinc-800"
                  : "bg-white text-zinc-950 ring-zinc-300 hover:bg-zinc-50 focus:ring-zinc-200 dark:bg-zinc-900 dark:text-zinc-50 dark:ring-zinc-700 dark:hover:bg-zinc-800 dark:focus:ring-zinc-800"
              }`}>
              Pending ({filteredPending.length})
            </button>

            <button
              onClick={() => setTab("drivers")}
              className={`h-12 flex-1 sm:flex-none rounded-xl px-4 text-base font-extrabold shadow-sm ring-1 transition focus:outline-none focus:ring-4 ${
                tab === "drivers"
                  ? "bg-zinc-950 text-white ring-zinc-950 hover:bg-zinc-900 focus:ring-zinc-200 dark:bg-white dark:text-zinc-950 dark:ring-white dark:hover:bg-zinc-100 dark:focus:ring-zinc-800"
                  : "bg-white text-zinc-950 ring-zinc-300 hover:bg-zinc-50 focus:ring-zinc-200 dark:bg-zinc-900 dark:text-zinc-50 dark:ring-zinc-700 dark:hover:bg-zinc-800 dark:focus:ring-zinc-800"
              }`}>
              Drivers ({filteredDrivers.length})
            </button>
          </div>
        </div>

        {/* Loading / Error */}
        {loading && (
          <div className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
            <p className="text-base text-zinc-700 dark:text-zinc-300">
              Loading…
            </p>
          </div>
        )}

        {error && !loading && (
          <div className="rounded-2xl border border-rose-200 bg-rose-50 p-5 shadow-sm dark:border-rose-900/50 dark:bg-rose-950/40">
            <p className="text-base font-semibold text-rose-700 dark:text-rose-200">
              {error}
            </p>
          </div>
        )}

        {/* Content */}
        {!loading && !error && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            {/* Left panel: Drivers list (hidden on mobile unless tab=drivers) */}
            <div
              className={`rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-950 ${
                tab === "drivers" ? "block" : "hidden lg:block"
              }`}>
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold">All Drivers</h2>
                {selectedDriverUid && (
                  <button
                    onClick={() => setSelectedDriverUid(null)}
                    className="text-base font-semibold text-zinc-700 hover:underline dark:text-zinc-300">
                    Clear
                  </button>
                )}
              </div>

              <div className="mt-3 space-y-2 max-h-[70vh] overflow-auto pr-1">
                {filteredDrivers.map((g) => (
                  <button
                    key={g.uid}
                    onClick={() => setSelectedDriverUid(g.uid)}
                    className={`w-full rounded-2xl border p-4 text-left shadow-sm transition focus:outline-none focus:ring-4 ${
                      selectedDriverUid === g.uid
                        ? "border-blue-600 bg-blue-50 ring-blue-100 dark:border-blue-500 dark:bg-blue-950/40 dark:ring-blue-900/40"
                        : "border-zinc-200 bg-white hover:bg-zinc-50 ring-transparent dark:border-zinc-800 dark:bg-zinc-950 dark:hover:bg-zinc-900/40"
                    }`}>
                    <div className="text-base font-extrabold break-words">
                      {displayName(g.uid)}
                    </div>
                    <div className="mt-1 text-sm text-zinc-700 dark:text-zinc-300">
                      <span className="font-semibold">
                        {g.approvedCount}/{REQUIRED.length} approved
                      </span>
                      <span className="text-zinc-500 dark:text-zinc-400">
                        {" "}
                        • {g.submittedCount}/{REQUIRED.length} submitted
                      </span>
                    </div>
                  </button>
                ))}

                {filteredDrivers.length === 0 && (
                  <div className="text-base text-zinc-700 dark:text-zinc-300">
                    No driver documents yet.
                  </div>
                )}
              </div>
            </div>

            {/* Right panel: Pending + Driver details */}
            <div className="lg:col-span-2 space-y-4">
              {/* Pending Review */}
              <div
                className={`rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-950 ${
                  tab === "pending" ? "block" : "hidden lg:block"
                }`}>
                <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                  <h2 className="text-lg font-semibold">Pending Review</h2>
                  <p className="text-sm text-zinc-700 dark:text-zinc-300">
                    {filteredPending.length === 0
                      ? "Nothing pending."
                      : `Showing ${Math.min(filteredPending.length, 50)} item(s).`}
                  </p>
                </div>

                {filteredPending.length === 0 ? (
                  <div className="mt-3 text-base text-zinc-700 dark:text-zinc-300">
                    Nothing pending.
                  </div>
                ) : (
                  <div className="mt-3 space-y-3">
                    {filteredPending.slice(0, 50).map((d) => (
                      <div
                        key={d.id}
                        className="rounded-2xl border border-zinc-200 bg-zinc-50 p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900/40">
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                          <div className="min-w-0 space-y-2">
                            <div className="flex flex-wrap gap-2">
                              <span
                                className={`${chipBase} ${typeChip(d.docType)}`}>
                                {d.docType.replaceAll("_", " ").toUpperCase()}
                              </span>
                              <span
                                className={`${chipBase} ${statusChip(
                                  String(d.status || "uploaded"),
                                )}`}>
                                {String(d.status || "uploaded").toUpperCase()}
                              </span>
                            </div>

                            <div className="text-lg font-extrabold break-words">
                              {displayName(d.uid)}
                            </div>

                            <div className="text-base text-zinc-800 dark:text-zinc-200 break-words">
                              {d.fileName}
                            </div>

                            <div className="text-sm text-zinc-700 dark:text-zinc-300">
                              {formatBytes(d.fileSize)} • Uploaded{" "}
                              <span className="font-semibold">
                                {formatDateTime(d.createdAt)}
                              </span>
                            </div>

                            <div className="text-sm text-zinc-600 dark:text-zinc-400 break-all">
                              UID: {d.uid}
                            </div>
                          </div>

                          <div className="flex flex-col gap-2 sm:items-end">
                            <a
                              href={d.downloadURL}
                              target="_blank"
                              rel="noreferrer"
                              className="h-12 inline-flex items-center justify-center rounded-xl border border-zinc-300 bg-white px-4 text-base font-extrabold text-blue-700 shadow-sm transition hover:bg-zinc-50 focus:outline-none focus:ring-4 focus:ring-zinc-200 dark:border-zinc-700 dark:bg-zinc-900 dark:text-blue-300 dark:hover:bg-zinc-800 dark:focus:ring-zinc-800">
                              View
                            </a>

                            <div className="grid grid-cols-2 gap-2 w-full sm:w-auto">
                              <button
                                onClick={() => setStatus(d.id, "approved")}
                                disabled={actingOn === d.id}
                                className="h-12 rounded-xl bg-emerald-700 px-4 text-base font-extrabold text-white shadow-sm transition hover:bg-emerald-800 focus:outline-none focus:ring-4 focus:ring-emerald-200 disabled:opacity-60 disabled:hover:bg-emerald-700 dark:focus:ring-emerald-900/40">
                                {actingOn === d.id ? "Working…" : "Approve"}
                              </button>

                              <button
                                onClick={() => setStatus(d.id, "rejected")}
                                disabled={actingOn === d.id}
                                className="h-12 rounded-xl bg-rose-700 px-4 text-base font-extrabold text-white shadow-sm transition hover:bg-rose-800 focus:outline-none focus:ring-4 focus:ring-rose-200 disabled:opacity-60 disabled:hover:bg-rose-700 dark:focus:ring-rose-900/40">
                                {actingOn === d.id ? "Working…" : "Reject"}
                              </button>
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}

                    {filteredPending.length > 50 && (
                      <div className="text-sm text-zinc-600 dark:text-zinc-400">
                        Showing first 50 pending items.
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Driver details */}
              <div
                className={`rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-950 ${
                  tab === "drivers" ? "block" : "hidden lg:block"
                }`}>
                <div className="space-y-1">
                  <h2 className="text-lg font-semibold">Driver Documents</h2>
                  <p className="text-base text-zinc-700 dark:text-zinc-300">
                    {selectedDriverUid
                      ? `Viewing: ${displayName(selectedDriverUid)}`
                      : "Select a driver to view their documents."}
                  </p>
                </div>

                {!selectedDriverUid && (
                  <div className="mt-3 text-base text-zinc-700 dark:text-zinc-300">
                    No driver selected.
                  </div>
                )}

                {selectedDriverUid && driverView && (
                  <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-3">
                    {REQUIRED.map((req) => {
                      const row = driverView.latest[req.type];
                      const missing = !row;

                      return (
                        <div
                          key={req.type}
                          className="rounded-2xl border border-zinc-200 bg-zinc-50 p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900/40">
                          <div className="flex items-start justify-between gap-3">
                            <div className="space-y-2">
                              <div className="text-base font-extrabold">
                                {req.label}
                              </div>

                              {missing ? (
                                <div className="text-base font-semibold text-amber-800 dark:text-amber-200">
                                  Missing
                                </div>
                              ) : (
                                <div className="space-y-1">
                                  <div className="text-sm text-zinc-700 dark:text-zinc-300 break-words">
                                    {row.fileName} • {formatBytes(row.fileSize)}
                                  </div>

                                  <div className="text-sm text-zinc-700 dark:text-zinc-300">
                                    Uploaded{" "}
                                    <span className="font-semibold">
                                      {formatDateTime(row.createdAt)}
                                    </span>{" "}
                                    • Status{" "}
                                    <span
                                      className={`${chipBase} ${statusChip(
                                        String(row.status || "uploaded"),
                                      )}`}>
                                      {String(
                                        row.status || "uploaded",
                                      ).toUpperCase()}
                                    </span>
                                  </div>
                                </div>
                              )}
                            </div>

                            {!missing && row ? (
                              <a
                                href={row.downloadURL}
                                target="_blank"
                                rel="noreferrer"
                                className="h-12 inline-flex items-center justify-center rounded-xl border border-zinc-300 bg-white px-4 text-base font-extrabold text-blue-700 shadow-sm transition hover:bg-zinc-50 focus:outline-none focus:ring-4 focus:ring-zinc-200 dark:border-zinc-700 dark:bg-zinc-900 dark:text-blue-300 dark:hover:bg-zinc-800 dark:focus:ring-zinc-800">
                                View
                              </a>
                            ) : null}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Mobile helper: if driver selected, show quick switch */}
              <div className="lg:hidden">
                {selectedDriverUid && (
                  <button
                    onClick={() => setTab("drivers")}
                    className="w-full h-12 rounded-xl bg-white text-zinc-950 ring-1 ring-zinc-300 px-4 text-base font-extrabold shadow-sm transition hover:bg-zinc-50 focus:outline-none focus:ring-4 focus:ring-zinc-200 dark:bg-zinc-900 dark:text-zinc-50 dark:ring-zinc-700 dark:hover:bg-zinc-800 dark:focus:ring-zinc-800">
                    Go to Driver Details
                  </button>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
