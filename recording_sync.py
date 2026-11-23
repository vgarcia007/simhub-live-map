import json
import logging
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
from datetime import datetime, timezone
from pathlib import Path
from threading import Condition

from recording_catalog import recording_directories, recordings_root

SYNC_INTERVAL = 60
logger = logging.getLogger(__name__)
DEFAULT_SHARE_MOUNT = "/mnt/simhub-recordings"


class ShareError(Exception):
    pass


def recordings_cache():
    default = Path.home() / ".local" / "share" / "simhub-navi" / "recordings"
    return Path(os.environ.get("SIMHUB_RECORDINGS_CACHE", default)).expanduser().resolve()


def mounted_share_available():
    if os.environ.get("SIMHUB_RECORDINGS_ROOT"):
        return True
    try:
        with open("/proc/self/mountinfo", encoding="utf-8") as mounts:
            return any(line.split()[4] == DEFAULT_SHARE_MOUNT for line in mounts)
    except OSError:
        return False


def settings_path():
    config_dir = Path(os.environ.get("XDG_CONFIG_HOME") or Path.home() / ".config")
    return config_dir / "simhub-navi" / "recording-sync.json"


def read_sync_settings():
    try:
        with settings_path().open(encoding="utf-8") as handle:
            settings = json.load(handle)
    except FileNotFoundError:
        mounted = mounted_share_available()
        return {"enabled": mounted, "source": "mount" if mounted else "smb"}
    if not isinstance(settings, dict) or type(settings.get("enabled")) is not bool or settings.get("source") not in ("mount", "smb"):
        raise ValueError("Could not read the recording sync settings.")
    return settings


def write_sync_settings(settings):
    path = settings_path()
    path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=path.parent, delete=False) as staged:
        temporary = Path(staged.name)
        try:
            json.dump(settings, staged, ensure_ascii=False)
            staged.close()
            temporary.replace(path)
        finally:
            temporary.unlink(missing_ok=True)


def last_sync_time():
    try:
        timestamp = (recordings_cache() / ".last-sync").stat().st_mtime
    except OSError:
        return None
    return datetime.fromtimestamp(timestamp, timezone.utc).isoformat()


def share_settings(data, saved, operation):
    fields = {}
    for key in ("host", "share", "folder", "username", "password"):
        value = data.get(key, "")
        if not isinstance(value, str) or len(value) > 1024 or any(ord(char) < 32 for char in value):
            raise ValueError("A Windows share field contains an invalid value.")
        fields[key] = value if key == "password" else value.strip()

    # Accept both a share name and a UNC path pasted into the Share field.
    share = fields["share"].replace("\\", "/")
    if share.startswith("//"):
        parts = share[2:].rstrip("/").split("/")
        if len(parts) < 2:
            raise ValueError("Enter a path like \\\\server\\share.")
        fields["host"], share = parts[:2]
        fields["folder"] = "/".join(parts[2:]) or fields["folder"]
    if "/" in share or share in (".", ".."):
        raise ValueError("Enter a share name or a complete UNC path.")
    fields["share"] = share
    fields["folder"] = fields["folder"].replace("\\", "/").strip("/")
    if fields["folder"] and any(part in ("", ".", "..") for part in fields["folder"].split("/")):
        raise ValueError("Enter a subfolder within the share.")

    host = fields["host"].rstrip(".").lower()
    if host and (len(host) > 253 or not re.fullmatch(r"[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?", host)):
        raise ValueError("Enter a Windows server name or IPv4 address.")
    fields["host"] = host

    source = data.get("source", "smb")
    enabled = data.get("enabled", False)
    if source not in ("smb", "mount") or type(enabled) is not bool:
        raise ValueError("Invalid recording sync settings.")
    if operation == "save" and source == "mount":
        if enabled and saved.get("source") != "mount" and not mounted_share_available():
            raise ValueError("There is no system-mounted SimHub share.")
        return {**saved, "enabled": enabled, "source": "mount"}
    if operation != "save" or enabled:
        if not host:
            raise ValueError("Enter the Windows server name or IP address.")
        if operation != "discover" and not share:
            raise ValueError("Select a Windows share or enter its UNC path.")
    if not fields["password"] and all(fields[key] == saved.get(key) for key in ("host", "username")):
        fields["password"] = saved.get("password", "")
    return {**fields, "enabled": enabled, "source": "smb"}


def file_version(info):
    return info.st_size, info.st_mtime_ns


def store_recording(destination, mtime_ns, write_file, staging_dir=None, active=lambda: True):
    with tempfile.NamedTemporaryFile(dir=staging_dir or destination.parent, delete=False) as staged:
        temporary = Path(staged.name)
        try:
            write_file(staged)
            staged.close()
            if not active():
                return False
            os.utime(temporary, ns=(mtime_ns, mtime_ns))
            temporary.replace(destination)
        finally:
            temporary.unlink(missing_ok=True)
    return True


