from flask import Flask, request, jsonify, render_template, redirect, send_file, send_from_directory, url_for
from base64 import b64encode
from threading import Thread
from werkzeug.serving import is_running_from_reloader
import requests
from flask_cors import CORS
from itsdangerous import BadSignature, URLSafeSerializer
import json
from mapping_helper import (
    REFERENCE_LOCK, UPLOAD_LIMIT, YAW_PROFILES, alignment_reference_points, apply_automatic_yaw, read_recording,
    initialize_track_storage, learn_live_fm8_track, metadata_text, read_refpoints, track_key, write_refpoints,
)
from recording_catalog import catalog_tracks, cloud_download, find_recording, preview_recording
from recording_sync import RecordingSync, ShareError, read_sync_settings, recordings_cache, share_settings, smb_request
from track_identity import legacy_track_for_recording, recording_track_key, resolve_track, track_aliases
from track_names import resolve_track_names
from update_addons import update_addons

from waitress import serve
import logging
import os
import time
import requests

import sqlite3

DB_PATH = 'poi_status.db'

def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    with get_db() as db:
        db.execute('''
            CREATE TABLE IF NOT EXISTS poi_status (
                mapname TEXT NOT NULL,
                layerinfo TEXT NOT NULL,
                uid TEXT NOT NULL,
                done INTEGER NOT NULL DEFAULT 1,
                PRIMARY KEY (mapname, layerinfo, uid)
            )
        ''')
init_db()


def load_config():
    global config, user_config_active, PROXY_TARGET_URL
    
    # Load configuration from config.json
    with open('config.json', 'r') as f:
        config = json.load(f)

    # Check if we have a config-user.json file
    try:
        with open('config-user.json', 'r') as f:
            user_config = json.load(f)
            config.update(user_config)
            user_config_active = True
    except FileNotFoundError:
        user_config_active = False
        print("No user config found, using default config.")

    # Update the proxy URL
    SimHubIP = config.get('SimHubIP', 'localhost')
    SimHubPort = config.get('SimHubPort', '8888')
    try:
        PROXY_TARGET_URL = f"http://{SimHubIP}:{SimHubPort}/api/getgamedata"
        requests.utils.urlparse(PROXY_TARGET_URL)  # Validate URL format
    except Exception as e:
        raise ValueError(f"Invalid PROXY_TARGET_URL: {PROXY_TARGET_URL}. Error: {e}")
    return config


def minimize_json(data):
    """
    Minimize JSON data by removing unnecessary things.
    """
    small_data ={}
    small_data['NewData'] = {}
    small_data['NewData']['FeedbackData'] = {}
    try:
        small_data['GameName'] = data['GameName']
    except KeyError:
        small_data['GameName'] = "Unknown Game"
    small_data['GameCode'] = data.get('GameCode') or small_data['GameName']
    try:
        small_data['IsGameInRace'] = data['IsGameInRace']
    except KeyError:
        small_data['IsGameInRace'] = False
    try:
        small_data['GameRunning'] = data['GameRunning']
    except KeyError:
        small_data['GameRunning'] = False
    new_data = data.get('NewData')
    if new_data is not None:
        for field in ('TrackName', 'TrackCode', 'TrackId', 'TrackIdWithConfig', 'TrackConfig'):
            if field in new_data:
                small_data['NewData'][field] = new_data[field]
        try:
            small_data['NewData']['FilteredSpeedKmh'] = new_data['FilteredSpeedKmh']
        except KeyError:
            pass
        try:
            small_data['NewData']['FeedbackData']['CoordinatesX'] = new_data['FeedbackData']['CoordinatesX']
        except KeyError:
            pass
        try:
            small_data['NewData']['FeedbackData']['CoordinatesY'] = new_data['FeedbackData']['CoordinatesY']
        except KeyError:
            pass
        try:
            small_data['NewData']['FeedbackData']['OrientationYaw'] = new_data['FeedbackData']['OrientationYaw']
        except KeyError:
            pass
        try:
            small_data['NewData']['CarCoordinates'] = new_data['CarCoordinates']
        except KeyError:
            pass
        try:
            small_data['NewData']['OrientationYaw'] = new_data['OrientationYaw']
        except KeyError:
            pass
        try:
            small_data['NewData']['SpeedKmh'] = new_data['SpeedKmh']
        except KeyError:
            pass
        try:
            small_data['NewData']['CurrentLapTime']= new_data['CurrentLapTime']
        except KeyError:
            pass
        try:
            small_data['NewData']['CurrentLap']= new_data['CurrentLap']
        except KeyError:
            pass
        try:
            small_data['NewData']['CurrentSectorIndex']= new_data['CurrentSectorIndex']
        except KeyError:
            pass
    else:
        small_data['NewData'] = None
    
    return small_data

