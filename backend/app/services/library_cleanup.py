"""Run from backend: venv/bin/python -m app.services.library_cleanup.

Schedule periodically on the same host, using the API's database and storage
configuration. Only upload fragments are removed; completed files/trash are kept.
"""

import asyncio

from app.db.session import AsyncSessionLocal, engine
from app.services.library import cleanup_expired_sessions


async def main():
    try:
        count = await cleanup_expired_sessions(AsyncSessionLocal)
        print(f"Expired upload sessions cleaned: {count}")
    finally:
        await engine.dispose()


if __name__ == "__main__":
    asyncio.run(main())
