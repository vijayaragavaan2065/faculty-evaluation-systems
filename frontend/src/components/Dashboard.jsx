// src/components/Dashboard.jsx
import React, { useEffect, useState } from "react";
import SubmissionForm from "../SubmissionForm";
import SubmissionsList from "../SubmissionsList";
import "./Dashboard.css";

/**
 * Updated Dashboard.jsx
 * - more resilient auth header extraction (token keys)
 * - includes credentials: 'include' (in case backend uses cookie-based auth)
 * - detailed logging of response body when non-200 (helpful for debugging 400)
 * - user-friendly statsError with guidance
 */

function StatCard({ title, value, icon }) {
  return (
    <div className="stat-card">
      <div className="stat-row">
        <div className="stat-icon">{icon}</div>
        <div>
          <div className="stat-title">{title}</div>
          <div className="stat-value">{value}</div>
        </div>
      </div>
    </div>
  );
}

/** try to locate a token in the common localStorage keys */
function findAuthToken() {
  // try several keys that might be used in your app
  const keys = ["token", "access", "access_token", "auth_token"];
  for (const k of keys) {
    const v = localStorage.getItem(k);
    if (v) return v;
  }
  // fallback: maybe app stored whole user object with token
  try {
    const u = localStorage.getItem("user");
    if (u) {
      const parsed = JSON.parse(u);
      if (parsed?.token) return parsed.token;
      if (parsed?.access_token) return parsed.access_token;
    }
  } catch (e) {
    // ignore JSON parse errors
  }
  return null;
}

