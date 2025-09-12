# backend/migrate_users.py
import json, asyncio, os
from app.services.user_service import create_user
from dotenv import load_dotenv

load_dotenv()

async def migrate():
    p = os.path.join(os.path.dirname(__file__), "users.json")
    if not os.path.exists(p):
        print("no users.json found, skipping")
        return
    with open(p, "r") as f:
        users = json.load(f)
    for email, u in users.items():
        print("creating", email)
        await create_user(email, u.get("password_hash") and "SetANewPassword123!" or "password", u.get("name","Imported"), u.get("role","faculty"))

if __name__ == "__main__":
    asyncio.run(migrate())
