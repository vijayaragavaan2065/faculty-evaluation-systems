// src/SubmissionsList.jsx
import React, { useEffect, useState } from "react";
import SubmissionDetail from "./SubmissionDetail";

/**
 * SubmissionsList
 *
 * Props:
 *  - apiBase: string base url (default http://127.0.0.1:8000)
 *  - endpoint: optional full endpoint to fetch submissions from (overrides default /api/submissions/)
 *  - user: current user object (optional) - used when mineOnly is true or to pre-fill department for HOD
 *  - mineOnly: boolean, when true force filter by user.id/_id
 *  - showDeptSelect: boolean, when true show an editable Department dropdown (Director/Admin)
 *  - fixedDepartment: string|null - if provided, lock results to this department (useful for HOD)
 */
export default function SubmissionsList({
  apiBase = "http://127.0.0.1:8000",
  endpoint = null,
  user = null,
  mineOnly = false,
  showDeptSelect = false,
  fixedDepartment = null,
}) {
  const [submissions, setSubmissions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [department, setDepartment] = useState("");
  const [status, setStatus] = useState(""); // "", "submitted", "hod_verified", "finalized", "rejected"
  const [message, setMessage] = useState("");
  const [selectedId, setSelectedId] = useState(null);
  const [selectedEditable, setSelectedEditable] = useState(false);
  const [lastFetchUrl, setLastFetchUrl] = useState(null);

  // Determine current role (fallback to faculty)
  const role = (user?.role || "").toString().toLowerCase() || "faculty";

  // Roles that may verify/approve
  const HIGHER_ROLES = new Set(["hod", "director", "registrar", "office_head", "admin"]);

  // Authoritative department list
  const DEPARTMENTS = [
    "All Departments",
    "Artificial Intelligence & Data Science",
    "Biomedical Engineering",
    "Chemical Engineering",
    "Civil Engineering",
    "Computer Science and Engineering (AIML)",
    "Computer Science and Engineering (Cyber Security)",
    "Computer Science and Engineering (Business Systems)",
    "Electrical and Electronics Engineering",
    "Electronics and Communication Engineering",
    "Information Technology",
    "Mechanical Engineering",
  ];

  const STATUS_OPTIONS = [
    { label: "All", value: "" },
    { label: "Submitted", value: "submitted" },
    { label: "HOD Verified", value: "hod_verified" },
    { label: "Finalized", value: "finalized" },
    { label: "Rejected", value: "rejected" },
  ];

  // Robust token finder (looks in common localStorage keys and user object)
  function findAuthToken() {
    const keys = ["token", "access", "access_token", "auth_token"];
    for (const k of keys) {
      const v = localStorage.getItem(k);
      if (v) return v;
    }
    try {
      const uRaw = localStorage.getItem("user");
      if (uRaw) {
        const parsed = JSON.parse(uRaw);
        if (parsed?.token) return parsed.token;
        if (parsed?.access_token) return parsed.access_token;
      }
    } catch (e) {
      // ignore JSON parse errors
    }
    return null;
  }

  // Determine user id robustly: prefers _id, then id, then email
  function getUserId() {
    if (user) return user._id || user.id || user.email || null;
    try {
      const uRaw = localStorage.getItem("user");
      if (uRaw) {
        const parsed = JSON.parse(uRaw);
        return parsed?._id || parsed?.id || parsed?.email || null;
      }
    } catch (e) {}
    return null;
  }

  // Initialize department state from props or user
  useEffect(() => {
    if (fixedDepartment) {
      setDepartment(fixedDepartment);
    } else if (user?.department) {
      setDepartment(user.department);
    } else {
      setDepartment(""); // All Departments
    }
  }, [fixedDepartment, user?.department]);

  // Build URL with optional query params department and status and optional faculty_id
  function buildUrl() {
    const params = new URLSearchParams();

    // If mineOnly, pass faculty_id (prefer backend filtering by token if not available)
    if (mineOnly) {
      const uid = getUserId();
      if (uid) {
        params.set("faculty_id", uid);
      } else {
        console.warn("SubmissionsList: mineOnly true but user id not available — backend may infer user from token.");
      }
    }

    // If there is a fixedDepartment (HOD), prefer that
    const deptToUse = fixedDepartment ?? (department && department !== "All Departments" ? department : "");
    if (deptToUse) {
      params.set("department", deptToUse);
    }

    if (status) {
      params.set("status", status);
    }

    const qstr = params.toString();
    if (endpoint) {
      // endpoint may already contain query params
      if (!qstr) return endpoint;
      return endpoint + (endpoint.includes("?") ? "&" : "?") + qstr;
    }

    const base = `${apiBase.replace(/\/$/, "")}/api/submissions/`;
    return qstr ? `${base}?${qstr}` : base;
  }

  // Safe JSON parsing with fallback
  async function parseResponse(res) {
    try {
      const text = await res.text();
      try {
        return JSON.parse(text);
      } catch {
        return { raw: text };
      }
    } catch (e) {
      return {};
    }
  }

  async function load() {
    setLoading(true);
    setMessage("");
    try {
      const url = buildUrl();
      setLastFetchUrl(url);
      const token = findAuthToken();
      const headers = token ? { Authorization: "Bearer " + token, Accept: "application/json" } : { Accept: "application/json" };

      console.debug("[SubmissionsList] fetching", url, { headers });

      const res = await fetch(url, { headers, credentials: "include" });
      const body = await parseResponse(res);

      if (!res.ok) {
        const errMsg = body?.detail || body?.message || (body.raw ? body.raw : `Request failed (${res.status})`);
        setMessage("Error: " + errMsg);
        setSubmissions([]);
        console.error("[SubmissionsList] fetch failed", res.status, body);
        return;
      }

      // Accept several possible payload shapes
      const list = body.submissions ?? body.results ?? body.data ?? body.items ?? body ?? [];
      const normalized = Array.isArray(list) ? list : [];
      setSubmissions(normalized);
      if (!normalized.length) {
        console.info("[SubmissionsList] no submissions returned", url);
      }
    } catch (err) {
      console.error("[SubmissionsList] network error", err);
      setMessage("Network error: " + (err?.message || String(err)));
      setSubmissions([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    // Load whenever filters change
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [department, status, endpoint, mineOnly, user?.id, user?._id, fixedDepartment]);

  // Verify / approve handlers (only for higher roles)
  async function handleVerify(id, action) {
    if (!HIGHER_ROLES.has(role)) {
      setMessage("Not authorized to verify submissions.");
      return;
    }

    const comments = window.prompt(`Add comments for ${action} (optional):`, "");
    if (!window.confirm(`Confirm to ${action} this submission?`)) return;

    try {
      const token = findAuthToken();
      const headers = token ? { Authorization: "Bearer " + token } : {};
      const form = new FormData();
      form.append("action", action);
      if (comments) form.append("comments", comments);

      const res = await fetch(`${apiBase.replace(/\/$/, "")}/api/submissions/${encodeURIComponent(id)}/verify`, {
        method: "PATCH",
        headers,
        body: form,
        credentials: "include",
      });

      const body = await parseResponse(res);
      if (!res.ok) {
        const err = body?.detail || body?.message || (body.raw ? body.raw : `Verify failed (${res.status})`);
        throw new Error(err);
      }
      setMessage(`Submission ${action}d.`);
      await load();
    } catch (err) {
      console.error("[SubmissionsList] verify error", err);
      setMessage("Error: " + (err?.message || String(err)));
    }
  }

  function StatusBadge({ status: s }) {
    const normalized = (s || "").toString().toLowerCase();
    const color =
      normalized === "finalized" || normalized === "verified"
        ? "#28A745"
        : normalized === "rejected"
        ? "#DC3545"
        : normalized === "hod_verified"
        ? "#007BFF"
        : normalized === "submitted"
        ? "#FFC107"
        : "#9e9e9e";

    const label =
      normalized === "hod_verified" ? "HOD Verified" :
      normalized === "finalized" ? "Finalized" :
      normalized === "rejected" ? "Rejected" :
      normalized === "submitted" ? "Submitted" :
      s || "Unknown";

    return (
      <span style={{
        background: color, color: "#fff", padding: "4px 10px", borderRadius: 12,
        fontSize: 13, fontWeight: 700, textTransform: "capitalize", display: "inline-block"
      }}>
        {label}
      </span>
    );
  }

  // Determine if the current user can edit a submission:
  // - owner (faculty_user_id matches current user id)
  // - and submission is in an editable state (not approved/finalized/verified)
  const EDITABLE_STATUSES = new Set(["", "submitted", "rejected"]); // tweak as needed
  function canEditSubmission(submission) {
    const uid = getUserId();
    if (!uid) return false;
    const ownerId = submission.faculty_user_id || submission.user_id || submission.faculty_id || submission.owner_id || null;
    if (!ownerId) return false;
    // ownerId may be an ObjectId string; compare loosely
    if (ownerId.toString() !== uid.toString()) return false;
    const st = (submission?.status || "").toString().toLowerCase();
    return EDITABLE_STATUSES.has(st);
  }

  // Open submission detail modal in view or edit mode
  function openDetail(id, editable = false) {
    setSelectedId(id);
    setSelectedEditable(Boolean(editable));
  }

  // Close handler used by SubmissionDetail
  function handleCloseDetail() {
    setSelectedId(null);
    setSelectedEditable(false);
  }

  // Called when child detail reports an update (saved/edited)
  async function handleDetailUpdated() {
    setSelectedId(null);
    setSelectedEditable(false);
    await load();
  }

  function canShowVerifyButtonsFor(roleArg, submission) {
    const st = (submission?.status || "").toString().toLowerCase();
    if (!HIGHER_ROLES.has(roleArg)) return false;
    if (roleArg === "hod") return st === "submitted";
    if (roleArg === "registrar") return st === "hod_verified";
    if (roleArg === "director" || roleArg === "admin" || roleArg === "office_head") return st === "submitted" || st === "hod_verified";
    return false;
  }

  return (
    <div style={{ padding: 10 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, marginBottom: 12 }}>
        <div>
          <h3 style={{ margin: 0, color: "#205067", fontSize: 20 }}>Submissions</h3>
          <div style={{ color: "#617882", marginTop: 6, fontSize: 13 }}>
            {endpoint ? "Showing: Department submissions" : mineOnly ? "Showing: Your submissions" : "Showing: Submissions"}
            {lastFetchUrl ? ` — ${submissions.length} items` : ""}
          </div>
        </div>

        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <label style={{ color: "#617882", fontSize: 13 }}>Department</label>
            {fixedDepartment ? (
              <div style={{ padding: "8px 10px", borderRadius: 8, background: "#fff", color: "#182B1C", minWidth: 260, border: "1px solid #e0e6eb" }}>
                {fixedDepartment}
              </div>
            ) : showDeptSelect ? (
              <select
                value={department}
                onChange={(e) => setDepartment(e.target.value)}
                style={{ padding: "8px 10px", borderRadius: 8, background: "#fff", border: "1px solid #e0e6eb", color: "#182B1C", minWidth: 260 }}
              >
                <option value="">All Departments</option>
                {DEPARTMENTS.filter(d => d !== "All Departments").map((d) => (
                  <option key={d} value={d}>{d}</option>
                ))}
              </select>
            ) : (
              <div style={{ padding: "8px 10px", borderRadius: 8, background: "#fff", color: "#617882", minWidth: 260, border: "1px solid #e0e6eb" }}>
                {department || "All Departments"}
              </div>
            )}
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <label style={{ color: "#617882", fontSize: 13 }}>Status</label>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              style={{ padding: "8px 10px", borderRadius: 8, background: "#fff", border: "1px solid #e0e6eb", color: "#182B1C", minWidth: 160 }}
            >
              {STATUS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>

          <div style={{ display: "flex", alignItems: "flex-end" }}>
            <button
              onClick={() => load()}
              style={{
                padding: "8px 12px", borderRadius: 10, border: "none",
                background: "linear-gradient(90deg,#007BFF,#00C6FF)", color: "#fff", cursor: "pointer",
                fontWeight: 700, marginLeft: 8, height: 40,
              }}
            >
              Refresh
            </button>
          </div>
        </div>
      </div>

      {message && <div style={{ color: "#DC3545", marginBottom: 12 }}>{message}</div>}

      {loading ? (
        <div style={{ color: "#617882" }}>Loading submissions…</div>
      ) : submissions.length === 0 ? (
        <div style={{ color: "#617882" }}>No submissions found.</div>
      ) : (
        <div style={{ display: "grid", gap: 12 }}>
          {submissions.map((s) => {
            const key = s._id || s.id || JSON.stringify(s).slice(0, 10);
            // score display: try multiple shapes
            const scoreText =
              typeof s.score?.total === "number"
                ? `${s.score.total} / ${s.score.max ?? 100}`
                : typeof s.score === "number"
                ? `${s.score} / 100`
                : (s.score && typeof s.score === "string" ? s.score : "- /100");

            return (
              <div key={key} style={{
                borderRadius: 12, padding: 14, background: "#fff", border: "1px solid #e0e6eb",
                display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap",
                boxShadow: "0 4px 10px rgba(0,0,0,0.05)"
              }}>
                <div style={{ minWidth: 240 }}>
                  <div style={{ fontWeight: 800, color: "#205067", fontSize: 15 }}>
                    {s.faculty_name ? s.faculty_name : (s.faculty_rank ?? "-")} {s.academic_year ? `— ${s.academic_year}` : ""}
                  </div>
                  <div style={{ color: "#617882", marginTop: 6, fontSize: 13 }}>
                    Faculty ID: {s.faculty_user_id ?? s.user_id ?? "-"} • Dept: {s.department ?? "-"}
                  </div>
                </div>

                <div style={{ display: "flex", alignItems: "center", gap: 16, marginLeft: "auto" }}>
                  <div style={{ textAlign: "right", minWidth: 140 }}>
                    <div style={{ fontWeight: 800, color: "#205067", fontSize: 18 }}>
                      {scoreText}
                    </div>
                    <div style={{ marginTop: 6 }}>
                      <StatusBadge status={s.status ?? "unknown"} />
                    </div>
                  </div>

                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <button
                      onClick={() => openDetail(s._id || s.id, false)}
                      style={{
                        padding: "8px 12px", borderRadius: 10, border: "1px solid #e0e6eb", background: "#fff",
                        color: "#205067", cursor: "pointer", fontWeight: 700,
                      }}
                    >
                      View
                    </button>

                    {/* Edit: visible to the faculty owner when editable */}
                    {canEditSubmission(s) && (
                      <button
                        onClick={() => openDetail(s._id || s.id, true)}
                        title="Edit your submission"
                        style={{
                          padding: "8px 12px", borderRadius: 10, border: "none", background: "#0ea5a3", color: "#fff",
                          cursor: "pointer", fontWeight: 700,
                        }}
                      >
                        Edit
                      </button>
                    )}

                    {/* verify buttons for higher roles */}
                    {canShowVerifyButtonsFor(role, s) ? (
                      <>
                        <button onClick={() => handleVerify(s._id || s.id, "approve")} style={{
                          padding: "8px 12px", borderRadius: 10, border: "none", background: "#28a745", color: "#fff",
                          cursor: "pointer", fontWeight: 700,
                        }}>Approve</button>

                        <button onClick={() => handleVerify(s._id || s.id, "reject")} style={{
                          padding: "8px 12px", borderRadius: 10, border: "none", background: "#DC3545", color: "#fff",
                          cursor: "pointer", fontWeight: 700,
                        }}>Reject</button>
                      </>
                    ) : (
                      // when not showing verify buttons, show last action summary for finalized items
                      (s.finalized || s.status === "hod_verified" || s.status === "finalized" || s.status === "rejected") ? (
                        <div style={{ color: "#617882", fontSize: 12, textAlign: "right" }}>
                          <div>Last action by: {s.verified_history && s.verified_history.length ? s.verified_history[s.verified_history.length - 1].actor_name : (s.finalized_by?.name ?? s.verified_by?.name ?? "-")}</div>
                          <div style={{ marginTop: 4 }}>{s.finalized_at ? new Date(s.finalized_at).toLocaleString() : (s.verified_at ? new Date(s.verified_at).toLocaleString() : "")}</div>
                        </div>
                      ) : null
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {selectedId && (
        <SubmissionDetail
          apiBase={apiBase}
          id={selectedId}
          editable={selectedEditable}
          onClose={handleCloseDetail}
          onUpdated={handleDetailUpdated}
        />
      )}
    </div>
  );
}