initialize_track_storage()
update_addons("https://garcias-garage.de/files-other/nfsh-addons/version.json", "static/addons")

app = Flask(__name__)
CORS(app, resources={r"^/(?!config-user/recording-sync(?:/|$)).*": {}})
recording_sync = RecordingSync()
recording_links = URLSafeSerializer(os.urandom(32), salt="simhub-recordings")


# Initialize configuration
config = {}
user_config_active = False
PROXY_TARGET_URL = ""
load_config()


@app.route('/')
def index():
    if not user_config_active:
        return redirect(url_for('get_config_user'))
    current_time = int(time.time())
    return render_template('index.html', config=config, timestamp=current_time)


@app.route('/horizon')
def horizon():
    if not user_config_active:
        return redirect(url_for('get_config_user'))
    current_time = int(time.time())
    return render_template('horizon2.html', config=config, timestamp=current_time)


@app.route('/horizon/markPOIasDone', methods=['POST'])
def mark_poi_as_done():
    data = request.json
    if not data or not all(k in data for k in ("mapname", "layerinfo", "uid")):
        return jsonify({'error': 'Invalid data'}), 400

    mapname = data["mapname"]
    layerinfo = data["layerinfo"]
    uid = data["uid"]

    with get_db() as db:
        db.execute('''
            INSERT INTO poi_status (mapname, layerinfo, uid, done)
            VALUES (?, ?, ?, 1)
            ON CONFLICT(mapname, layerinfo, uid)
            DO UPDATE SET done=1
        ''', (mapname, layerinfo, uid))
    return jsonify({'success': 'Marker updated'}), 200


@app.route('/horizon/unmarkPOIasDone', methods=['POST'])
def unmark_poi_as_done():
    data = request.json
    if not data or not all(k in data for k in ("mapname", "layerinfo", "uid")):
        return jsonify({'error': 'Invalid data'}), 400

    mapname = data["mapname"]
    layerinfo = data["layerinfo"]
    uid = data["uid"]

    with get_db() as db:
        db.execute('''
            INSERT INTO poi_status (mapname, layerinfo, uid, done)
            VALUES (?, ?, ?, 0)
            ON CONFLICT(mapname, layerinfo, uid)
            DO UPDATE SET done=0
        ''', (mapname, layerinfo, uid))
    return jsonify({'success': 'Marker unmarked'}), 200


@app.route('/horizon/poiStatus', methods=['GET'])
def get_poi_status():
    mapname = request.args.get('mapname')
    layerinfo = request.args.get('layerinfo')
    query = 'SELECT mapname, layerinfo, uid, done FROM poi_status WHERE 1=1'
    params = []
    if mapname:
        query += ' AND mapname=?'
        params.append(mapname)
    if layerinfo:
        query += ' AND layerinfo=?'
        params.append(layerinfo)
    with get_db() as db:
        rows = db.execute(query, params).fetchall()
        result = [dict(row) for row in rows]
    return jsonify(result)


@app.route('/settings')
def settings():
    if not user_config_active:
        return redirect(url_for('get_config_user'))
    return render_template('settings.html', config=config)


@app.route('/helper')
def helper():
    if not user_config_active:
        return redirect(url_for('get_config_user'))
    return render_template('helper.html')

@app.route('/recordings')
def list_recordings():
    return render_recordings()


def render_recordings(upload_error=None):
    root = recordings_cache()
    try:
        tracks, skipped = catalog_tracks(root, read_refpoints())
    except FileNotFoundError:
        tracks, skipped = [], 0
    except OSError:
        return render_template('recordings.html', tracks=None, skipped=0, upload_error=upload_error)
    for track in tracks:
        display_name = track['source_display_name']
        for source in track['sources'].values():
            source['token'] = recording_links.dumps([source['path'], source['size'], source['rank'][0], display_name])
    return render_template('recordings.html', tracks=tracks, skipped=skipped, upload_error=upload_error)


def catalog_recording_details(token):
    relative, size, modified_ns, display_name = recording_links.loads(token)
    return find_recording(recordings_cache(), relative, size, modified_ns), display_name


