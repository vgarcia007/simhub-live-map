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
    
