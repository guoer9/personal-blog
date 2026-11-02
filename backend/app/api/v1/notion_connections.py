"""Admin-only creation of private Notion connections; no remote mutations."""

from __future__ import annotations

import asyncio
import json

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field, SecretStr, field_validator, model_validator
from starlette.concurrency import run_in_threadpool

from app.api.deps import get_current_admin
from app.services.notion_credentials import (
    ConnectionSummary,
    NotionConnectionCredential,
    NotionCredentialDuplicateError,
    NotionCredentialStore,
)
from app.services.notion_library import NotionLibraryClient, NotionLibraryError, notion_library_service


class CreateConnectionRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True, hide_input_in_errors=True)

    label: str = Field(min_length=1, max_length=100)
    token: SecretStr = Field(min_length=1, max_length=4096)

    @field_validator("label", "token", mode="before")
    @classmethod
    def trim_string(cls, value: object) -> str:
        if not isinstance(value, str):
            raise ValueError("Expected text")
        return value.strip()

    @field_validator("token")
    @classmethod
    def header_safe_token(cls, value: SecretStr) -> SecretStr:
        if any(not 33 <= ord(char) <= 126 for char in value.get_secret_value()):
            raise ValueError("Invalid credential")
        return value

    @model_validator(mode="after")
    def private_label(self) -> "CreateConnectionRequest":
        if self.token.get_secret_value() in self.label:
            raise ValueError("The connection name must not contain its credential")
        return self


router = APIRouter(prefix="/admin/notion", dependencies=[Depends(get_current_admin)])


def get_credential_store() -> NotionCredentialStore:
    # Reuse the exact catalog used by GET /connections and source imports.
    return notion_library_service.credentials


@router.post(
    "/connections",
    status_code=201,
    response_model=ConnectionSummary,
    openapi_extra={"requestBody": {
        "required": True,
        "content": {"application/json": {"schema": CreateConnectionRequest.model_json_schema()}},
    }},
)
async def create_connection(
    request: Request,
    store: NotionCredentialStore = Depends(get_credential_store),
) -> ConnectionSummary:
    # A framework body parameter would echo invalid input in its default 422.
    # Parse manually so malformed JSON and every schema/type failure stay private.
    try:
        async with asyncio.timeout(5):
            body = bytearray()
            async for chunk in request.stream():
                if len(body) + len(chunk) > 16_384:
                    raise HTTPException(413, "连接请求过大")
                body.extend(chunk)
    except TimeoutError:
        raise HTTPException(408, "连接请求超时") from None

    try:
        payload = CreateConnectionRequest.model_validate(json.loads(body))
    except (ValueError, TypeError, RecursionError):
        raise HTTPException(422, "请提供有效的连接名称和 Notion 密钥") from None

    credential = NotionConnectionCredential(id="verification", label=payload.label, token=payload.token)
    try:
        async with asyncio.timeout(25):
            async with NotionLibraryClient(credential) as client:
                await client.request("GET", "/users/me")
    except NotionLibraryError as error:
        # Map only known safe categories; never forward an upstream body/exception.
        if str(error) == "Notion 授权失败或尚未授予只读访问权限":
            raise HTTPException(400, "Notion 密钥无效或没有访问权限") from None
        raise HTTPException(502, "无法验证 Notion 连接，请稍后重试") from None
    except TimeoutError:
        raise HTTPException(504, "Notion 连接验证超时，请稍后重试") from None
    except Exception:
        raise HTTPException(502, "无法验证 Notion 连接，请稍后重试") from None

    try:
        return await run_in_threadpool(store.add, payload.label, payload.token.get_secret_value())
    except NotionCredentialDuplicateError:
        raise HTTPException(409, "此 Notion 密钥已经配置连接") from None
    except Exception:
        raise HTTPException(503, "Notion 连接暂时无法保存，请检查连接文件配置") from None
