fetch('/config')
  .then(response => response.json())
  .then(config => {
    mapboxgl.accessToken = config.mapboxToken;
    initMap(config);
    InfoBoxShowHide("show");
    //InfoBoxSetTitle("Info");
    InfoBoxEntryClear();
    fetchGameData(config);
  })
  .catch(err => console.error("Error loading config:", err));


let index;
let points;
let poiInfoBox = document.getElementById('poi-info-box');
let poiInfo = document.getElementById('poiInfo');
let poiInfoIcon = document.getElementById('poiInfoIcon');
let goodGeojson = null;


let directions = {
  'left': 'fa-solid fa-diamond-turn-right fa-flip-horizontal',
  'right': 'fa-solid fa-diamond-turn-right',
  'route': 'fa-solid fa-route',
  'landmark': 'fa-solid fa-landmark',
  'straight': 'fa-solid fa-road',
  'danger': 'fa-solid fa-road-circle-exclamation',

}

let lastPoi = null;
let gameToLatLng = null;
let lastGameName = null;
let lastTrackCode = null;
let transformCache = {};
let map, marker;
let poiEditorLink = document.getElementById('poiEditorLink');

//let message = '';

// Configuration settings for the InfoBox
let infoBox = document.getElementById('nav-info-box');
let infoBoxEntries = document.getElementById('nib-entries');
let infobox_warning_TrackInfo_id = null;
let infobox_warning_IsGameInRace_id = null;
let infobox_warning_NoTransform_id = null;
let infobox_warning_LapInfo_id = null;
let infobox_warning_Error_id = null;

// Vars for the player's marker
let lastPos = null;
let animating = false;


/**
 * Animates a map marker smoothly from a starting position to a target position over a specified duration.
 *
 * @param {Object} marker - The map marker object to animate. Must have a `setLngLat` method.
 * @param {Object} from - The starting position of the marker.
 * @param {number} from.lng - The longitude of the starting position.
 * @param {number} from.lat - The latitude of the starting position.
 * @param {Object} to - The target position of the marker.
 * @param {number} to.lng - The longitude of the target position.
 * @param {number} to.lat - The latitude of the target position.
 * @param {number} duration - The duration of the animation in milliseconds.
 */
function animateMarkerSmooth(marker, from, to, duration) {
  if (animating) return;
  const startTime = performance.now();
  const dLng = to.lng - from.lng;
  const dLat = to.lat - from.lat;

  animating = true;

  function step(now) {
    const t = Math.min((now - startTime) / duration, 1);
    const curLng = from.lng + dLng * t;
    const curLat = from.lat + dLat * t;
    marker.setLngLat([curLng, curLat]);
    if (t < 1) {
      requestAnimationFrame(step);
    } else {
      animating = false;
    }
  }
  requestAnimationFrame(step);
}
function animateMarkerSmoothTest(marker, from, to, duration) {
  if (animating) return; // Verhindert parallele Animationen

  const startTime = performance.now();
  const dLng = to.lng - from.lng;
  const dLat = to.lat - from.lat;

  animating = true;

  function step(now) {
    const elapsed = now - startTime;
    const progress = Math.min(elapsed / duration, 1); // Fortschritt zwischen 0 und 1

    // Ease-In-Out-Interpolation für flüssigere Bewegung
    const easedProgress = progress < 0.5
      ? 2 * progress * progress
      : -1 + (4 - 2 * progress) * progress;

    const currentLng = from.lng + dLng * easedProgress;
    const currentLat = from.lat + dLat * easedProgress;

    marker.setLngLat([currentLng, currentLat]);

    if (progress < 1) {
      requestAnimationFrame(step);
    } else {
      animating = false; // Animation abgeschlossen
    }
  }

  requestAnimationFrame(step);
}


/**
 * Toggles the visibility of the info box element.
 *
 * @param {string} visibility - Determines the visibility state of the info box.
 *                              Accepts 'show' to display the info box, 
 *                              'hide' to hide it, or logs a warning for invalid input.
 */
function InfoBoxShowHide(visibility) {
  if (visibility === 'show') {
    infoBox.style.display = 'block';
  } else if (visibility === 'hide') {
    infoBox.style.display = 'none'; 
  } else {
    console.warn("Invalid visibility parameter. Use 'show' or 'hide'.");
  }
}


