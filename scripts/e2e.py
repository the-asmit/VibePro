from __future__ import annotations

import base64
import os
import socket
import subprocess
import sys
import tempfile
import time
import urllib.request
from pathlib import Path

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

ROOT = Path(__file__).resolve().parents[1]
BACKEND = ROOT / "backend"
CLI = ROOT / "cli" / "bin" / "vibepro.js"
SAMPLE = ROOT / "web" / "sample-findings.json"


def free_port() -> int:
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


def call(args: list[str], env: dict[str, str], *, expected: int = 0) -> subprocess.CompletedProcess[str]:
    result = subprocess.run(args, cwd=ROOT, env=env, text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    print(result.stdout, end="")
    if result.returncode != expected:
        raise RuntimeError(f"Command {args!r} exited {result.returncode}, expected {expected}")
    return result


def main() -> None:
    with tempfile.TemporaryDirectory(prefix="vibepro-e2e-") as temp:
        base = Path(temp)
        home = base / "home"
        (home / ".codex" / "skills").mkdir(parents=True)
        port = free_port()
        private = Ed25519PrivateKey.generate()
        private_pem = private.private_bytes(
            serialization.Encoding.PEM,
            serialization.PrivateFormat.PKCS8,
            serialization.NoEncryption(),
        )
        public_pem = private.public_key().public_bytes(
            serialization.Encoding.PEM,
            serialization.PublicFormat.SubjectPublicKeyInfo,
        ).decode("ascii")
        api = f"http://127.0.0.1:{port}"
        env = os.environ.copy()
        env.update({
            "ENGINE_DIR": str(ROOT / "engine"),
            "VERSION": "latest",
            "VIBEPRO_SIGNING_KEY": "base64:" + base64.b64encode(private_pem).decode("ascii"),
            # A real in-memory SQLite database keeps this portable across drive-letter paths.
            "DATABASE_URL": "sqlite://",
            "VIBEPRO_API": api,
            "VIBEPRO_HOME": str(home),
            "VIBEPRO_TEST_PUBLIC_KEY": public_pem,
            "NODE_ENV": "test",
            "VIBEPRO_TELEMETRY": "1",
        })
        backend_log_path = base / "backend.log"
        with backend_log_path.open("w", encoding="utf-8") as backend_log:
            server = subprocess.Popen(
                [sys.executable, "-m", "uvicorn", "app:app", "--host", "127.0.0.1", "--port", str(port)],
                cwd=BACKEND, env=env, stdout=backend_log, stderr=subprocess.STDOUT, text=True,
            )
            try:
                for _ in range(80):
                    if server.poll() is not None:
                        backend_log.flush()
                        raise RuntimeError("Backend exited before becoming healthy:\n" + backend_log_path.read_text(encoding="utf-8"))
                    try:
                        with urllib.request.urlopen(api + "/health", timeout=1) as response:
                            if response.status == 200:
                                break
                    except Exception:
                        time.sleep(0.25)
                else:
                    backend_log.flush()
                    raise RuntimeError("Backend health check timed out:\n" + backend_log_path.read_text(encoding="utf-8"))

                node = "node"
                call([node, str(CLI), "install", "--agent", "codex", "--dry-run"], env)
                call([node, str(CLI), "install", "--agent", "codex"], env)
                call([node, str(CLI), "verify", "--agent", "codex"], env)
                call([node, str(CLI), "doctor"], env)

                installed = home / ".codex" / "skills" / "vibepro-audit" / "SKILL.md"
                original = installed.read_bytes()
                installed.write_bytes(original + b"\n# tamper probe\n")
                changed = call([node, str(CLI), "verify", "--agent", "codex"], env, expected=1)
                if "modified" not in changed.stdout:
                    raise RuntimeError("Tamper verification did not report a modified file")
                installed.write_bytes(original)

                call([node, str(CLI), "report", str(SAMPLE), "--no-open"], env)
                with urllib.request.urlopen(api + "/api/v1/stats", timeout=3) as response:
                    stats = response.read().decode("utf-8")
                if '"codex":1' not in stats:
                    raise RuntimeError("Anonymous install telemetry was not recorded: " + stats)
                call([node, str(CLI), "uninstall", "--agent", "codex"], env)
                if (home / ".codex" / "skills" / "vibepro-audit").exists():
                    raise RuntimeError("Uninstall left the skill directory behind")
                print("End-to-end flow passed.")
            finally:
                server.terminate()
                try:
                    server.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    server.kill()
                    server.wait()


if __name__ == "__main__":
    main()
