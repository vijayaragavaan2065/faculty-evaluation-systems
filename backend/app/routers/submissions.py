from fastapi import APIRouter, Depends, UploadFile, File, Form, HTTPException, status, Path
from app.routers.auth import get_current_user
from app.db.client import db
from bson import ObjectId
import os
import traceback
from datetime import datetime, date
from typing import Optional, Any, Dict

# import ai service (keep same as your project)
from app.services import ai_service

router = APIRouter()

UPLOAD_DIR = os.path.join(os.path.dirname(__file__), "..", "..", "uploads")
os.makedirs(UPLOAD_DIR, exist_ok=True)

ALLOWED_DEPARTMENTS = [
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
]

def is_higher_role(user: dict) -> bool:
    """
    Returns True for system-level roles that should see all submissions.
    We normalize the role to lowercase to avoid capitalization mismatches
    (e.g. "Director" vs "director").
    """
    role = (user.get("role") or "").lower()
    return role in ("director", "registrar", "office_head", "admin")

def sanitize_value(v: Any):
    from bson import ObjectId as _ObjectId
    if isinstance(v, _ObjectId):
        return str(v)
    if isinstance(v, (datetime, date)):
        return v.isoformat()
    if isinstance(v, dict):
        return sanitize_doc(v)
    if isinstance(v, list):
        return [sanitize_value(x) for x in v]
    return v

def sanitize_doc(doc: dict):
    out = {}
    for k, v in doc.items():
        if k == "_id":
            out["id"] = sanitize_value(v)
            continue
        out[k] = sanitize_value(v)
    return out