/**
 * Sets the title of the info box element.
 *
 * @param {string|null} [title=null] - The title to set. If null or not provided, defaults to 'Info'.
 */
function InfoBoxSetTitle(title = null) {
  if (title) {
    infoBox.querySelector('.nib-title').textContent = title;
  } else {
    infoBox.querySelector('.nib-title').textContent = 'Info';
  }
}


/**
 * Clears all entries from the info box by setting its inner HTML to an empty string.
 * 
 * This function is used to reset or remove all content within the `infoBoxEntries` element.
 */
function InfoBoxEntryClear() {
  infoBoxEntries.innerHTML = '';
}


/**
 * Adds a new entry to the info box with an optional icon, name, and additional information.
 *
 * @param {string} [entry_icon='fa-solid fa-house'] - The CSS class for the icon to display in the entry.
 * @param {string|null} [entry_name=null] - The name or title of the entry. Can be null if not provided.
 * @param {string|null} [entry_info=null] - Additional information or description for the entry. Can be null if not provided.
 * @returns {string} The unique ID of the newly created entry element.
 */
function InfoBoxEntryAdd(entry_icon = 'fa-solid fa-house', entry_name = null, entry_info = null) {
  // check if infoBoxEntries.innerHTML is emty
  let separator = '<hr class="entry-separator">';
  if (infoBoxEntries.innerHTML.trim() === '') {
    separator = '';
  }
  const id = 'nib-entry-' + Date.now() + Math.floor(Math.random() * 1000);
  const entry = `<div id="${id}">
                        ${separator}
                    <div class="destination-entry">
                            <div class="entry-icon"><i class="${entry_icon}"></i></div>
                            <div class="entry-text">
                                <div class="entry-name link-dark">${entry_name}</div>
                                <div class="entry-info">${entry_info}</div>
                            </div>
                        </div>
                    </div>`;
  infoBoxEntries.insertAdjacentHTML('beforeend', entry);
  return id;
}


/**
 * Updates the content of an information box entry in the DOM.
 *
 * @param {string} id - The ID of the entry element to update.
 * @param {string} [entry_icon='fa-solid fa-house'] - The CSS class for the icon to display in the entry.
 * @param {string|null} [entry_name=null] - The name or title to display in the entry. If null, the name will be cleared.
 * @param {string|null} [entry_info=null] - Additional information to display in the entry. If null, the info will be cleared.
 */
function InfoBoxEntryUpdate(id, entry_icon = 'fa-solid fa-house', entry_name = null, entry_info = null) {
  const entry = document.getElementById(id);
  if (!entry) {
    console.warn(`Entry with ID ${id} not found.`);
    return;
  }
  entry.querySelector('.entry-icon i').className = entry_icon;
  if (entry_name) {
    entry.querySelector('.entry-name').innerHTML = entry_name;
  } else {
    entry.querySelector('.entry-name').innerHTML = '';
  }
  if (entry_info) {
    entry.querySelector('.entry-info').innerHTML = entry_info;
  } else {
    entry.querySelector('.entry-info').innerHTML = '';
  }
}


/**
 * Deletes an HTML element with the specified ID from the DOM.
 *
 * @param {string} id - The ID of the HTML element to be removed.
 * @returns {void}
 * @throws {void} - Logs a warning to the console if the element with the specified ID is not found.
 */
function InfoBoxEntryDelete(id) {
  const entry = document.getElementById(id);
  if (entry) {
    entry.remove();
  } else {
    console.warn(`Entry with ID ${id} not found.`);
  }
}


/**
 * Calculates the appropriate zoom level for a map based on the given speed in km/h.
 *
 * @param {number} speedKmh - The speed in kilometers per hour.
 * @param {number} minZoom - The minimum zoom level allowed.
 * @param {number} maxZoom - The maximum zoom level allowed.
 * @returns {number} The calculated zoom level, rounded to one decimal place.
 */
function getZoomForSpeed(speedKmh, minZoom, maxZoom, defaultMapZoom) {
  console.log("Calculating zoom for speed:", speedKmh, "km/h");
  if (Number(speedKmh) >= 150){
    
    console.log("Speed is below 150 km/h, using default zoom level:", defaultMapZoom);
    return minZoom;

  }else if (Number(speedKmh) <= 60){
    console.log("Speed is below 60 km/h, using max zoom level:", maxZoom);
    return maxZoom;

  }else{
    console.log("Speed is between 60 km/h, using max zoom level:", defaultMapZoom);
    return defaultMapZoom;
  }
  
}


