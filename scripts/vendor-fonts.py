"""Vendor the self-hosted fonts used by VibePro and its local report viewer."""
from pathlib import Path
import shutil
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
FONTS = [
    ('geist', '5.2.8', 'geist-latin-wght-normal.woff2', 'geist-latin.woff2', 'geist-OFL.txt'),
    ('jetbrains-mono', '5.2.8', 'jetbrains-mono-latin-wght-normal.woff2', 'jetbrains-mono-latin.woff2', 'jetbrains-mono-OFL.txt'),
]
for package, version, filename, destination, license_name in FONTS:
    base = f'https://cdn.jsdelivr.net/npm/@fontsource-variable/{package}@{version}/'
    for remote, local in [('files/' + filename, destination), ('LICENSE', license_name)]:
        data = urllib.request.urlopen(base + remote, timeout=30).read()
        output = ROOT / 'web/fonts' / local
        output.write_bytes(data)
        shutil.copyfile(output, ROOT / 'cli/viewer/fonts' / local)
        print(local)
