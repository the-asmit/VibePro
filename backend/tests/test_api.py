import base64
import hashlib
import json
from pathlib import Path

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from fastapi.testclient import TestClient

from backend.app import InstallEvent, _database, create_app


def test_concurrent_sqlite_startup_creates_tables_and_indexes_once(tmp_path):
    from concurrent.futures import ThreadPoolExecutor
    from threading import Barrier
    from sqlalchemy import inspect

    url = 'sqlite:///' + (tmp_path / 'shared.db').as_posix()
    ready = Barrier(4)

    def initialize(_):
        ready.wait(timeout=5)
        engine = _database(url)
        engine.dispose()

    with ThreadPoolExecutor(max_workers=4) as workers:
        list(workers.map(initialize, range(4)))
    engine = _database(url)
    try:
        assert inspect(engine).has_table('install_events')
        assert len(inspect(engine).get_indexes('install_events')) == 4
    finally:
        engine.dispose()


def make_client(tmp_path: Path, web_dir: Path | None = None, *, engine_root: Path | None = None) -> TestClient:
    engine = engine_root or tmp_path / "engine"
    if engine_root is None:
        engine.mkdir(parents=True)
        (engine / "SKILL.md").write_text("hello engine", encoding="utf-8")
        (engine / "nested").mkdir()
        (engine / "nested" / "guide.md").write_text("guide", encoding="utf-8")
    return TestClient(create_app(
        engine_dir=engine,
        version="latest" if engine_root else "1.0.0",
        web_dir=web_dir or tmp_path / "missing",
        signing_key=Ed25519PrivateKey.generate(),
        database_url="sqlite://",
    ))


def test_manifest_hashes_match_files(tmp_path):
    with make_client(tmp_path) as client:
        response = client.get("/api/v1/manifest")
        assert response.status_code == 200
        manifest = response.json()
        assert manifest["name"] == "vibepro-audit"
        assert manifest["version"] == "1.0.0"
        for item in manifest["files"]:
            content = client.get("/api/v1/files/" + item["path"]).content
            assert hashlib.sha256(content).hexdigest() == item["sha256"]
            assert len(content) == item["size"]


def test_signed_manifest_is_ed25519_and_canonical(tmp_path):
    with make_client(tmp_path) as client:
        envelope = client.get("/api/v1/manifest/signed").json()
        public = client.app.state.signing_key.public_key()
        public_der = public.public_bytes(serialization.Encoding.DER, serialization.PublicFormat.SubjectPublicKeyInfo)
        expected_id = hashlib.sha256(public_der).hexdigest()
        assert envelope["key_id"] == expected_id
        signature = base64.b64decode(envelope["signature"])
        public.verify(signature, json.dumps(envelope["manifest"], sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode())


def test_tampering_changes_signed_payload(tmp_path):
    with make_client(tmp_path) as client:
        envelope = client.get("/api/v1/manifest/signed").json()
        envelope["manifest"]["version"] = "9.9.9"
        signature = base64.b64decode(envelope["signature"])
        payload = json.dumps(envelope["manifest"], sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()
        try:
            client.app.state.signing_key.public_key().verify(signature, payload)
        except Exception:
            pass
        else:
            raise AssertionError("tampered manifest verified")


def test_path_traversal_is_blocked(tmp_path):
    with make_client(tmp_path) as client:
        for path in ("%2e%2e%2fsecret", "nested%2f..%2f..%2fsecret", "C%3a%2fsecret"):
            assert client.get("/api/v1/files/" + path).status_code == 400


def test_unknown_file_and_version_return_404(tmp_path):
    with make_client(tmp_path) as client:
        assert client.get("/api/v1/files/not-here.md").status_code == 404
        assert client.get("/api/v1/manifest/signed?version=9.9.9").status_code == 404


def test_health_versions_and_static_site(tmp_path):
    web = tmp_path / "web"
    web.mkdir()
    (web / "index.html").write_text("<h1>VibePro</h1>", encoding="utf-8")
    with make_client(tmp_path, web) as client:
        assert client.get("/health").json() == {"status": "ok"}
        assert client.get("/api/v1/versions").json() == [{"version": "1.0.0", "latest": True}]
        assert "VibePro" in client.get("/").text
        headers = client.get("/health", headers={"x-forwarded-proto": "https"}).headers
        assert headers["x-content-type-options"] == "nosniff"
        assert "max-age=31536000" in headers["strict-transport-security"]


def test_events_are_anonymous_and_aggregated(tmp_path):
    with make_client(tmp_path) as client:
        for event, agent, os_name in [("install", "codex", "win32"), ("update", "codex", "win32"), ("install", "cursor", "darwin")]:
            response = client.post("/api/v1/events", json={"event": event, "agent": agent, "version": "1.0.0", "os": os_name})
            assert response.status_code == 202
        stats = client.get("/api/v1/stats").json()
        assert stats == {"total_installs": 3, "by_agent": {"codex": 2, "cursor": 1}, "by_os": {"darwin": 1, "win32": 2}, "last_30_days": 3}
        invalid = client.post("/api/v1/events", json={"event": "install", "agent": "codex", "version": "1.0.0", "os": "plan9", "ip": "203.0.113.5"})
        assert invalid.status_code == 422
        assert "ip" not in InstallEvent.__table__.columns


def test_latest_selects_highest_release(tmp_path):
    releases = tmp_path / "engine"
    for version, content in [("1.0.0", "old"), ("1.2.0", "new")]:
        folder = releases / version
        folder.mkdir(parents=True)
        (folder / "SKILL.md").write_text(content, encoding="utf-8")
    with make_client(tmp_path, engine_root=releases) as client:
        manifest = client.get("/api/v1/manifest").json()
        assert manifest["version"] == "1.2.0"
        assert client.get("/api/v1/versions").json() == [
            {"version": "1.2.0", "latest": True}, {"version": "1.0.0", "latest": False}
        ]
        assert client.get("/api/v1/manifest?version=1.0.0").json()["version"] == "1.0.0"


def test_request_body_limit_rejects_large_event(tmp_path):
    with make_client(tmp_path) as client:
        response = client.post("/api/v1/events", content=b"x" * (1024 * 1024 + 1), headers={"content-type": "application/json"})
        assert response.status_code == 413
