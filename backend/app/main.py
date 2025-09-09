from fastapi import FastAPI

app = FastAPI(title="AI Faculty Eval - Backend")

@app.get("/api/health")
async def health():
    return {"status": "ok", "message": "FastAPI backend is running"}
