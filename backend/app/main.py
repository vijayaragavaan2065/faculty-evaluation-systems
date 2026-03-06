# backend/app/main.py
import os
import traceback
from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

# Load .env from backend/ (one level up from app/)
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))  # backend/app/..
ENV_PATH = os.path.join(BASE_DIR, ".env")
if os.path.exists(ENV_PATH):
    load_dotenv(ENV_PATH)

app = FastAPI(title="AI Faculty Eval API")

# Development-friendly CORS origins
FRONTEND_ORIGINS = [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "http://localhost:5174",
    "http://127.0.0.1:5174",
    "http://localhost:3000",
    "http://127.0.0.1:3000",
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=FRONTEND_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Ensure uploads dir exists and mount it
UPLOAD_DIR = os.path.join(BASE_DIR, "uploads")
os.makedirs(UPLOAD_DIR, exist_ok=True)
app.mount("/uploads", StaticFiles(directory=UPLOAD_DIR), name="uploads")

# Informational (non-secret)
print("AI Faculty Eval API starting...")
print("Loaded HF model:", os.getenv("HF_MODEL", "not-set"))
print("Running with DEBUG CORS origins:", FRONTEND_ORIGINS)

def try_register_router(module_path: str, prefix: str) -> bool:
    """
    Import module_path and include its 'router' attribute at the given prefix.
    Returns True on success, False on failure.
    """
    try:
        module = __import__(module_path, fromlist=["router"])
        router = getattr(module, "router", None)
        if router is None:
            print(f"Module {module_path} imported but has no 'router' attribute; skipping {prefix}.")
            return False
        app.include_router(router, prefix=prefix)
        print(f"Registered router from {module_path} at {prefix}")
        return True
    except Exception:
        print(f"Warning: failed to import {module_path} — skipping {prefix}.")
        traceback.print_exc()
        return False

# Register core routers (adjust module paths if your router names differ)
try_register_router("app.routers.auth", "/api/auth")
try_register_router("app.routers.users", "/api/users")
try_register_router("app.routers.submissions", "/api/submissions")

# Optional routers
try_register_router("app.routers.reports", "/api/reports")
try_register_router("app.routers.ai", "/api/ai")

# Health endpoints
@app.get("/api/health")
def health_check():
    return {"status": "ok", "service": "AI Faculty Eval API"}

@app.get("/_routes")
def list_routes():
    """Return a friendly list of registered routes and methods (development aid)."""
    routes = []
    for r in app.routes:
        try:
            methods = list(getattr(r, "methods", []) or [])
            routes.append({"path": r.path, "name": getattr(r, "name", None), "methods": methods})
        except Exception:
            routes.append({"path": getattr(r, "path", str(r)), "name": getattr(r, "name", None)})
    return {"routes": routes}

if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv("PORT", 8000))
    uvicorn.run("app.main:app", host="0.0.0.0", port=port, reload=True)
