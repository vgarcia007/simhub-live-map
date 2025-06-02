# SimHub Live Map for Real Tracks

This project provides a live map view similar to a navigation system and uses the SimHub JSON API to display the current position of the car on real-world race tracks. It is a proof of concept, currently implemented for Forza Motorsport 8 and the Nordschleife.

## Features

- Live updating of the car position on a map
- Realistic navigation-like view
- Uses real GPS coordinates for track mapping

## How does it work?

A Python Flask server acts as a CORS proxy to fetch data from the SimHub JSON API. The frontend displays the car's position in real time on a Leaflet map.

To map in-game coordinates to real GPS positions, three reference points are required for each track. A reference point consists of the in-game coordinates and the corresponding GPS coordinates.

## Contributing

Want to add a new track or improve existing reference points? Here's how:

1. Find three distinctive points on the track (e.g. start/finish, a notable corner, track end).
2. For each point, determine the in-game coordinates (CoordinatesX, CoordinatesY) and the corresponding GPS coordinates (lat, lng).
3. Add the three reference points to the `static/track_reference_points.json` file. The format looks like this:

   ```json
   {
     "FM8": {
       "Nurburgring Nordschleife": {
         "ref_points": [
           { "CoordinatesX": ..., "CoordinatesY": ..., "lat": ..., "lng": ... },
           { "CoordinatesX": ..., "CoordinatesY": ..., "lat": ..., "lng": ... },
           { "CoordinatesX": ..., "CoordinatesY": ..., "lat": ..., "lng": ... }
         ]
       },
       "Your New Track": {
         "ref_points": [ ... ]
       }
     }
   }
   ```

4. Create a pull request with your changes or open an issue if you need help.

## Getting Started

1. Install the dependencies:

   ```
   pip install flask requests flask-cors numpy waitress
   ```
2. Edit static/map-config.js Line 1  
 ```"mapAPIurl": "http://localhost:5000/fakedata"``` for fakedata. Just a test and not moving  
Or  ```"http://localhost:5000/proxy"``` for Live Data

3. Edit config.json and Put in the API URL of your SimHub PC
 
4. Start the server:

   ```
   python app.py
   ```

5. Open `localhost:5000` in your browser.

## Status

The project is in an early stage and currently only supports Forza Motorsport 8 on the Nordschleife. More tracks and features are planned. Community contributions are very welcome!