function loadGeoJson(url) {
  return fetch(url)
    .then(response => {
      if (!response.ok) {
        console.error(`Failed to load GeoJSON from ${url}:`, response.statusText);
      }
      return response.json();
    })
    .catch(error => {
      console.error(`Error loading GeoJSON from ${url}:`, error);

    }
    );
}

async function loadGeoJsonAndAddLayer(map, url, layerId, layerOptions = {}) {
  const stringLayerId = String(layerId); // layerId als String

  let geojson;
  // 1) GeoJSON laden und bei Fehler abbrechen
  try {
    geojson = await loadGeoJson(url);
    console.log(`GeoJSON loaded from ${url}`);
    goodGeojson = true;
  } catch (error) {
    console.error(`Failed to load GeoJSON from ${url}:`, error);
    goodGeojson = null;
    return; // Exit bevor irgendwas an der Karte passiert
  }

  // 2) Existenz und Inhalt prüfen
  if (
    !geojson ||
    !Array.isArray(geojson.features) ||
    geojson.features.length === 0
  ) {
    goodGeojson = null;
    console.warn(`No features found in GeoJSON from ${url}`);
    return;
  }

  // 3) Source hinzufügen bzw. updaten
  try {
    if (!map.getSource(stringLayerId)) {
      map.addSource(stringLayerId, {
        type: 'geojson',
        data: geojson
      });
    } else {
      map.getSource(stringLayerId).setData(geojson);
    }
  } catch (error) {
    goodGeojson = null;
    console.error(`Error adding/updating source '${stringLayerId}':`, error);
    return;
  }

  // 4) Layer hinzufügen
  try {
    if (!map.getLayer(stringLayerId)) {
      map.addLayer({
        id: stringLayerId,
        type: 'line',
        source: stringLayerId,
        layout: {
          'line-join': 'round',
          'line-cap': 'round'
        },
        paint: {
          'line-color': layerOptions.color || '#888',
          'line-width': layerOptions.width || 2
        }
      });
      
    }
  } catch (error) {
    goodGeojson = null; // Reset goodGeojson, da wir hier einen Fehler haben
    console.error(`Error adding layer '${stringLayerId}':`, error);
    return;
  }

  // 5) Marker setzen (nur Point-Geometrien)
  try {
    geojson.features
      .filter(f => f.geometry.type === 'Point')
      .forEach(f => {
        const [lng, lat] = f.geometry.coordinates;
        const iconClass = f.properties.iconClass || 'fa-solid fa-map-marker-alt';
        const el = document.createElement('div');
        el.innerHTML = `<i class="${iconClass}"></i>`;
        const icon = el.firstChild;
        icon.style.fontSize = '24px';
        icon.style.color    = f.properties.iconColor || '#ff0000';
        new mapboxgl.Marker(el)
          .setLngLat([lng, lat])
          .addTo(map);
      });
  } catch (error) {
    console.error(`Error adding markers for '${stringLayerId}':`, error);
    // Nicht return, da wir zumindest die Karte schon gezeichnet haben
  }

  // 6) Karte auf GeoJSON zentrieren
  try {
    const bounds = new mapboxgl.LngLatBounds();
    geojson.features.forEach(feature => {
      const geom = feature.geometry;
      if (geom.type === 'Point') {
        bounds.extend(geom.coordinates);
      } else if (geom.type === 'LineString') {
        geom.coordinates.forEach(coord => bounds.extend(coord));
      } else if (geom.type === 'Polygon') {
        geom.coordinates[0].forEach(coord => bounds.extend(coord));
      }
    });
    if (!bounds.isEmpty()) {
      map.fitBounds(bounds, { padding: 20 });
    }
  } catch (error) {
    console.error(`Error fitting bounds for '${stringLayerId}':`, error);
  }

  // 7) RBush-Index aufbauen
  try {
    const points = geojson.features
      .filter(f => f.geometry.type === 'Point')
      .map(f => ({
        minX: f.geometry.coordinates[0],
        minY: f.geometry.coordinates[1],
        maxX: f.geometry.coordinates[0],
        maxY: f.geometry.coordinates[1],
        properties: f.properties
      }));
    index = new RBush();
    index.load(points);
    // optional: return index, wenn du ihn später nutzen möchtest
    return index;
  } catch (error) {
    console.error(`Error building spatial index for '${stringLayerId}':`, error);
  }
}



