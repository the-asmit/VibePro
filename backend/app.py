"""Signed VibePro registry, anonymous usage statistics, and static site."""
from __future__ import annotations

import base64
import hashlib
import json
import logging
import os
import re
import time
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Literal

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.middleware import SlowAPIMiddleware
from slowapi.util import get_remote_address
from sqlalchemy import DateTime, Integer, String, create_engine, func, select
from sqlalchemy.orm import DeclarativeBase, Mapped, Session, mapped_column
from sqlalchemy.pool import StaticPool
from sqlalchemy.schema import CreateIndex, CreateTable

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_ENGINE_DIR = ROOT / "engine"
WEB_DIR = ROOT / "web"
UPSTREAM = "https://github.com/cloudflare/security-audit-skill"
MAX_REQUEST_BYTES = int(os.getenv("MAX_REQUEST_BYTES", "1048576"))
VERSION_PATTERN = re.compile(r"^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$")


class JsonLogFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        return json.dumps({"timestamp": datetime.now(timezone.utc).isoformat(), "level": record.levelname.lower(), "logger": record.name, "message": record.getMessage()}, separators=(",", ":"))


handler = logging.StreamHandler()
handler.setFormatter(JsonLogFormatter())
logging.basicConfig(level=os.getenv("LOG_LEVEL", "INFO"), handlers=[handler], force=True)
logger = logging.getLogger("vibepro")


class Base(DeclarativeBase):
    pass


class InstallEvent(Base):
    __tablename__ = "install_events"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    event: Mapped[str] = mapped_column(String(16), nullable=False, index=True)
    agent: Mapped[str] = mapped_column(String(24), nullable=False, index=True)
    version: Mapped[str] = mapped_column(String(40), nullable=False)
    os: Mapped[str] = mapped_column(String(16), nullable=False, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, index=True)


class ManifestFile(BaseModel):
    path: str
    sha256: str
    size: int


class Manifest(BaseModel):
    name: str
    version: str
    upstream: str
    license: str
    files: list[ManifestFile]


class Version(BaseModel):
    version: str
    latest: bool


class EventIn(BaseModel):
    event: Literal["install", "update", "uninstall"]
    agent: Literal["codex", "claude", "cursor", "antigravity", "gemini"]
    version: str = Field(min_length=1, max_length=40, pattern=r"^[A-Za-z0-9.+-]+$")
    os: Literal["win32", "darwin", "linux"]


class RequestBodyLimitMiddleware:
    """Buffer bounded POST bodies so chunked requests cannot bypass the limit."""
    def __init__(self, app, max_bytes: int):
        self.app, self.max_bytes = app, max_bytes

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http" or scope.get("method") != "POST":
            return await self.app(scope, receive, send)
        content_length = next((v.decode("latin-1") for k, v in scope.get("headers", []) if k.lower() == b"content-length"), None)
        if content_length and content_length.isdigit() and int(content_length) > self.max_bytes:
            return await JSONResponse({"detail": "Request body too large"}, status_code=413)(scope, receive, send)
        messages, total = [], 0
        while True:
            message = await receive()
            if message["type"] == "http.disconnect":
                return
            total += len(message.get("body", b""))
            if total > self.max_bytes:
                return await JSONResponse({"detail": "Request body too large"}, status_code=413)(scope, receive, send)
            messages.append(message)
            if not message.get("more_body", False):
                break
        async def replay():
            if messages:
                return messages.pop(0)
            return await receive()
        await self.app(scope, replay, send)