@app.route('/recordings/preview/<token>')
def catalog_preview(token):
    try:
        path, _ = catalog_recording_details(token)
        _, preview = preview_recording(path)
        return jsonify(preview)
    except (BadSignature, OSError, ValueError):
        return {'error': 'This preview is unavailable. Refresh the recordings list and select it again.'}, 404


@app.route('/recordings/file/<token>')
def catalog_recording(token):
    try:
        path, display_name = catalog_recording_details(token)
        if path.parent.name.lower() == 'maprecordscloud':
            return app.response_class(cloud_download(path, display_name), mimetype='application/octet-stream')
        return send_file(str(path), mimetype='application/octet-stream')
    except (BadSignature, OSError, ValueError):
        return {'error': 'This recording is unavailable. Refresh the recordings list and select it again.'}, 404


@app.route('/helper2', methods=['GET', 'POST'])
@app.route('/helper2/<game>/<track>')
def helper2(game=None, track=None):
    if not user_config_active:
        return redirect(url_for('get_config_user'))
    if game is not None:
        tracks = read_refpoints().get(game, {})
        key = resolve_track(tracks, track)
        if not tracks.get(key, {}).get('helper2'):
            return {'error': 'Track not found in Mapping Helper 2.'}, 404
        if key != track:
            return redirect(url_for('helper2', game=game, track=key))
    script_version = os.stat(os.path.join(app.static_folder, 'helper2.js')).st_mtime_ns
    selected_recording = request.args.get('recording') if game is None else None
    if request.method == 'POST':
        try:
            imported = recording_import_data(helper2_upload())
        except ValueError as error:
            return render_recordings(upload_error=str(error)), 400
        uploaded = request.files['recording']
        uploaded.stream.seek(0)
        imported['file'] = b64encode(uploaded.stream.read()).decode('ascii')
        return render_template('helper2.html', game=game, script_version=script_version, uploaded_recording=imported)
    if game is None and not selected_recording:
        return redirect(url_for('list_recordings'))
    return render_template('helper2.html', game=game, track=track, script_version=script_version,
                           selected_recording=selected_recording)


def helper2_upload():
    if request.content_length and request.content_length > UPLOAD_LIMIT + 64 * 1024:
        raise ValueError("The recording exceeds 2 MB.")
    uploaded = request.files.get('recording')
    if not uploaded or not uploaded.filename.lower().endswith('.shtl'):
        raise ValueError("Choose a .shtl recording.")
    uploaded.stream.seek(0, os.SEEK_END)
    if uploaded.stream.tell() > UPLOAD_LIMIT:
        raise ValueError("The recording exceeds 2 MB.")
    uploaded.stream.seek(0)
    return read_recording(uploaded.stream)


def recording_import_data(recording):
    tracks = read_refpoints().get(recording['game'], {})
    key = recording_track_key(recording)
    existing = tracks.get(key) or tracks.get(legacy_track_for_recording(tracks, recording), {})
    names = resolve_track_names(recording['game'], key, recording['track_config'],
                                existing.get('display_name', ''), recording['display_name'])
    return {
        'recording': recording,
        'track_key': key,
        **names._asdict(),
        'yaw': existing.get('yaw', 0),
        'yaw_profile': YAW_PROFILES.get(recording['game']),
    }


@app.route('/helper2/import', methods=['POST'])
def helper2_import():
    try:
        return jsonify(recording_import_data(helper2_upload()))
    except ValueError as error:
        return {'error': str(error)}, 400


@app.route('/helper2/recording/<game>/<track>')
def helper2_recording(game, track):
    tracks = read_refpoints().get(game, {})
    key = resolve_track(tracks, track)
    entry = tracks.get(key, {})
    if 'helper2' not in entry:
        return {'error': 'Track not found in Mapping Helper 2.'}, 404
    recording = entry['helper2']['recording']
    names = resolve_track_names(game, key, recording.get('track_config', ''),
                                entry.get('display_name', ''), recording.get('display_name', ''))
    return jsonify(**entry['helper2'], **names._asdict(),
                   yaw_profile=YAW_PROFILES.get(game))


