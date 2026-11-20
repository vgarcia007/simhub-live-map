import gzip
import json
import math
import os
import stat
import tempfile
import zlib
from functools import lru_cache
from pathlib import Path
from threading import Lock

import numpy as np

from generate_transforms import build_transforms, process_tracks
from track_identity import migrate_track_keys, recording_track_key, resolve_track, track_aliases

REFERENCE_FILE = Path("static/track_reference_points.json")
TRANSFORM_FILE = Path("static/track_transforms.json")
POI_DIRECTORY = Path("static/poi")
REFERENCE_LOCK = Lock()
UPLOAD_LIMIT = 2 * 1024 * 1024
JSON_LIMIT = 8 * 1024 * 1024
POINT_LIMIT = 25_000
EARTH_RADIUS = 6_378_137
MAP_LAT_LIMIT = 85.05112878


def read_refpoints():
    with REFERENCE_FILE.open(encoding="utf-8") as source:
        return json.load(source)


def poi_renames(refpoints):
    moves = []
    for game, tracks in refpoints.items():
        directory = POI_DIRECTORY / track_key(game)
        if not directory.is_dir():
            continue
        files = {path.stem: path for path in directory.glob("*.json") if path.is_file()}
        for track, entry in tracks.items():
            if not entry.get("track_name") or track in files:
                continue
            for alias in entry.get("aliases", ()):
                if alias in files and resolve_track(tracks, alias) == track:
                    destination = directory / (track_key(track) + ".json")
                    moves.append((files.pop(alias), destination))
                    files[track] = destination
                    break
    return moves


def write_refpoints(refpoints):
    # Call under REFERENCE_LOCK. Stage both outputs before updating the track files.
    transforms = build_transforms(refpoints)
    staged = []
    moved_pois = []

    def stage(path, write):
        with tempfile.NamedTemporaryFile(dir=path.parent, delete=False) as output:
            temp_path = Path(output.name)
            staged.append(temp_path)
            mode = stat.S_IMODE(path.stat().st_mode) if path.exists() else 0o644
            os.fchmod(output.fileno(), mode)
            write(output)
        return temp_path

    def stage_json(path, data):
        return stage(path, lambda output: output.write(json.dumps(data, indent=2).encode("utf-8")))

    try:
        refs_temp = stage_json(REFERENCE_FILE, refpoints)
        transforms_temp = stage_json(TRANSFORM_FILE, transforms)
        backup = None
        if TRANSFORM_FILE.exists():
            previous = TRANSFORM_FILE.read_bytes()
            backup = stage(TRANSFORM_FILE, lambda output: output.write(previous))

        for source, destination in poi_renames(refpoints):
            source.rename(destination)
            moved_pois.append((source, destination))

        os.replace(transforms_temp, TRANSFORM_FILE)
        try:
            os.replace(refs_temp, REFERENCE_FILE)
        except OSError:
            if backup is None:
                TRANSFORM_FILE.unlink(missing_ok=True)
            else:
                os.replace(backup, TRANSFORM_FILE)
            raise
    except OSError:
        for source, destination in reversed(moved_pois):
            destination.rename(source)
        raise
    finally:
        for path in staged:
            path.unlink(missing_ok=True)


def bounded_number(value, minimum, maximum):
    return type(value) in (int, float) and minimum <= value <= maximum


def track_key(value):
    if (
        not isinstance(value, str)
        or not 1 <= len(value) <= 200
        or value != value.strip()
        or value in {".", ".."}
        or any(character in "/\\" or ord(character) < 32 for character in value)
    ):
        raise ValueError("The recording needs a valid GameCode and TrackName.")
    return value


def metadata_text(value):
    if isinstance(value, str):
        return value.strip()[:200]
    if type(value) is int:
        return str(value)[:200]
    return ""


