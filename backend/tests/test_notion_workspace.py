import httpx
import pytest
from sqlalchemy import select, func
from tests.test_notion_library import notion_library_db, library_credentials, NotionLibraryScenario, PAGE_SAFE, library_page_url, library_database_url
from app.models import NotionDocument, NotionSource
from app.services.notion_library import NotionLibraryService, NotionLibraryError, parse_notion_source_url


def test_new_app_page_links_are_supported_but_developer_and_workspace_home_are_not():
    parsed = parse_notion_source_url('https://app.notion.com/p/2026-10-15-3f99bf4896c9801e9d6bd0899bf1f2cd?source=copy_link')
    assert parsed.entity_id == '3f99bf48-96c9-801e-9d6b-d0899bf1f2cd'
    for url in ['https://app.notion.com/developers/connections/40b9bf48-96c9-81fc-8048-00274c345534', 'https://app.notion.com/library/private?spaceId=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa']:
        with pytest.raises(NotionLibraryError): parse_notion_source_url(url)


@pytest.mark.asyncio
async def test_notion_page_probe_400_falls_back_without_suppressing_other_validation_errors(tmp_path):
    from app.services.notion_library import NotionLibraryClient
    credential = library_credentials(tmp_path).get_connection('primary')
    messages = iter(['Provided database_id is a page, not a database. Use the pages API instead.', 'Invalid database input'])
    async def handler(request):
        return httpx.Response(400, json={'code': 'validation_error', 'message': next(messages)})
    async with NotionLibraryClient(credential, httpx.MockTransport(handler)) as client:
        assert await client.get_database(PAGE_SAFE, allow_not_found=True) is None
        with pytest.raises(NotionLibraryError): await client.get_database(PAGE_SAFE, allow_not_found=True)


