from fastapi import APIRouter, HTTPException, status, Depends
from pydantic import BaseModel, EmailStr
from fastapi.security import OAuth2PasswordBearer
from typing import Optional
from app.core import security
from app.services import user_service

router = APIRouter()
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/login")


# --- Register Input Schema ---
class RegisterIn(BaseModel):
    email: EmailStr
    password: str
    name: str
    role: Optional[str] = "faculty"
    department: Optional[str] = None   # ✅ added


# --- Login Input Schema ---
class LoginIn(BaseModel):
    email: EmailStr
    password: str


# --- Register route ---
@router.post("/register")
async def register(payload: RegisterIn):
    existing = await user_service.get_user_by_email(payload.email)
    if existing:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Email already registered")

    created = await user_service.create_user(
        payload.email,
        payload.password,
        payload.name,
        payload.role,
        payload.department,   # ✅ added
    )

    if not created:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Failed to create user")

    return {
        "message": "user_created",
        "email": created.get("email"),
        "id": str(created.get("_id")),
        "name": created.get("name"),
        "role": created.get("role"),
        "department": created.get("department"),  # ✅ return department
    }


# --- Login route ---
@router.post("/login")
async def login(payload: LoginIn):
    user = await user_service.get_user_by_email(payload.email)
    if not user or not security.verify_password(payload.password, user["password_hash"]):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")

    token = security.create_access_token(subject=str(user["_id"]))
    return {"access_token": token, "token_type": "bearer"}


# --- Get current user from token ---
async def get_current_user(token: str = Depends(oauth2_scheme)):
    try:
        payload = security.decode_token(token)
        uid = payload.get("sub")
        user = await user_service.get_user_by_id(uid)
        if not user:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found")
        user["id"] = str(user["_id"])  # convert _id to string
        return user
    except Exception:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired token")