@app.route('/helper2/save', methods=['POST'])
def helper2_save():
    try:
        if request.content_length and request.content_length > UPLOAD_LIMIT + 64 * 1024:
            raise ValueError("The recording exceeds 2 MB.")
        game = track_key(request.form.get('game'))
        track = track_key(request.form.get('track'))
        alignment = json.loads(request.form.get('alignment', 'null'))
        uploaded = helper2_upload() if 'recording' in request.files else None
        if uploaded is not None and (uploaded['game'], recording_track_key(uploaded)) != (game, track):
            raise ValueError("The game and track key must match the uploaded recording.")

        with REFERENCE_LOCK:
            refpoints = read_refpoints()
            tracks = refpoints.setdefault(game, {})
            previous_key = resolve_track(tracks, track) if uploaded is None else track
            if uploaded is not None and track not in tracks:
                previous_key = legacy_track_for_recording(tracks, uploaded)
            existing = tracks.get(previous_key)
            if uploaded is None:
                if not existing or 'helper2' not in existing:
                    return {'error': 'Track not found in Mapping Helper 2.'}, 404
                track = previous_key
                recording = existing['helper2']['recording']
            else:
                recording = uploaded
                if existing is not None:
                    old_recording = existing.get('helper2', {}).get('recording')
                    if old_recording and old_recording.get('track_config') != recording['track_config']:
                        raise ValueError("A different configuration already uses this GameCode and TrackName.")
                    if request.form.get('replace') != 'yes':
                        return {'error': 'Replace the saved reference points for this track?',
                                'replace_required': True}, 409

            refs = alignment_reference_points(recording, alignment)
            saved_alignment = {key: alignment[key] for key in (
                'latitude', 'longitude', 'scale', 'rotation', 'yaw', 'mirror', 'axis'
            )}
            previous = existing or {}
            names = resolve_track_names(game, track, recording['track_config'],
                                        previous.get('display_name', ''), recording['display_name'])
            display_name = metadata_text(request.form.get('display_name')) or names.display_name
            updated = {
                'track_name': recording['track_name'],
                'display_name': display_name,
                'aliases': track_aliases(track, *previous.get('aliases', ()), previous_key,
                                         recording['track_code'], recording['display_name']),
                'yaw': alignment['yaw'],
                'ref_points': refs,
                'helper2': {'recording': recording, 'alignment': saved_alignment},
            }
            if game not in YAW_PROFILES or saved_alignment['axis'] != 'xz':
                reference = alignment.get('yaw_reference')
                if isinstance(reference, dict):
                    saved_alignment['yaw_reference'] = {key: reference.get(key) for key in ('zero', 'sign')}
            apply_automatic_yaw(game, updated, saved_alignment)
            if recording['track_config']:
                updated['track_config'] = recording['track_config']
            if previous_key != track:
                del tracks[previous_key]
            tracks[track] = updated
            write_refpoints(refpoints)
        return jsonify(url=url_for('helper2', game=game, track=track), point_count=len(refs))
    except (ValueError, RecursionError) as error:
        return {'error': str(error)}, 400
    except Exception:
        app.logger.exception("Could not save Mapping Helper 2 reference points")
        return {'error': 'Could not save the reference points. Please try again.'}, 500


@app.route('/config-user-update', methods=['POST'])
def update_config_user():
    data = request.json
    # get the DEBUG key from the data
    print(f"Received data for user config update: {data}")
    if 'DEBUG' in data:
        data['DEBUG'] = data['DEBUG'].lower() == 'true' or data['DEBUG'] == '1'

    if 'speedZoom' in data:
        data['speedZoom'] = data['speedZoom'].lower() == 'true' or data['speedZoom'] == '1'

    if not isinstance(data, dict):
        return {'error': 'Invalid data format'}, 400
    
    try:
        with open('config-user.json', 'w') as f:
            json.dump(data, f, indent=2)
        load_config()
        return jsonify({'success': 'User configuration updated successfully'}), 200
    
    except Exception as e:
        return {'error': str(e)}, 500

@app.route('/config-user')
def get_config_user():
    load_config()

    return render_template('config.html', config=config)


@app.route('/config-user/recording-sync', methods=['GET', 'POST'])
@app.route('/config-user/recording-sync/<any(discover,test):operation>', methods=['POST'])
def manage_recording_sync(operation='save'):
    try:
        if request.method == 'GET':
            return jsonify(recording_sync.info()), 200, {'Cache-Control': 'no-store'}
        origin = request.headers.get('Origin')
        if request.headers.get('Sec-Fetch-Site') in ('cross-site', 'same-site') or (
            origin and origin != request.host_url.rstrip('/')
        ):
            return {'error': 'Open Config directly on the Navi server.'}, 403
        data = request.get_json(silent=True)
        if not isinstance(data, dict):
            return {'error': 'Invalid recording sync settings.'}, 400
        if operation == 'save':
            recording_sync.save(data)
            return jsonify(recording_sync.info()), 200, {'Cache-Control': 'no-store'}
        settings = share_settings(data, read_sync_settings(), operation)
        return jsonify(smb_request(operation, settings)), 200, {'Cache-Control': 'no-store'}
    except ValueError as error:
        return {'error': str(error) if not isinstance(error, json.JSONDecodeError)
                else 'Could not read the recording sync settings.'}, 400
    except ShareError as error:
        return {'error': str(error)}, 502
    except OSError:
        return {'error': 'Could not access the recording sync settings or start the SMB client.'}, 503