export default function Dashboard({ apiBase = "http://127.0.0.1:8000", user }) {
  const [showNewForm, setShowNewForm] = useState(false);
  const [view, setView] = useState("dashboard");
  const [stats, setStats] = useState({ total: 0, avgScore: "—", pending: 0, approved: 0 });
  const [loadingStats, setLoadingStats] = useState(false);
  const [statsError, setStatsError] = useState("");

  // helper to create headers (bearer token if found)
  function buildHeaders() {
    const token = findAuthToken();
    const headers = { Accept: "application/json" };
    if (token) headers.Authorization = "Bearer " + token;
    return headers;
  }

  async function loadStats() {
    setLoadingStats(true);
    setStatsError("");
    try {
      const headers = buildHeaders();

      // make the request and include credentials in case the backend uses cookie auth
      const res = await fetch(`${apiBase.replace(/\/$/, "")}/api/submissions/stats`, {
        method: "GET",
        headers,
        credentials: "include",
      });

      // try to parse JSON body if present (for both ok and error cases)
      let body = null;
      try {
        body = await res.json().catch(() => null);
      } catch (e) {
        // non-json body fallback
        try {
          body = await res.text();
        } catch (err) {
          body = null;
        }
      }

      if (!res.ok) {
        // helpful console logging for debugging: status + body
        console.error("GET /api/submissions/stats failed:", res.status, body);
        // Provide helpful message depending on status
        if (res.status === 400) {
          setStatsError(
            "Bad request while fetching stats (400). Check backend logs — often caused by missing/invalid auth or missing query params."
          );
        } else if (res.status === 401 || res.status === 403) {
          setStatsError(
            "Not authorized (401/403). Please sign in again. If you recently logged in, ensure your token is stored in localStorage under 'token' or 'access'."
          );
        } else {
          setStatsError(
            `Failed to load stats (${res.status}). See console for server response.`
          );
        }
        // optional: display server-provided message (if present)
        if (body && typeof body === "object" && body.detail) {
          // append backend detail for convenience
          setStatsError((prev) => prev + " — " + body.detail);
        }
        // reset stats to safe defaults
        setStats({ total: 0, avgScore: "—", pending: 0, approved: 0 });
        return;
      }

      // success
      const d = body || {};
      setStats({
        total: d.total_submissions ?? 0,
        avgScore: d.avg_score ? `${d.avg_score} / 100` : "—",
        pending: d.pending_reviews ?? 0,
        approved: d.approved ?? 0,
      });
    } catch (err) {
      console.error("loadStats: network or parsing error:", err);
      setStatsError("Network or parsing error while loading stats. Check console for details.");
      setStats({ total: 0, avgScore: "—", pending: 0, approved: 0 });
    } finally {
      setLoadingStats(false);
    }
  }

  useEffect(() => {
    if (user) loadStats();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  const role = (user?.role || "faculty").toString().toLowerCase();

  const actions =
    role === "faculty"
      ? [
          { label: "New Form", view: "new-form", style: "mix" },
          { label: "My Submissions", view: "my-submissions", style: "green" },
          { label: "Upload Proofs", view: "upload-proofs", style: "mix" },
          { label: "AI Feedback", view: "ai-feedback", style: "green" },
        ]
      : role === "hod"
      ? [
          { label: "New Form", view: "new-form", style: "mix" },
          { label: "My Submissions", view: "my-submissions", style: "green" },
          { label: "Department Submissions", view: "department-submissions", style: "mix" },
          { label: "Department AI Analysis", view: "department-ai", style: "green" },
        ]
      : [
          { label: "Department Submissions", view: "department-submissions", style: "mix" },
          { label: "AI Insights Dashboard", view: "ai-insights", style: "green" },
          { label: "Reports & Analytics", view: "reports", style: "mix" },
          { label: "User Management", view: "user-management", style: "green" },
        ];

  const buttonClass = (s) =>
    s === "blue" ? "action-btn btn-gradient-blue" : s === "green" ? "action-btn btn-gradient-green" : "action-btn btn-gradient-mix";

  return (
    <div className="dashboard-root">
      <div className="dashboard-header">
        <div className="greeting">
          <h1>
            {role === "faculty"
              ? `Welcome, ${user?.name ?? "Faculty"}`
              : role === "hod"
              ? `${user?.department ?? "Department"} • HOD Dashboard`
              : `${user?.university ?? "University"} • Admin Dashboard`}
          </h1>
          <p className="subtitle">
            {role === "faculty"
              ? `Academic Year ${user?.academic_year ?? ""}`
              : role === "hod"
              ? `HOD: ${user?.name ?? ""}`
              : `Registrar / Admin: ${user?.name ?? ""}`}
          </p>
        </div>
      </div>

      <div className="stats-row">
        <StatCard title="Total Submissions" value={loadingStats ? "…" : stats.total} icon={<span className="dot blue" />} />
        <StatCard title="Average AI Score" value={loadingStats ? "…" : stats.avgScore} icon={<span className="dot teal" />} />
        <StatCard title={role === "faculty" ? "Pending Reviews" : "Pending Approvals"} value={loadingStats ? "…" : stats.pending} icon={<span className="dot amber" />} />
        <StatCard title={role === "faculty" ? "Approved Submissions" : "Approved KPI Forms"} value={loadingStats ? "…" : stats.approved} icon={<span className="dot green" />} />
      </div>

      {statsError && <div className="form-msg err" role="status">{statsError}</div>}

      <div className="quick-actions-large">
        {actions.map((a) => (
          <button
            key={a.view}
            className={buttonClass(a.style)}
            onClick={() => {
              if (a.view === "new-form") setShowNewForm(true);
              else setView(a.view);
            }}
          >
            {a.label}
          </button>
        ))}
      </div>

      <div className="panel">
        {view === "my-submissions" && (
          <div className="panel-content">
            <div className="panel-title">My Submissions</div>
            <SubmissionsList apiBase={apiBase} user={user} mineOnly />
          </div>
        )}

        {view === "department-submissions" && (
          <div className="panel-content">
            <div className="panel-title">Department Submissions</div>

            {role === "hod" ? (
              <SubmissionsList apiBase={apiBase} user={user} fixedDepartment={user?.department ?? ""} />
            ) : (
              <SubmissionsList apiBase={apiBase} showDeptSelect={true} />
            )}
          </div>
        )}

        {view === "upload-proofs" && (
          <div className="panel-content">
            <div className="panel-title">Upload Proofs</div>
            <div className="placeholder">Upload UI coming soon.</div>
          </div>
        )}

        {view === "ai-feedback" && (
          <div className="panel-content">
            <div className="panel-title">AI Feedback</div>
            <div className="placeholder">AI insights will appear here.</div>
          </div>
        )}

        {view === "department-ai" && (
          <div className="panel-content">
            <div className="panel-title">Department AI Analysis</div>
            <div className="placeholder">Department-level AI analytics will appear here.</div>
          </div>
        )}

        {view === "ai-insights" && (
          <div className="panel-content">
            <div className="panel-title">AI Insights Dashboard</div>
            <div className="placeholder">Global AI analytics will appear here.</div>
          </div>
        )}

        {view === "reports" && (
          <div className="panel-content">
            <div className="panel-title">Reports & Analytics</div>
            <div className="placeholder">Exportable reports coming soon.</div>
          </div>
        )}

        {view === "user-management" && (
          <div className="panel-content">
            <div className="panel-title">User Management</div>
            <div className="placeholder">Manage faculty/HOD accounts here.</div>
          </div>
        )}
      </div>

      {showNewForm && (
        <SubmissionForm
          apiBase={apiBase}
          onSubmitted={() => {
            setShowNewForm(false);
            setView("my-submissions");
            loadStats();
          }}
          onCancel={() => setShowNewForm(false)}
        />
      )}
    </div>
  );
}
