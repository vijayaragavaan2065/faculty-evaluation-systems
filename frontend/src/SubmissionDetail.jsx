// src/SubmissionDetail.jsx
import { useEffect, useState } from "react";
import SubmissionForm from "./SubmissionForm";

export default function SubmissionDetail({ apiBase = "http://127.0.0.1:8000", id, onClose, onUpdated }) {
  const [submission, setSubmission] = useState(null);
  const [loading, setLoading] = useState(false);
  const [userRole, setUserRole] = useState("faculty"); // fetched profile role
  const [currentUserId, setCurrentUserId] = useState(null);
  const [showEdit, setShowEdit] = useState(false);
  const token = localStorage.getItem("token");

  // roles allowed to verify
  const HIGHER_ROLES = new Set(["hod", "director", "registrar", "office_head", "admin"]);

  // fetch profile to determine role and id
  useEffect(() => {
    async function fetchProfile() {
      if (!token) return;
      try {
        const res = await fetch(`${apiBase.replace(/\/$/,"")}/api/users/me`, {
          headers: { Authorization: "Bearer " + token },
        });
        if (!res.ok) return;
        const data = await res.json();
        if (data && data.role) setUserRole(String(data.role).toLowerCase());
        // accept common id shapes
        if (data) setCurrentUserId(data._id ?? data.id ?? data.email ?? null);
      } catch (e) {
        console.warn("Profile fetch failed", e);
      }
    }
    fetchProfile();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  // load submission
  useEffect(() => {
    if (!id) return;
    setLoading(true);
    (async () => {
      try {
        const res = await fetch(`${apiBase.replace(/\/$/,"")}/api/submissions/${encodeURIComponent(id)}`, {
          headers: token ? { Authorization: "Bearer " + token } : {},
        });
        if (!res.ok) {
          const text = await res.text();
          let body = {};
          try { body = JSON.parse(text); } catch (e) { body = { detail: text }; }
          throw new Error(body.detail || `Fetch failed: ${res.status}`);
        }
        const data = await res.json();
        setSubmission(data);
      } catch (err) {
        setSubmission({ error: err.message });
      } finally {
        setLoading(false);
      }
    })();
  }, [id, token, apiBase]);

  if (!id) return null;

  // parse computed totals from server if present, otherwise derive from submission.score
  function getComputed() {
    if (!submission) return null;
    if (submission.section_totals_json) {
      try {
        const parsed = typeof submission.section_totals_json === "string" ? JSON.parse(submission.section_totals_json) : submission.section_totals_json;
        return parsed;
      } catch (e) {
        return null;
      }
    }
    // fallback: use submission.score
    return submission.score || null;
  }
  const computed = getComputed();

  // determine whether the current user is the owner of this submission
  function isOwner() {
    if (!submission || !currentUserId) return false;
    const ownerCandidates = [
      submission.faculty_user_id,
      submission.faculty_id,
      submission.faculty_user?._id,
      submission.faculty_user?.id,
      submission.user_id,
      submission.user?._id,
      submission.user?.id,
      submission.faculty_user_email,
      submission.faculty_email,
    ];
    for (const c of ownerCandidates) {
      if (!c) continue;
      if (String(c) === String(currentUserId)) return true;
      // if currentUserId is email and c is email string
      if (typeof c === "string" && currentUserId && currentUserId.includes("@") && c === currentUserId) return true;
    }
    return false;
  }

  // show edit button when user is owner or admin and submission is not finalized/rejected
  function canEdit() {
    if (!submission) return false;
    const notEditableWhen = ["rejected", "finalized"];
    if (notEditableWhen.includes(String(submission.status).toLowerCase())) return false;
    // owner can edit
    if (isOwner()) return true;
    // higher roles optionally allowed to edit - currently allow admin/higher to edit
    if (HIGHER_ROLES.has(userRole)) return true;
    return false;
  }

  // approve/reject
  async function verify(action) {
    if (!HIGHER_ROLES.has(userRole)) {
      alert("Not authorized to verify submissions.");
      return;
    }
    if (!confirm(`Confirm ${action}?`)) return;
    const comments = prompt("Optional comments", "");
    const form = new FormData();
    form.append("action", action);
    if (comments) form.append("comments", comments);
    try {
      const res = await fetch(`${apiBase.replace(/\/$/,"")}/api/submissions/${encodeURIComponent(id)}/verify`, {
        method: "PATCH",
        headers: token ? { Authorization: "Bearer " + token } : {},
        body: form,
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.detail || JSON.stringify(body));
      // refresh
      await refresh();
      if (onUpdated) onUpdated();
    } catch (e) {
      alert("Error: " + e.message);
    }
  }

  async function refresh() {
    if (!id) return;
    setLoading(true);
    try {
      const res = await fetch(`${apiBase.replace(/\/$/,"")}/api/submissions/${encodeURIComponent(id)}`, {
        headers: token ? { Authorization: "Bearer " + token } : {},
      });
      if (res.ok) {
        const data = await res.json();
        setSubmission(data);
      } else {
        const text = await res.text();
        let body = {};
        try { body = JSON.parse(text); } catch (e) { body = { detail: text }; }
        throw new Error(body.detail || `Refresh failed: ${res.status}`);
      }
    } catch (e) {
      console.warn("refresh error", e);
    } finally {
      setLoading(false);
    }
  }

  async function downloadPDF() {
    try {
      const res = await fetch(`${apiBase}/api/submissions/${id}/kpi-pdf`, {
        headers: { Authorization: "Bearer " + token }
      });
      if (!res.ok) throw new Error("Failed to download PDF");
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "kpi-report.pdf";
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch (e) {
      alert("PDF download failed");
    }
  }

  // helper to compute proof URL reliably
  function proofUrl(fileMeta = {}) {
    if (!fileMeta) return null;
    const dl = fileMeta.download_url ?? fileMeta.url ?? fileMeta.file_url;
    if (dl) {
      if (dl.startsWith("http://") || dl.startsWith("https://")) return dl;
      return apiBase.replace(/\/$/,"") + dl;
    }
    if (fileMeta.stored_filename) {
      return apiBase.replace(/\/$/,"") + "/uploads/" + encodeURIComponent(fileMeta.stored_filename);
    }
    if (fileMeta.original_filename && fileMeta.path) {
      return apiBase.replace(/\/$/,"") + fileMeta.path;
    }
    return null;
  }

  function collectGlobalProofs() {
  if (!submission) return [];
  const arr = [];
  if (submission.file_meta) arr.push(Array.isArray(submission.file_meta) ? submission.file_meta : submission.file_meta);
  const candidates = ["proofs","files","attachments","proof_files"];
  for (const k of candidates) {
    const v = submission[k];
    if (Array.isArray(v)) arr.push(v);
  }
  return arr.flat().filter(Boolean).map((p) => (typeof p === "string" ? { name: p, url: null } : p));
}

  function collectActivityProofs() {
    if (!submission) return {};
    const out = {};
    for (let i = 1; i <= 20; i++) {
      const key = `proof_row_${i}`;
      if (Array.isArray(submission[key]) && submission[key].length) {
        out[i] = submission[key].map((p) => (typeof p === "string" ? { name: p, url: null } : p));
      }
    }
    if (submission.activity_proofs && typeof submission.activity_proofs === "object") {
      Object.entries(submission.activity_proofs).forEach(([r, arr]) => {
        if (Array.isArray(arr)) out[r] = (out[r] || []).concat(arr.map((p) => (typeof p === "string" ? { name: p, url: null } : p)));
      });
    }
    return out;
  }

  const globalProofs = collectGlobalProofs();
  const activityProofs = collectActivityProofs();

  return (
    <div style={{
      position: "fixed", inset: 0, background: "rgba(3,6,23,0.75)",
      display: "flex", alignItems: "center", justifyContent: "center", zIndex: 3000, padding: 16
    }}>
      <div style={{ width: 960, maxHeight: "92vh", overflow: "auto", background: "#0d1b2a", padding: 20, borderRadius: 12, color: "#eaf2ff", boxShadow: "0 6px 32px rgba(0,0,0,0.6)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h3 style={{ margin: 0 }}>Submission Detail</h3>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={downloadPDF} style={{ padding: "8px 12px", borderRadius: 8, background: "#7b5cff", color: "#fff", border: "none" }}>Download KPI PDF</button>
            <button onClick={onClose} style={{ padding: "8px 12px", borderRadius: 8, background: "transparent", color: "#eaf2ff", border: "1px solid rgba(255,255,255,0.04)" }}>Close</button>

            {submission && canEdit() && (
              <button onClick={() => setShowEdit(true)} style={{ padding: "8px 12px", borderRadius: 8, background: "#1976d2", color: "#fff", border: "none" }}>
                Edit
              </button>
            )}

            {submission && HIGHER_ROLES.has(userRole) && String(submission.status).toLowerCase() !== "rejected" && !submission.finalized && (
              <>
                <button onClick={() => verify("approve")} style={{ padding: "8px 12px", borderRadius: 8, background: "#4caf50", color: "#fff", border: "none" }}>Approve</button>
                <button onClick={() => verify("reject")} style={{ padding: "8px 12px", borderRadius: 8, background: "#f44336", color: "#fff", border: "none" }}>Reject</button>
              </>
            )}
          </div>
        </div>

        {loading && <p>Loading...</p>}
        {!loading && submission && submission.error && <p style={{ color: "tomato" }}>Error: {submission.error}</p>}

        {!loading && submission && !submission.error && !showEdit && (
          <div style={{ marginTop: 12 }}>
            <div style={{ display: "flex", gap: 20 }}>
              <div style={{ flex: 1 }}>
                <p><strong>Faculty:</strong> {submission.faculty_user_id ?? submission.faculty_user?.name ?? submission.faculty_name ?? "-"}</p>
                <p><strong>Rank:</strong> {submission.faculty_rank ?? "-"}</p>
                <p><strong>Academic Year:</strong> {submission.academic_year ?? "-"}</p>
                <p><strong>Department:</strong> {submission.department ?? "-"}</p>

                <div style={{ marginTop: 10, borderRadius: 10, overflow: "hidden", border: "1px solid rgba(255,255,255,0.03)" }}>
                  <div style={{ padding: "10px 12px", display: "flex", gap: 12, background: "rgba(255,255,255,0.01)", fontWeight: 800 }}>
                    <div style={{ width: 48 }}>#</div>
                    <div style={{ flex: 1 }}>Activity</div>
                    <div style={{ width: 320 }}>Rubric</div>
                    <div style={{ width: 80, textAlign: "right" }}>Max</div>
                    <div style={{ width: 140, textAlign: "right" }}>Points</div>
                  </div>

                  <div style={{ padding: 12 }}>
                    {renderReadRow(1, "% Pass in ESE (Average of all theory courses)", isAPIII(submission) ? "81% - 95% → 0–20" : "80% - 95% → 0–30", isAPIII(submission) ? 20 : 30, computed?.perRow?.academic?.passMarks)}
                    {renderReadRow(2, "Student Feedback (Average of all theory courses)", isAPIII(submission) ? "3.1 - 4.5 (out of 5) → 0–20" : "3.0 - 4.5 (out of 5) → 0–30", isAPIII(submission) ? 20 : 30, computed?.perRow?.academic?.fbMarks)}
                    {renderReadRow(3, "Developing Online Course / Video Lecture and uploaded", "10 pts / video (cap 30)", 30, computed?.perRow?.academic?.videosMarks)}
                    {renderReadRow(4, "Implementation of Innovative teaching methodologies addressing SDGs", "4 pts / activity (cap 30)", 30, computed?.perRow?.academic?.sdgMarks)}
                    {renderReadRow(5, "VAC / Capsule courses / Achievements / Publications", "1 pt/hr VAC; 4 pts achievement; 2 pts/publication", isAPIII(submission) ? 25 : 30, computed?.perRow?.academic?.vacMarks)}

                    <SectionTotalDisplay label="Academic Total" max={isAPIII(submission) ? 125 : 150} value={computed?.totals?.academic ?? submission.score?.academic} />

                    {renderReadRow(6, "Publications", isAPIII(submission) ? "Publications target → up to 80 pts" : "25 pts / publication (up to 75)", isAPIII(submission) ? 80 : 75, computed?.perRow?.research?.pubsMarks)}
                    {renderReadRow(7, "Citations", isAPIII(submission) ? "0.5 pt / citation (cap 20)" : "1 pt / citation (cap 15)", isAPIII(submission) ? 20 : 15, computed?.perRow?.research?.citationsMarks)}
                    {renderReadRow(8, "Consultancy Revenue (₹ / year)", isAPIII(submission) ? "Scaled to 25pts" : "Scaled to 20pts", isAPIII(submission) ? 25 : 20, computed?.perRow?.research?.consultancyMarks)}
                    {renderReadRow(9, "Sponsored grants / proposals", "Combined scaled", isAPIII(submission) ? 50 : 40, computed?.perRow?.research?.sponsoredCombined)}
                    {renderReadRow(10, "Research visits", "10 pts / visit", 10, computed?.perRow?.research?.researchVisitsMarks)}
                    {renderReadRow(11, "Professional memberships", "10 pts / membership", 10, computed?.perRow?.research?.membershipsMarks)}
                    {renderReadRow(12, "FDP / MOOC / STTP", "1 pt/day phys; 0.5 online; 4 pts/4w MOOC", isAPIII(submission) ? 15 : 20, computed?.perRow?.research?.fdpMarks)}
                    {renderReadRow(13, "Mandatory training courses", "10 pts / course", 10, computed?.perRow?.research?.mandatoryMarks)}

                    <SectionTotalDisplay label="Research Total" max={isAPIII(submission) ? 225 : 200} value={computed?.totals?.research ?? submission.score?.research} />

                    {renderReadRow(14, "Convener / Coordinator / Guest lectures / Committees", isAPIII(submission) ? "Physical 3 pts/day; Online 2 pts/day; Guest 2 pts/day; Committee 1 pt" : "Physical 3 pts/day; Online 2 pts/day; Guest 2 pts/hr; Committee 1 pt", isAPIII(submission) ? 25 : 20, computed?.perRow?.admin?.convenerMarks)}
                    {renderReadRow(15, "Institution events (A/B/C)", "a:3 pts b:2 pts c:1 pt", "-", computed?.perRow?.admin?.eventsMarks)}
                    {renderReadRow(16, "Institute / Dept responsibilities", "Head 10 pts, Member 5 pts", 30, computed?.perRow?.admin?.respMarks)}

                    <SectionTotalDisplay label="Admin Total" max={isAPIII(submission) ? 75 : 50} value={computed?.totals?.admin ?? submission.score?.admin} />

                    {renderReadRow(17, "Community Services / ISR", isAPIII(submission) ? "10 pts / activity (cap 15)" : "10 pts / activity", isAPIII(submission) ? 15 : 30, computed?.perRow?.outreach?.communityMarks)}
                    {renderReadRow(18, "Being a Resource person", "Outside 3 pt/hr; Inside 2 pt/hr", 20, computed?.perRow?.outreach?.resourceMarks)}
                    {renderReadRow(19, "Training in Industry / Research (Days/Year)", isAPIII(submission) ? "Two weeks = full 20pts" : "Two weeks = full 30pts", isAPIII(submission) ? 20 : 30, computed?.perRow?.outreach?.trainingMarks)}
                    {renderReadRow(20, "Awards & Recognition", "Awards 5 pts each; Editorial 4 pts; Review 1 pt", 20, computed?.perRow?.outreach?.awardsTotal)}

                    <div style={{ padding: "12px 8px", display: "flex", justifyContent: "space-between", background: "rgba(255,255,255,0.01)", fontWeight: 900 }}>
                      <div>Grand Total</div>
                      <div style={{ display: "flex", gap: 20, alignItems: "center" }}>
                        <div style={{ color: "rgba(200,220,255,0.7)" }}>500</div>
                        <div style={{ background: "linear-gradient(90deg,#6a11cb,#2575fc)", padding: "8px 14px", borderRadius: 10, color: "#fff", fontWeight: 900 }}>{computed?.totals?.total ?? submission.score?.total ?? "-"}</div>
                      </div>
                    </div>

                  </div>
                </div>
              </div>

              <div style={{ width: 300 }}>
                <div style={{ background: "#1b263b", padding: 12, borderRadius: 8 }}>
                  <h4 style={{ marginTop: 0, color: "#90caf9" }}>Status</h4>
                  <div style={{ fontWeight: 700, color: "#fff" }}>{submission.status ?? "-"}</div>
                  {submission.verified_by && <div style={{ marginTop: 8 }}>Verified by: {submission.verified_by.name} ({submission.verified_by.role})</div>}
                </div>

                <div style={{ marginTop: 12 }}>
                  <h4 style={{ marginBottom: 8, color: "#90caf9" }}>Proof (Global)</h4>
                  {globalProofs.length > 0 ? (
                    globalProofs.map((p, i) => {
                      const url = proofUrl(p);
                      const name = p.original_filename ?? p.name ?? p.filename ?? String(p);
                      return url ? (
                        <div key={"gpf-" + i} style={{ marginBottom: 8 }}>
                          <a href={url} target="_blank" rel="noopener noreferrer" style={{ color: "#64b5f6" }}>{name}</a>
                        </div>
                      ) : (
                        <div key={"gpf-" + i} style={{ color: "rgba(200,220,255,0.6)", marginBottom: 8 }}>{name}</div>
                      );
                    })
                  ) : (
                    <div style={{ color: "rgba(200,220,255,0.6)" }}>No proof attached.</div>
                  )}
                </div>

                <div style={{ marginTop: 12 }}>
                  <h4 style={{ marginBottom: 8, color: "#90caf9" }}>Proof (Per-Activity)</h4>
                  {Object.keys(activityProofs).length === 0 && <div style={{ color: "rgba(200,220,255,0.6)" }}>No per-activity proofs.</div>}
                  {Object.entries(activityProofs).map(([row, arr]) => (
                    <div key={"act-" + row} style={{ marginBottom: 8 }}>
                      <div style={{ fontWeight: 800, marginBottom: 6 }}>Row {row}</div>
                      {arr.map((p, i) => {
                        const url = proofUrl(p);
                        const name = p.original_filename ?? p.name ?? p.filename ?? String(p);
                        return url ? (
                          <div key={i}><a href={url} target="_blank" rel="noopener noreferrer" style={{ color: "#64b5f6" }}>{name}</a></div>
                        ) : (
                          <div key={i} style={{ color: "rgba(200,220,255,0.6)" }}>{name}</div>
                        );
                      })}
                    </div>
                  ))}
                </div>
              </div>
            </div>

          </div>
        )}

        {showEdit && submission && (
          <div>
            <SubmissionForm
              apiBase={apiBase}
              submission={submission}
              editable={true}
              onCancel={() => setShowEdit(false)}
              onSubmitted={async (updated) => {
                setShowEdit(false);
                await refresh();
                if (onUpdated) onUpdated(updated);
              }}
            />
          </div>
        )}

      </div>
    </div>
  );
}

function renderReadRow(num, activity, rubric, max, value) {
  const safeValue = value ?? "-";
  return (
    <div key={num} style={{ display: "flex", gap: 12, alignItems: "center", padding: "12px 6px", borderBottom: "1px solid rgba(255,255,255,0.02)" }}>
      <div style={{ width: 48, color: "rgba(200,220,255,0.7)", fontWeight: 700 }}>{num}</div>
      <div style={{ flex: 1 }}>{activity}</div>
      <div style={{ width: 320, color: "rgba(200,220,255,0.7)" }}>{rubric}</div>
      <div style={{ width: 80, textAlign: "right", color: "rgba(200,220,255,0.8)", fontWeight: 700 }}>{max}</div>
      <div style={{ width: 140, textAlign: "right" }}>
        <div style={{ background: "rgba(0,0,0,0.45)", padding: "6px 10px", borderRadius: 8, display: "inline-block", minWidth: 56, textAlign: "center", fontWeight: 700 }}>{safeValue}</div>
      </div>
    </div>
  );
}

function SectionTotalDisplay({ label, max, value }) {
  return (
    <div style={{ padding: "12px 8px", display: "flex", justifyContent: "space-between", background: "rgba(255,255,255,0.01)", fontWeight: 800 }}>
      <div>{label}</div>
      <div style={{ display: "flex", gap: 20, alignItems: "center" }}>
        <div style={{ color: "rgba(200,220,255,0.7)" }}>{max}</div>
        <div style={{ background: "rgba(0,0,0,0.45)", padding: "6px 10px", borderRadius: 8 }}>{value ?? "-"}</div>
      </div>
    </div>
  );
}

function isAPIII(submission) {
  const rank = submission?.faculty_rank ?? submission?.faculty?.rank ?? "";
  if (!rank) return false;
  return String(rank).toUpperCase().includes("AP III") || String(rank).toUpperCase().includes("AP (III)");
}