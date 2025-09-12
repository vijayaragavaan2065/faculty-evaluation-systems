from fastapi import APIRouter, Depends
from app.routers.auth import get_current_user

router = APIRouter()

@router.get("/me")
async def get_me(current_user: dict = Depends(get_current_user)):
    return {
        "id": current_user.get("id"),
        "email": current_user.get("email"),
        "name": current_user.get("name"),
        "role": current_user.get("role"),
        "department": current_user.get("department"),  # ✅ added
    }
