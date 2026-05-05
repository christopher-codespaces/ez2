"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { getAuth, onAuthStateChanged, User } from "firebase/auth";
import {
  getFirestore,
  collection,
  addDoc,
  serverTimestamp,
  query,
  where,
  orderBy,
  getDocs,
} from "firebase/firestore";
import { getStorage, ref, uploadBytes, getDownloadURL } from "firebase/storage";
import {
  ArrowLeft,
  CheckCircle2,
  AlertTriangle,
  UploadCloud,
  FileText,
  ShieldCheck,
  ExternalLink,
  Loader2,
} from "lucide-react";
import { app } from "@/lib/firebase";

/* ------------------ Brand tokens ------------------ */
const BRAND = {
  orange: "#F36C21",
  red: "#E02020",
  dark: "#0B1220",
};

type DocType =
  | "id"
  | "drivers_license"
  | "proof_of_address"
  | "vehicle_registration"
  | "police_clearance";

const REQUIRED_DOCS: { type: DocType; label: string; hint: string }[] = [
  { type: "id", label: "ID / Passport", hint: "Clear photo or PDF." },
  {
    type: "drivers_license",
    label: "Driver’s License",
    hint: "Front + back in one file.",
  },
  {
    type: "proof_of_address",
    label: "Proof of Address",
    hint: "Recent utility bill or bank statement.",
  },
  {
    type: "vehicle_registration",
    label: "Vehicle Registration",
    hint: "Vehicle registration document.",
  },
  {
    type: "police_clearance",
    label: "Police Clearance",
    hint: "PDF only, proof of no criminal record.",
  },
];

type DriverDocRow = {
  id: string;
  uid: string;
  docType: DocType;
  fileName: string;
  fileType: string;
  fileSize: number;
  storagePath: string;
  downloadURL: string;
  status: string;
  createdAt?: Date | null;
};

const formatBytes = (bytes: number) => {
  const mb = bytes / (1024 * 1024);
  return mb >= 1 ? `${mb.toFixed(1)} MB` : `${(bytes / 1024).toFixed(0)} KB`;
};

const formatDateTime = (d?: Date | null) => (d ? d.toLocaleString() : "—");

const StatusBadge = ({ ok }: { ok: boolean }) =>
  ok ? (
    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 text-emerald-700 px-3 py-1 text-xs font-semibold">
      <CheckCircle2 className="h-4 w-4" />
      Uploaded
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 rounded-full bg-orange-50 text-orange-700 px-3 py-1 text-xs font-semibold">
      <AlertTriangle className="h-4 w-4" />
      Required
    </span>
  );

