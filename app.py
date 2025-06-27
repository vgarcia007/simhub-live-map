from flask import Flask, request, jsonify, render_template, redirect, url_for
import requests
from flask_cors import CORS
import json
from generate_transforms import process_tracks
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
    try:
        small_data['IsGameInRace'] = data['IsGameInRace']
    except KeyError:
        small_data['IsGameInRace'] = False
    try:
        small_data['GameRunning'] = data['GameRunning']
    except KeyError:
        small_data['GameRunning'] = False
    if data['NewData'] is not None:
        try:
            small_data['NewData']['TrackName'] = data['NewData']['TrackName']
        except KeyError:
            pass
        try:
            small_data['NewData']['TrackCode'] = data['NewData']['TrackCode']
        except KeyError:
            pass
        try:
            small_data['NewData']['FilteredSpeedKmh'] = data['NewData']['FilteredSpeedKmh']
        except KeyError:
            pass
        try:
            small_data['NewData']['FeedbackData']['CoordinatesX'] = data['NewData']['FeedbackData']['CoordinatesX']
        except KeyError:
            pass
        try:
            small_data['NewData']['FeedbackData']['CoordinatesY'] = data['NewData']['FeedbackData']['CoordinatesY']
        except KeyError:
            pass
        try:
            small_data['NewData']['FeedbackData']['OrientationYaw'] = data['NewData']['FeedbackData']['OrientationYaw']
        except KeyError:
            pass
        try:
            small_data['NewData']['CarCoordinates'] = data['NewData']['CarCoordinates']
        except KeyError:
            pass
        try:
            small_data['NewData']['OrientationYaw'] = data['NewData']['OrientationYaw']
        except KeyError:
            pass
        try:
            small_data['NewData']['SpeedKmh'] = data['NewData']['SpeedKmh']
        except KeyError:
            pass
        try:
            small_data['NewData']['CurrentLapTime']= data['NewData']['CurrentLapTime']
        except KeyError:
            pass
        try:
            small_data['NewData']['CurrentLap']= data['NewData']['CurrentLap']
        except KeyError:
            pass
        try:
            small_data['NewData']['CurrentSectorIndex']= data['NewData']['CurrentSectorIndex']
        except KeyError:
            pass
    else:
        small_data['NewData'] = None
    
    return small_data

process_tracks("static/track_reference_points.json", "static/track_transforms.json")
update_addons("https://garcias-garage.de/files-other/nfsh-addons/version.json", "static/addons")

app = Flask(__name__)
CORS(app)  


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
        with open('static/track_reference_points.json', 'r') as f:
            refpoints = json.load(f)
        if game in refpoints and track in refpoints[game]:
            return jsonify(refpoints[game][track])
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
        with open('static/track_reference_points.json', 'r') as f:
            refpoints = json.load(f)

        return render_template('tracks.html', config=config, games=refpoints, poi_dict=poi_dict)
    except Exception as e:
        return {'error': str(e)}, 500


@app.route('/delete-track/<game>/<track>', methods=['GET'])
def delete_track(game, track):
    try:
        with open('static/track_reference_points.json', 'r') as f:
            refpoints = json.load(f)
        
        if game in refpoints and track in refpoints[game]:
            del refpoints[game][track]
            # If the game has no tracks left, remove the game entry
            if not refpoints[game]:
                del refpoints[game]
            
            with open('static/track_reference_points.json', 'w') as f:
                json.dump(refpoints, f, indent=2)
            
            process_tracks("static/track_reference_points.json", "static/track_transforms.json")
            return jsonify({'message': 'Track deleted successfully'}), 200
        else:
            return {'error': 'Track not found'}, 404
    except Exception as e:
        return {'error': str(e)}, 500


@app.route('/save-refpoints/<game>', methods=['POST'])
def save_refpoints(game):

    data = request.json

    #check if data is valid
    if not isinstance(data, dict):
        return {'error': 'Invalid data format'}, 400
    #check if track is provided
    try:
        track = top_key = next(iter(data))
        print(game)
        print(track)
    except StopIteration:
        return {'error': 'No track provided'}, 400

    try:
        with open('static/track_reference_points.json', 'r') as f:
            refpoints = json.load(f)
    except Exception as e:
        return {'error': str(e)}, 500

    if game not in refpoints:
        refpoints[game] = {}
    if track not in refpoints[game]:
        refpoints[game][track] = {}

    if 'yaw' not in refpoints[game][track]:
        refpoints[game][track]['yaw'] = 0.0
    if 'ref_points' not in refpoints[game][track]:
        refpoints[game][track]['ref_points'] = []

    # Update the yaw value
    if 'yaw' in data[track]:
        refpoints[game][track]['yaw'] = data[track]['yaw']
    else:
        return {'error': 'Yaw value is required'}, 400
    # Update the reference points
    if 'ref_points' in data[track]:
        #check if we have at least three ref_points
        if len(data[track]['ref_points']) < 3:
            return {'error': 'At least three reference points are required'}, 400
        refpoints[game][track]['ref_points'] = data[track]['ref_points']
    else:
        return {'error': 'Reference points are required'}, 400
    
    #now write back the static/track_reference_points.json file
    try:
        with open('static/track_reference_points.json', 'w') as f:
            json.dump(refpoints, f, indent=2)
    except Exception as e:
        return {'error': str(e)}, 500


    process_tracks("static/track_reference_points.json", "static/track_transforms.json")

    return jsonify({'message': 'Data saved successfully'}), 200


# Route to handle CORS requests
@app.route('/proxy')
def proxy():
    try:
        print(f"Fetching data from {PROXY_TARGET_URL}")
        response = requests.get(PROXY_TARGET_URL)
        data = response.json()
        return jsonify(minimize_json(data))
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


@app.route('/poi/<game>/<trackcode>')
def poi(game, trackcode):
    if not user_config_active:
        return redirect(url_for('get_config_user'))
    
    with open('icons.json', 'r') as f:
        icons = json.load(f)
    print(icons)
    return render_template('poi_editor.html', config=config, game=game, trackcode=trackcode, directions=icons)

@app.route('/poi-editor/<game>/<trackcode>', methods=['GET', 'POST'])
def poi_editor(game, trackcode):
    if request.method == 'GET':
        try:
            with open(f'static/poi/{game}/{trackcode}.json', 'r') as file:
                data = json.load(file)
            return jsonify(data)
        except FileNotFoundError:
            return jsonify({"type": "FeatureCollection", "features": []})
    elif request.method == 'POST':
        data = request.json
        with open(f'static/poi/{game}/{trackcode}.json', 'w') as file:
            json.dump(data, file, indent=2)
        return jsonify({"status": "success"})

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
    
    if debug:
        logger.debug("Running in debug mode with Flask development server")
        app.run(port=5000, debug=True)
    else:
        logger.info("Running in production mode with Waitress server")
        serve(app, host="0.0.0.0", port=5000)