@app.route('/config')
def get_config():
    return jsonify(config)

@app.route('/icons')
def icons():
    ##load icons from icons.json
    try:
        with open('icons.json', 'r') as f:
            icons = json.load(f)
    except FileNotFoundError:
        return {'error': 'Icons file not found'}, 404
    except json.JSONDecodeError:
        return {'error': 'Error decoding icons file'}, 500
    return jsonify(icons)

@app.route('/refpoints/<game>/<track>')
def get_refpoint(game, track):
    try:
        tracks = read_refpoints().get(game, {})
        key = resolve_track(tracks, track)
        if key in tracks:
            return jsonify(tracks[key])
        else:
            return {'error': 'Track not found'}, 404
    except Exception as e:
        return {'error': str(e)}, 500


@app.route('/list-tracks', methods=['GET'])
def list_tracks():
    

    root_dir = 'static/poi'
    poi_dict = {}
    
    for entry in os.listdir(root_dir):
        subdir_path = os.path.join(root_dir, entry)
        if not os.path.isdir(subdir_path):
            continue
        
        file_counts = {}
        for fname in os.listdir(subdir_path):
            if not fname.lower().endswith('.json'):
                continue
            
            name = os.path.splitext(fname)[0]
            full_path = os.path.join(subdir_path, fname)
            
            try:
                with open(full_path, 'r', encoding='utf-8') as f:
                    data = json.load(f)
                # GeoJSON-Features zählen
                count = len(data.get('features', []))
            except Exception as e:
                # Bei Fehlern können wir None setzen oder z.B. 0
                print(f"Fehler beim Laden von {full_path}: {e}")
                count = None
            
            file_counts[name] = count
        
        poi_dict[entry] = file_counts
    try:
        refpoints = read_refpoints()

        for game, tracks in refpoints.items():
            counts = poi_dict.setdefault(game, {})
            for track, entry in tracks.items():
                key = poi_track_key(track, entry, counts)
                counts[track] = counts.get(key, 0)
        return render_template('tracks.html', config=config, games=refpoints, poi_dict=poi_dict)
    except Exception as e:
        return {'error': str(e)}, 500


@app.route('/delete-track/<game>/<track>', methods=['GET'])
def delete_track(game, track):
    try:
        with REFERENCE_LOCK:
            refpoints = read_refpoints()
            tracks = refpoints.get(game, {})
            key = resolve_track(tracks, track)
            if key not in tracks:
                return {'error': 'Track not found'}, 404
            del tracks[key]
            if not refpoints[game]:
                del refpoints[game]
            write_refpoints(refpoints)
        return jsonify({'message': 'Track deleted successfully'}), 200
    except Exception as e:
        return {'error': str(e)}, 500


@app.route('/save-refpoints/<game>', methods=['POST'])
def save_refpoints(game):
    data = request.json
    if not isinstance(data, dict):
        return {'error': 'Invalid data format'}, 400
    if not data:
        return {'error': 'No track provided'}, 400

    track = next(iter(data))
    try:
        with REFERENCE_LOCK:
            refpoints = read_refpoints()
            tracks = refpoints.setdefault(game, {})
            entry = tracks.setdefault(resolve_track(tracks, track), {'display_name': track})
            if 'helper2' in entry:
                return {'error': 'Edit this track in Mapping Helper 2.'}, 409
            if 'yaw' not in data[track]:
                return {'error': 'Yaw value is required'}, 400
            if 'ref_points' not in data[track]:
                return {'error': 'Reference points are required'}, 400
            if len(data[track]['ref_points']) < 3:
                return {'error': 'At least three reference points are required'}, 400
            entry.update(yaw=data[track]['yaw'], ref_points=data[track]['ref_points'])
            write_refpoints(refpoints)
    except Exception as e:
        return {'error': str(e)}, 500

    return jsonify({'message': 'Data saved successfully'}), 200


