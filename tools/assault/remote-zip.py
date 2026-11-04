"""Read a public ZIP directory and one named member through bounded HTTP ranges."""
import argparse
import io
import json
import time
import urllib.request
import zipfile
from pathlib import Path


class RangeReader(io.RawIOBase):
    def __init__(self, url, transfer_limit=30_000_000):
        self.url, self.position, self.transferred = url, 0, 0
        self.limit, self.requests = transfer_limit, 0
        self.deadline = time.monotonic() + 150
        with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"}, method="HEAD"), timeout=25) as r:
            self.length = int(r.headers["Content-Length"])
            self.modified = r.headers.get("Last-Modified")

    def seekable(self):
        return True

    def readable(self):
        return True

    def tell(self):
        return self.position

    def seek(self, offset, whence=0):
        self.position = offset + (0 if whence == 0 else self.position if whence == 1 else self.length)
        if self.position < 0 or self.position > self.length:
            raise ValueError("Invalid archive offset")
        return self.position

    def read(self, size=-1):
        if size < 0:
            size = self.length - self.position
        size = min(size, self.length - self.position)
        if not size:
            return b""
        if time.monotonic() > self.deadline:
            raise TimeoutError("150-second source inspection checkpoint")
        if size > 8_000_000 or self.transferred + size > self.limit:
            raise ValueError("Selective download exceeds transfer budget; full archive fallback forbidden")
        start, end = self.position, self.position + size - 1
        req = urllib.request.Request(self.url, headers={"Range": f"bytes={start}-{end}", "User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=25) as r:
            expected = f"bytes {start}-{end}/{self.length}"
            if r.status != 206 or r.headers.get("Content-Range") != expected:
                raise ValueError(f"Server did not honor exact HTTP range: {r.status}, {r.headers.get('Content-Range')}")
            data = r.read(size + 1)
        if len(data) != size:
            raise ValueError("Truncated or oversized HTTP range")
        self.transferred += size
        self.requests += 1
        self.position += size
        return data


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--url", required=True)
    p.add_argument("--output", type=Path, required=True)
    p.add_argument("--receipt", type=Path, required=True)
    args = p.parse_args()
    for target in (args.output, args.receipt):
        if not target.is_absolute():
            raise ValueError("Output and receipt must be absolute")
    reader = None
    result = {"source": args.url, "output": str(args.output), "receipt": str(args.receipt)}
    try:
        reader = RangeReader(args.url)
        with zipfile.ZipFile(reader) as archive:
            entries = archive.infolist()
            matches = [e for e in entries if e.filename.replace("\\", "/").endswith("/GameData.db.zip") or e.filename == "GameData.db.zip"]
            result.update(archiveBytes=reader.length, lastModified=reader.modified,
                          entries=len(entries), databaseMembers=[e.filename for e in matches])
            if len(matches) != 1:
                result["sampleMembers"] = [e.filename for e in entries[:60]]
                raise ValueError("Archive does not contain exactly one GameData.db.zip")
            member = matches[0]
            if member.file_size > 20_000_000:
                raise ValueError("Database member exceeds 20MB expectation")
            if args.output.exists():
                raise FileExistsError(f"Protected existing output: {args.output}")
            payload = archive.read(member)
            with zipfile.ZipFile(io.BytesIO(payload)) as database_zip:
                result["databaseArchiveMembers"] = database_zip.namelist()
                if not any(e.filename.endswith(".db") for e in database_zip.infolist()):
                    raise ValueError("Database member is not a database ZIP")
            args.output.parent.mkdir(parents=True, exist_ok=True)
            with args.output.open("xb") as target:
                target.write(payload)
            result.update(ok=True, bytes=len(payload), member=member.filename)
    except Exception as error:
        result.update(ok=False, error=str(error))
    if reader:
        result.update(transferredBytes=reader.transferred, rangeRequests=reader.requests)
    args.receipt.parent.mkdir(parents=True, exist_ok=True)
    args.receipt.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(result, ensure_ascii=False))
    return 0 if result.get("ok") else 1


if __name__ == "__main__":
    raise SystemExit(main())
