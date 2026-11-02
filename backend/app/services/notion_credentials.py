"""Private credential catalog for named Notion internal connections."""

from __future__ import annotations

import contextlib
import fcntl
import json
import os
import re
import tempfile
import time
from pathlib import Path
from uuid import uuid4

from pydantic import BaseModel, ConfigDict, SecretStr


class NotionCredentialError(ValueError):
    """Sanitized credential configuration error."""


class NotionCredentialDuplicateError(NotionCredentialError):
    """The token already belongs to a configured connection."""


class ConnectionSummary(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str
    label: str
    configured: bool


class NotionConnectionCredential(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str
    label: str
    token: SecretStr


_CONNECTION_ID = re.compile(r"^[a-z0-9][a-z0-9_-]{0,63}$")
_MAX_CREDENTIAL_FILE_BYTES = 1_048_576


class NotionCredentialStore:
    """Reads credentials and serializes atomic additions under a stable file lock."""

    def __init__(self, path: str | Path) -> None:
        self.path = Path(path)

    def _read(self) -> list[NotionConnectionCredential]:
        try:
            if not self.path.exists():
                return []
            if not self.path.is_file() or self.path.stat().st_size > _MAX_CREDENTIAL_FILE_BYTES:
                raise NotionCredentialError("Notion connection file is invalid")
            payload = json.loads(self.path.read_text(encoding="utf-8"))
        except NotionCredentialError:
            raise
        except (OSError, UnicodeError, json.JSONDecodeError):
            # Do not include the parser message or file contents: either may
            # contain credentials pasted into a malformed file.
            raise NotionCredentialError("Notion connection file could not be read") from None

        if not isinstance(payload, dict) or set(payload) != {"version", "connections"}:
            raise NotionCredentialError("Notion connection file has an unsupported format")
        if type(payload.get("version")) is not int or payload["version"] != 1 or not isinstance(payload.get("connections"), list):
            raise NotionCredentialError("Notion connection file has an unsupported format")

        records: list[NotionConnectionCredential] = []
        seen: set[str] = set()
        for item in payload["connections"]:
            if not isinstance(item, dict) or set(item) != {"id", "label", "token"}:
                raise NotionCredentialError("Notion connection entry is invalid")
            connection_id = item.get("id")
            label = item.get("label")
            token = item.get("token")
            if (
                not isinstance(connection_id, str)
                or not _CONNECTION_ID.fullmatch(connection_id)
                or connection_id in seen
                or not isinstance(label, str)
                or not label.strip()
                or len(label) > 100
                or not isinstance(token, str)
                or not token.strip()
                or len(token) > 4096
            ):
                raise NotionCredentialError("Notion connection entry is invalid")
            seen.add(connection_id)
            records.append(NotionConnectionCredential(
                id=connection_id,
                label=label.strip(),
                token=SecretStr(token.strip()),
            ))
        return records

    def add(self, label: str, token: str) -> ConnectionSummary:
        # Validate before touching the filesystem, and never include input in errors.
        if not isinstance(label, str) or not isinstance(token, str):
            raise NotionCredentialError("Notion connection input is invalid")
        label, token = label.strip(), token.strip()
        if (
            not label or len(label) > 100
            or not token or len(token) > 4096
            or not re.fullmatch(r"[!-~]+", token)
            or token in label
        ):
            raise NotionCredentialError("Notion connection input is invalid")

        temporary_path: str | None = None
        try:
            self.path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
            # Never lock the replaced inode: every writer uses this stable sidecar.
            lock_fd = os.open(
                self.path.with_name(self.path.name + ".lock"),
                os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW,
                0o600,
            )
            try:
                os.fchmod(lock_fd, 0o600)
                deadline = time.monotonic() + 2.0
                while True:
                    try:
                        fcntl.flock(lock_fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
                        break
                    except BlockingIOError:
                        if time.monotonic() >= deadline:
                            raise NotionCredentialError("Notion connection file is busy") from None
                        time.sleep(0.01)

                if self.path.is_symlink():
                    raise NotionCredentialError("Notion connection file is invalid")
                records = self._read()  # Validate the entire current file before replacing it.
                if any(record.token.get_secret_value() == token for record in records):
                    raise NotionCredentialDuplicateError("Notion connection is already configured")
                connection_id = str(uuid4())
                while any(record.id == connection_id for record in records):
                    connection_id = str(uuid4())
                entries = [
                    {"id": record.id, "label": record.label, "token": record.token.get_secret_value()}
                    for record in records
                ]
                entries.append({"id": connection_id, "label": label, "token": token})
                content = json.dumps({"version": 1, "connections": entries}, ensure_ascii=False).encode("utf-8")
                if len(content) > _MAX_CREDENTIAL_FILE_BYTES:
                    raise NotionCredentialError("Notion connection file is full")
                with tempfile.NamedTemporaryFile(
                    mode="wb", prefix=".notion-connections-", dir=self.path.parent, delete=False,
                ) as temporary:
                    temporary_path = temporary.name
                    os.fchmod(temporary.fileno(), 0o600)
                    temporary.write(content)
                    temporary.flush()
                    os.fsync(temporary.fileno())
                os.replace(temporary_path, self.path)
                temporary_path = None
                return ConnectionSummary(id=connection_id, label=label, configured=True)
            finally:
                os.close(lock_fd)
        except NotionCredentialError:
            raise
        except Exception:
            raise NotionCredentialError("Notion connection could not be saved") from None
        finally:
            if temporary_path is not None:
                with contextlib.suppress(OSError):
                    os.unlink(temporary_path)

    def list_connections(self) -> list[ConnectionSummary]:
        return [
            ConnectionSummary(id=record.id, label=record.label, configured=True)
            for record in self._read()
        ]

    def get_connection(self, connection_id: str) -> NotionConnectionCredential:
        for record in self._read():
            if record.id == connection_id:
                return record
        raise NotionCredentialError("Notion connection is not configured")
