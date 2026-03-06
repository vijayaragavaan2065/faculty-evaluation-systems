# backend/app/database.py
"""
Database connection helper.

- If MONGO_URI and MONGO_DB_NAME are set in the environment, connect using pymongo.
- Otherwise expose a lightweight stub `db` object so handlers don't crash during UI development.
"""

import os
import sys
import traceback

MONGO_URI = os.getenv("MONGO_URI", "").strip()
MONGO_DB_NAME = os.getenv("MONGO_DB_NAME", "ai_faculty_eval")

# Simple stub collection to mimic pymongo Collection.find behaviour for dev mode.
class _StubCursor(list):
    def __init__(self, data=None):
        super().__init__(data or [])

    def __iter__(self):
        return super().__iter__()

    def limit(self, n):
        return _StubCursor(self[:n])

class _StubCollection:
    def __init__(self, name):
        self._name = name
        self._data = []

    def find(self, *args, **kwargs):
        # Return an empty cursor by default (safe)
        return _StubCursor([])

    def insert_one(self, doc):
        # append and mimic pymongo InsertOneResult with inserted_id
        self._data.append(doc)
        class _Res: inserted_id = len(self._data) - 1
        return _Res()

    def find_one(self, *args, **kwargs):
        return None

class _StubDB:
    def __init__(self):
        self._collections = {}

    def __getattr__(self, item):
        if item not in self._collections:
            self._collections[item] = _StubCollection(item)
        return self._collections[item]

    def get_collection(self, name):
        return getattr(self, name)

# Try to create a real pymongo connection if URI provided
if MONGO_URI:
    try:
        from pymongo import MongoClient

        client = MongoClient(MONGO_URI, serverSelectionTimeoutMS=5000)
        # Test the connection (will raise if can't connect)
        client.server_info()
        db = client[MONGO_DB_NAME]
        print(f"[database] Connected to MongoDB: {MONGO_URI} -> DB: {MONGO_DB_NAME}")
    except Exception:
        print("[database] Failed to connect to MongoDB. Falling back to in-memory stub DB.")
        traceback.print_exc()
        db = _StubDB()
else:
    print("[database] No MONGO_URI provided — using in-memory stub DB for development.")
    db = _StubDB()

# Export db variable for other modules to import
__all__ = ["db"]
