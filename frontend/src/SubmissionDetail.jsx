// src/SubmissionDetail.jsx
import { useEffect, useState } from "react";

export default function SubmissionDetail({ apiBase = "http://127.0.0.1:8000", id, onClose, onUpdated }) {
  const [submission, setSubmission] = useState(null);
  const [loading, setLoading] = useState(false);
  const [userRole, setUserRole] = useState("faculty"); // fetched profile role
  const [currentUserId, setCurrentUserId] = useState(null);
  const token = localStorage.getItem("token");

  // roles allowed to verify
  const HIGHER_ROLES = new Set(["hod", "director", "registrar", "office_head", "admin"]);

  useEffect(() => {
    // fetch profile to know role & id (if token present)
    async function fetchProfile() {
      if (!token) return;
      try {
        const res = await fetch(`${apiBase.replace(/\/$/,"")}/api/users/me`, {
          headers: { Authorization: "Bearer " + token },
        });
        if (!res.ok) return;
        const data = await res.json();
        if (data && data.role) setUserRole(String(data.role).toLowerCase());
        if (data && data.id) setCurrentUserId(data.id);
      } catch (e) {
        console.warn("Profile fetch failed", e);
      }
    }
    fetchProfile();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    (async () => {
      try {
        const res = await fetch(`${apiBase.replace(/\/$/,"")}/api/submissions/${id}`, {
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
  }, [id, token]);

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

  async function verify(action) {
    // check role
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
      const res = await fetch(`${apiBase.replace(/\/$/,"")}/api/submissions/${id}/verify`, {
        method: "PATCH",
        headers: token ? { Authorization: "Bearer " + token } : {},
        body: form,
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.detail || JSON.stringify(body));
      if (onUpdated) onUpdated();
    } catch (e) {
      alert("Error: " + e.message);
    }
  }

  return (
    <div style={{
      position: "fixed", inset: 0, background: "rgba(3,6,23,0.75)",
      display: "flex", alignItems: "center", justifyContent: "center", zIndex: 3000, padding: 16
    }}>
      <div style={{ width: 960, maxHeight: "92vh", overflow: "auto", background: "#0d1b2a", padding: 20, borderRadius: 12, color: "#eaf2ff", boxShadow: "0 6px 32px rgba(0,0,0,0.6)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h3 style={{ margin: 0 }}>Submission Detail</h3>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={onClose} style={{ padding: "8px 12px", borderRadius: 8, background: "transparent", color: "#eaf2ff", border: "1px solid rgba(255,255,255,0.04)" }}>Close</button>

            {/* Only show Approve/Reject when user is higher role and submission not rejected or finalized.
                Registrar (included in HIGHER_ROLES) will see buttons even if status is "verified" — backend should mark finalized when complete. */}
            {submission && HIGHER_ROLES.has(userRole) && submission.status !== "rejected" && !submission.finalized && (
              <>
                <button onClick={() => verify("approve")} style={{ padding: "8px 12px", borderRadius: 8, background: "#4caf50", color: "#fff", border: "none" }}>Approve</button>
                <button onClick={() => verify("reject")} style={{ padding: "8px 12px", borderRadius: 8, background: "#f44336", color: "#fff", border: "none" }}>Reject</button>
              </>
            )}
          </div>
        </div>

        {loading && <p>Loading...</p>}
        {!loading && submission && submission.error && <p style={{ color: "tomato" }}>Error: {submission.error}</p>}

        {!loading && submission && !submission.error && (
          <div style={{ marginTop: 12 }}>
            <div style={{ display: "flex", gap: 20 }}>
              <div style={{ flex: 1 }}>
                <p><strong>Faculty:</strong> {submission.faculty_user_id}</p>
                <p><strong>Rank:</strong> {submission.faculty_rank}</p>
                <p><strong>Academic Year:</strong> {submission.academic_year}</p>
                <p><strong>Department:</strong> {submission.department ?? "-"}</p>

                {/* table: we render rows similar to form but readonly */}
                <div style={{ marginTop: 10, borderRadius: 10, overflow: "hidden", border: "1px solid rgba(255,255,255,0.03)" }}>
                  <div style={{ padding: "10px 12px", display: "flex", gap: 12, background: "rgba(255,255,255,0.01)", fontWeight: 800 }}>
                    <div style={{ width: 48 }}>#</div>
                    <div style={{ flex: 1 }}>Activity</div>
                    <div style={{ width: 320 }}>Rubric</div>
                    <div style={{ width: 80, textAlign: "right" }}>Max</div>
                    <div style={{ width: 140, textAlign: "right" }}>Points</div>
                  </div>

                  <div style={{ padding: 12 }}>
                    {renderReadRow(1, "% Pass in ESE (Average of all theory courses)", "81% - 95% → 0–30", 30, submission, computed?.perRow?.academic?.passMarks)}
                    {renderReadRow(2, "Student Feedback (Average of all theory courses)", "3.1 - 4.5 (out of 5) → 0–30", 30, submission, computed?.perRow?.academic?.fbMarks)}
                    {renderReadRow(3, "Developing Online Course / Video Lecture and uploaded", "10 pts / video (cap 30)", 30, submission, computed?.perRow?.academic?.videosMarks)}
                    {renderReadRow(4, "Implementation of Innovative teaching methodologies addressing SDGs", "4 pts / activity (cap 30)", 30, submission, computed?.perRow?.academic?.sdgMarks)}
                    {renderReadRow(5, "VAC / Capsule courses / Achievements / Publications", "1 pt/hr VAC; 4 pts achievement; 2 pts/publication", 30, submission, computed?.perRow?.academic?.vacMarks)}

                    <div style={{ padding: "12px 8px", display: "flex", justifyContent: "space-between", background: "rgba(255,255,255,0.01)", fontWeight: 800 }}>
                      <div>Academic Total</div>
                      <div style={{ display: "flex", gap: 20, alignItems: "center" }}>
                        <div style={{ color: "rgba(200,220,255,0.7)" }}>150</div>
                        <div style={{ background: "rgba(0,0,0,0.45)", padding: "6px 10px", borderRadius: 8 }}>{computed?.totals?.academic ?? submission.score?.academic ?? "-"}</div>
                      </div>
                    </div>

                    {/* Research */}
                    {renderReadRow(6, "Publications", "25 pts / publication (up to 75)", 75, submission, computed?.perRow?.research?.pubsMarks)}
                    {renderReadRow(7, "Citations", "1 pt / citation (cap 15)", 15, submission, computed?.perRow?.research?.citationsMarks)}
                    {renderReadRow(8, "Consultancy Revenue (₹ / year)", "Scaled 0..200k → 0..20", 20, submission, computed?.perRow?.research?.consultancyMarks)}
                    {renderReadRow(9, "Sponsored grants / proposals", "Combined scaled (cap 40)", 40, submission, computed?.perRow?.research?.sponsoredCombined)}
                    {renderReadRow(10, "Research visits", "10 pts / visit", 10, submission, computed?.perRow?.research?.researchVisitsMarks)}
                    {renderReadRow(11, "Professional memberships", "10 pts / membership", 10, submission, computed?.perRow?.research?.membershipsMarks)}
                    {renderReadRow(12, "FDP / MOOC / STTP", "1 pt/day phys; 0.5 online; 4 pts/4w MOOC", 20, submission, computed?.perRow?.research?.fdpMarks)}
                    {renderReadRow(13, "Mandatory training courses", "10 pts / course", 10, submission, computed?.perRow?.research?.mandatoryMarks)}

                    <div style={{ padding: "12px 8px", display: "flex", justifyContent: "space-between", background: "rgba(255,255,255,0.01)", fontWeight: 800 }}>
                      <div>Research Total</div>
                      <div style={{ display: "flex", gap: 20, alignItems: "center" }}>
                        <div style={{ color: "rgba(200,220,255,0.7)" }}>200</div>
                        <div style={{ background: "rgba(0,0,0,0.45)", padding: "6px 10px", borderRadius: 8 }}>{computed?.totals?.research ?? "-"}</div>
                      </div>
                    </div>

                    {/* Admin */}
                    {renderReadRow(14, "Convener / Coordinator / Guest lectures / Committees", "Physical 3 pts/day; Online 2 pts/day; Guest 2 pts/hr; Committee 1 pt", 20, submission, computed?.perRow?.admin?.convenerMarks)}
                    {renderReadRow(15, "Institution events (A/B/C)", "a:3 pts b:2 pts c:1 pt", "-", submission, computed?.perRow?.admin?.eventsMarks)}
                    {renderReadRow(16, "Institute / Dept responsibilities", "Head 10 pts, Member 5 pts", 30, submission, computed?.perRow?.admin?.respMarks)}

                    <div style={{ padding: "12px 8px", display: "flex", justifyContent: "space-between", background: "rgba(255,255,255,0.01)", fontWeight: 800 }}>
                      <div>Admin Total</div>
                      <div style={{ display: "flex", gap: 20, alignItems: "center" }}>
                        <div style={{ color: "rgba(200,220,255,0.7)" }}>50</div>
                        <div style={{ background: "rgba(0,0,0,0.45)", padding: "6px 10px", borderRadius: 8 }}>{computed?.totals?.admin ?? "-"}</div>
                      </div>
                    </div>

                    {/* Outreach */}
                    {renderReadRow(17, "Community Services / ISR", "10 pts / activity", 30, submission, computed?.perRow?.outreach?.communityMarks)}
                    {renderReadRow(18, "Being a Resource person", "Outside 3 pt/hr; Inside 2 pt/hr", 20, submission, computed?.perRow?.outreach?.resourceMarks)}
                    {renderReadRow(19, "Training in Industry / Research (Days/Year)", "Two weeks = full 30 pts", 30, submission, computed?.perRow?.outreach?.trainingMarks)}
                    {renderReadRow(20, "Awards & Recognition", "Awards 5 pts each; Editorial 4 pts; Review 1 pt", 20, submission, computed?.perRow?.outreach?.awardsTotal)}

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

              {/* right sidebar */}
              <div style={{ width: 300 }}>
                <div style={{ background: "#1b263b", padding: 12, borderRadius: 8 }}>
                  <h4 style={{ marginTop: 0, color: "#90caf9" }}>Status</h4>
                  <div style={{ fontWeight: 700, color: "#fff" }}>{submission.status}</div>
                  {submission.verified_by && <div style={{ marginTop: 8 }}>Verified by: {submission.verified_by.name} ({submission.verified_by.role})</div>}
                </div>

                <div style={{ marginTop: 12 }}>
                  <h4 style={{ marginBottom: 8, color: "#90caf9" }}>Proof</h4>
                  {submission.file_meta?.original_filename ? (
                    <a style={{ color: "#64b5f6" }} href={`${apiBase}${submission.file_meta.download_url ?? submission.file_meta.stored_path}`} target="_blank" rel="noreferrer">{submission.file_meta.original_filename}</a>
                  ) : (
                    <div style={{ color: "rgba(200,220,255,0.6)" }}>No proof attached.</div>
                  )}
                </div>
              </div>
            </div>

          </div>
        )}
      </div>
    </div>
  );
}

// helper to render readonly rows
function renderReadRow(num, activity, rubric, max, submission, value) {
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