/**
 * Initializes a Mapbox map with the specified configuration.
 *
 * @param {Object} CONFIG - Configuration object for initializing the map.
 * @param {string} CONFIG.mapboxToken - The access token for Mapbox API.
 * @param {Object} CONFIG.mapboxStyles - An object containing available Mapbox styles.
 * @param {string} CONFIG.mapboxStyle - The key for the desired Mapbox style in the `mapboxStyles` object.
 * @param {Array<number>} CONFIG.defaultMapCenter - The default center of the map as [longitude, latitude].
 * @param {number} CONFIG.defaultMapZoom - The default zoom level of the map.
 *
 * @throws {Error} Logs a warning if `defaultMapCenter` or `defaultMapZoom` is not set in the configuration.
 */

function initMap(CONFIG) {
  if (CONFIG.defaultMapCenter && CONFIG.defaultMapZoom) {
    mapboxgl.accessToken = CONFIG.mapboxToken;
    map = new mapboxgl.Map({
      container: 'map',
      style: CONFIG.mapboxStyles[CONFIG.mapboxStyle] || 'mapbox://styles/mapbox/streets-v12',
      center: CONFIG.defaultMapCenter,
      zoom: CONFIG.defaultMapZoom,
      pitch: 50,
      bearing: 0,
      antialias: true,
      collectResourceTiming: false
    });

    const markerElement = document.createElement('div');
    markerElement.className = 'car-icon';

    marker = new mapboxgl.Marker({
        element: markerElement,

      })
      .setLngLat(CONFIG.defaultMapCenter)
      .addTo(map);


      



  } else {
    console.warn("Default map center or zoom not set in config");
  }
}


/**
 * Fetches game data from the specified API and updates the map, markers, and UI elements accordingly.
 * Handles various states such as waiting for GPS data, missing transformations, and lap information updates.
 * Ensures only one fetch operation is in progress at a time and schedules periodic updates.
 *
 * @async
 * @function fetchGameData
 * @param {Object} config - Configuration object for the function.
 * @param {string} config.mapAPIurl - The URL of the map API to fetch game data from.
 * @param {number} config.fetchIntervalMs - The interval in milliseconds for fetching data periodically.
 * @param {boolean} config.speedZoom - Whether to adjust the map zoom based on speed.
 * @param {number} config.minZoom - The minimum zoom level for the map.
 * @param {number} config.maxZoom - The maximum zoom level for the map.
 * @param {number} config.defaultMapZoom - The default zoom level for the map.
 * 
 * @throws {Error} Throws an error if the transformation data is missing or if the API format is invalid.
 */
