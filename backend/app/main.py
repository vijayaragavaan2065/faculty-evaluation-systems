# app/main.py
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

# import your routers
from app.routers import auth, users, submissions  # adjust imports if different

app = FastAPI(title="AI Faculty Eval API")

# Development-friendly list of allowed origins (include 5173 and 5174)
FRONTEND_ORIGINS = [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "http://localhost:5174",   # <-- your current Vite origin
    "http://127.0.0.1:5174",
    "http://localhost:3000",
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=FRONTEND_ORIGINS,   # use ["*"] only for quick local tests
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# include routers AFTER middleware (order here is fine)
app.include_router(auth.router, prefix="/api/auth")
app.include_router(users.router, prefix="/api/users")
app.include_router(submissions.router, prefix="/api/submissions")
