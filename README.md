# SimHub Live Map for Real Tracks

This project provides a live map view similar to a navigation system and uses the SimHub JSON API to display the current position of the car on real-world race tracks. It is a proof of concept, currently tested with Forza Motorsport 8 and the Nordschleife and other Tracks. It should work for every other game supported by simhub that outputs X and Y Coordinates.

## Features

- Live updating of the car position on a map
- Realistic navigation-like view
- Uses real GPS coordinates for track mapping

## How does it work?

A Python Flask server acts as a CORS proxy to fetch data from the SimHub JSON API. The frontend displays the car's position in real time on a Leaflet map.

To map in-game coordinates to real GPS positions, a minimum of three reference points are required for each track (more points = better accuracy).  
A reference point consists of the in-game coordinates and the corresponding GPS coordinates.

### Why Affine Transformation?

We use an affine transformation because game coordinates and GPS coordinates are not directly comparable. Rotation, translation, and different scales need to be accounted for, which can only be reliably achieved with at least three reference points.

## Contributing

### Using the Mapping Helper Tool

To simplify the creation and management of reference points, you can use the built-in Mapping Helper tool. This tool eliminates the need to manually edit the `static/track_reference_points.json` file.

#### How to Use the Mapping Helper

1. Start the server as described in the "Getting Started" section.
2. Open your browser and navigate to `http://localhost:5000/helper`.
3. Use the interface to:
   - Add new reference points by providing in-game coordinates and corresponding GPS coordinates.
   - Adjust the yaw correction if the map rotation is incorrect.
   - Save your changes directly to the reference points file.
4. The tool automatically updates the transformations and ensures the data is valid.

This tool streamlines the process and reduces the risk of errors when adding or modifying reference points.

5. For now, please create a pull request with your changes or open an issue if you need help. (Sync Feature is planned for the future)

## Getting Started

1. Install the dependencies:

   ```
   pip install flask requests flask-cors numpy waitress
   ```
2. Edit static/map-config.js Line 1  
 ```"mapAPIurl": "http://localhost:5000/fakedata"``` for fakedata. Just a test and not moving  
Or  ```"http://localhost:5000/proxy"``` for Live Data

3. Start the server:

   ```
   python app.py
   ```

5. Open `localhost:5000` in your browser.
6. Edit Settings ![alt text](screenshots/config01.jpg?raw=true)
7. Start Mapping ![alt text](screenshots/mapping01.png?raw=true)
8. Enjoy the Map ![alt text](screenshots/map01.jpg?raw=true)

## Status

The project is in an early stage and currently only supports Forza Motorsport 8 on the Nordschleife. More tracks and features are planned. Community contributions are very welcome!
