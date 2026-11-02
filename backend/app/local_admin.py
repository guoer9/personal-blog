"""Explicit bootstrap for the isolated LOCAL template; not an application hook."""
import asyncio
from datetime import datetime, timezone
import os
from sqlalchemy import select
from app.core.config import settings
from app.core.security import get_password_hash
from app.db.session import AsyncSessionLocal, engine
from app.models.user import User


async def main():
    if settings.ENVIRONMENT != "local":
        raise RuntimeError("This bootstrap only runs in the isolated local template")
    password = os.environ.get("LOCAL_ADMIN_PASSWORD", "")
    if len(password) < 20:
        raise RuntimeError("Run the local template initializer first")
    try:
        async with AsyncSessionLocal() as db:
            if await db.scalar(select(User).where(User.username == "localadmin")):
                print("Local administrator already exists; password unchanged")
                return
            db.add(User(username="localadmin", email="localadmin@example.com", hashed_password=get_password_hash(password), is_admin=True, is_active=True,
                        created_at=datetime.now(timezone.utc).replace(tzinfo=None)))
            await db.commit()
            print("Local administrator created")
    finally:
        await engine.dispose()


if __name__ == "__main__":
    asyncio.run(main())
