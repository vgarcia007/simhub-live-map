"""Run isolated, read-only SMB operations for recording sync."""

import errno
import json
import os
import shutil
import sys
from contextlib import closing
from pathlib import Path
from urllib.parse import quote

from recording_catalog import recording_folders
from recording_sync import ShareError, store_recording

NS_PER_SECOND = 1_000_000_000


def file_version(info):
    return info[6], info[8], info[9]  # libsmbclient returns the stat tuple (size, mtime and ctime).


class WindowsShare:
    def __init__(self, settings):
        try:
            import smbc
        except (ImportError, OSError):
            raise ShareError("SMB support is unavailable. Install python3-smbc on the Navi server.") from None

        self.smbc = smbc
        self.host = settings["host"]
        username = settings["username"]
        domain, separator, account = username.partition("\\")
        if not separator:
            domain, account = "", username

        def authenticate(server, share, workgroup, user, password):
            if server.rstrip(".").lower() != self.host:
                return "", "", ""
            return domain or workgroup, account, settings["password"]

        self.client = smbc.Context(auth_fn=authenticate)
        self.client.optionNoAutoAnonymousLogin = bool(account)
        self.client.port = 445
        self.client.timeout = 5000
        self.root = Path(settings["share"])
        if settings["folder"]:
            self.root /= settings["folder"]

    def uri(self, path):
        return "smb://" + self.host + "/" + "/".join(quote(part, safe="") for part in path.parts)

    def entries(self, path, kind):
        for entry in self.client.opendir(self.uri(path)).getdents():
            name = entry.name
            if entry.smbc_type == kind and name not in ("", ".", "..") and "/" not in name and "\\" not in name:
                yield path / name

    def discover(self):
        names = (entry.name for entry in self.entries(Path(), self.smbc.FILE_SHARE))
        return sorted(set(name for name in names if not name.endswith("$")), key=str.casefold)

    def folders(self):
        def directories(path):
            return list(self.entries(path, self.smbc.DIR))
        return recording_folders(self.root, directories)

    def check(self):
        # Validate access even when the configured root is itself a recording folder.
        self.client.opendir(self.uri(self.root)).getdents()
        return any(True for _ in self.folders())

    def copy(self, source, destination, staging):
        uri = self.uri(source)
        info = self.client.stat(uri)
        size, mtime, _ = file_version(info)
        try:
            current = destination.stat()
            if current.st_size == size and current.st_mtime_ns // NS_PER_SECOND == mtime:
                return False
        except FileNotFoundError:
            pass

        def transfer(staged):
            with closing(self.client.open(uri, os.O_RDONLY)) as incoming:
                shutil.copyfileobj(incoming, staged)
            updated = self.client.stat(uri)
            if staged.tell() != size or file_version(info) != file_version(updated):
                raise OSError("The recording changed during transfer")

        return store_recording(destination, mtime * NS_PER_SECOND, transfer, staging_dir=staging)

    def sync(self, cache, staging):
        copied = failures = 0
        for directory in self.folders():
            game = directory.parent.name or self.root.parts[0]
            target = cache / game / directory.name
            try:
                target.mkdir(parents=True, exist_ok=True)
                for source in self.entries(directory, self.smbc.FILE):
                    if source.suffix.lower() == ".shtl":
                        try:
                            copied += self.copy(source, target / source.name, staging)
                        except (OSError, RuntimeError):
                            failures += 1
            except (OSError, RuntimeError):
                failures += 1
        return {"copied": copied, "failures": failures}


def main(request):
    try:
        share = WindowsShare(request["settings"])
        operation = request["operation"]
        if operation == "discover":
            return {"shares": share.discover()}
        if operation == "test":
            return {"has_recordings": share.check()}
        return share.sync(Path(request["cache"]), Path(request["staging"]))
    except ShareError as error:
        return {"error": str(error)}
    except (OSError, RuntimeError) as error:
        code = getattr(error, "errno", None) or (error.args[0] if error.args else None)
        if code in (errno.EACCES, errno.EPERM):
            message = "Access denied. Check the Windows username, password and share permissions."
        elif code in (errno.ENOENT, errno.ENOTDIR):
            message = "Windows could not find the server, share or folder. Check the path and that the PC is on."
        else:
            message = "The Windows share is unavailable. Check that the PC is on and reachable."
        return {"error": message}


if __name__ == "__main__":
    print(json.dumps(main(json.load(sys.stdin))))
