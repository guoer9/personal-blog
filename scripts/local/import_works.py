#!/usr/bin/env python3
"""Import reviewed initial works through the same administrator API as the UI."""
import argparse
import json
import mimetypes
from pathlib import Path
from urllib.parse import urlsplit
import httpx

ROOT = Path(__file__).resolve().parents[2]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-url", default="http://127.0.0.1:8001")
    parser.add_argument("--asset-root", type=Path, default=ROOT / "backend/public-media/works")
    parser.add_argument("--publish", action="store_true", help="Explicitly publish newly imported works")
    args = parser.parse_args()
    if urlsplit(args.base_url).hostname not in {"127.0.0.1", "localhost", "::1"}:
        parser.error("The local importer only accepts a loopback server")
    values = {}
    for line in (ROOT / ".env.local-workspace").read_text().splitlines():
        if line and not line.startswith("#"):
            key, value = line.split("=", 1)
            values[key] = value
    source = json.loads((ROOT / "frontend/src/data/initial-works.json").read_text())
    state_file = ROOT / "output/research-profile/import-works-state.json"
    state_file.parent.mkdir(parents=True, exist_ok=True)
    state = json.loads(state_file.read_text()) if state_file.exists() else {}

    def checkpoint():
        state_file.write_text(json.dumps(state, ensure_ascii=False, indent=2))

    with httpx.Client(base_url=args.base_url + "/api/v1", timeout=180) as client:
        result = client.post("/auth/login/json", json={"username": values["LOCAL_ADMIN_USERNAME"], "password": values["LOCAL_ADMIN_PASSWORD"]})
        result.raise_for_status()
        client.headers["Authorization"] = "Bearer " + result.json()["access_token"]

        def api(method, path, **kwargs):
            response = client.request(method, path, **kwargs)
            if response.is_error:
                raise RuntimeError(f"{method} {path}: {response.status_code}: {response.text[:500]}")
            return response.json() if response.content else None

        existing = {item["slug"]: item for item in api("GET", "/admin/works")["items"]}
        for item in source["items"]:
            slug = item["slug"]
            if slug in existing and slug not in state:
                print("Existing work preserved: " + slug, flush=True)
                continue
            current = state.setdefault(slug, {"assets": {}, "uploads": {}})
            payload = {key: value for key, value in item.items() if key not in {"slug", "media_files"}}
            payload.update({role + "_asset_id": None for role in ("cover", "video", "audio")})
            record = existing.get(slug)
            if record and record["published"] is not None:
                print("Already published; preserved: " + slug, flush=True)
                continue
            if record is None:
                record = api("POST", "/admin/works", json={"slug": slug, **payload})
                current["id"] = record["id"]
                checkpoint()
            for role, relative in item["media_files"].items():
                if role not in current["assets"]:
                    path = (args.asset_root / relative).resolve(strict=True)
                    if args.asset_root.resolve() not in path.parents:
                        raise ValueError("Invalid import media path")
                    print("Preparing " + slug + "/" + role, flush=True)
                    session_id = current["uploads"].get(role)
                    if session_id:
                        session = api("GET", "/library/uploads/" + session_id)
                    else:
                        mime = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
                        session = api("POST", "/library/uploads", json={"name": slug + "-" + path.name, "size": path.stat().st_size, "mime_type": mime})
                        current["uploads"][role] = session["id"]
                        checkpoint()
                    with path.open("rb") as stream:
                        index = 0
                        while part := stream.read(session["chunk_size"]):
                            if index not in session["received_parts"]:
                                api("PUT", f"/library/uploads/{session['id']}/parts/{index}", content=part, headers={"Content-Type": "application/octet-stream"})
                            index += 1
                    entry = api("POST", f"/library/uploads/{session['id']}/complete")
                    current["assets"][role] = api("POST", "/admin/work-assets", json={"entry_id": entry["id"], "role": role})["id"]
                    checkpoint()
                payload[role + "_asset_id"] = current["assets"][role]
            record = api("PUT", "/admin/works/" + record["id"], json={"version": record["version"], **payload})
            if args.publish:
                record = api("POST", f"/admin/works/{record['id']}/publish", json={"version": record["version"]})
            current["version"] = record["version"]
            checkpoint()
            print(("Published " if args.publish else "Draft imported ") + slug, flush=True)


if __name__ == "__main__":
    main()
