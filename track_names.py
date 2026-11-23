"""Display labels for SimHub track identities. The catalog never changes a track key."""

import json
import re
import unicodedata
from pathlib import Path
from typing import NamedTuple


class TrackNames(NamedTuple):
    display_name: str
    search_name: str = ""


def normalized_name(value):
    plain = unicodedata.normalize("NFKD", value.casefold())
    return "".join(char for char in plain if char.isalnum())


def load_catalog():
    with Path(__file__).with_name("track_names.json").open(encoding="utf-8") as source:
        rows = json.load(source)
    catalog = {}
    normalized = {}
    for game, entries in rows.items():
        catalog[game] = {}
        names = {}
        for key, (circuit, layout) in entries.items():
            label = TrackNames(f"{circuit} – {layout}" if layout else circuit, circuit)
            catalog[game][key] = label
            names.setdefault(normalized_name(key), set()).add(label)
        normalized[game] = {key: next(iter(labels)) for key, labels in names.items() if len(labels) == 1}
    return catalog, normalized


CATALOG, NORMALIZED_CATALOG = load_catalog()


def known_track_names(game, key, config=""):
    exact = CATALOG.get(game, {})
    normalized = NORMALIZED_CATALOG.get(game, {})
    if game == "RRRE" and config:
        configured = f"{key}-{config}"
        match = exact.get(configured) or normalized.get(normalized_name(configured))
        if match or not key.isdecimal():
            return match
    return exact.get(key) or normalized.get(normalized_name(key))


def readable_track_name(name, key):
    if not name or name.isdecimal():
        return ""
    # SimHub sometimes repeats an internal key as the display name. Accept
    # human-readable variations, such as "Brands Hatch GP", before the catalog.
    return name if name != key or not re.search(r"[_-]", key) else ""


def resolve_track_names(game, key, config="", saved_name="", recorded_name=""):
    known = known_track_names(game, key, config)
    for name in (saved_name, recorded_name):
        if readable_track_name(name, key) and not (name == key and known and name != known.display_name):
            return TrackNames(name, known.search_name if known and known.display_name == name else "")
    return known or TrackNames(recorded_name or saved_name or key)
