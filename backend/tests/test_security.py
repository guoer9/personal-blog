import asyncio
from io import BytesIO

import pytest
from fastapi import HTTPException, UploadFile

from app.api import deps
from app.api.v1 import auth as auth_api
from app.api.v1.files import validate_file
from app.core.config import Settings
from app.core.security import create_access_token, create_refresh_token
from app.models.user import User
from app.schemas.user import TokenRefresh


class _Result:
    def __init__(self, value):
        self.value = value

    def scalar_one_or_none(self):
        return self.value


class _Db:
    def __init__(self, value):
        self.value = value

    async def execute(self, _query):
        return _Result(self.value)


def test_refresh_token_cannot_authenticate_as_access_token():
    user = User(id=1, username="alice", email="alice@example.com", is_active=True)
    token = create_refresh_token(user.id)

    current_user = asyncio.run(deps.get_current_user(_Db(user), token))

    assert current_user is None


def test_access_token_authenticates_active_user():
    user = User(id=1, username="alice", email="alice@example.com", is_active=True)
    token = create_access_token(user.id)

    current_user = asyncio.run(deps.get_current_user(_Db(user), token))

    assert current_user is user


def test_production_settings_reject_placeholder_secret():
    with pytest.raises(ValueError):
        Settings(
            ENVIRONMENT="production",
            SECRET_KEY="your-super-secret-key-change-in-production-use-openssl-rand-hex-32",
        )


def test_refresh_requires_active_user(monkeypatch):
    inactive_user = User(id=1, username="alice", email="alice@example.com", is_active=False)

    async def get_inactive_user(_db, _user_id):
        return inactive_user

    monkeypatch.setattr(auth_api, "get_user_by_id", get_inactive_user)

    with pytest.raises(HTTPException) as error:
        asyncio.run(
            auth_api.refresh_token(
                TokenRefresh(refresh_token=create_refresh_token(inactive_user.id)),
                _Db(None),
            )
        )

    assert error.value.status_code == 401


def test_upload_rejects_disallowed_extension():
    upload = UploadFile(BytesIO(b"not an image"), filename="payload.exe")

    with pytest.raises(HTTPException) as error:
        validate_file(upload)

    assert error.value.status_code == 400


def test_upload_rejects_mismatched_mime_type():
    upload = UploadFile(
        BytesIO(b"not an image"),
        filename="payload.png",
        headers={"content-type": "text/plain"},
    )

    with pytest.raises(HTTPException) as error:
        validate_file(upload)

    assert error.value.status_code == 400
