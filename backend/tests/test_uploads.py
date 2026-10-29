import httpx

from app.core.config import settings


async def test_upload_requires_authentication(client: httpx.AsyncClient):
    response = await client.post(
        "/api/v1/files/upload",
        files={"file": ("avatar.png", b"image-bytes", "image/png")},
    )

    assert response.status_code == 401


async def test_upload_rejects_oversized_content(
    client: httpx.AsyncClient,
    admin_token: str,
    monkeypatch,
):
    monkeypatch.setattr(settings, "MAX_UPLOAD_SIZE", 4)

    response = await client.post(
        "/api/v1/files/upload",
        headers={"Authorization": f"Bearer {admin_token}"},
        files={"file": ("avatar.png", b"12345", "image/png")},
    )

    assert response.status_code == 400
    assert "文件大小超过限制" in response.json()["detail"]
