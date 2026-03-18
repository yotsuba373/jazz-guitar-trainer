"""Download Weimar Jazz Database (WJazzD) SQLite3 file."""

import ssl
from pathlib import Path
import urllib.request

URL = "https://jazzomat.hfm-weimar.de/download/downloads/wjazzd.db"
DATA_DIR = Path(__file__).parent / "output"
DB_PATH = DATA_DIR / "wjazzd.db"


def download():
    if DB_PATH.exists():
        size_mb = DB_PATH.stat().st_size / 1024 / 1024
        print(f"Already downloaded: {DB_PATH} ({size_mb:.1f} MB)")
        return

    DATA_DIR.mkdir(parents=True, exist_ok=True)
    print(f"Downloading {URL} ...")
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE
    resp = urllib.request.urlopen(URL, context=ctx)
    data = resp.read()
    DB_PATH.write_bytes(data)
    print(f"Downloaded {len(data) / 1024 / 1024:.1f} MB to {DB_PATH}")


if __name__ == "__main__":
    download()
