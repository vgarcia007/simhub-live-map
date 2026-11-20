# Confirmed against the local FM8 recordings and the cloud recording for Spa.
FM8_TRACKS = {
    "Nurburgring Endurance": "31",
    "Nurburgring Nordschleife": "32",
    "Nurburgring Sprint": "34",
    "Spa Francorchamps Full": "530",
    "Brands Hatch GP": "860",
}


# Layout names and keys confirmed against the PCars3 .shtl recordings.
PCARS3_TRACKS = {
    "Nurburgring-Nordschleife": ("Nurburgring", "Nordschleife", "Nürburgring Nordschleife"),
    "Bathurst-Mount_Panorama": ("Bathurst", "Mount_Panorama", "Bathurst – Mount Panorama"),
    "AutodromoNazionaleMonza-GP": ("AutodromoNazionaleMonza", "GP", "Monza GP"),
    "Azure_Circuit-GP": ("Azure_Circuit", "GP", "Azure Circuit GP"),
    "Hockenheimring-GP": ("Hockenheimring", "GP", "Hockenheimring GP"),
}


def recording_track_key(recording):
    name = recording.get("track_name")
    config = recording.get("track_config")
    if recording.get("game") == "PCars3" and name and config:
        return f"{name}-{config}"
    return name


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
    return recording_track_key(recording)


def migrate_track_keys(refpoints):
    changed = False
    for game, tracks in refpoints.items():
        for old_key, entry in list(tracks.items()):
            recording = entry.get("helper2", {}).get("recording", {})
            pcars = PCARS3_TRACKS.get(old_key) if game == "PCars3" else None
            confirmed = FM8_TRACKS.get(old_key) if game == "FM8" else old_key if pcars else None
            recorded_key = recording_track_key(recording)
            track = recorded_key or confirmed or old_key
            if track != old_key and track in tracks:
                # An occupied key is ambiguous. Keep both entries available.
                track = old_key
            name = entry.get("display_name") or recording.get("display_name") or old_key
            if pcars and name == old_key:
                name = pcars[2]
            aliases = track_aliases(track, *entry.get("aliases", ()), old_key,
                                    recording.get("track_code"), recording.get("display_name"))
            identity = {"display_name": name, "aliases": aliases}
            if track == recorded_key:
                identity["track_name"] = recording["track_name"]
                if recording.get("track_config"):
                    identity["track_config"] = recording["track_config"]
            elif pcars and track == confirmed:
                identity["track_name"], identity["track_config"] = pcars[:2]
            elif track == confirmed:
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
