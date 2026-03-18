"""Download Parker Omnibook MusicXML from LORIA and extract."""

import io
import ssl
import zipfile
from pathlib import Path
import urllib.request

URL = "https://homepages.loria.fr/evincent/omnibook/omnibook_xml.zip"
DATA_DIR = Path(__file__).parent / "output" / "omnibook"


def download_and_extract():
    if DATA_DIR.exists() and any(DATA_DIR.glob("*.xml")):
        print(f"Already downloaded: {len(list(DATA_DIR.glob('*.xml')))} XML files in {DATA_DIR}")
        return

    DATA_DIR.mkdir(parents=True, exist_ok=True)
    print(f"Downloading {URL} ...")
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE
    resp = urllib.request.urlopen(URL, context=ctx)
    data = resp.read()
    print(f"Downloaded {len(data)} bytes")

    with zipfile.ZipFile(io.BytesIO(data)) as zf:
        xml_count = 0
        for info in zf.infolist():
            if info.filename.endswith(".xml"):
                # Extract to flat directory
                name = Path(info.filename).name
                target = DATA_DIR / name
                target.write_bytes(zf.read(info))
                xml_count += 1
        print(f"Extracted {xml_count} XML files to {DATA_DIR}")


if __name__ == "__main__":
    download_and_extract()
