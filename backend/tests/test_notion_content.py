import json
import httpx
import pytest


PAGE = 'dddddddd-dddd-dddd-dddd-dddddddddddd'


def block(kind, payload, id='block-1', children=False):
    return {'id': id, 'type': kind, kind: payload, 'has_children': children}


class BlocksClient:
    def __init__(self, rows): self.rows = rows
    async def list_block_children(self, block_id, cursor=None):
        return {'results': self.rows.get(block_id, []), 'has_more': False, 'next_cursor': None}


@pytest.mark.asyncio
async def test_native_blocks_preserve_rich_text_todos_tables_and_empty_paragraphs(tmp_path):
    from app.services.notion_content import NotionContentReader
    rows = {PAGE: [
        block('heading_2', {'is_toggleable': True, 'rich_text': [{'plain_text': '<literal> 标题', 'annotations': {'bold': True, 'underline': True, 'color': 'blue'}}]}),
        block('paragraph', {'rich_text': []}, 'empty'),
        block('to_do', {'rich_text': [{'plain_text': '完成事项'}], 'checked': True}, 'todo', True),
        block('table', {'table_width': 2, 'has_column_header': False, 'has_row_header': True}, 'table', True),
    ], 'todo': [block('paragraph', {'rich_text': [{'plain_text': '嵌套说明'}]}, 'child')],
        'table': [block('table_row', {'cells': [[{'plain_text': '左格'}], [{'plain_text': '右格'}]]}, 'row')]}
    content = await NotionContentReader(BlocksClient(rows), storage_root=tmp_path).read(PAGE)
    assert content.blocks[0]['text'][0] == {'text': '<literal> 标题', 'bold': True, 'italic': False, 'underline': True, 'strikethrough': False, 'code': False, 'color': 'blue', 'href': None}
    assert content.blocks[0]['is_toggleable'] is True
    assert content.blocks[1]['type'] == 'paragraph' and content.blocks[1]['text'] == []
    assert content.blocks[2]['checked'] is True
    assert content.blocks[2]['children'][0]['text'][0]['text'] == '嵌套说明'
    assert content.blocks[3]['has_column_header'] is False and content.blocks[3]['has_row_header'] is True
    assert content.blocks[3]['rows'][0][1][0]['text'] == '右格'
    assert '嵌套说明' in content.markdown


@pytest.mark.asyncio
async def test_notion_images_are_copied_privately_without_auth_or_expiring_urls(tmp_path):
    from app.services.notion_content import NotionContentReader
    png = b'\x89PNG\r\n\x1a\n' + b'safe-image-test'
    requests = []
    async def download(request):
        requests.append(request)
        assert 'Authorization' not in request.headers
        return httpx.Response(200, content=png, headers={'Content-Type': 'image/png'})
    signed = 'https://prod-files-secure.s3.us-west-2.amazonaws.com/test/image.png?X-Amz-Signature=private-signature'
    rows = {PAGE: [block('image', {'type': 'file', 'file': {'url': signed}, 'caption': [{'plain_text': '图片说明'}]})]}
    content = await NotionContentReader(BlocksClient(rows), storage_root=tmp_path, media_transport=httpx.MockTransport(download)).read(PAGE)
    url = content.blocks[0]['url']
    assert url.startswith('/api/v1/documents/media/' + PAGE + '/') and url.endswith('.png')
    saved = list((tmp_path / 'notion-media' / PAGE).glob('*.png'))
    assert len(saved) == 1 and saved[0].read_bytes() == png
    assert 'X-Amz' not in json.dumps(content.blocks) and 'private-signature' not in content.markdown
    assert len(requests) == 1


