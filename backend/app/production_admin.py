"""Explicit production administrator bootstrap.

This command is intentionally separate from application startup. It reads the
administrator password from the process environment and never prints it.
"""

from __future__ import annotations

import asyncio
import os
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.security import get_password_hash
from app.db.session import AsyncSessionLocal, engine
from app.models.user import User


def _required(name: str) -> str:
    value = os.environ.get(name, "").strip()
    if not value:
        raise RuntimeError(f"{name} must be set for production administrator bootstrap")
    return value


def _enabled(name: str) -> bool:
    return os.environ.get(name, "false").strip().lower() in {"1", "true", "yes", "on"}


async def ensure_admin(
    db: AsyncSession,
    *,
    username: str,
    email: str,
    password: str,
    update_password: bool,
) -> str:
    user = await db.scalar(select(User).where(User.username == username))
    if user is None:
        user = User(
            username=username,
            email=email,
            hashed_password=get_password_hash(password),
            is_admin=True,
            is_active=True,
            created_at=datetime.now(timezone.utc).replace(tzinfo=None),
        )
        db.add(user)
        await db.flush()
        return "created"

    changed = False
    if user.email != email:
        user.email = email
        changed = True
    if not user.is_admin:
        user.is_admin = True
        changed = True
    if not user.is_active:
        user.is_active = True
        changed = True
    if update_password:
        user.hashed_password = get_password_hash(password)
        changed = True
    if changed:
        await db.flush()
    return "password-updated" if update_password else ("updated" if changed else "unchanged")


async def main() -> None:
    if settings.ENVIRONMENT.lower() != "production":
        raise RuntimeError("This bootstrap only runs when ENVIRONMENT=production")

    username = _required("ADMIN_USERNAME")
    email = _required("ADMIN_EMAIL")
    password = _required("ADMIN_PASSWORD")
    if len(password) < 20:
        raise RuntimeError("ADMIN_PASSWORD must contain at least 20 characters")

    try:
        async with AsyncSessionLocal() as db:
            result = await ensure_admin(
                db,
                username=username,
                email=email,
                password=password,
                update_password=_enabled("ADMIN_UPDATE_PASSWORD"),
            )
            await db.commit()
            print(f"Production administrator {result}: {username}")
    finally:
        await engine.dispose()


if __name__ == "__main__":
    asyncio.run(main())
