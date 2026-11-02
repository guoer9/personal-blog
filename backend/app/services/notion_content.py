"""Preserve supported Notion blocks as safe data and privately snapshot images."""
from dataclasses import dataclass
import asyncio
import hashlib
import os
from pathlib import Path
import re
import tempfile
from typing import Any
from urllib.parse import urlparse
from uuid import UUID

import httpx
from PIL import Image, ImageOps
from pillow_heif import register_heif_opener

from app.core.config import settings
from app.services.notion_sync import NotionSyncError, NotionSyncService


class NotionContentError(NotionSyncError):
    pass


@dataclass
class ContentSnapshot:
    markdown: str
    blocks: list[dict[str, Any]]
    plain_text: str


COLORS = {'default', 'gray', 'brown', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink', 'red'}
COLORS |= {color + '_background' for color in list(COLORS) if color != 'default'}
MEDIA_HOSTS = {'prod-files-secure.s3.us-west-2.amazonaws.com', 's3.us-west-2.amazonaws.com', 's3-us-west-2.amazonaws.com'}
MAX_IMAGE_BYTES = 10 * 1024 * 1024
MAX_PAGE_IMAGE_BYTES = 50 * 1024 * 1024
MAX_HEIC_PIXELS = 40_000_000
register_heif_opener()


def transcode_heic(path: Path) -> None:
    """Decode bounded iPhone photos and omit source metadata from web output."""
    try:
        # r+b never recreates a path unlinked by cancellation in the owner task.
        # A running worker may finish writing its open, unlinked descriptor.
        with path.open('r+b') as output, Image.open(output) as image:
            if image.width * image.height > MAX_HEIC_PIXELS or image.format != 'HEIF':
                raise NotionContentError('Notion HEIC 图片超过尺寸上限或格式无效')
            with ImageOps.exif_transpose(image).convert('RGB') as converted:
                output.seek(0)
                output.truncate()
                converted.save(output, format='JPEG', quality=90)
                output.flush()
                os.fsync(output.fileno())
    except NotionContentError:
        raise
    except Exception:
        raise NotionContentError('Notion HEIC 图片无法转换') from None


def media_directory(page_id: str, storage_root: Path | None = None) -> Path:
    normalized = str(UUID(page_id))
    root = (storage_root or Path(settings.PRIVATE_STORAGE_DIR)).resolve()
    directory = root / 'notion-media' / normalized
    for path in (root, root / 'notion-media', directory):
        if path.is_symlink():
            raise NotionContentError('Notion 图片存储目录不可用')
        path.mkdir(mode=0o700, parents=True, exist_ok=True)
    return directory


def image_type(header: bytes) -> str | None:
    if header.startswith(b'\x89PNG\r\n\x1a\n'): return 'png'
    if header.startswith(b'\xff\xd8\xff'): return 'jpg'
    if header.startswith((b'GIF87a', b'GIF89a')): return 'gif'
    if header[:4] == b'RIFF' and header[8:12] == b'WEBP': return 'webp'
    return None


def safe_link(value: Any) -> str | None:
    if not isinstance(value, str) or len(value) > 2048: return None
    try:
        parsed = urlparse(value)
        if parsed.scheme not in {'http', 'https', 'mailto'} or parsed.username or parsed.password: return None
        if parsed.scheme != 'mailto' and not parsed.hostname: return None
    except ValueError:
        return None
    return value


class NotionContentReader:
    def __init__(self, client, *, storage_root: Path | None = None, media_transport=None):
        self.client = client
        self.storage_root = storage_root
        self.media_transport = media_transport
        self.reader = NotionSyncService()
        self.block_count = 0
        self.char_count = 0
        self.image_bytes = 0
        self.plain: list[str] = []

    def rich(self, rows: Any) -> list[dict[str, Any]]:
        if not isinstance(rows, list): raise NotionContentError('Notion 富文本不完整')
        result = []
        for row in rows:
            if not isinstance(row, dict) or not isinstance(row.get('plain_text'), str):
                raise NotionContentError('Notion 富文本不完整')
            annotations = row.get('annotations') or {}
            if not isinstance(annotations, dict): raise NotionContentError('Notion 文本样式不完整')
            text = row['plain_text']
            self.char_count += len(text)
            if self.char_count > 500_000: raise NotionContentError('Notion 页面超过内容上限')
            link = (row.get('text') or {}).get('link') if isinstance(row.get('text'), dict) else None
            href = row.get('href') or (link.get('url') if isinstance(link, dict) else None)
            if href and not safe_link(href): raise NotionContentError('Notion 页面含不支持的链接')
            color = annotations.get('color', 'default')
            result.append({'text': text, **{key: annotations.get(key) is True for key in ('bold', 'italic', 'underline', 'strikethrough', 'code')}, 'color': color if color in COLORS else 'default', 'href': href or None})
        self.plain.append(''.join(item['text'] for item in result))
        return result

    async def image(self, page_id: str, url: Any) -> str:
        try:
            parsed = urlparse(url if isinstance(url, str) else '')
            trusted = parsed.scheme == 'https' and parsed.hostname in MEDIA_HOSTS and not parsed.username and not parsed.password and parsed.port is None
        except ValueError:
            trusted = False
        if not trusted: raise NotionContentError('Notion 图片来源暂不支持安全快照')
        directory = media_directory(page_id, self.storage_root)
        temporary: Path | None = None
        try:
            # Separate client: never forward the Notion API Authorization header.
            async with httpx.AsyncClient(timeout=30, follow_redirects=False, transport=self.media_transport) as client:
                async with client.stream('GET', url) as response:
                    if response.status_code != 200: raise NotionContentError('Notion 图片读取失败')
                    if int(response.headers.get('content-length', '0')) > MAX_IMAGE_BYTES: raise NotionContentError('Notion 图片超过 10 MiB 上限')
                    fd, name = tempfile.mkstemp(prefix='.download-', dir=directory)
                    temporary = Path(name)
                    digest = hashlib.sha256()
                    size = 0
                    header = b''
                    with os.fdopen(fd, 'wb') as output:
                        async for chunk in response.aiter_bytes():
                            size += len(chunk); self.image_bytes += len(chunk)
                            if size > MAX_IMAGE_BYTES or self.image_bytes > MAX_PAGE_IMAGE_BYTES: raise NotionContentError('Notion 图片超过安全快照上限')
                            if len(header) < 16: header += chunk[:16 - len(header)]
                            output.write(chunk); digest.update(chunk)
                        output.flush(); os.fsync(output.fileno())
                    if header[4:8] == b'ftyp' and header[8:12] in {b'heic', b'heix', b'hevc', b'hevx', b'mif1', b'msf1'}:
                        await asyncio.to_thread(transcode_heic, temporary)
                        converted_size = temporary.stat().st_size
                        self.image_bytes += converted_size - size
                        if converted_size > MAX_IMAGE_BYTES or self.image_bytes > MAX_PAGE_IMAGE_BYTES:
                            raise NotionContentError('Notion 图片超过安全快照上限')
                        digest = hashlib.sha256(temporary.read_bytes())
                        extension = 'jpg'
                    else:
                        extension = image_type(header)
                    if not extension: raise NotionContentError('Notion 图片格式无法安全显示')
                    asset = digest.hexdigest() + '.' + extension
                    temporary.replace(directory / asset); temporary = None
                    return f'/api/v1/documents/media/{str(UUID(page_id))}/{asset}'
        except NotionContentError:
            raise
        except (httpx.HTTPError, ValueError, OSError):
            raise NotionContentError('Notion 图片读取失败') from None
        finally:
            if temporary: temporary.unlink(missing_ok=True)

    async def read(self, page_id: str) -> ContentSnapshot:
        blocks, markdown = await self.children(page_id, page_id, 0, frozenset())
        return ContentSnapshot(markdown, blocks, '\n'.join(self.plain))

    async def children(self, block_id: str, page_id: str, depth: int, ancestors: frozenset[str]):
        if depth > 16 or block_id in ancestors: raise NotionContentError('Notion 内容层级无法完整读取')
        rows = await self.reader._read_children(self.client, block_id)
        blocks, lines = [], []
        for row in rows:
            self.block_count += 1
            if self.block_count > 10_000: raise NotionContentError('Notion 页面超过内容块上限')
            kind, current_id = row.get('type'), row.get('id')
            data = row.get(kind)
            if not isinstance(kind, str) or not isinstance(current_id, str) or not isinstance(data, dict) or not isinstance(row.get('has_children'), bool):
                raise NotionContentError('Notion 内容块不完整')
            node: dict[str, Any] = {'id': current_id, 'type': kind}
            line = ''
            if kind in {'paragraph', 'heading_1', 'heading_2', 'heading_3', 'bulleted_list_item', 'numbered_list_item', 'to_do', 'quote', 'callout', 'toggle', 'code'}:
                node['text'] = self.rich(data.get('rich_text'))
                node['color'] = data.get('color') if data.get('color') in COLORS else 'default'
                if kind in {'heading_1', 'heading_2', 'heading_3'}:
                    node['is_toggleable'] = data.get('is_toggleable') is True
                if kind == 'to_do': node['checked'] = data.get('checked') is True
                if kind == 'code': node['language'] = str(data.get('language', 'plain text'))[:40]
                if kind == 'callout':
                    icon = data.get('icon') or {}
                    node['icon'] = icon.get('emoji', '')[:30] if isinstance(icon, dict) and icon.get('type') == 'emoji' else ''
                line = ''.join(item['text'] for item in node['text'])
            elif kind == 'image':
                node['caption'] = self.rich(data.get('caption', []))
                source = data.get(data.get('type'))
                if not isinstance(source, dict): raise NotionContentError('Notion 图片信息不完整')
                node['url'] = await self.image(page_id, source.get('url'))
                line = f"![{''.join(item['text'] for item in node['caption'])}]({node['url']})"
            elif kind == 'table':
                table_rows = await self.reader._read_children(self.client, current_id)
                self.block_count += len(table_rows)
                if self.block_count > 10_000 or not table_rows: raise NotionContentError('Notion 表格不完整')
                node['rows'] = []
                width = data.get('table_width')
                for table_row in table_rows:
                    cells = (table_row.get('table_row') or {}).get('cells')
                    if table_row.get('type') != 'table_row' or not isinstance(cells, list) or len(cells) != width: raise NotionContentError('Notion 表格列数不完整')
                    node['rows'].append([self.rich(cell) for cell in cells])
                node['has_column_header'] = data.get('has_column_header') is True
                node['has_row_header'] = data.get('has_row_header') is True
                line = '\n'.join(' | '.join(''.join(item['text'] for item in cell) for cell in cells) for cells in node['rows'])
            elif kind in {'divider', 'column_list', 'column'}:
                pass
            elif kind in {'bookmark', 'link_preview', 'embed'}:
                node['url'] = safe_link(data.get('url'))
                if not node['url']: raise NotionContentError('Notion 引用链接无法读取')
                node['caption'] = self.rich(data.get('caption', [])); line = node['url']
            else:
                raise NotionContentError(f'暂不支持完整呈现的 Notion 内容块：{kind}')
            if row['has_children'] and kind != 'table':
                if kind in {'image', 'code', 'divider', 'bookmark', 'link_preview', 'embed'}: raise NotionContentError('Notion 内容块含未支持的嵌套内容')
                node['children'], nested = await self.children(current_id, page_id, depth + 1, ancestors | {block_id})
                if nested: line += '\n' + nested
            blocks.append(node)
            if line: lines.append(line)
        return blocks, '\n\n'.join(lines).strip()
