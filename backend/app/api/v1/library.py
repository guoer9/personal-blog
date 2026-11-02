from uuid import UUID
from urllib.parse import quote

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.background import BackgroundTask

from app.api.deps import get_current_admin
from app.db.session import get_db
from app.schemas.library import EntryList, EntryResponse, EntryUpdate, FolderCreate, StorageStatus, UploadCreate, UploadResponse
from app.services.library import LibraryService
from app.services.library_storage import IO_BLOCK_SIZE

router = APIRouter(dependencies=[Depends(get_current_admin)])


async def library_service(db: AsyncSession = Depends(get_db)):
    try:
        yield LibraryService(db)
    except OSError:
        raise HTTPException(507, "Private storage I/O failed; retry after checking available space") from None


@router.get("/entries", response_model=EntryList)
async def entries(parent_id: UUID | None = None, trash: bool = False, service: LibraryService = Depends(library_service)):
    return await service.list_entries(parent_id, trash)


@router.get("/status", response_model=StorageStatus)
async def status(service: LibraryService = Depends(library_service)):
    return await service.status()


@router.post("/folders", response_model=EntryResponse)
async def create_folder(data: FolderCreate, service: LibraryService = Depends(library_service)):
    return await service.create_folder(data)


@router.patch("/entries/{entry_id}", response_model=EntryResponse)
async def update_entry(entry_id: UUID, data: EntryUpdate, service: LibraryService = Depends(library_service)):
    return await service.update_entry(entry_id, data)


@router.delete("/entries/{entry_id}", status_code=204)
async def delete_entry(entry_id: UUID, service: LibraryService = Depends(library_service)):
    await service.delete_entry(entry_id)
    return Response(status_code=204)


@router.post("/entries/{entry_id}/restore", response_model=EntryResponse)
async def restore_entry(entry_id: UUID, service: LibraryService = Depends(library_service)):
    return await service.restore_entry(entry_id)


@router.get("/entries/{entry_id}/download")
async def download(entry_id: UUID, service: LibraryService = Depends(library_service)):
    entry, file = await service.open_download(entry_id)

    def blocks():
        try:
            remaining = entry.size
            while remaining:
                block = file.read(min(IO_BLOCK_SIZE, remaining))
                if not block:
                    break
                remaining -= len(block)
                yield block
        finally:
            file.close()

    return StreamingResponse(blocks(), media_type="application/octet-stream", headers={
        "Content-Length": str(entry.size),
        "Content-Disposition": f"attachment; filename*=utf-8''{quote(entry.name, safe='')}",
        "X-Content-Type-Options": "nosniff", "Cache-Control": "private, no-store",
    }, background=BackgroundTask(file.close))


@router.post("/uploads", response_model=UploadResponse)
async def init_upload(data: UploadCreate, service: LibraryService = Depends(library_service)):
    return await service.init_upload(data)


@router.get("/uploads/{upload_id}", response_model=UploadResponse)
async def get_upload(upload_id: UUID, service: LibraryService = Depends(library_service)):
    return await service.get_upload(upload_id)


@router.put("/uploads/{upload_id}/parts/{index}", status_code=204)
async def put_part(upload_id: UUID, index: int, request: Request, service: LibraryService = Depends(library_service)):
    await service.put_part(upload_id, index, request)
    return Response(status_code=204)


@router.post("/uploads/{upload_id}/complete", response_model=EntryResponse)
async def complete_upload(upload_id: UUID, service: LibraryService = Depends(library_service)):
    return await service.complete_upload(upload_id)


@router.delete("/uploads/{upload_id}", status_code=204)
async def cancel_upload(upload_id: UUID, service: LibraryService = Depends(library_service)):
    await service.cancel_upload(upload_id)
    return Response(status_code=204)
