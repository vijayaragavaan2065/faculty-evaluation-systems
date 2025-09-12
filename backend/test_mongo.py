# backend/test_mongo.py
import os, certifi, asyncio
from motor.motor_asyncio import AsyncIOMotorClient

# Option A: read from env if you set MONGO_URI in backend/.env and load with python-dotenv
from dotenv import load_dotenv
load_dotenv()
MONGO_URI = os.getenv("MONGO_URI")

# Option B: alternatively, set MONGO_URI above directly (not recommended to paste secrets into chat)

print("Using CA bundle from certifi:", certifi.where())
client = AsyncIOMotorClient(MONGO_URI, tlsCAFile=certifi.where(), serverSelectionTimeoutMS=10000)

async def run():
    try:
        # Force a test operation
        db = client.get_database(os.getenv("MONGO_DB_NAME", "ai_faculty_eval"))
        names = await db.list_collection_names()
        print("OK — collections:", names)
    except Exception as e:
        print("ERROR connecting to MongoDB:")
        import traceback
        traceback.print_exc()

if __name__ == "__main__":
    asyncio.run(run())