@pytest.mark.asyncio
async def test_workspace_directory_is_selected_connection_only_and_returns_safe_metadata(tmp_path):
    requests = []
    async def handler(request):
        requests.append(request)
        assert request.headers['Authorization'] == 'Bearer unit-test-token'
        assert request.url.path == '/v1/search'
        return httpx.Response(200, json={
            'results': [
                {'object': 'page', 'id': PAGE_SAFE, 'properties': {'title': {'type': 'title', 'title': [{'plain_text': '目录笔记'}]}}, 'url': 'https://evil.example/ignored', 'last_edited_time': '2026-11-02T01:00:00Z'},
                {'object': 'data_source', 'id': 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'parent': {'database_id': 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'}, 'title': [{'plain_text': '资料数据库'}]},
            ], 'has_more': True, 'next_cursor': 'next-page',
        })
    service = NotionLibraryService(library_credentials(tmp_path), httpx.MockTransport(handler))
    result = await service.browse_workspace('primary', 'cursor-1', '目录')
    assert result['items'][0] == {'id': PAGE_SAFE, 'kind': 'page', 'title': '目录笔记', 'url': 'https://www.notion.so/dddddddddddddddddddddddddddddddd', 'last_edited_at': '2026-11-02T01:00:00+00:00'}
    assert result['items'][1]['kind'] == 'database'
    assert result['items'][1]['id'] == 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
    assert result['next_cursor'] == 'next-page'
    assert 'token' not in str(result) and 'evil.example' not in str(result)
    import json
    assert json.loads(requests[0].content) == {'page_size': 50, 'start_cursor': 'cursor-1', 'query': '目录'}
    with pytest.raises(NotionLibraryError): await service.browse_workspace('unknown')
    assert len(requests) == 1


@pytest.mark.asyncio
async def test_standalone_page_preview_import_sync_and_failure_preserve_snapshot(notion_library_db, tmp_path):
    factory, admin_id = notion_library_db
    scenario = NotionLibraryScenario()
    scenario.pages[PAGE_SAFE]['parent'] = {'type': 'workspace', 'workspace': True}
    service = NotionLibraryService(library_credentials(tmp_path), scenario.transport(), str(tmp_path / 'lock'))
    async with factory() as db:
        preview = await service.inspect(db, 'primary', library_page_url())
        assert preview['source_type'] == 'page'
        assert preview['page_count'] == 1 and preview['publishable_count'] == 1
        assert await db.scalar(select(func.count(NotionDocument.id))) == 0
        await service.import_source(db, 'primary', library_page_url(), admin_id)
        await db.commit()
        source = await db.scalar(select(NotionSource))
        assert source.source_type == 'page' and source.data_source_ids == []
        document = await db.scalar(select(NotionDocument))
        assert document.content == '安全正文' and document.status == 'published'
        scenario.pages[PAGE_SAFE]['_test_body'] = '修改后的安全正文'
        await service.sync(db, source.id, admin_id); await db.commit()
        assert document.content == '修改后的安全正文'
        assert await db.scalar(select(func.count(NotionDocument.id))) == 1
        del scenario.pages[PAGE_SAFE]
        with pytest.raises(NotionLibraryError): await service.sync(db, source.id, admin_id)
        assert document.content == '修改后的安全正文' and document.status == 'published'


@pytest.mark.asyncio
async def test_standalone_block_read_failure_retains_last_published_snapshot(notion_library_db, tmp_path):
    factory, admin_id = notion_library_db
    scenario = NotionLibraryScenario()
    scenario.pages[PAGE_SAFE]['parent'] = {'type': 'workspace', 'workspace': True}
    service = NotionLibraryService(library_credentials(tmp_path), scenario.transport(), str(tmp_path / 'lock'))
    async with factory() as db:
        await service.import_source(db, 'primary', library_page_url(), admin_id); await db.commit()
        document = await db.scalar(select(NotionDocument)); source = await db.scalar(select(NotionSource))
        scenario.block_failure.add(PAGE_SAFE)
        with pytest.raises(NotionLibraryError): await service.sync(db, source.id, admin_id)
        assert document.status == 'published' and document.content == '安全正文'


@pytest.mark.asyncio
async def test_standalone_secret_and_archived_pages_are_not_published(notion_library_db, tmp_path):
    factory, admin_id = notion_library_db
    scenario = NotionLibraryScenario()
    scenario.pages[PAGE_SAFE]['parent'] = {'type': 'workspace', 'workspace': True}
    scenario.pages[PAGE_SAFE]['_test_body'] = 'password = "some-sensitive-password"'
    service = NotionLibraryService(library_credentials(tmp_path), scenario.transport(), str(tmp_path / 'lock'))
    async with factory() as db:
        await service.import_source(db, 'primary', library_page_url(), admin_id); await db.commit()
        document = await db.scalar(select(NotionDocument))
        source = await db.scalar(select(NotionSource))
        assert document.status == 'isolated' and document.content == ''
        scenario.pages[PAGE_SAFE]['archived'] = True
        await service.sync(db, source.id, admin_id); await db.commit()
        assert document.status == 'archived' and document.content == ''


@pytest.mark.asyncio
async def test_workspace_selected_database_page_import_is_scoped_to_one_page(notion_library_db, tmp_path):
    factory, admin_id = notion_library_db
    scenario = NotionLibraryScenario()
    service = NotionLibraryService(library_credentials(tmp_path), scenario.transport(), str(tmp_path / 'lock'))
    async with factory() as db:
        await service.import_source(db, 'primary', library_database_url(), admin_id); await db.commit()
        preview = await service.inspect(db, 'primary', library_page_url())
        assert preview['import_scope'] == 'page'
        scenario.pages[PAGE_SAFE]['_test_body'] = '选中页面的修改'
        await service.import_source(db, 'primary', library_page_url(), admin_id); await db.commit()
        document = await db.scalar(select(NotionDocument).where(NotionDocument.notion_page_id == PAGE_SAFE))
        assert document.content == '选中页面的修改'
        assert await db.scalar(select(func.count(NotionDocument.id))) == 2


@pytest.mark.asyncio
async def test_workspace_directory_requires_admin(client, admin_token, monkeypatch):
    from app.api.v1 import notion as notion_api
    calls = []
    class DirectoryService:
        async def browse_workspace(self, connection_id, cursor, query):
            calls.append((connection_id, cursor, query))
            return {'items': [], 'next_cursor': None}
    monkeypatch.setattr(notion_api, 'notion_library_service', DirectoryService())
    url = '/api/v1/admin/notion/connections/primary/workspace?cursor=next&q=技术'
    assert (await client.get(url)).status_code == 401
    assert calls == []
    result = await client.get(url, headers={'Authorization': f'Bearer {admin_token}'})
    assert result.status_code == 200 and result.json() == {'items': [], 'next_cursor': None}
    assert calls == [('primary', 'next', '技术')]