@router.post("/", status_code=201)
async def create_submission(
    faculty_rank: str = Form(...),
    academic_year: str = Form(...),
    pass_percent: float = Form(...),
    student_feedback: float = Form(...),
    online_videos: int = Form(...),
    sdg_activities: int = Form(...),
    vac_hours: int = Form(...),
    publications: int = Form(...),
    citations: int = Form(...),
    consultancy_revenue: float = Form(0.0),
    sponsored_grants_count: int = Form(0),
    sponsored_grants_amount: float = Form(0.0),
    research_visits: int = Form(0),
    memberships_count: int = Form(0),
    fdp_days_phys: float = Form(0.0),
    fdp_days_online: float = Form(0.0),
    mooc_4w: int = Form(0),
    mandatory_courses: int = Form(0),
    convener_days: int = Form(0),
    convener_online_days: int = Form(0),
    guest_hours: int = Form(0),
    committee_events: int = Form(0),
    conferences_organized: int = Form(0),
    events_a: int = Form(0),
    events_b: int = Form(0),
    events_c: int = Form(0),
    head_count: int = Form(0),
    member_count: int = Form(0),
    dept_responsibilities: int = Form(0),
    outreach_activities: int = Form(0),
    resource_person_hours: int = Form(0),
    resource_outside_hours: int = Form(0),
    resource_inside_hours: int = Form(0),
    training_days: int = Form(0),
    awards_count: int = Form(0),
    editorial_count: int = Form(0),
    reviews_count: int = Form(0),
    section_totals_json: str = Form(None),

    # GLOBAL PROOF
    proof: UploadFile = File(None),

    # PER ROW PROOFS
    proof_row_1: UploadFile = File(None),
    proof_row_2: UploadFile = File(None),
    proof_row_3: UploadFile = File(None),
    proof_row_4: UploadFile = File(None),
    proof_row_5: UploadFile = File(None),
    proof_row_6: UploadFile = File(None),
    proof_row_7: UploadFile = File(None),
    proof_row_8: UploadFile = File(None),
    proof_row_9: UploadFile = File(None),
    proof_row_10: UploadFile = File(None),
    proof_row_11: UploadFile = File(None),
    proof_row_12: UploadFile = File(None),
    proof_row_13: UploadFile = File(None),
    proof_row_14: UploadFile = File(None),
    proof_row_15: UploadFile = File(None),
    proof_row_16: UploadFile = File(None),
    proof_row_17: UploadFile = File(None),
    proof_row_18: UploadFile = File(None),
    proof_row_19: UploadFile = File(None),
    proof_row_20: UploadFile = File(None),

    current_user: dict = Depends(get_current_user),
):
    file_meta = None
    if proof:
        safe_name = f"{datetime.utcnow().strftime('%Y%m%d%H%M%S')}_{proof.filename}"
        out_path = os.path.join(UPLOAD_DIR, safe_name)
        with open(out_path, "wb") as f:
            f.write(await proof.read())
        file_meta = {
            "original_filename": proof.filename,
            "stored_path": out_path,
            "stored_filename": safe_name,
            "content_type": proof.content_type,
            "uploaded_at": datetime.utcnow()
        }

    # -------- SAVE PER-ROW PROOFS --------
    row_proofs = {}
    row_files = [
        proof_row_1, proof_row_2, proof_row_3, proof_row_4, proof_row_5,
        proof_row_6, proof_row_7, proof_row_8, proof_row_9, proof_row_10,
        proof_row_11, proof_row_12, proof_row_13, proof_row_14, proof_row_15,
        proof_row_16, proof_row_17, proof_row_18, proof_row_19, proof_row_20
    ]

    for idx, file in enumerate(row_files, start=1):
        if file:
            safe_name = f"{datetime.utcnow().strftime('%Y%m%d%H%M%S')}_{file.filename}"
            out_path = os.path.join(UPLOAD_DIR, safe_name)

            with open(out_path, "wb") as f:
                f.write(await file.read())

            row_proofs[f"proof_row_{idx}"] = [{
                "original_filename": file.filename,
                "stored_path": out_path,
                "stored_filename": safe_name,
                "content_type": file.content_type,
                "uploaded_at": datetime.utcnow()
            }]

    # assign department from the current_user (must exist for faculty / hod)
    department = current_user.get("department")

    submission = {
        "faculty_user_id": current_user["id"],
        "faculty_rank": faculty_rank,
        "academic_year": academic_year,
        "department": department,

        # INSERT PER ROW PROOFS
        **row_proofs,

        "academic": {
            "pass_percent": pass_percent,
            "student_feedback": student_feedback,
            "online_videos": online_videos,
            "sdg_activities": sdg_activities,
            "vac_hours": vac_hours,
        },
        "research": {
            "publications": publications,
            "citations": citations,
            "consultancy_revenue": consultancy_revenue,
            "sponsored_grants_count": sponsored_grants_count,
            "sponsored_grants_amount": sponsored_grants_amount,
            "research_visits": research_visits,
            "memberships_count": memberships_count,
            "fdp_days_phys": fdp_days_phys,
            "fdp_days_online": fdp_days_online,
            "mooc_4w": mooc_4w,
            "mandatory_courses": mandatory_courses,
        },
        "administration": {
            "convener_days": convener_days,
            "convener_online_days": convener_online_days,
            "guest_hours": guest_hours,
            "committee_events": committee_events,
            "conferences_organized": conferences_organized,
            "events_a": events_a,
            "events_b": events_b,
            "events_c": events_c,
            "head_count": head_count,
            "member_count": member_count,
            "dept_responsibilities": dept_responsibilities,
        },
        "outreach": {
            "outreach_activities": outreach_activities,
            "resource_person_hours": resource_person_hours,
            "resource_outside_hours": resource_outside_hours,
            "resource_inside_hours": resource_inside_hours,
            "training_days": training_days,
            "awards_count": awards_count,
            "editorial_count": editorial_count,
            "reviews_count": reviews_count,
        },
        "file_meta": file_meta,
        "section_totals_json": section_totals_json,
        "status": "submitted",
        "created_at": datetime.utcnow(),
    }

    # compute AI/rule-based score and feedback now
    try:
        scored = ai_service.score_submission(submission)
        submission["score"] = scored.get("score")  # numeric grand total (out of 500 or 100)
        submission["section_totals"] = scored.get("section_totals")
        submission["ai_feedback"] = scored.get("ai_feedback")
        submission["score_debug"] = scored.get("debug")
        submission["scored_at"] = scored.get("scored_at")
    except Exception as e:
        print("ai scoring error:", e)
        traceback.print_exc()

    res = await db.submissions.insert_one(submission)
    return {"submission_id": str(res.inserted_id)}


@router.get("/", status_code=200)
async def list_submissions(
    status: Optional[str] = None,
    faculty_id: Optional[str] = None,
    current_user: dict = Depends(get_current_user),
):
    q = {}
    if status:
        q["status"] = status

    role = (current_user.get("role") or "").lower()

    if is_higher_role(current_user):
        if faculty_id:
            q["faculty_user_id"] = faculty_id
    else:
        if role == "hod":
            dept = current_user.get("department")
            if dept:
                q["department"] = dept
            if faculty_id:
                q["faculty_user_id"] = faculty_id
        else:
            q["faculty_user_id"] = current_user["id"]

    cursor = db.submissions.find(q).sort("created_at", -1)
    items = []
    async for doc in cursor:
        safe = sanitize_doc(doc)

        if safe.get("file_meta"):
            fm = safe["file_meta"]
            safe["file_meta"] = {
                "original_filename": fm.get("original_filename"),
                "uploaded_at": fm.get("uploaded_at"),
                "stored_filename": fm.get("stored_filename"),
            }
            if fm.get("stored_filename"):
                safe["file_meta"]["download_url"] = f"/uploads/{fm.get('stored_filename')}"

        # ADD DOWNLOAD URL FOR PER ROW PROOFS
        for i in range(1, 21):
            key = f"proof_row_{i}"
            if safe.get(key):
                for f in safe[key]:
                    if f.get("stored_filename"):
                        f["download_url"] = f"/uploads/{f['stored_filename']}"

        items.append(safe)

    return {"count": len(items), "submissions": items}


