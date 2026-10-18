"""Create or reuse an Ed25519 keypair without silently replacing a signing key."""
from __future__ import annotations

import argparse
import base64
import hashlib
import json
import os
from pathlib import Path

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

ROOT = Path(__file__).resolve().parents[2]


def ensure_keypair(output: Path) -> tuple[bytes, str, str]:
    output.mkdir(parents=True, exist_ok=True)
    private_path = output / 'private_key.pem'
    if not private_path.exists():
        key = Ed25519PrivateKey.generate()
        pem = key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption())
        try:
            descriptor = os.open(private_path, os.O_CREAT | os.O_EXCL | os.O_WRONLY | getattr(os, 'O_BINARY', 0), 0o600)
            with os.fdopen(descriptor, 'wb') as file:
                file.write(pem)
        except FileExistsError:
            pass
    private_pem = private_path.read_bytes()
    key = serialization.load_pem_private_key(private_pem, password=None)
    if not isinstance(key, Ed25519PrivateKey):
        raise ValueError(f'{private_path} is not an Ed25519 private key.')
    public = key.public_key()
    public_pem = public.public_bytes(serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo).decode('ascii')
    key_id = hashlib.sha256(public.public_bytes(serialization.Encoding.DER, serialization.PublicFormat.SubjectPublicKeyInfo)).hexdigest()
    public_path = output / 'public_key.pem'
    if not public_path.exists() or public_path.read_text(encoding='ascii') != public_pem:
        public_path.write_text(public_pem, encoding='ascii')
    return private_pem, public_pem, key_id


def sync_public_key(public_pem: str, key_id: str, root: Path = ROOT) -> None:
    cli_path = root / 'cli/lib/trusted-key.js'
    web_path = root / 'web/app.js'
    web = web_path.read_text(encoding='utf-8')
    start, end = web.index('const publicKeyPem ='), web.index('const $ =')
    replacement = 'const publicKeyPem =\n  ' + json.dumps(public_pem) + ';\n'
    updated_web = web[:start] + replacement + web[end:]
    updated_cli = (
        '// Public trust root. The private signing key must never be committed.\n'
        + f"export const TRUSTED_KEY_ID = '{key_id}';\n"
        + 'export const TRUSTED_PUBLIC_KEY_PEM = `' + public_pem + '`;\n'
    )
    for path, updated in [(web_path, updated_web), (cli_path, updated_cli)]:
        if path.read_text(encoding='utf-8') != updated:
            path.write_text(updated, encoding='utf-8')


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output-dir', type=Path, default=ROOT / 'backend/keys')
    parser.add_argument('--sync-public-key', action='store_true', help='Update the CLI and website public trust roots.')
    parser.add_argument('--show-secret', action='store_true', help='Print the private-key environment value for manual deployment configuration.')
    args = parser.parse_args()
    private_pem, public_pem, key_id = ensure_keypair(args.output_dir.resolve())
    if args.sync_public_key:
        sync_public_key(public_pem, key_id)
    print(f'Keypair ready in {args.output_dir.resolve()} (existing private keys are reused).')
    print(f'Public fingerprint: {key_id}')
    print('CLI and website public keys synchronized.' if args.sync_public_key else 'Use --sync-public-key to update the CLI and website trust roots.')
    if args.show_secret:
        print('Private deployment secret; never commit or share this value:')
        print('VIBEPRO_SIGNING_KEY=base64:' + base64.b64encode(private_pem).decode('ascii'))


if __name__ == '__main__':
    main()
