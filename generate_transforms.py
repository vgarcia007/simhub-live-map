import json
import numpy as np

def solve_affine(refs, key):
    # Verwende exakte Werte ohne Rundung
    A = np.array([[p['CoordinatesX'], p['CoordinatesY'], 1] for p in refs])
    b = np.array([p[key] for p in refs])
    x, _, _, _ = np.linalg.lstsq(A, b, rcond=None)
    return x.tolist()

def process_tracks(input_file, output_file):
    with open(input_file, 'r') as f:
        data = json.load(f)

    result = {}
    for game, tracks in data.items():
        result[game] = {}
        for track_name, values in tracks.items():
            refs = values['ref_points']
            lat_coeffs = solve_affine(refs, 'lat')
            lng_coeffs = solve_affine(refs, 'lng')
            result[game][track_name] = {
                'lat': lat_coeffs,
                'lng': lng_coeffs
            }

    with open(output_file, 'w') as f:
        json.dump(result, f, indent=2)
        print(f"✅ Transformations saved to {output_file}")

if __name__ == "__main__":
    process_tracks("track_reference_points.json", "static/track_transforms.json")
