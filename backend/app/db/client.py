# backend/app/db/client.py
from motor.motor_asyncio import AsyncIOMotorClient
from app.core.config import MONGO_URI, MONGO_DB_NAME

# Create client and explicitly select the DB by name (avoids get_default_database errors)
client = AsyncIOMotorClient(MONGO_URI)
db = client.get_database(MONGO_DB_NAME)