async function fetchGameData(config) {
  if (fetchGameData.fetchInProgress) return;
  fetchGameData.fetchInProgress = true;

  try {
    const res = await fetch(config.mapAPIurl);
    const data = await res.json();

    if (!data.IsGameInRace) {
      // — GPS-Waiting —
      if (!infobox_warning_IsGameInRace_id) {
        infobox_warning_IsGameInRace_id = InfoBoxEntryAdd(
          'fa-solid fa-satellite-dish fa-fw',
          'GPS',
          'Waiting for position data…'
        );
      } else {
        InfoBoxEntryUpdate(
          infobox_warning_IsGameInRace_id,
          'fa-solid fa-satellite-dish fa-fw',
          'GPS',
          'Waiting for position data…'
        );
      }

      if (infobox_warning_LapInfo_id) {
        InfoBoxEntryDelete(infobox_warning_LapInfo_id);
        infobox_warning_LapInfo_id = null;
      }
      //unload layer if it exists
      if (map.getLayer('123456')) {
        map.removeLayer('123456');
      }
      //hide the info box
      poiInfoBox.style.display = 'none'; 
      //goodGeojson = null;
      lastPos = null;

      return;
    }

    if (infobox_warning_IsGameInRace_id) {
      InfoBoxEntryDelete(infobox_warning_IsGameInRace_id);
      infobox_warning_IsGameInRace_id = null;
    }

    const d = data.NewData.FeedbackData;
    const gameName = data.GameName;
    const trackCode = data.NewData.TrackCode;
    const trackName = data.NewData.TrackName;

    // Load Trackinfo
    if (gameName !== lastGameName || trackCode !== lastTrackCode) {
      console.log("Loading TrackInfo for", gameName, trackCode);
      poiEditorLink.href = `/poi/${gameName}/${trackCode}`;
      loadGeoJsonAndAddLayer(map, `/static/poi/${gameName}/${trackCode}.json`, 123456);
      
      
      if (infobox_warning_TrackInfo_id) {
        InfoBoxEntryUpdate(
          infobox_warning_TrackInfo_id,
          'fa-solid fa-road fa-fw',
          trackName,
          gameName
        );
      } else {
        infobox_warning_TrackInfo_id = InfoBoxEntryAdd(
          'fa-solid fa-road fa-fw',
          trackName,
          gameName
        );
      }

      // Transform-Cache
      if (!transformCache[gameName]?.[trackCode]) {
        const tfRes = await fetch("/static/track_transforms.json");
        const tfJson = await tfRes.json();
        transformCache[gameName] = transformCache[gameName] || {};
        transformCache[gameName][trackCode] = tfJson[gameName]?.[trackCode] || null;
      }
      const coeffs = transformCache[gameName][trackCode];

      if (!coeffs) {
        // Missing Transform
        if (!infobox_warning_NoTransform_id) {
          infobox_warning_NoTransform_id = InfoBoxEntryAdd(
            'fa-solid fa-road-circle-xmark fa-fw',
            'Transform missing',
            'Please create it:<br><a href="/helper">Click here</a>'
          );
        } else {
          InfoBoxEntryUpdate(
            infobox_warning_NoTransform_id,
            'fa-solid fa-road-circle-xmark fa-fw',
            'Transform missing',
            'Please create it:<br><a href="/helper">Click here</a>'
          );
        }
        throw new Error("Transformation missing");
      }
      // Transform available -> Remove warning
      if (infobox_warning_NoTransform_id) {
        InfoBoxEntryDelete(infobox_warning_NoTransform_id);
        infobox_warning_NoTransform_id = null;
      }

      // Set gameToLatLng
      const c = coeffs;
      gameToLatLng = (x, y) => [
        c.lat[0] * x + c.lat[1] * y + c.lat[2],
        c.lng[0] * x + c.lng[1] * y + c.lng[2],
        c.yaw
      ];

      lastGameName = gameName;
      lastTrackCode = trackCode;
    }

    if (!gameToLatLng) throw new Error("Transformation missing");
    if(goodGeojson) {
      poiInfoBox.style.display = 'block';
    }

    // revert erroneous API status
    if (infobox_warning_Error_id) {
      InfoBoxEntryDelete(infobox_warning_Error_id);
      infobox_warning_Error_id = null;
    }

    // Marker & Camera
    const [lat, lng, yaw_off] = gameToLatLng(d.CoordinatesX, d.CoordinatesY);
    const yaw = d.OrientationYaw + yaw_off;
    const speed = data.NewData.FilteredSpeedKmh;

    const newPos = {
      lng,
      lat
    };
    if (!lastPos) {
      marker.setLngLat([lng, lat]);
    } else {
      //animateMarkerSmooth(marker, lastPos, newPos, config.fetchIntervalMs);
      animateMarkerSmoothTest(marker, lastPos, newPos, config.fetchIntervalMs);
    }
    lastPos = newPos;

    let zoom = config.defaultMapZoom;
    console.log("Zoom level:", zoom, "Speed:", speed, "km/h");
    if (data.IsGameInRace){
      if (config.speedZoom ) {
        zoom = getZoomForSpeed(speed, config.minZoom, config.maxZoom, config.defaultMapZoom);
      }
    }
    console.log("Zoom level:", zoom, "Speed:", speed, "km/h");

    // Map-Kamera

    if (!window._mapInitialized) {
      map.jumpTo({
        center: [lng, lat],
        zoom,
        bearing: yaw
      });
      window._mapInitialized = true;
    } else {
      map.flyTo({
        center: [lng, lat],
        zoom,
        bearing: yaw,
        speed: 0.3, // slower is better for smoothness
        curve: 0, // lower conflict overshoot
        easing: t => t, // linear speed
        essential: true, // this animation is essential for the user experience
        maxDuration: config.fetchIntervalMs
      });
    }
    console.log(goodGeojson);
    if (goodGeojson) {
      
      const nearest = findNearestMarker(lat, lng);

      if (nearest) {

        if (lastPoi && lastPoi.properties.name === nearest.properties.name) {
          //console.warn("Marker is the same as last POI, skipping update");

        }else {         
          let direction = nearest.properties.direction;
          let html = '<i class="'+ directions[direction] +' fa-3x poi-pin"></i>'
          poiInfoIcon.innerHTML = html; 
          poiInfo.innerHTML = nearest.properties.name;
          lastPoi = nearest;

        }

      } else {
        console.warn("Kein nächster Marker gefunden");
      }
    }




    

    // Here comes the "Always Add or Update" for LapInfo
    const CurrentLapTime = data.NewData.CurrentLapTime;
    const CurrentLap = data.NewData.CurrentLap;
    const CurrentSectorIndex = data.NewData.CurrentSectorIndex;
    distance = 'Lap ' + CurrentLap + ' · Sector ' + CurrentSectorIndex;

    if (infobox_warning_LapInfo_id) {
      InfoBoxEntryUpdate(infobox_warning_LapInfo_id, 'fa-solid fa-stopwatch fa-fw', time = String(CurrentLapTime), distance);
    } else {
      infobox_warning_LapInfo_id = InfoBoxEntryAdd('fa-solid fa-stopwatch fa-fw', time = String(CurrentLapTime), distance);
    }

  } catch (err) {
    // API Error
    if (err.message.includes("Invalid API format")) {
      if (infobox_warning_Error_id) {
        InfoBoxEntryUpdate(
          infobox_warning_Error_id,
          'fa-solid fa-triangle-exclamation fa-fw',
          'API',
          'Is SimHub and Game running?'
        );
      } else {
        infobox_warning_Error_id = InfoBoxEntryAdd(
          'fa-solid fa-triangle-exclamation fa-fw',
          'API',
          'Is SimHub and Game running?'
        );
      }
    }
    // Transformation missing
    if (err.message.includes("Transformation missing")) {
      // i think this is already handled above. need to check
    }

  } finally {
    fetchGameData.fetchInProgress = false;
    setTimeout(() => fetchGameData(config), config.fetchIntervalMs);
  }
}


