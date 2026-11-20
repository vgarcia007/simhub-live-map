import json
import numpy as np

def solve_affine(refs, key):
    A = np.array([[p['CoordinatesX'], p['CoordinatesY'], 1] for p in refs])
    b = np.array([p[key] for p in refs])
    x, _, _, _ = np.linalg.lstsq(A, b, rcond=None)
    return x.tolist()

def build_transforms(data):
    result = {}
    for game, tracks in data.items():
        result[game] = {}
        for track_name, values in tracks.items():
            refs = values['ref_points']
            lat_coeffs = solve_affine(refs, 'lat')
            lng_coeffs = solve_affine(refs, 'lng')
            result[game][track_name] = {
                'lat': lat_coeffs,
                'lng': lng_coeffs,
                'yaw': values.get('yaw', 0),
                **({'yaw_sign': -1} if values.get('yaw_sign') == -1 else {}),
                'display_name': values.get('display_name', track_name),
                'aliases': values.get('aliases', []),
            }

    return result


def process_tracks(input_file, output_file):
    with open(input_file, 'r') as f:
        result = build_transforms(json.load(f))
    with open(output_file, 'w') as f:
        json.dump(result, f, indent=2)
        print(f"🗺️ ✅ Transformations saved to {output_file}")

if __name__ == "__main__":
    process_tracks("static/track_reference_points.json", "static/track_transforms.json")
