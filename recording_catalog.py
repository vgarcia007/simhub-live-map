import gzip
import json
import math
import os
from functools import lru_cache
from pathlib import Path

from mapping_helper import UPLOAD_LIMIT, has_area, parse_recording, read_recording_data
from track_identity import legacy_track_for_recording, recording_track_key, resolve_track
from track_names import normalized_name, readable_track_name, resolve_track_names

SOURCES = {"maprecords": "local", "maprecordscloud": "cloud"}


def recordings_root():
    return Path(os.environ.get("SIMHUB_RECORDINGS_ROOT", "/mnt/simhub-recordings")).resolve()


def recording_directories(root):
    def directories(path):
        return [entry for entry in path.iterdir() if not entry.is_symlink() and entry.is_dir()]

    yield from recording_folders(root, directories)


def recording_folders(root, directories):
    if root.name.lower() in SOURCES:
        yield root
        return
    children = directories(root)
    plugins = next((entry for entry in children if entry.name.lower() == "pluginsdata"), None)
    for directory in directories(plugins) if plugins is not None else children:
        if directory.name.lower() in SOURCES:
            yield directory
            continue
        yield from (child for child in directories(directory) if child.name.lower() in SOURCES)


def cloud_recording_data(path):
    with path.open("rb") as stream:
        data = read_recording_data(stream)
    if not data.get("GameCode"):
        data["GameCode"] = path.parent.parent.name
    if data.get("TrackName") is None or data.get("TrackName") == "":
        key, separator, length = path.stem.rpartition("-")
        if not separator or not key or not math.isfinite(float(length)):
            raise ValueError("Invalid SimHub cloud recording filename.")
        name = key
        if data["GameCode"] == "PCars3" and "-" in key:
            name, _, config = key.rpartition("-")
            data["TrackConfig"] = config
        data["TrackName"] = name
    return data


def preview_recording(path):
    if path.parent.name.lower() == "maprecordscloud":
        recording = parse_recording(cloud_recording_data(path))
    else:
        with path.open("rb") as stream:
            recording = parse_recording(read_recording_data(stream))
    axis = 2 if has_area(recording["points"], 2) else 1
    points = [(point[0], point[axis]) for point in recording["points"]]
    distances = [math.dist(previous, current) for previous, current in zip(points, points[1:])]
    nonzero = sorted(step for step in distances if step > 0)
    typical_step = nonzero[len(nonzero) // 2] if nonzero else 0
    gap = max(25, 20 * typical_step)
    segments = [[points[0]]]
    for point, step in zip(points[1:], distances):
        if step > gap:
            segments.append([])
        segments[-1].append(point)
    end_gap = math.dist(points[0], points[-1])
    return recording, {
        "closed": len(segments) == 1 and end_gap <= 4 * typical_step,
        "has_gaps": len(segments) > 1,
        "segments": segments,
        "axis": "X/Z" if axis == 2 else "X/Y",
    }


@lru_cache(maxsize=2048)
def catalog_metadata(path, size, modified_ns):
    if size > UPLOAD_LIMIT:
        raise ValueError("The recording exceeds 2 MB.")
    recording, preview = preview_recording(path)
    return {key: value for key, value in recording.items() if key != "points"}, preview["closed"], preview["has_gaps"]


def cloud_download(path, display_name):
    data = cloud_recording_data(path)
    if display_name:
        data["TrackDisplayName"] = display_name
    payload = gzip.compress(json.dumps(data, separators=(",", ":")).encode("utf-8"))
    if len(payload) > UPLOAD_LIMIT:
        raise ValueError("The prepared recording exceeds 2 MB.")
    return payload


def catalog_tracks(root, refpoints):
    groups = {}
    skipped = 0
    for directory in recording_directories(root):
        source = SOURCES[directory.name.lower()]
        for file in directory.iterdir():
            if file.suffix.lower() != ".shtl" or file.is_symlink() or not file.is_file():
                continue
            try:
                info = file.stat()
                recording, closed, has_gaps = catalog_metadata(file, info.st_size, info.st_mtime_ns)
            except (OSError, ValueError):
                skipped += 1
                continue

            game = recording["game"]
            key = recording_track_key(recording)
            identity = (game, key)
            if identity not in groups:
                tracks = refpoints.get(game, {})
                existing_key = resolve_track(tracks, key)
                if existing_key not in tracks:
                    existing_key = legacy_track_for_recording(tracks, recording)
                existing = tracks.get(existing_key, {})
                groups[identity] = {
                    "game": game,
                    "key": key,
                    "saved_name": existing.get("display_name", ""),
                    "recorded_name": recording["display_name"],
                    "configs": set(),
                    "mapped": len(existing.get("ref_points", ())) >= 3,
                    "edit_key": existing_key if existing.get("helper2") else None,
                    "sources": {},
                }

            group = groups[identity]
            if not readable_track_name(group["recorded_name"], key) and readable_track_name(recording["display_name"], key):
                group["recorded_name"] = recording["display_name"]
            if recording["track_config"]:
                group["configs"].add(recording["track_config"])
            candidates = group["sources"]
            rank = (info.st_mtime_ns, file.name.casefold())
            if source not in candidates or rank > candidates[source]["rank"]:
                candidates[source] = {"path": file.relative_to(root).as_posix(), "rank": rank,
                                      "size": info.st_size, "closed": closed, "has_gaps": has_gaps}
    for group in groups.values():
        saved_name = group.pop("saved_name")
        recorded_name = group.pop("recorded_name")
        configs = group.pop("configs")
        key = group["key"]
        config = next(iter(configs)) if len(configs) == 1 else ""
        names = resolve_track_names(group["game"], key, config, saved_name, recorded_name)
        group["name"] = names.display_name
        # Only relay an observed label to the other source. A catalog guess
        # must never become part of the recording's matching metadata.
        group["source_display_name"] = (
            next((name for name in (saved_name, recorded_name) if name != key and readable_track_name(name, key)), "")
            if len(configs) <= 1 else ""
        )
    return sorted(groups.values(), key=lambda track: (
        track["game"].casefold(), normalized_name(track["name"]), track["key"],
    )), skipped


def find_recording(root, relative, size, modified_ns):
    try:
        path = (root / relative).resolve(strict=True)
        info = path.stat()
    except (OSError, ValueError, RuntimeError) as error:
        raise FileNotFoundError("The recording is unavailable.") from error
    if (
        not path.is_relative_to(root)
        or path.suffix.lower() != ".shtl"
        or path.parent.name.lower() not in SOURCES
        or not path.is_file()
        or info.st_size > UPLOAD_LIMIT
        or (info.st_size, info.st_mtime_ns) != (size, modified_ns)
    ):
        raise FileNotFoundError("The recording has changed or is unavailable.")
    return path