//Theme Logic
const themeLink = document.getElementById('theme-link');
const toggleBtns = document.querySelectorAll('.theme-toggle');
const themeToggleBtn = document.getElementById('theme-toggle-btn');
const themeIcon = themeToggleBtn.querySelector('i');
toggleBtns.forEach(btn => btn.addEventListener('click', toggleTheme));
const DARK_CSS = '/static/app-dark.css';
const LIGHT_CSS = '';

function setTheme(mode) {
  if (mode === 'dark') {
    themeLink.href = DARK_CSS;
    themeIcon.classList.remove('fa-sun');
    themeIcon.classList.add('fa-moon');
  } else {
    themeLink.href = LIGHT_CSS;
    themeIcon.classList.remove('fa-moon');
    themeIcon.classList.add('fa-sun');
  }
  localStorage.setItem('theme', mode);
}

function toggleTheme() {
  const current = localStorage.getItem('theme') === 'dark' ? 'dark' : 'light';
  setTheme(current === 'dark' ? 'light' : 'dark');
}

(function init() {
  const saved = localStorage.getItem('theme');
  if (saved === 'dark' || saved === 'light') {
    setTheme(saved);
  } else {
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    setTheme(prefersDark ? 'dark' : 'light');
  }
})();




// Debugging in findNearestMarker hinzufügen
function calculateDistance(lat1, lon1, lat2, lon2) {
  const R = 6371e3;
  const φ1 = lat1 * Math.PI / 180;
  const φ2 = lat2 * Math.PI / 180;
  const Δφ = (lat2 - lat1) * Math.PI / 180;
  const Δλ = (lon2 - lon1) * Math.PI / 180;
  const a =
    Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
    Math.cos(φ1) * Math.cos(φ2) *
    Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function findNearestMarker(lat, lon) {
  if (!index) {
    console.error("RBush-Index ist nicht initialisiert.");
    return null;
  }
  // Alle Punkte aus dem Index holen
  const allPoints = index.all();
  let nearest = null;
  let minDist = Infinity;
  for (const pt of allPoints) {
    // pt.minY = lat, pt.minX = lon
    const dist = calculateDistance(lat, lon, pt.minY, pt.minX);
    if (dist < minDist) {
      minDist = dist;
      nearest = pt;
    }
  }
  return nearest;
}
