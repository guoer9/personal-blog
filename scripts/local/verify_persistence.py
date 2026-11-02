#!/usr/bin/env python3
"""Restart only blog-local, then compare public content and a synthetic private file."""
import hashlib
import json
from pathlib import Path
import subprocess
import sys
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[2]
ORIGIN = 'http://127.0.0.1:8001/api/v1'
OUTPUT = ROOT / 'output/research-profile'
CONFIG = dict(line.split('=', 1) for line in (ROOT / '.env.local-workspace').read_text().splitlines() if line and not line.startswith('#'))


def request(path, token=None, data=None, binary=False):
    headers = {'Content-Type': 'application/json'}
    if token:
        headers['Authorization'] = 'Bearer ' + token
    with urlopen(Request(ORIGIN + path, data=json.dumps(data).encode() if data else None, headers=headers), timeout=30) as response:
        content = response.read()
        return content if binary else json.loads(content)


def snapshot(folder_name, filename):
    token = request('/auth/login/json', data={'username': CONFIG['LOCAL_ADMIN_USERNAME'], 'password': CONFIG['LOCAL_ADMIN_PASSWORD']})['access_token']
    works = request('/works')['items']
    root = request('/library/entries', token)['items']
    folder = next(entry for entry in root if entry['name'] == folder_name)
    entries = request('/library/entries?parent_id=' + folder['id'], token)['items']
    entry = next(item for item in entries if item['name'] == filename)
    private_hash = hashlib.sha256(request('/library/entries/' + entry['id'] + '/download', token, binary=True)).hexdigest()
    media = {}
    for url in sorted({work[role] for work in works for role in ('cover', 'video', 'audio') if work.get(role)}):
        with urlopen(Request('http://127.0.0.1:8001' + url, headers={'Range': 'bytes=0-4095'}), timeout=30) as response:
            assert response.status == 206
            media[url] = {'range': response.headers['Content-Range'], 'sample_sha256': hashlib.sha256(response.read()).hexdigest()}
    return {'works': works, 'root_entries': root, 'folder_entries': entries, 'private_sha256': private_hash, 'public_media_samples': media}


def main():
    browser = json.loads((OUTPUT / 'browser-workflow/result.json').read_text())
    args = (browser['library']['folder'], browser['library']['filename'])
    before = snapshot(*args)
    with (OUTPUT / 'persistence-restart.log').open('w') as log:
        for action in ('stop', 'start'):
            subprocess.run([sys.executable, str(ROOT / 'scripts/local/dev.py'), action], cwd=ROOT, check=True, stdout=log, stderr=subprocess.STDOUT)
    after = snapshot(*args)
    assert before == after, 'Local content changed across restart'
    result = {'passed': True, 'services_restarted': ['blog-local-api', 'blog-local-database'], 'public_works': len(after['works']), 'slugs': [work['slug'] for work in after['works']], 'private_root_entries': len(after['root_entries']), 'synthetic_file_bytes': browser['library']['size'], 'private_sha256': after['private_sha256'], 'public_media_range_samples': len(after['public_media_samples']), 'all_metadata_equal': True}
    (OUTPUT / 'persistence-result.json').write_text(json.dumps(result, indent=2))
    print(json.dumps(result, indent=2))


if __name__ == '__main__':
    main()
