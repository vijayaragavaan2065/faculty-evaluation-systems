# backend/app/core/config.py
import os
from dotenv import load_dotenv

load_dotenv()

MONGO_URI = os.getenv("MONGO_URI", "mongodb://localhost:27017")
MONGO_DB_NAME = os.getenv("MONGO_DB_NAME", "ai_faculty_eval")
JWT_SECRET = os.getenv("JWT_SECRET", "dev_secret_change_this")