def canonical_manifest(manifest: Manifest) -> bytes:
    return json.dumps(manifest.model_dump(mode="json"), sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")


def load_private_key(value: str):
    value = value.strip()
    if not value:
        raise RuntimeError("VIBEPRO_SIGNING_KEY is required; create one with backend/scripts/generate_keys.py")
    if value.startswith("base64:"):
        value = base64.b64decode(value[7:], validate=True).decode("ascii")
    try:
        key = serialization.load_pem_private_key(value.encode("utf-8"), password=None)
    except Exception as exc:
        raise RuntimeError("VIBEPRO_SIGNING_KEY must contain an Ed25519 PEM private key (plain PEM or base64:PEM)") from exc
    if not isinstance(key, Ed25519PrivateKey):
        raise RuntimeError("VIBEPRO_SIGNING_KEY must be Ed25519")
    return key


def key_fingerprint(public_key) -> str:
    public_der = public_key.public_bytes(serialization.Encoding.DER, serialization.PublicFormat.SubjectPublicKeyInfo)
    return hashlib.sha256(public_der).hexdigest()


def discover_versions(engine_root: Path) -> dict[str, Path]:
    if (engine_root / "SKILL.md").is_file():
        return {"1.0.0": engine_root.resolve()}
    root = engine_root.resolve(strict=True)
    result = {}
    for candidate in root.iterdir():
        if candidate.is_dir() and VERSION_PATTERN.fullmatch(candidate.name) and (candidate / "SKILL.md").is_file():
            result[candidate.name] = candidate.resolve()
    if not result:
        raise RuntimeError(f"No versioned audit engines found under {root}")
    return result


def version_key(value: str) -> tuple:
    match = re.match(r"^(\d+)\.(\d+)\.(\d+)(.*)$", value)
    suffix = match.group(4)
    # Stable releases sort above prereleases of the same numeric version.
    return tuple(map(int, match.group(1, 2, 3))) + (1 if not suffix or suffix.startswith("+") else 0, suffix)


def build_manifest(engine_dir: Path, version: str) -> tuple[Manifest, dict[str, Path]]:
    root = engine_dir.resolve(strict=True)
    files: list[ManifestFile] = []
    paths: dict[str, Path] = {}
    for candidate in sorted(root.rglob("*")):
        if not candidate.is_file():
            continue
        resolved = candidate.resolve(strict=True)
        if not resolved.is_relative_to(root):
            continue
        relative = resolved.relative_to(root).as_posix()
        data = resolved.read_bytes()
        files.append(ManifestFile(path=relative, sha256=hashlib.sha256(data).hexdigest(), size=len(data)))
        paths[relative] = resolved
    return Manifest(name="vibepro-audit", version=version, upstream=UPSTREAM, license="MIT", files=files), paths


def _database(url: str):
    kwargs = {"connect_args": {"check_same_thread": False}} if url.startswith("sqlite") else {}
    if url in {"sqlite://", "sqlite:///:memory:"}:
        kwargs["poolclass"] = StaticPool
    if url.startswith("sqlite:////"):
        db_path = Path(url[10:])
        db_path.parent.mkdir(parents=True, exist_ok=True)
    engine = create_engine(url, future=True, **kwargs)
    if url.startswith("sqlite"):
        # Gunicorn workers can initialize a new database concurrently. Keep the
        # existence check inside each SQLite DDL statement, including indexes.
        with engine.begin() as connection:
            for table in Base.metadata.sorted_tables:
                connection.execute(CreateTable(table, if_not_exists=True))
                for index in table.indexes:
                    connection.execute(CreateIndex(index, if_not_exists=True))
    else:
        Base.metadata.create_all(engine)
    return engine


def create_app(engine_dir: Path | None = None, version: str | None = None, web_dir: Path | None = None, *, signing_key=None, database_url: str | None = None) -> FastAPI:
    configured_engine = Path(engine_dir or os.getenv("ENGINE_DIR", str(DEFAULT_ENGINE_DIR))).expanduser()
    configured_version = version or os.getenv("VERSION", "latest")
    configured_web = Path(web_dir or WEB_DIR)
    db_url = database_url or os.getenv("DATABASE_URL")
    if not db_url and os.getenv("VERCEL") == "1":
        raise RuntimeError("DATABASE_URL must point to persistent storage for a Vercel deployment.")
    db_url = db_url or "sqlite:///./vibepro.db"
    limiter = Limiter(key_func=get_remote_address, default_limits=["120/minute"])

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        versions = discover_versions(configured_engine)
        latest = max(versions, key=version_key)
        selected = latest if configured_version == "latest" else configured_version
        if selected not in versions:
            raise RuntimeError(f"VERSION {selected!r} is unavailable; available versions: {', '.join(sorted(versions, key=version_key))}")
        app.state.versions = versions
        app.state.latest_version = latest
        app.state.selected_version = selected
        app.state.manifests = {}
        app.state.file_maps = {}
        for ver, directory in versions.items():
            app.state.manifests[ver], app.state.file_maps[ver] = build_manifest(directory, ver)
        app.state.signing_key = signing_key or load_private_key(os.getenv("VIBEPRO_SIGNING_KEY", ""))
        app.state.key_id = key_fingerprint(app.state.signing_key.public_key())
        app.state.db_engine = _database(db_url)
        logger.info("service_started version=%s engine_versions=%s", selected, len(versions))
        yield
        app.state.db_engine.dispose()

    app = FastAPI(title="VibePro API", version="1.0.0", lifespan=lifespan)
    app.state.limiter = limiter
    app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
    app.add_middleware(SlowAPIMiddleware)
    app.add_middleware(RequestBodyLimitMiddleware, max_bytes=MAX_REQUEST_BYTES)
    origins = [item.strip() for item in os.getenv("CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173,http://localhost:8000,http://127.0.0.1:8000").split(",") if item.strip()]
    app.add_middleware(CORSMiddleware, allow_origins=origins, allow_credentials=False, allow_methods=["GET", "POST"], allow_headers=["Content-Type", "Accept"])

    @app.middleware("http")
    async def security_headers_and_logging(request: Request, call_next):
        started = time.monotonic()
        response = await call_next(request)
        # Revalidate page code so saved tabs do not keep an older installer
        # command after an update. Fonts and release downloads remain cacheable.
        if response.headers.get("content-type", "").split(";", 1)[0] in {
            "text/html", "text/javascript", "application/javascript", "text/css"
        }:
            response.headers["Cache-Control"] = "no-cache"
        response.headers["Content-Security-Policy"] = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; connect-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'"
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        response.headers["X-Frame-Options"] = "DENY"
        if request.url.scheme == "https" or request.headers.get("x-forwarded-proto", "").split(",")[0].strip() == "https":
            response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
        logger.info("request method=%s path=%s status=%s duration_ms=%.1f", request.method, request.url.path, response.status_code, (time.monotonic() - started) * 1000)
        return response

    def version_or_404(value: str) -> str:
        version = app.state.latest_version if value == "latest" else value
        if version not in app.state.versions:
            raise HTTPException(status_code=404, detail="Version not found")
        return version

    def signed(version: str) -> dict:
        manifest = app.state.manifests[version]
        signature = app.state.signing_key.sign(canonical_manifest(manifest))
        return {"manifest": manifest.model_dump(mode="json"), "signature": base64.b64encode(signature).decode("ascii"), "key_id": app.state.key_id}

    @app.get("/health")
    @limiter.limit("120/minute")
    async def health(request: Request) -> dict[str, str]:
        return {"status": "ok"}

    @app.get("/api/v1/manifest", response_model=Manifest)
    @limiter.limit("120/minute")
    async def get_manifest(request: Request, version: str | None = None) -> Manifest:
        selected = version_or_404(version or app.state.selected_version)
        return app.state.manifests[selected]

    @app.get("/api/v1/manifest/signed")
    @limiter.limit("120/minute")
    async def get_signed_manifest(request: Request, version: str | None = None) -> dict:
        return signed(version_or_404(version or app.state.selected_version))

    @app.get("/api/v1/versions", response_model=list[Version])
    @limiter.limit("120/minute")
    async def versions(request: Request) -> list[Version]:
        return [Version(version=value, latest=value == app.state.latest_version) for value in sorted(app.state.versions, key=version_key, reverse=True)]

    @app.get("/api/v1/files/{file_path:path}")
    @limiter.limit("120/minute")
    async def get_file(request: Request, file_path: str):
        return file_for(app.state.selected_version, file_path)

    @app.get("/api/v1/versions/{version}/files/{file_path:path}")
    @limiter.limit("120/minute")
    async def get_version_file(request: Request, version: str, file_path: str):
        return file_for(version_or_404(version), file_path)

    def file_for(version: str, file_path: str):
        normalized = file_path.replace("\\", "/")
        parts = normalized.split("/")
        if (not normalized or normalized.startswith("/") or ".." in parts or "." in parts
                or "\x00" in normalized or ":" in normalized):
            raise HTTPException(status_code=400, detail="Invalid file path")
        candidate = app.state.file_maps[version].get(normalized)
        if candidate is None:
            raise HTTPException(status_code=404, detail="File not found")
        try:
            if not candidate.resolve(strict=True).is_relative_to(app.state.versions[version]):
                raise HTTPException(status_code=400, detail="Invalid file path")
            return FileResponse(candidate, media_type="application/octet-stream", filename=candidate.name)
        except FileNotFoundError:
            raise HTTPException(status_code=404, detail="File not found") from None

    @app.post("/api/v1/events", status_code=202)
    @limiter.limit("30/minute")
    async def create_event(request: Request, event: EventIn) -> dict[str, str]:
        if not re.fullmatch(r"\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?", event.version):
            raise HTTPException(status_code=422, detail="Invalid version")
        record = InstallEvent(event=event.event, agent=event.agent, version=event.version, os=event.os, created_at=datetime.now(timezone.utc))
        with Session(app.state.db_engine) as session:
            session.add(record)
            session.commit()
        return {"status": "accepted"}

    @app.get("/api/v1/stats")
    @limiter.limit("120/minute")
    async def stats(request: Request) -> dict:
        since = datetime.now(timezone.utc) - timedelta(days=30)
        with Session(app.state.db_engine) as session:
            total = session.scalar(select(func.count()).select_from(InstallEvent).where(InstallEvent.event.in_(["install", "update"]))) or 0
            by_agent = {name: count for name, count in session.execute(select(InstallEvent.agent, func.count()).where(InstallEvent.event.in_(["install", "update"])).group_by(InstallEvent.agent))}
            by_os = {name: count for name, count in session.execute(select(InstallEvent.os, func.count()).where(InstallEvent.event.in_(["install", "update"])).group_by(InstallEvent.os))}
            last_30_days = session.scalar(select(func.count()).select_from(InstallEvent).where(InstallEvent.created_at >= since, InstallEvent.event.in_(["install", "update"]))) or 0
        return {"total_installs": total, "by_agent": by_agent, "by_os": by_os, "last_30_days": last_30_days}

    if configured_web.is_dir():
        app.mount("/", StaticFiles(directory=configured_web, html=True), name="website")
    return app


app = create_app()
