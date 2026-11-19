# Confirmed against the FM8 .shtl samples supplied with this project.
FM8_TRACKS = {
    "Nurburgring Endurance": "31",
    "Nurburgring Nordschleife": "32",
    "Nurburgring Sprint": "34",
    "Brands Hatch GP": "860",
}


def track_aliases(track, *names):
    return list(dict.fromkeys(name for name in names if isinstance(name, str) and name and name != track))


def resolve_track(tracks, name):
    if name in tracks:
        return name
    matches = [key for key, entry in tracks.items() if name in entry.get("aliases", ())]
    return matches[0] if len(matches) == 1 else name


def legacy_track_for_recording(tracks, recording):
    # A display name may identify an old entry. Never use it to merge distinct saved IDs.
    for alias in (recording["track_code"], recording["display_name"]):
        if not alias:
            continue
        key = resolve_track(tracks, alias)
        if key in tracks and not tracks[key].get("helper2") and not tracks[key].get("track_name"):
            return key
    return recording["track_name"]


def migrate_track_keys(refpoints):
    changed = False
    for game, tracks in refpoints.items():
        for old_key, entry in list(tracks.items()):
            recording = entry.get("helper2", {}).get("recording", {})
            confirmed = FM8_TRACKS.get(old_key) if game == "FM8" else None
            track = recording.get("track_name") or confirmed or old_key
            if track != old_key and track in tracks:
                # An occupied key is ambiguous. Keep both entries available.
                track = old_key
            name = entry.get("display_name") or recording.get("display_name") or old_key
            aliases = track_aliases(track, *entry.get("aliases", ()), old_key,
                                    recording.get("track_code"), recording.get("display_name"))
            identity = {"display_name": name, "aliases": aliases}
            if track == recording.get("track_name") or track == confirmed:
                identity["track_name"] = track
            if any(entry.get(key) != value for key, value in identity.items()):
                entry.update(identity)
                changed = True
            if track != old_key:
                # Preserve the existing order for the track list.
                renamed = {track if key == old_key else key: value for key, value in tracks.items()}
                tracks.clear()
                tracks.update(renamed)
                changed = True
    return changed
