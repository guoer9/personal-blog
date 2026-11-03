from app.core.security import verify_password
from app.models import User
from app.production_admin import ensure_admin


async def test_ensure_admin_creates_production_admin(db_session):
    result = await ensure_admin(
        db_session,
        username="guoer9",
        email="guoer9@example.com",
        password="a-strong-production-password",
        update_password=False,
    )

    assert result == "created"
    user = await db_session.get(User, 1)
    assert user is not None
    assert user.username == "guoer9"
    assert user.email == "guoer9@example.com"
    assert user.is_admin is True
    assert user.is_active is True
    assert verify_password("a-strong-production-password", user.hashed_password)


async def test_ensure_admin_preserves_password_until_explicit_update(db_session):
    db_session.add(
        User(
            username="guoer9",
            email="old@example.com",
            hashed_password="not-a-real-hash",
            is_admin=False,
            is_active=False,
        )
    )
    await db_session.commit()

    result = await ensure_admin(
        db_session,
        username="guoer9",
        email="guoer9@example.com",
        password="a-new-production-password",
        update_password=False,
    )

    assert result == "updated"
    user = await db_session.get(User, 1)
    assert user.email == "guoer9@example.com"
    assert user.is_admin is True
    assert user.is_active is True
    assert user.hashed_password == "not-a-real-hash"

    result = await ensure_admin(
        db_session,
        username="guoer9",
        email="guoer9@example.com",
        password="a-new-production-password",
        update_password=True,
    )

    assert result == "password-updated"
    await db_session.refresh(user)
    assert verify_password("a-new-production-password", user.hashed_password)
