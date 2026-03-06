from fastapi import FastAPI
from app.routers import submissions

app = FastAPI()

# Register the submissions router
app.include_router(submissions.router, prefix="/api/submissions", tags=["submissions"])