export default function DriverDocumentsPage() {
  const router = useRouter();

  const auth = useMemo(() => (app ? getAuth(app) : null), []);
  const db = useMemo(() => (app ? getFirestore(app) : null), []);
  const storage = useMemo(() => (app ? getStorage(app) : null), []);

  const [user, setUser] = useState<User | null>(null);
  const [docs, setDocs] = useState<DriverDocRow[]>([]);
  const [loadingDocs, setLoadingDocs] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [files, setFiles] = useState<Partial<Record<DocType, File | null>>>({});
  const [uploading, setUploading] = useState<Partial<Record<DocType, boolean>>>(
    {},
  );
  const [uploadErrors, setUploadErrors] = useState<
    Partial<Record<DocType, string>>
  >({});

  useEffect(() => {
    if (!auth || !db) return;

    const unsub = onAuthStateChanged(auth, async (u) => {
      if (!u) return router.push("/login");
      setUser(u);

      const q = query(
        collection(db, "driverDocuments"),
        where("uid", "==", u.uid),
        orderBy("createdAt", "desc"),
      );

      const snap = await getDocs(q);
      setDocs(
        snap.docs.map((d) => {
          const data = d.data() as any;
          return {
            id: d.id,
            ...data,
            createdAt: data.createdAt?.toDate?.() ?? null,
          };
        }),
      );
      setLoadingDocs(false);
    });

    return () => unsub();
  }, [auth, db, router]);

  const latestByType = useMemo(() => {
    const map: Partial<Record<DocType, DriverDocRow>> = {};
    docs.forEach((d) => {
      if (!map[d.docType]) map[d.docType] = d;
    });
    return map;
  }, [docs]);

  const completed = Object.keys(latestByType).length;
  const progress = Math.round((completed / REQUIRED_DOCS.length) * 100);

  const handleUpload = async (docType: DocType) => {
    if (!auth || !db || !storage) return;
    const u = auth.currentUser;
    if (!u) return;

    const file = files[docType];
    if (!file) return;

    // Clear previous error for this doc type
    setUploadErrors((prev) => {
      const next = { ...prev };
      delete next[docType];
      return next;
    });

    // Validate file size (max 10MB)
    const MAX_SIZE = 10 * 1024 * 1024; // 10MB
    if (file.size > MAX_SIZE) {
      setUploadErrors((prev) => ({
        ...prev,
        [docType]: "File exceeds size limit (10MB)",
      }));
      return;
    }

    setUploading((m) => ({ ...m, [docType]: true }));

    try {
      const path =
        docType === "police_clearance"
          ? `drivers/${u.uid}/documents/police_clearance.pdf`
          : `driver-documents/${u.uid}/${docType}/${Date.now()}_${file.name}`;
      const storageRef = ref(storage, path);

      await uploadBytes(storageRef, file);
      const url = await getDownloadURL(storageRef);

      await addDoc(collection(db, "driverDocuments"), {
        uid: u.uid,
        docType,
        fileName: file.name,
        fileType: file.type,
        fileSize: file.size,
        storagePath: path,
        downloadURL: url,
        status: "uploaded",
        createdAt: serverTimestamp(),
      });

      setFiles((f) => ({ ...f, [docType]: null }));
      setUploading((m) => ({ ...m, [docType]: false }));
    } catch (err: any) {
      console.error(err);
      setUploadErrors((prev) => ({
        ...prev,
        [docType]: err?.message || "Upload failed. Please try again.",
      }));
      setUploading((m) => ({ ...m, [docType]: false }));
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 py-8 px-4">
      <div className="max-w-5xl mx-auto space-y-8">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1
              className="text-3xl font-semibold text-gray-900 dark:text-slate-100
">
              Driver Documents
            </h1>
            <p className="text-sm text-gray-600 mt-1">
              Upload documents to verify and activate your account
            </p>
          </div>

          <button
            onClick={() => router.push("/driver")}
            className="flex items-center gap-2 text-sm font-medium text-gray-700 hover:text-gray-900 dark:text-slate-100
">
            <ArrowLeft size={18} />
            Back
          </button>
        </div>

        {/* Progress card */}
        <div className="rounded-3xl bg-white border p-6 shadow-sm">
          <div className="flex items-center justify-between">
            <div>
              <p
                className="text-sm font-semibold text-gray-900 dark:text-slate-100
">
                Verification progress
              </p>
              <p className="text-xs text-gray-600 mt-1">
                {completed} of {REQUIRED_DOCS.length} documents uploaded
              </p>
            </div>
            <span className="text-xl font-semibold">{progress}%</span>
          </div>

          <div className="mt-4 h-3 bg-gray-100 rounded-full overflow-hidden">
            <div
              className="h-full rounded-full transition-all"
              style={{
                width: `${progress}%`,
                backgroundColor: BRAND.orange,
              }}
            />
          </div>

          <div className="mt-3 flex items-center gap-2 text-xs text-gray-600">
            <ShieldCheck size={16} />
            Your documents are encrypted and securely stored
          </div>
        </div>

        {/* Document cards */}
        {!loadingDocs && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {REQUIRED_DOCS.map(({ type, label, hint }) => {
              const latest = latestByType[type];
              const isUploaded = !!latest;

              return (
                <div
                  key={type}
                  className="rounded-3xl bg-white border p-6 shadow-sm space-y-4">
                  <div className="flex items-start justify-between">
                    <div>
                      <h3
                        className="text-lg font-semibold text-gray-900 dark:text-slate-100
">
                        {label}
                      </h3>
                      <p className="text-sm text-gray-600 mt-1">{hint}</p>
                    </div>
                    <StatusBadge ok={isUploaded} />
                  </div>

                  {isUploaded && latest && (
                    <div className="rounded-xl bg-gray-50 border p-4 text-sm">
                      <p
                        className="font-medium text-gray-900 dark:text-slate-100
">
                        {latest.fileName}
                      </p>
                      <p className="text-xs text-gray-600 mt-1">
                        {formatBytes(latest.fileSize)} • Uploaded{" "}
                        {formatDateTime(latest.createdAt)}
                      </p>
                      <a
                        href={latest.downloadURL}
                        target="_blank"
                        className="inline-flex items-center gap-1 text-sm text-orange-600 mt-2 hover:underline">
                        View file <ExternalLink size={14} />
                      </a>
                    </div>
                  )}

                  <div>
                    <input
                      type="file"
                      onChange={(e) => {
                        setUploadErrors((prev) => {
                          const next = { ...prev };
                          delete next[type];
                          return next;
                        });
                        setFiles((f) => ({
                          ...f,
                          [type]: e.target.files?.[0] ?? null,
                        }));
                      }}
                      className="w-full text-sm file:mr-3 file:rounded-xl file:border-0 file:bg-gray-100 file:px-4 file:py-2 file:text-sm file:font-medium file:text-gray-700 hover:file:bg-gray-200"
                    />
                    {uploadErrors[type] && (
                      <p className="mt-2 text-sm text-red-600">
                        {uploadErrors[type]}
                      </p>
                    )}
                  </div>

                  <button
                    onClick={() => handleUpload(type)}
                    disabled={uploading[type]}
                    className="w-full flex items-center justify-center gap-2 rounded-xl py-3 text-sm font-semibold text-white transition"
                    style={{
                      backgroundColor: uploading[type]
                        ? "#9CA3AF"
                        : BRAND.orange,
                    }}>
                    {uploading[type] ? (
                      <>
                        <Loader2 className="animate-spin" size={16} />
                        Uploading…
                      </>
                    ) : (
                      <>
                        <UploadCloud size={16} />
                        {isUploaded ? "Replace document" : "Upload document"}
                      </>
                    )}
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
