import logging
import os
import shutil
import tempfile
import time
from pathlib import Path

from recording_catalog import recording_directories, recordings_root

SYNC_INTERVAL = 60
logger = logging.getLogger(__name__)


def recordings_cache():
    default = Path.home() / ".local" / "share" / "simhub-navi" / "recordings"
    return Path(os.environ.get("SIMHUB_RECORDINGS_CACHE", default)).expanduser().resolve()


def file_version(info):
    return info.st_size, info.st_mtime_ns


def copy_recording(source, destination):
    current = source.stat()
    try:
        if file_version(destination.stat()) == file_version(current):
            return False
    except FileNotFoundError:
        pass

    with source.open("rb") as incoming:
        before = os.fstat(incoming.fileno())
        staged = tempfile.NamedTemporaryFile(dir=destination.parent, delete=False)
        temporary = Path(staged.name)
        try:
            with staged:
                shutil.copyfileobj(incoming, staged)
                size = staged.tell()
            after = source.stat()
            if (
                size != before.st_size or file_version(before) != file_version(after)
                or before.st_ino != after.st_ino or before.st_ctime_ns != after.st_ctime_ns
            ):
                raise OSError("SimHub changed the recording during the copy")
            os.utime(temporary, ns=(before.st_atime_ns, before.st_mtime_ns))
            temporary.replace(destination)
        finally:
            temporary.unlink(missing_ok=True)
    return True


def sync_recordings(source, cache):
    copied = 0
    failures = 0
    cache.mkdir(parents=True, exist_ok=True)
    for directory in recording_directories(source):
        try:
            target = cache / directory.parent.name / directory.name
            target.mkdir(parents=True, exist_ok=True)
            for path in directory.iterdir():
                if path.suffix.lower() != ".shtl":
                    continue
                try:
                    if not path.is_symlink() and path.is_file():
                        copied += copy_recording(path, target / path.name)
                except OSError as error:
                    logger.debug("Could not copy %s: %s", path, error)
                    failures += 1
        except OSError as error:
            logger.debug("Could not sync %s: %s", directory, error)
            failures += 1
    return copied, failures


def run_recording_sync():
    previous_issue = None
    while True:
        try:
            copied, failures = sync_recordings(recordings_root(), recordings_cache())
            if copied:
                logger.info("Copied %d SimHub recordings to local storage", copied)
            issue = f"{failures} recording files or folders could not be copied" if failures else None
        except OSError as error:
            issue = str(error)
        if issue and issue != previous_issue:
            logger.warning("SimHub recording sync will retry: %s", issue)
        previous_issue = issue
        time.sleep(SYNC_INTERVAL)
