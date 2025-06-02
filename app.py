from flask import Flask, request, jsonify, render_template
import requests
from flask_cors import CORS
import json
from generate_transforms import process_tracks
from waitress import serve

process_tracks("static/track_reference_points.json", "static/track_transforms.json")

app = Flask(__name__)
CORS(app)  

# Load configuration from config.json
with open('config.json', 'r') as f:
    config = json.load(f)


PROXY_TARGET_URL = config.get('PROXY_TARGET_URL', 'http://192.168.188.102:8888/api/getgamedata')


@app.route('/')
def index():
    return render_template('index.html')


@app.route('/helper')
def helper():
    return render_template('helper.html')

@app.route('/config')
def get_config():
    return jsonify(config)

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
        response = requests.get(PROXY_TARGET_URL)
        return jsonify(response.json())
    except Exception as e:
        return {'error': str(e)}, 500

# Route to serve fake game data
@app.route('/fakedata')
def fakedata():
    try:
        with open('fake_gamedata.json', 'r') as f:
            data = json.load(f)
        return jsonify(data)
    except Exception as e:
        return {'error': str(e)}, 500


if __name__ == '__main__':
    debug = config.get('DEBUG', False)
    if debug:
        app.run(port=5000, debug=True)
    else:
        serve(app, host="0.0.0.0", port=5000)
    