def copy_recording(source, destination, active):
    current = source.stat()
    try:
        if file_version(destination.stat()) == file_version(current):
            return False
    except FileNotFoundError:
        pass

    with source.open("rb") as incoming:
        before = os.fstat(incoming.fileno())

        def transfer(staged):
            shutil.copyfileobj(incoming, staged)
            after = source.stat()
            if (
                staged.tell() != before.st_size or file_version(before) != file_version(after)
                or before.st_ino != after.st_ino or before.st_ctime_ns != after.st_ctime_ns
            ):
                raise OSError("SimHub changed the recording during the copy")

        return store_recording(destination, before.st_mtime_ns, transfer, active=active)


def sync_recordings(source, cache, active=lambda: True):
    copied = 0
    failures = 0
    cache.mkdir(parents=True, exist_ok=True)
    for directory in recording_directories(source):
        if not active():
            break
        try:
            target = cache / directory.parent.name / directory.name
            target.mkdir(parents=True, exist_ok=True)
            for path in directory.iterdir():
                if not active():
                    break
                if path.suffix.lower() != ".shtl":
                    continue
                try:
                    if not path.is_symlink() and path.is_file():
                        copied += copy_recording(path, target / path.name, active)
                except OSError as error:
                    logger.debug("Could not copy %s: %s", path, error)
                    failures += 1
        except OSError as error:
            logger.debug("Could not sync %s: %s", directory, error)
            failures += 1
    return copied, failures


def smb_request(operation, settings, active=lambda: True, **options):
    payload = json.dumps({"operation": operation, "settings": settings, **options})
    deadline = time.monotonic() + (300 if operation == "sync" else 12)
    with subprocess.Popen(
        [sys.executable, "-m", "recording_smb"], cwd=Path(__file__).resolve().parent,
        stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True,
    ) as worker:
        try:
            while active() and time.monotonic() < deadline:
                try:
                    output, _ = worker.communicate(input=payload, timeout=0.25)
                    break
                except subprocess.TimeoutExpired:
                    payload = None
            else:
                if active():
                    raise ShareError("The Windows share did not respond in time.")
                return {}
        finally:
            if worker.poll() is None:
                worker.kill()
                worker.communicate()
    try:
        result = json.loads(output)
    except ValueError:
        raise ShareError("The SMB client could not complete the request.") from None
    if "error" in result:
        raise ShareError(result["error"])
    return result


class RecordingSync:
    def __init__(self):
        self.condition = Condition()
        self.revision = 0
        self.status = "waiting"
        self.issue = None

    def save(self, data):
        with self.condition:
            saved = share_settings(data, read_sync_settings(), "save")
            write_sync_settings(saved)
            self.revision += 1
            self.status = "waiting"
            self.issue = None
            self.condition.notify_all()

    def info(self):
        with self.condition:
            settings = read_sync_settings()
            public = {key: settings.get(key, "") for key in ("enabled", "source", "host", "share", "folder", "username")}
            return {
                **public, "has_password": bool(settings.get("password")),
                "mount_available": settings["source"] == "mount" or mounted_share_available(),
                "status": self.status if settings["enabled"] else "disabled",
                "issue": self.issue if settings["enabled"] else None,
                "last_success": last_sync_time(),
            }

    def run(self):
        while True:
            with self.condition:
                revision = self.revision
                try:
                    settings = read_sync_settings()
                except (OSError, ValueError):
                    logger.warning("Could not read recording sync settings")
                    self.condition.wait(SYNC_INTERVAL)
                    continue
                if not settings["enabled"]:
                    self.condition.wait()
                    continue
                self.status = "syncing"

            def active():
                return self.revision == revision

            copied = failures = 0
            issue = None
            try:
                cache = recordings_cache()
                if settings["source"] == "mount":
                    copied, failures = sync_recordings(recordings_root(), cache, active)
                else:
                    cache.mkdir(parents=True, exist_ok=True)
                    with tempfile.TemporaryDirectory(prefix=".sync-", dir=cache) as staging:
                        result = smb_request("sync", settings, active, cache=str(cache), staging=staging)
                    copied, failures = result.get("copied", 0), result.get("failures", 0)
                if failures:
                    issue = f"{failures} files or folders could not be copied. Navi will retry."
            except ShareError as error:
                issue = str(error)
            except OSError:
                issue = "The recording source or local library is unavailable. Navi will retry."

            with self.condition:
                if not active():
                    continue
                if issue and issue != self.issue:
                    logger.warning("Recording sync: %s", issue)
                if copied:
                    logger.info("Copied %d SimHub recordings to local storage", copied)
                self.issue = issue
                self.status = "error" if issue else "ready"
                if not issue:
                    try:
                        (cache / ".last-sync").touch(mode=0o600)
                    except OSError:
                        logger.warning("Could not record the time of the last successful recording sync")
                self.condition.wait(SYNC_INTERVAL)
