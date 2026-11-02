"""Public API for temporary, code-protected visitor file transfers."""

import os
from typing import Annotated
from typing import Literal
from urllib.parse import quote

from fastapi import APIRouter, Depends, Header, HTTPException, Request, Response
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, ConfigDict, Field, field_validator
from starlette.background import BackgroundTask

from app.core.config import settings
from app.services.transfers import IO_BLOCK_BYTES, TransferService, get_transfer_service

router = APIRouter()


class TransferConfig(BaseModel):
    max_file_bytes: int
    chunk_bytes: int
    retention_seconds: int


class UploadCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    filename: str = Field(min_length=1, max_length=255)
    size: int = Field(gt=0)
    fingerprint: str

    @field_validator("filename")
    @classmethod
    def safe_filename(cls, value: str) -> str:
        if not value.strip() or any(ord(char) < 32 or ord(char) == 127 for char in value):
            raise ValueError("filename must be a printable name")
        return value

    @field_validator("fingerprint")
    @classmethod
    def sha256_fingerprint(cls, value: str) -> str:
        digest = value.removeprefix("sha256:")
        if len(digest) != 64 or any(char not in "0123456789abcdefABCDEF" for char in digest):
            raise ValueError("fingerprint must be sha256 followed by a 64-character hex digest")
        return "sha256:" + digest.lower()


class UploadCreated(BaseModel):
    upload_id: str
    upload_token: str
    code: str
    chunk_bytes: int
    expires_at: str


class UploadStatus(BaseModel):
    received_bytes: int
    size: int
    status: Literal["uploading", "completed"]
    expires_at: str


class CodeLookup(BaseModel):
    model_config = ConfigDict(extra="forbid")

    code: str = Field(min_length=1, max_length=128)


class LookupResult(BaseModel):
    filename: str
    size: int
    expires_at: str
    download_url: str


def _source(request: Request) -> str:
    return request.client.host if request.client is not None else "unknown"


@router.get("/config", response_model=TransferConfig)
async def transfer_config():
    return TransferConfig(
        max_file_bytes=settings.TRANSFER_MAX_FILE_BYTES,
        chunk_bytes=settings.TRANSFER_CHUNK_BYTES,
        retention_seconds=settings.TRANSFER_RETENTION_SECONDS,
    )


@router.post("/uploads", response_model=UploadCreated, status_code=201)
async def create_upload(
    data: UploadCreate,
    request: Request,
    service: TransferService = Depends(get_transfer_service),
):
    return await service.create_upload(data.filename, data.size, data.fingerprint, _source(request))


@router.get("/uploads/{upload_id}", response_model=UploadStatus)
async def get_upload(
    upload_id: str,
    token: Annotated[str | None, Header(alias="X-Upload-Token")] = None,
    service: TransferService = Depends(get_transfer_service),
):
    return await service.get_upload(upload_id, token)


@router.put("/uploads/{upload_id}/chunks/{index}", status_code=204)
async def put_chunk(
    upload_id: str,
    index: int,
    request: Request,
    token: Annotated[str | None, Header(alias="X-Upload-Token")] = None,
    service: TransferService = Depends(get_transfer_service),
):
    await service.put_chunk(upload_id, token, index, request)
    return Response(status_code=204)


@router.post("/uploads/{upload_id}/complete", response_model=UploadStatus)
async def complete_upload(
    upload_id: str,
    token: Annotated[str | None, Header(alias="X-Upload-Token")] = None,
    service: TransferService = Depends(get_transfer_service),
):
    return await service.complete_upload(upload_id, token)


@router.delete("/uploads/{upload_id}", status_code=204)
async def cancel_upload(
    upload_id: str,
    token: Annotated[str | None, Header(alias="X-Upload-Token")] = None,
    service: TransferService = Depends(get_transfer_service),
):
    await service.cancel_upload(upload_id, token)
    return Response(status_code=204)


@router.post("/lookup", response_model=LookupResult)
async def lookup_code(
    data: CodeLookup,
    request: Request,
    service: TransferService = Depends(get_transfer_service),
):
    return await service.lookup(data.code, _source(request), settings.API_V1_PREFIX)


@router.get("/download/{ticket}")
async def download(
    ticket: str,
    request: Request,
    service: TransferService = Depends(get_transfer_service),
):
    row, file_obj, status_code, start, end = await service.open_download(
        ticket, request.headers.get("range")
    )
    length = end - start + 1

    def blocks():
        remaining = length
        try:
            while remaining:
                block = file_obj.read(min(IO_BLOCK_BYTES, remaining))
                if not block:
                    break
                remaining -= len(block)
                yield block
        finally:
            file_obj.close()

    headers = {
        "Content-Length": str(length),
        "Content-Disposition": f"attachment; filename*=UTF-8''{quote(row['filename'], safe='')}",
        "Accept-Ranges": "bytes",
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "private, no-store",
    }
    if status_code == 206:
        headers["Content-Range"] = f"bytes {start}-{end}/{row['size']}"
    return StreamingResponse(
        blocks(), status_code=status_code, media_type="application/octet-stream", headers=headers,
        background=BackgroundTask(file_obj.close),
    )
