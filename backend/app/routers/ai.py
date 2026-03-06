# backend/app/routers/ai.py
from fastapi import APIRouter, Depends, HTTPException, status
from datetime import datetime
import os
import requests
from typing import Optional

# Use your existing auth dependency - adjust import if your project layout differs
from app.routers.auth import get_current_user

router = APIRouter(tags=["AI"])

def _get_db():
    """
    Lazy import DB client to avoid import-time issues during uvicorn reload.
    """
    try:
        from app.db.client import db
        return db
    except Exception as e:
        # raise HTTPException instead of crash so frontend receives meaningful message
        raise HTTPException(status_code=500, detail=f"DB import failed: {e}")

# ---------- Basic fetch feedback (already stored when submission created) ----------
@router.get("/submission/{submission_id}")
async def get_submission_ai_feedback(submission_id: str, current_user=Depends(get_current_user)):
    db = _get_db()
    from bson import ObjectId
    try:
        oid = ObjectId(submission_id)
    except Exception:
        raise HTTPException(status_code=400, detail="invalid submission id")

    doc = await db.submissions.find_one({"_id": oid})
    if not doc:
        raise HTTPException(status_code=404, detail="submission not found")

    # Authorization: simple check reusing your project rules
    role = (current_user.get("role") or "").lower()
    if role not in ("director", "registrar", "office_head", "admin", "hod"):
        # regular faculty only allowed their own submission
        if doc.get("faculty_user_id") != current_user["id"]:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not authorized")

    # Build a "where_to_improve" if ai_feedback exists
    ai_feedback = doc.get("ai_feedback", "")
    where_to_improve = []
    if isinstance(ai_feedback, str) and ai_feedback.strip():
        # take up to 3 sentences from ai_feedback as quick bullets
        sentences = [s.strip() for s in ai_feedback.replace("\n", " ").split(".") if s.strip()]
        where_to_improve = sentences[:3]
    else:
        # fallback to weakest section if available
        section_totals = doc.get("section_totals", {})
        if isinstance(section_totals, dict) and section_totals:
            weakest = min(section_totals.items(), key=lambda t: t[1])[0]
            where_to_improve = [f"Weakest section: {weakest} (score {section_totals.get(weakest)})"]

    return {
        "submission_id": submission_id,
        "ai_feedback": ai_feedback,
        "debug": doc.get("score_debug", {}),
        "score": doc.get("score", {}),
        "section_totals": doc.get("section_totals", {}),
        "where_to_improve": where_to_improve,
        "ai_llm_summary": doc.get("ai_llm_summary"),
        "fetched_at": datetime.utcnow().isoformat()
    }

# --------- Hugging Face summarization endpoint ----------
@router.post("/submission/{submission_id}/hf_summarize")
async def hf_summarize_submission(submission_id: str, current_user=Depends(get_current_user)):
    """
    Call Hugging Face Inference API (text2text-generation) to produce an improved, actionable summary.
    Stores the resulting text in submission.ai_llm_summary and returns it.
    Requires HF_API_TOKEN and HF_MODEL in environment.
    """
    db = _get_db()
    from bson import ObjectId
    try:
        oid = ObjectId(submission_id)
    except Exception:
        raise HTTPException(status_code=400, detail="invalid submission id")

    doc = await db.submissions.find_one({"_id": oid})
    if not doc:
        raise HTTPException(status_code=404, detail="submission not found")

    # Authorization check
    role = (current_user.get("role") or "").lower()
    if role not in ("director", "registrar", "office_head", "admin", "hod"):
        if doc.get("faculty_user_id") != current_user["id"]:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not authorized")

    HF_API_TOKEN = os.getenv("HF_API_TOKEN")
    HF_MODEL = os.getenv("HF_MODEL", "google/flan-t5-large")
    if not HF_API_TOKEN:
        raise HTTPException(status_code=500, detail="Server not configured: HF_API_TOKEN missing")

    # Build a concise prompt / input for the text2text model
    # Use stored ai_feedback, section totals and score as context.
    ai_feedback = doc.get("ai_feedback", "")
    section_totals = doc.get("section_totals", {})
    score = doc.get("score", {})

    prompt_lines = [
        "You are an expert academic coach. Provide a short, actionable 3-step improvement plan for the faculty member.",
        f"Overall score: {score}",
        f"Section totals: {section_totals}",
        f"Existing AI feedback: {ai_feedback}",
        "Give: 1) Top three actions (concise), 2) One-month plan (3 steps), 3) Quick metrics to track.",
    ]
    prompt = "\n".join(prompt_lines)

    # Call HF Inference API (text2text endpoint)
    api_url = f"https://api-inference.huggingface.co/models/{HF_MODEL}"
    headers = {"Authorization": f"Bearer {HF_API_TOKEN}", "Accept": "application/json"}
    payload = {
        "inputs": prompt,
        "options": {"wait_for_model": True, "use_cache": False},
        "parameters": {"max_new_tokens": 512, "temperature": 0.2}
    }

    try:
        resp = requests.post(api_url, headers=headers, json=payload, timeout=30)
    except requests.RequestException as e:
        raise HTTPException(status_code=500, detail=f"HuggingFace request failed: {e}")

    if resp.status_code != 200:
        # surface HF error message for debugging (don't expose secrets)
        raise HTTPException(status_code=500, detail=f"Hugging Face Inference API error: {resp.status_code} {resp.text[:100]}")

    # HF returns a JSON list or dict depending on model; handle common cases
    try:
        result = resp.json()
        # If model returns list with generated_text
        if isinstance(result, list) and len(result) > 0 and isinstance(result[0], dict):
            # many text2text models return {"generated_text": "..."}
            llm_text = result[0].get("generated_text") or result[0].get("text") or str(result[0])
        elif isinstance(result, dict) and "generated_text" in result:
            llm_text = result["generated_text"]
        else:
            llm_text = str(result)
    except Exception:
        llm_text = resp.text

    # store into DB
    await db.submissions.update_one({"_id": oid}, {"$set": {"ai_llm_summary": llm_text, "ai_llm_at": datetime.utcnow()}})
    return {"llm_summary": llm_text}