@pytest.mark.asyncio
async def test_private_images_reject_untrusted_hosts_and_active_formats(tmp_path):
    from app.services.notion_content import NotionContentReader, NotionContentError
    async def svg(request): return httpx.Response(200, content=b'<svg onload="alert(1)"></svg>')
    for url in ['http://127.0.0.1/admin', 'https://evil.example/image.png', 'https://prod-files-secure.s3.us-west-2.amazonaws.com/test/image.svg']:
        rows = {PAGE: [block('image', {'type': 'file', 'file': {'url': url}, 'caption': []})]}
        with pytest.raises(NotionContentError):
            await NotionContentReader(BlocksClient(rows), storage_root=tmp_path, media_transport=httpx.MockTransport(svg)).read(PAGE)
    assert not list(tmp_path.rglob('*.png'))


@pytest.mark.asyncio
async def test_iphone_heic_images_are_transcoded_to_browser_compatible_jpeg(tmp_path):
    from io import BytesIO
    from PIL import Image
    from pillow_heif import from_pillow
    from app.services.notion_content import NotionContentReader
    source = BytesIO()
    from_pillow(Image.new('RGB', (24, 16), '#20a070')).save(source)
    async def download(request):
        assert 'Authorization' not in request.headers
        return httpx.Response(200, content=source.getvalue(), headers={'Content-Type': 'image/heic'})
    rows = {PAGE: [block('image', {'type': 'file', 'file': {'url': 'https://prod-files-secure.s3.us-west-2.amazonaws.com/test/iphone.heic'}, 'caption': []})]}
    content = await NotionContentReader(BlocksClient(rows), storage_root=tmp_path, media_transport=httpx.MockTransport(download)).read(PAGE)
    assert content.blocks[0]['url'].endswith('.jpg')
    saved = list((tmp_path / 'notion-media' / PAGE).iterdir())
    assert len(saved) == 1
    with Image.open(saved[0]) as image:
        image.load()
        assert image.format == 'JPEG' and image.size == (24, 16)
        assert not image.getexif()


@pytest.mark.asyncio
async def test_cancelled_heic_conversion_cannot_recreate_cleaned_temporary_file(tmp_path, monkeypatch):
    import asyncio
    from io import BytesIO
    from threading import Event
    from PIL import Image
    from pillow_heif import from_pillow
    from app.services.notion_content import NotionContentReader
    source = BytesIO()
    from_pillow(Image.new('RGB', (24, 16), '#20a070')).save(source)
    started, release, finished = Event(), Event(), Event()
    save = Image.Image.save
    def delayed_save(image, target, *args, **kwargs):
        started.set()
        try:
            if not release.wait(3):
                raise AssertionError('conversion was not released')
            return save(image, target, *args, **kwargs)
        finally:
            finished.set()
    monkeypatch.setattr(Image.Image, 'save', delayed_save)
    async def download(request):
        return httpx.Response(200, content=source.getvalue())
    reader = NotionContentReader(BlocksClient({}), storage_root=tmp_path, media_transport=httpx.MockTransport(download))
    task = asyncio.create_task(reader.image(PAGE, 'https://prod-files-secure.s3.us-west-2.amazonaws.com/test/photo.heic'))
    try:
        assert await asyncio.to_thread(started.wait, 3)
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task
    finally:
        release.set()
    assert await asyncio.to_thread(finished.wait, 3)
    assert list((tmp_path / 'notion-media' / PAGE).iterdir()) == []


@pytest.mark.asyncio
@pytest.mark.parametrize('destination', ['https://example.com/?access_token=private-link-credential', 'https://example.com/ntn_abcdefghijklmnopqrstuvwxyz123456'])
async def test_credentials_in_link_destinations_are_isolated_before_publication(tmp_path, destination):
    from app.services.notion_library import NotionLibraryService, SourceSchema
    from app.services.notion_credentials import NotionCredentialStore
    from tests.test_notion_library import library_page
    client = BlocksClient({PAGE: [block('paragraph', {'rich_text': [{'plain_text': '普通链接', 'href': destination}]})]})
    service = NotionLibraryService(NotionCredentialStore(tmp_path / 'unused.json'))
    result = await service._render_page(client, library_page(PAGE, '普通标题', '随笔', ''), SourceSchema('标题', ()), None)
    assert result.status == 'isolated'
    assert result.content == ''
    assert destination not in str(result)
