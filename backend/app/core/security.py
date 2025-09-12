# backend/app/core/security.py
import os
import datetime
from typing import Optional

from passlib.context import CryptContext
import jwt
from jwt import ExpiredSignatureError, InvalidTokenError

# password hashing
PWD_CTX = CryptContext(schemes=["bcrypt"], deprecated="auto")

# JWT config
JWT_SECRET = os.getenv("JWT_SECRET", "dev_secret_change_this")  # set env in prod
JWT_ALGORITHM = "HS256"
JWT_EXP_MINUTES = 60 * 24 * 7  # 7 days

# --- Password helpers ---
def get_password_hash(password: str) -> str:
    """
    Return a bcrypt hash for the given password.
    """
    return PWD_CTX.hash(password)

def verify_password(plain: str, hashed: str) -> bool:
    """
    Verify that a plain password matches a given bcrypt hash.
    """
    return PWD_CTX.verify(plain, hashed)

# --- JWT helpers ---
def create_access_token(subject: str, expires_delta: Optional[datetime.timedelta] = None) -> str:
    """
    Create a JWT with subject (sub) and expiration.
    """
    now = datetime.datetime.utcnow()
    if expires_delta is None:
        expires_delta = datetime.timedelta(minutes=JWT_EXP_MINUTES)
    exp = now + expires_delta
    payload = {
        "sub": subject,
        "iat": int(now.timestamp()),
        "exp": int(exp.timestamp()),
    }
    token = jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)
    return token

def decode_token(token: str) -> dict:
    """
    Decode and verify a JWT. Raises if expired or invalid.
    """
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        return payload
    except ExpiredSignatureError:
        raise
    except InvalidTokenError:
        raise
    except Exception:
        raise InvalidTokenError("Invalid token")
