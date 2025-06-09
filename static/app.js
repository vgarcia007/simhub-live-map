fetch('/config')
    .then(response => response.json())
    .then(config => {
        mapboxgl.accessToken = config.mapboxToken;
        initMap(config);
        InfoBoxShowHide("show");
        InfoBoxSetTitle("Info");
        InfoBoxEntryClear();
        fetchGameData(config);
    })
    .catch(err => console.error("Error loading config:", err));

let lastPosition = null;
let gameToLatLng = null;
let lastGameName = null;
let lastTrackCode = null;
let transformCache = {};
let map, marker;
let infoBox = document.getElementById('nav-info-box');
let infoBoxEntries = document.getElementById('nib-entries');
let message = '';

let infobox_warning_TrackInfo_id = null;
let infobox_warning_IsGameInRace_id = null;
let infobox_warning_NoTransform_id = null;
let infobox_warning_LapInfo_id = null;
let infobox_warning_Error_id = null;




let lastPos = null;
let animating = false;

function animateMarkerSmooth(marker, from, to, duration) {
  if (animating) return; // falls eine Animation noch läuft, optional abbrechen oder warten
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
  

function InfoBoxShowHide(visibility) {
    if (visibility === 'show') {
        infoBox.style.display = 'block';
    } else if (visibility === 'hide') {
        infoBox.style.display = 'none';
    } else {
        console.warn("Invalid visibility parameter. Use 'show' or 'hide'.");
    }
}
function InfoBoxSetTitle(title = null ){
    if (title) {
        infoBox.querySelector('.nib-title').textContent = title;
    } else {
        infoBox.querySelector('.nib-title').textContent = 'Info';
    }
}

function InfoBoxEntryClear() {
    infoBoxEntries.innerHTML = '';
}

function InfoBoxEntryAdd(entry_icon = 'fa-solid fa-house', entry_name = null, entry_info = null) {
    // check if infoBoxEntries.innerHTML is emty
    let separator = '<hr class="entry-separator">';
    if (infoBoxEntries.innerHTML.trim() === '') {
        separator = '';
    }
    const id = 'nib-entry-' + Date.now() + Math.floor(Math.random() * 1000);
    const entry =  `<div id="${id}">
                        ${separator}
                    <div class="destination-entry">
                            <div class="entry-icon"><i class="${entry_icon}"></i></div>
                            <div class="entry-text">
                                <div class="entry-name">${entry_name}</div>
                                <div class="entry-info">${entry_info}</div>
                            </div>
                        </div>
                    </div>`;
    infoBoxEntries.insertAdjacentHTML('beforeend', entry);
    return id;
}

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

function InfoBoxEntryDelete(id) {
    const entry = document.getElementById(id);
    if (entry) {
        entry.remove();
    } else {
        console.warn(`Entry with ID ${id} not found.`);
    }
}


function getZoomForSpeed(speedKmh, minZoom, maxZoom) {
    if (speedKmh >= 150) return minZoom + 0.5; 
    if (speedKmh <= 60) return maxZoom;
    const factor = (speedKmh - 60) / (90);
    return Math.round((maxZoom - factor * (maxZoom - minZoom)) * 10) / 10;
}

async function fetchGameData(config) {
    if (fetchGameData.fetchInProgress) return;
    fetchGameData.fetchInProgress = true;
  
    try {
      const res  = await fetch(config.mapAPIurl);
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
        // Lap-Info wegräumen
        if (infobox_warning_LapInfo_id) {
          InfoBoxEntryDelete(infobox_warning_LapInfo_id);
          infobox_warning_LapInfo_id = null;
        }
        return;
      }
      
      if (infobox_warning_IsGameInRace_id) {
        InfoBoxEntryDelete(infobox_warning_IsGameInRace_id);
        infobox_warning_IsGameInRace_id = null;
      }

  
      const d         = data.NewData.FeedbackData;
      const gameName  = data.GameName;
      const trackCode = data.NewData.TrackCode;
      const trackName = data.NewData.TrackName;
  
      // — TrackInfo & Transform laden/cachen —
      if (gameName !== lastGameName || trackCode !== lastTrackCode) {
        // TrackInfo
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
          const tfRes  = await fetch("/static/track_transforms.json");
          const tfJson = await tfRes.json();
          transformCache[gameName] = transformCache[gameName] || {};
          transformCache[gameName][trackCode] = tfJson[gameName]?.[trackCode] || null;
        }
        const coeffs = transformCache[gameName][trackCode];
  
        if (!coeffs) {
          // Fehlende Transform
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
        // Transform vorhanden → Warnung entfernen
        if (infobox_warning_NoTransform_id) {
          InfoBoxEntryDelete(infobox_warning_NoTransform_id);
          infobox_warning_NoTransform_id = null;
        }
  
        // gameToLatLng setzen
        const c = coeffs;
        gameToLatLng = (x, y) => [
          c.lat[0]*x + c.lat[1]*y + c.lat[2],
          c.lng[0]*x + c.lng[1]*y + c.lng[2],
          c.yaw
        ];
  
        lastGameName  = gameName;
        lastTrackCode = trackCode;
      }
  
      if (!gameToLatLng) throw new Error("Transformation missing");
  
      // — fehlerhaften API-Status zurücknehmen —
      if (infobox_warning_Error_id) {
        InfoBoxEntryDelete(infobox_warning_Error_id);
        infobox_warning_Error_id = null;
      }
  
      // — Marker & Kamera (unverändert) —
      const [lat, lng, yaw_off] = gameToLatLng(d.CoordinatesX, d.CoordinatesY);
      const yaw = d.OrientationYaw + yaw_off;
      const speed = data.NewData.FilteredSpeedKmh;
  
      const newPos = { lng, lat };
        if (!lastPos) {
        marker.setLngLat([lng, lat]);
        } else {
        animateMarkerSmooth(marker, lastPos, newPos, config.fetchIntervalMs);
        }
        lastPos = newPos;

  
      const zoom = config.speedZoom
        ? getZoomForSpeed(speed, config.minZoom, config.maxZoom)
        : config.defaultMapZoom;




        if (!window._mapInitialized) {
            map.jumpTo({ center: [lng, lat], zoom, bearing: yaw });
            window._mapInitialized = true;
          } else {
            map.flyTo({
              center:   [lng, lat],
              zoom,
              bearing:  yaw,
              speed:    0.3,     // langsamer Flug → weicher
              curve:    0,     // geringeres Conflict-Overshoot
              easing:   t => t,  // lineares Tempo
              essential: false,
              maxDuration: config.fetchIntervalMs

            });
          }



      // ── Hier kommt das „Always Add or Update“ für LapInfo ────────────
      const CurrentLapTime = data.NewData.CurrentLapTime;
      const CurrentLap = data.NewData.CurrentLap;
      const CurrentSectorIndex = data.NewData.CurrentSectorIndex;
      distance = 'Lap ' + CurrentLap + ' · Sector ' + CurrentSectorIndex;

      if(infobox_warning_LapInfo_id) {
          InfoBoxEntryUpdate(infobox_warning_LapInfo_id, 'fa-solid fa-stopwatch fa-fw', time = String(CurrentLapTime), distance);
      }else {
          infobox_warning_LapInfo_id = InfoBoxEntryAdd('fa-solid fa-stopwatch fa-fw', time = String(CurrentLapTime), distance);
      }
  
    } catch (err) {
      // Fehler: API-Format
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
        // hier haben wir die Warnung schon in #2 gesetzt
      }
  
    } finally {
      fetchGameData.fetchInProgress = false;
      setTimeout(() => fetchGameData(config), config.fetchIntervalMs);
    }
  }


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