def read_recording_data(stream):
    try:
        with gzip.GzipFile(fileobj=stream, mode="rb") as compressed:
            raw = compressed.read(JSON_LIMIT + 1)
        if len(raw) > JSON_LIMIT:
            raise ValueError("The uncompressed recording exceeds 8 MB.")
        data = json.loads(raw)
    except (OSError, EOFError, zlib.error, UnicodeError, RecursionError, json.JSONDecodeError) as error:
        raise ValueError("The file must contain valid GZip-compressed SimHub JSON.") from error

    if not isinstance(data, dict):
        raise ValueError("The file must contain a SimHub recording.")
    if data.get("HasRelativeCarCoordinates"):
        raise ValueError("Use a recording with absolute car coordinates.")
    coordinates = data.get("CarCoordinates")
    if not isinstance(coordinates, list):
        raise ValueError("The recording does not contain CarCoordinates.")
    if len(coordinates) > POINT_LIMIT:
        raise ValueError(f"The recording exceeds {POINT_LIMIT:,} coordinate samples.")

    return data


def recording_metadata(data):
    game = data.get("GameCode")
    name = data.get("TrackName")
    game = track_key(str(game) if type(game) is int else game)
    name = track_key(str(name) if type(name) is int else name)
    recording = {
        "game": game,
        "track_name": name,
        "display_name": metadata_text(data.get("TrackDisplayName")),
        "track_code": metadata_text(data.get("TrackCode")),
        "track_config": metadata_text(data.get("TrackConfig")),
    }
    track_key(recording_track_key(recording))
    return recording


def read_recording(stream):
    return parse_recording(read_recording_data(stream))


def parse_recording(data):
    recording = recording_metadata(data)
    coordinates = data["CarCoordinates"]
    points = []
    skipped = 0
    for sample in coordinates:
        position = sample.get("Value") if isinstance(sample, dict) else None
        if (
            not isinstance(position, list)
            or len(position) != 3
            or not all(bounded_number(value, -1e9, 1e9) for value in position)
        ):
            skipped += 1
            continue
        progress = sample.get("p")
        points.append([*position, progress if bounded_number(progress, -1, 1) else None])

    recording.update(points=points, skipped=skipped)
    game = recording["game"]
    axes = (2,) if game == "FM8" else (2, 1)
    if not any(has_area(points, axis) for axis in axes):
        raise ValueError("The recording needs at least three non-collinear points.")
    return recording


def has_area(points, axis):
    if len(points) < 3:
        return False
    plane = np.array([(point[0], point[axis]) for point in points], dtype=float)
    centered = plane - plane[0]
    return np.linalg.matrix_rank(centered) == 2


# Clockwise offset for raw heading zero before any map rotation or reflection.
# The sign is the raw heading's sense in the unmirrored game coordinate plane.
YAW_PROFILES = {
    "FM8": {"zero": 180, "sign": -1},
    "PCars3": {"zero": 0, "sign": -1},
}


def apply_automatic_yaw(game, entry, alignment):
    profile = YAW_PROFILES.get(game) if alignment["axis"] == "xz" else None
    reflection = -1 if alignment["mirror"] else 1
    if profile is None:
        profile = alignment.get("yaw_reference")
        if profile is None:
            zero = reflection * (alignment["yaw"] + alignment["rotation"])
            profile = {"zero": (zero + 180) % 360 - 180, "sign": reflection * entry.get("yaw_sign", 1)}
        alignment["yaw_reference"] = profile
    if (
        not isinstance(profile, dict)
        or not bounded_number(profile.get("zero"), -180, 180)
        or not bounded_number(profile.get("sign"), -1, 1)
        or profile["sign"] not in (-1, 1)
    ):
        raise ValueError("Invalid yaw calibration.")
    offset = reflection * profile["zero"] - alignment["rotation"]
    alignment["yaw"] = round((offset + 180) % 360 - 180, 4)
    entry["yaw"] = alignment["yaw"]
    if reflection * profile["sign"] == -1:
        entry["yaw_sign"] = -1
    else:
        entry.pop("yaw_sign", None)


