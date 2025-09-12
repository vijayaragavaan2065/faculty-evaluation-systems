from datetime import datetime
from app.db.client import db
from app.core import security

# --- Get user by email ---
async def get_user_by_email(email: str):
    return await db.users.find_one({"email": email})


# --- Get user by id ---
async def get_user_by_id(user_id: str):
    from bson import ObjectId
    try:
        oid = ObjectId(user_id)
    except Exception:
        return None
    user = await db.users.find_one({"_id": oid})
    return user


# --- Create user (with department) ---
async def create_user(email: str, password: str, name: str, role: str = "faculty", department: str | None = None):
    password_hash = security.get_password_hash(password)
    doc = {
        "email": email,
        "password_hash": password_hash,
        "name": name,
        "role": role,
        "department": department,   # ✅ store department
        "created_at": datetime.utcnow(),
    }
    res = await db.users.insert_one(doc)
    doc["_id"] = res.inserted_id
    return doc
