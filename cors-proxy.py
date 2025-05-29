from flask import Flask, request, jsonify
import requests
from flask_cors import CORS

app = Flask(__name__)
CORS(app)  # erlaubt CORS für alle

TARGET_URL = 'http://192.168.188.102:8888/api/getgamedata'

@app.route('/proxy')
def proxy():
    try:
        response = requests.get(TARGET_URL)
        return jsonify(response.json())
    except Exception as e:
        return {'error': str(e)}, 500

if __name__ == '__main__':
    app.run(port=5000)
