from pathlib import Path

import pytest

from backend.scripts.generate_keys import ensure_keypair, sync_public_key


def test_existing_dev_key_is_reused_and_public_key_is_recovered(tmp_path):
    private, public, fingerprint = ensure_keypair(tmp_path)
    (tmp_path / 'public_key.pem').unlink()
    assert ensure_keypair(tmp_path) == (private, public, fingerprint)
    assert (tmp_path / 'private_key.pem').read_bytes() == private
    assert (tmp_path / 'public_key.pem').read_text(encoding='ascii') == public


def test_public_trust_roots_are_synchronized_without_a_private_key(tmp_path):
    private, public, fingerprint = ensure_keypair(tmp_path / 'keys')
    (tmp_path / 'web').mkdir()
    (tmp_path / 'cli/lib').mkdir(parents=True)
    web = tmp_path / 'web/app.js'
    cli = tmp_path / 'cli/lib/trusted-key.js'
    web.write_text('const publicKeyPem = "old";\nconst $ = selector => document.querySelector(selector);\n', encoding='utf-8')
    cli.write_text('old', encoding='utf-8')
    sync_public_key(public, fingerprint, root=tmp_path)
    assert fingerprint in cli.read_text(encoding='utf-8')
    assert public in cli.read_text(encoding='utf-8')
    assert 'BEGIN PUBLIC KEY' in web.read_text(encoding='utf-8')
    assert 'BEGIN PRIVATE KEY' not in web.read_text(encoding='utf-8') + cli.read_text(encoding='utf-8')
    assert (tmp_path / 'keys/private_key.pem').read_bytes() == private


def test_invalid_existing_key_is_not_overwritten(tmp_path):
    key = tmp_path / 'private_key.pem'
    key.write_bytes(b'not a key')
    with pytest.raises(ValueError):
        ensure_keypair(tmp_path)
    assert key.read_bytes() == b'not a key'