@router.get("/stats", status_code=200)
async def submissions_stats(current_user: dict = Depends(get_current_user)):
    try:
        q: Dict[str, Any] = {}
        role = (current_user.get("role") or "").lower()
        if is_higher_role(current_user):
            q = {}
        elif role == "hod":
            dept = current_user.get("department")
            if dept:
                q = {"department": dept}
            else:
                q = {}
        else:
            q = {"faculty_user_id": current_user["id"]}

        total = await db.submissions.count_documents(q)

        pending_q = dict(q)
        pending_q["status"] = {"$in": ["submitted", "pending"]}
        pending = await db.submissions.count_documents(pending_q)

        approved_q = dict(q)
        approved_q["status"] = {"$in": ["verified", "finalized", "approved"]}
        approved = await db.submissions.count_documents(approved_q)

        avg_score = None
        try:
            match_stage = {"$match": q} if q else {"$match": {}}
            pipeline = [
                match_stage,
                {
                    "$project": {
                        "numericScore": {
                            "$cond": [
                                {"$isNumber": "$score.total"},
                                "$score.total",
                                {
                                    "$cond": [
                                        {"$isNumber": "$score"},
                                        "$score",
                                        None
                                    ]
                                }
                            ]
                        }
                    }
                },
                {"$match": {"numericScore": {"$ne": None}}},
                {"$group": {"_id": None, "avgScore": {"$avg": "$numericScore"}}}
            ]
            agg_result = await db.submissions.aggregate(pipeline).to_list(length=1)
            if agg_result and len(agg_result) > 0:
                avg_val = agg_result[0].get("avgScore")
                if avg_val is not None:
                    avg_score = round(float(avg_val), 2)
        except Exception as agg_err:
            print("stats: aggregation failed:", agg_err)
            traceback.print_exc()

        return {
            "total_submissions": int(total),
            "avg_score": avg_score,
            "pending_reviews": int(pending),
            "approved": int(approved),
        }
    except Exception as e:
        print("stats error:", e)
        traceback.print_exc()
        raise HTTPException(status_code=500, detail="Unable to compute stats")


@router.get("/{submission_id}", status_code=200)
async def get_submission(
    submission_id: str = Path(..., pattern=r"^[0-9a-fA-F]{24}$"),
    current_user: dict = Depends(get_current_user),
):
    try:
        oid = ObjectId(submission_id)
    except Exception:
        raise HTTPException(status_code=400, detail=f"invalid submission id: {submission_id}")

    doc = await db.submissions.find_one({"_id": oid})
    if not doc:
        raise HTTPException(status_code=404, detail="submission not found")

    safe = sanitize_doc(doc)

    if safe.get("file_meta"):
        fm = safe["file_meta"]
        stored_filename = fm.get("stored_filename")
        if stored_filename:
            safe["file_meta"]["download_url"] = f"/uploads/{stored_filename}"

    # PER ROW DOWNLOAD URL
    for i in range(1, 21):
        key = f"proof_row_{i}"
        if safe.get(key):
            for f in safe[key]:
                if f.get("stored_filename"):
                    f["download_url"] = f"/uploads/{f['stored_filename']}"

    return safe


@router.patch("/{submission_id}/verify", status_code=200)
async def verify_submission(
    submission_id: str = Path(..., pattern=r"^[0-9a-fA-F]{24}$"),
    action: str = Form(...),
    comments: Optional[str] = Form(None),
    current_user: dict = Depends(get_current_user),
):
    role = (current_user.get("role") or "").lower()
    if role not in ("hod", "director", "registrar", "office_head", "admin"):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not authorized to verify")

    if action not in ("approve", "reject"):
        raise HTTPException(status_code=400, detail="action must be 'approve' or 'reject'")

    try:
        oid = ObjectId(submission_id)
    except Exception:
        raise HTTPException(status_code=400, detail=f"invalid submission id: {submission_id}")

    doc = await db.submissions.find_one({"_id": oid})
    if not doc:
        raise HTTPException(status_code=404, detail="submission not found")

    update = {
        "$set": {
            "status": "verified" if action == "approve" else "rejected",
            "verified_by": {
                "id": current_user["id"],
                "name": current_user.get("name"),
                "role": current_user.get("role"),
                "department": current_user.get("department"),
            },
            "verified_at": datetime.utcnow(),
            "verification_comments": comments,
        }
    }

    res = await db.submissions.update_one({"_id": oid}, update)
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="submission not found")

    return {"message": "ok", "submission_id": submission_id, "status": update["$set"]["status"]}