def migrate_automatic_yaw(refpoints):
    changed = False
    for game, tracks in refpoints.items():
        for entry in tracks.values():
            alignment = entry.get("helper2", {}).get("alignment")
            if not alignment:
                continue
            before = (alignment.copy(), entry.get("yaw"), entry.get("yaw_sign"))
            alignment.pop("yaw_auto", None)
            apply_automatic_yaw(game, entry, alignment)
            changed |= before != (alignment, entry.get("yaw"), entry.get("yaw_sign"))
    return changed


def initialize_track_storage():
    with REFERENCE_LOCK:
        refpoints = read_refpoints()
        keys_changed = migrate_track_keys(refpoints)
        yaw_changed = migrate_automatic_yaw(refpoints)
        if keys_changed or yaw_changed or poi_renames(refpoints):
            write_refpoints(refpoints)
        else:
            process_tracks(REFERENCE_FILE, TRANSFORM_FILE)


@lru_cache(maxsize=128)
def learn_live_fm8_track(track, names):
    # FM8 with no separate layout uses the live TrackId as the .shtl TrackName.
    with REFERENCE_LOCK:
        refpoints = read_refpoints()
        tracks = refpoints.get("FM8", {})
        if track in tracks:
            return
        matches = {name for name in names if name in tracks and not tracks[name].get("track_name")}
        if len(matches) != 1:
            return
        previous = matches.pop()
        entry = tracks.pop(previous)
        entry["track_name"] = track
        entry["aliases"] = track_aliases(track, *entry.get("aliases", ()), previous, *names)
        tracks[track] = entry
        write_refpoints(refpoints)


def alignment_reference_points(recording, alignment):
    if not isinstance(alignment, dict):
        raise ValueError("Place and align the recording on the map before saving.")
    ranges = {
        "latitude": (-MAP_LAT_LIMIT, MAP_LAT_LIMIT),
        "longitude": (-180, 180),
        "scale": (0.0001, 10_000),
        "rotation": (-360, 360),
        "yaw": (-360, 360),
    }
    for key, bounds in ranges.items():
        if not bounded_number(alignment.get(key), *bounds):
            raise ValueError(f"Invalid alignment value: {key}.")
    if type(alignment.get("mirror")) is not bool or alignment.get("axis") not in ("xz", "xy"):
        raise ValueError("Choose a valid coordinate plane and reflection setting.")

    if recording["game"] == "FM8" and alignment["axis"] != "xz":
        raise ValueError("FM8 recordings use the X/Z coordinate plane.")
    axis = 2 if alignment["axis"] == "xz" else 1
    points = recording["points"]
    if not has_area(points, axis):
        raise ValueError("The selected coordinate plane needs three non-collinear points.")
    xs = [point[0] for point in points]
    ys = [point[axis] for point in points]
    center_x = (min(xs) + max(xs)) / 2
    center_y = (min(ys) + max(ys)) / 2
    angle = math.radians(alignment["rotation"])
    cosine, sine = math.cos(angle), math.sin(angle)
    latitude = alignment["latitude"]
    longitude = alignment["longitude"]
    degrees_per_meter = 180 / (math.pi * EARTH_RADIUS)
    longitude_per_meter = degrees_per_meter / math.cos(math.radians(latitude))
    scale = alignment["scale"]
    mirror = -1 if alignment["mirror"] else 1

    refs = []
    for x, y in zip(xs, ys):
        east = (x - center_x) * scale * mirror
        north = (y - center_y) * scale
        lat = latitude + (sine * east + cosine * north) * degrees_per_meter
        lng = longitude + (cosine * east - sine * north) * longitude_per_meter
        if not (-MAP_LAT_LIMIT <= lat <= MAP_LAT_LIMIT and -180 <= lng <= 180):
            raise ValueError("The aligned track lies outside the supported map bounds.")
        refs.append({"CoordinatesX": x, "CoordinatesY": y, "lat": lat, "lng": lng})

    return refs
