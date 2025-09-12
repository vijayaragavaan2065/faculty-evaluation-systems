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
 *  - mineOnly: boolean, when true force filter by user.id
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
  const [department, setDepartment] = useState(fixedDepartment ?? "");
  const [status, setStatus] = useState(""); // "", "submitted", "hod_verified", "finalized", "rejected"
  const [message, setMessage] = useState("");
  const [selectedId, setSelectedId] = useState(null);

  const token = localStorage.getItem("token");

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

  // Determine current role (fallback to faculty)
  const role = (user?.role || "").toString().toLowerCase() || "faculty";

  // Roles that may verify/approve (HOD, Registrar, Director, Office Head, Admin)
  const HIGHER_ROLES = new Set(["hod", "director", "registrar", "office_head", "admin"]);

  // Build URL with optional query params department and status and optional faculty_id
  function buildUrl() {
    const params = new URLSearchParams();

    if (mineOnly && user?.id) {
      params.set("faculty_id", user.id);
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

  async function fetchJsonSafe(res) {
    try {
      const txt = await res.text();
      try {
        return JSON.parse(txt);
      } catch {
        return { raw: txt };
      }
    } catch {
      return {};
    }
  }

  async function load() {
    setLoading(true);
    setMessage("");
    try {
      const url = buildUrl();
      const headers = token ? { Authorization: "Bearer " + token } : {};
      const res = await fetch(url, { headers });
      const body = await fetchJsonSafe(res);
      if (!res.ok) {
        const errMsg = body?.detail || body?.message || (body.raw ? body.raw : `Request failed (${res.status})`);
        setMessage("Error: " + errMsg);
        setSubmissions([]);
        return;
      }
      const list = body.submissions ?? body.results ?? body.data ?? body ?? [];
      setSubmissions(Array.isArray(list) ? list : []);
    } catch (err) {
      setMessage("Error: " + (err?.message || String(err)));
      setSubmissions([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    // When fixedDepartment prop changes (HOD load), set local department
    if (fixedDepartment) setDepartment(fixedDepartment);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fixedDepartment]);

  useEffect(() => {
    load();
    // run when department or status changes, or endpoint / mineOnly / user changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [department, status, endpoint, mineOnly, user?.id, fixedDepartment]);

  async function handleVerify(id, action) {
    // Only allow higher roles to call this (defensive check)
    if (!HIGHER_ROLES.has(role)) {
      setMessage("Not authorized to verify submissions.");
      return;
    }

    const comments = window.prompt(`Add comments for ${action} (optional):`, "");
    if (!window.confirm(`Confirm to ${action} this submission?`)) return;
    try {
      const form = new FormData();
      form.append("action", action);
      if (comments) form.append("comments", comments);

      const headers = token ? { Authorization: "Bearer " + token } : {};
      const res = await fetch(`${apiBase.replace(/\/$/, "")}/api/submissions/${encodeURIComponent(id)}/verify`, {
        method: "PATCH",
        headers,
        body: form,
      });

      const body = await fetchJsonSafe(res);
      if (!res.ok) {
        const errMsg = body?.detail || body?.message || (body.raw ? body.raw : `Verify failed (${res.status})`);
        throw new Error(errMsg);
      }

      setMessage(`Submission ${action}d.`);
      await load();
    } catch (err) {
      setMessage("Error: " + (err?.message || String(err)));
    }
  }

  function StatusBadge({ status }) {
    const normalized = (status || "").toString().toLowerCase();
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
      status || "unknown";

    return (
      <span
        style={{
          background: color,
          color: "#fff",
          padding: "4px 10px",
          borderRadius: 12,
          fontSize: 13,
          fontWeight: 700,
          textTransform: "capitalize",
          display: "inline-block",
        }}
      >
        {label}
      </span>
    );
  }

  function canShowVerifyButtonsFor(roleArg, submission) {
    const st = (submission?.status || "").toString().toLowerCase();
    if (!HIGHER_ROLES.has(roleArg)) return false;
    if (roleArg === "hod") {
      return st === "submitted";
    }
    if (roleArg === "registrar") {
      return st === "hod_verified";
    }
    if (roleArg === "director" || roleArg === "admin" || roleArg === "office_head") {
      return st === "submitted" || st === "hod_verified";
    }
    return false;
  }

  return (
    <div style={{ padding: 10 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, marginBottom: 12 }}>
        <div>
          <h3 style={{ margin: 0, color: "#205067", fontSize: 20 }}>Submissions</h3>
          <div style={{ color: "#617882", marginTop: 6, fontSize: 13 }}>
            {endpoint ? "Showing: Department submissions" : mineOnly ? "Showing: Your submissions" : "Showing: Submissions"}
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
                style={{
                  padding: "8px 10px",
                  borderRadius: 8,
                  background: "#fff",
                  border: "1px solid #e0e6eb",
                  color: "#182B1C",
                  minWidth: 260,
                }}
              >
                <option value="">All Departments</option>
                {DEPARTMENTS.filter((d) => d !== "All Departments").map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
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
              style={{
                padding: "8px 10px",
                borderRadius: 8,
                background: "#fff",
                border: "1px solid #e0e6eb",
                color: "#182B1C",
                minWidth: 160,
              }}
            >
              {STATUS_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>

          <div style={{ display: "flex", alignItems: "flex-end" }}>
            <button
              onClick={() => load()}
              style={{
                padding: "8px 12px",
                borderRadius: 10,
                border: "none",
                background: "linear-gradient(90deg,#007BFF,#00C6FF)",
                color: "#fff",
                cursor: "pointer",
                fontWeight: 700,
                marginLeft: 8,
                height: 40,
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
          {submissions.map((s) => (
            <div
              key={s.id}
              style={{
                borderRadius: 12,
                padding: 14,
                background: "#fff",
                border: "1px solid #e0e6eb",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: 12,
                flexWrap: "wrap",
                boxShadow: "0 4px 10px rgba(0,0,0,0.05)",
              }}
            >
              <div style={{ minWidth: 240 }}>
                <div style={{ fontWeight: 800, color: "#205067", fontSize: 15 }}>
                  {s.faculty_name ? s.faculty_name : s.faculty_rank ?? "-"} {s.academic_year ? `— ${s.academic_year}` : ""}
                </div>

                <div style={{ color: "#617882", marginTop: 6, fontSize: 13 }}>
                  Faculty ID: {s.faculty_user_id ?? "-"} • Dept: {s.department ?? "-"}
                </div>
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: 16, marginLeft: "auto" }}>
                <div style={{ textAlign: "right", minWidth: 140 }}>
                  <div style={{ fontWeight: 800, color: "#205067", fontSize: 18 }}>
                    {typeof s.score?.total === "number" ? `${s.score.total} / 100` : typeof s.score === "number" ? `${s.score} / 100` : "- /100"}
                  </div>
                  <div style={{ marginTop: 6 }}>
                    <StatusBadge status={s.status ?? "unknown"} />
                  </div>
                </div>

                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <button
                    onClick={() => setSelectedId(s.id)}
                    style={{
                      padding: "8px 12px",
                      borderRadius: 10,
                      border: "1px solid #e0e6eb",
                      background: "#fff",
                      color: "#205067",
                      cursor: "pointer",
                      fontWeight: 700,
                    }}
                  >
                    View
                  </button>

                  {canShowVerifyButtonsFor(role, s) ? (
                    <>
                      <button
                        onClick={() => handleVerify(s.id, "approve")}
                        style={{
                          padding: "8px 12px",
                          borderRadius: 10,
                          border: "none",
                          background: "#28a745",
                          color: "#fff",
                          cursor: "pointer",
                          fontWeight: 700,
                        }}
                      >
                        Approve
                      </button>
                      <button
                        onClick={() => handleVerify(s.id, "reject")}
                        style={{
                          padding: "8px 12px",
                          borderRadius: 10,
                          border: "none",
                          background: "#DC3545",
                          color: "#fff",
                          cursor: "pointer",
                          fontWeight: 700,
                        }}
                      >
                        Reject
                      </button>
                    </>
                  ) : (
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
          ))}
        </div>
      )}

      {selectedId && (
        <SubmissionDetail
          apiBase={apiBase}
          id={selectedId}
          onClose={() => setSelectedId(null)}
          onUpdated={() => {
            setSelectedId(null);
            load();
          }}
        />
      )}
    </div>
  );
}
