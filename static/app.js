fetch('/config')
    .then(response => response.json())
    .then(config => {
        console.log("Loaded config:", config); // <---- Hier!
        mapboxgl.accessToken = config.mapboxToken;
        initMap(config);
        fetchGameData(config);
    })
    .catch(err => console.error("Error loading config:", err));


let gameToLatLng = null;
let lastGameName = null;
let lastTrackCode = null;
let transformCache = {};
let map, marker; // Make map and marker accessible globally
let overlay = document.getElementById('race-overlay');
let overlayText = document.getElementById('race-overlay-text');

function getZoomForSpeed(speedKmh, minZoom, maxZoom) {
  if (speedKmh >= 150) return minZoom + 0.5; // nicht ganz reinzoomen
  if (speedKmh <= 60) return maxZoom;
  const factor = (speedKmh - 60) / (90);
  return Math.round((maxZoom - factor * (maxZoom - minZoom)) * 10) / 10;
}

async function fetchGameData(config) {
    if (fetchGameData.fetchInProgress) return;
    fetchGameData.fetchInProgress = true;

    try {
        const res = await fetch(config.mapAPIurl);
        const data = await res.json();

        if (!data.IsGameInRace) {
            
            if (overlay) {
                overlay.style.display = 'flex';
                overlayText.textContent = 'Waiting for race to start...';
            }
            setTimeout(() => fetchGameData(config), config.fetchIntervalMs);
            return;
        } else {
            if (overlay) overlay.style.display = 'none';
        }

        if (!data?.NewData?.FeedbackData) throw new Error("Invalid API format");

        const d = data.NewData.FeedbackData;
        const gameName = data.GameName;
        const trackCode = data.NewData.TrackCode;

        if (gameName !== lastGameName || trackCode !== lastTrackCode) {
            console.log(`Track change detected: ${gameName} / ${trackCode}`);

            if (!transformCache[gameName]?.[trackCode]) {
            const tfRes = await fetch("/static/track_transforms.json");
            const tfJson = await tfRes.json();

            if (!tfJson[gameName] || !tfJson[gameName][trackCode]) {
                if (overlay) {
                    overlay.style.display = 'flex';
                    overlayText.textContent = `No transform for ${gameName} / ${trackCode}`;
                }
                setTimeout(() => fetchGameData(config), config.fetchIntervalMs);
                return;
            }
            else {
                if (overlay) overlay.style.display = 'none';
            }

            transformCache[gameName] = transformCache[gameName] || {};
            transformCache[gameName][trackCode] = tfJson[gameName][trackCode];
            }

            const coeffs = transformCache[gameName][trackCode];
            gameToLatLng = (x, y) => [
            coeffs.lat[0] * x + coeffs.lat[1] * y + coeffs.lat[2],
            coeffs.lng[0] * x + coeffs.lng[1] * y + coeffs.lng[2],
            coeffs.yaw
            ];

            lastGameName = gameName;
            lastTrackCode = trackCode;
        }

        if (!gameToLatLng) throw new Error("Transformation missing");

        const [lat, lng, yaw_cor] = gameToLatLng(d.CoordinatesX, d.CoordinatesY);
        const yaw = d.OrientationYaw + yaw_cor;
        //const yaw = d.OrientationYaw
        const speed = data.NewData.FilteredSpeedKmh;
        const zoom = getZoomForSpeed(speed, config.minZoom, config.maxZoom);

        marker.setLngLat([lng, lat]);
        

        if (!window._mapInitialized) {
            map.jumpTo({ center: [lng, lat], zoom: zoom, bearing: yaw });
            window._mapInitialized = true;
        } else {
            const method = speed > 180 ? 'jumpTo' : 'easeTo';
            map[method]({
            center: [lng, lat],
            bearing: yaw,
            zoom: zoom,
            duration: config.fetchIntervalMs,
            easing: t => t
            });

            }



    } catch (err) {
        console.error("API-Error (is SimHub running?):", err);
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
            pitch: 45,
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