# Route to handle CORS requests
@app.route('/proxy')
def proxy():
    try:
        print(f"Fetching data from {PROXY_TARGET_URL}")
        response = requests.get(PROXY_TARGET_URL)
        data = response.json()
        telemetry = minimize_json(data)
        new = telemetry['NewData']
        if telemetry['GameCode'] == 'FM8' and telemetry['IsGameInRace'] and new and not new.get('TrackConfig'):
            track = metadata_text(new.get('TrackId'))
            configured = metadata_text(new.get('TrackIdWithConfig'))
            if track.isdecimal() and configured in ('', track):
                names = tuple(metadata_text(new.get(key)) for key in ('TrackCode', 'TrackName'))
                try:
                    learn_live_fm8_track(track, names)
                except OSError:
                    app.logger.exception("Could not update track identity from SimHub")
        return jsonify(telemetry)
    except Exception as e:
        return {'error': str(e)}, 500

# Route to handle CORS requests
@app.route('/proxy/unminimized')
def proxy_unminimized():
    try:
        print(f"Fetching data from {PROXY_TARGET_URL}")
        response = requests.get(PROXY_TARGET_URL)
        data = response.json()
        return jsonify(data)
    except Exception as e:
        return {'error': str(e)}, 500

# Route to serve fake game data
@app.route('/fakedata')
def fakedata():
    try:
        with open('fake_gamedata.json', 'r') as f:
            data = json.load(f)
            
        return jsonify(minimize_json(data))
    except Exception as e:
        return {'error': str(e)}, 500


def poi_track_key(track, entry, existing):
    return next((key for key in (track, *entry.get('aliases', ())) if key in existing), track)


def poi_storage(game, track):
    track_key(game)
    track_key(track)
    tracks = read_refpoints().get(game, {})
    key = resolve_track(tracks, track)
    entry = tracks.get(key, {})
    directory = os.path.join('static', 'poi', game)
    files = {
        os.path.splitext(filename)[0] for filename in os.listdir(directory)
        if filename.endswith('.json')
    } if os.path.isdir(directory) else set()
    filename = poi_track_key(key, entry, files) + '.json'
    return directory, filename, key, entry.get('display_name', key)


@app.route('/poi/<game>/<trackcode>')
def poi(game, trackcode):
    if not user_config_active:
        return redirect(url_for('get_config_user'))
    try:
        _, _, key, display_name = poi_storage(game, trackcode)
    except ValueError as error:
        return {'error': str(error)}, 400
    with open('icons.json', 'r') as f:
        icons = json.load(f)
    return render_template('poi_editor.html', config=config, game=game, trackcode=key,
                           display_name=display_name, directions=icons)


@app.route('/static/poi/<game>/<trackcode>.json')
def static_poi(game, trackcode):
    try:
        with REFERENCE_LOCK:
            directory, filename, _, _ = poi_storage(game, trackcode)
            return send_from_directory(os.path.abspath(directory), filename)
    except ValueError as error:
        return {'error': str(error)}, 400


@app.route('/poi-editor/<game>/<trackcode>', methods=['GET', 'POST'])
def poi_editor(game, trackcode):
    try:
        with REFERENCE_LOCK:
            directory, filename, _, _ = poi_storage(game, trackcode)
            path = os.path.join(directory, filename)
            if request.method == 'GET':
                try:
                    with open(path, 'r', encoding='utf-8') as source:
                        return jsonify(json.load(source))
                except FileNotFoundError:
                    return jsonify({"type": "FeatureCollection", "features": []})
            os.makedirs(directory, exist_ok=True)
            with open(path, 'w', encoding='utf-8') as output:
                json.dump(request.json, output, indent=2)
            return jsonify({"status": "success"})
    except ValueError as error:
        return {'error': str(error)}, 400


@app.route('/favicon.ico')
def favicon_redirect():
    return redirect(url_for('static', filename='favicon/favicon.ico'), code=302)

if __name__ == '__main__':
    
    debug = config.get('DEBUG', False)
    log_level = logging.DEBUG if debug else logging.INFO
    
    logging.basicConfig(
        level=log_level,
        format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
    )
    
    logger = logging.getLogger(__name__)
    logger.info(f"Starting application with DEBUG={debug}")
    logger.info(f"Using PROXY_TARGET_URL: {PROXY_TARGET_URL}")
    if not debug or is_running_from_reloader():
        Thread(target=recording_sync.run, name="recording-sync", daemon=True).start()
    
    if debug:
        logger.debug("Running in debug mode with Flask development server")
        app.run(port=5015, debug=True)
    else:
        logger.info("Running in production mode with Waitress server")
        serve(app, host="0.0.0.0", port=5015)
