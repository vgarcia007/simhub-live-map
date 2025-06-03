fetch('/config')
    .then(response => response.json())
    .then(config => {
        mapboxgl.accessToken = config.mapboxToken;
        initMap(config);
        fetchGameData(config);
    })
    .catch(err => console.error("Error loading config:", err));

let lastPosition = null;
let gameToLatLng = null;
let lastGameName = null;
let lastTrackCode = null;
let transformCache = {};
let map, marker;
let overlay = document.getElementById('race-overlay');
let overlayText = document.getElementById('race-overlay-text');
let message = '';

function animateMarker(posA, posB, duration) {
    const startTime = performance.now();

    function step(now) {
        const t = Math.min((now - startTime) / duration, 1);
        const currentLng = posA.lng + (posB.lng - posA.lng) * t;
        const currentLat = posA.lat + (posB.lat - posA.lat) * t;

        marker.setLngLat([currentLng, currentLat]);

        if (t < 1) {
        requestAnimationFrame(step);
        }

    }

    requestAnimationFrame(step);
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
        const res = await fetch(config.mapAPIurl);
        const data = await res.json();

        if (!data.IsGameInRace) {
            message = 'Waiting for race to start...';
            if (overlay) overlayText.textContent = message;
            fetchGameData.fetchInProgress = false;
            // Continue polling, even if the race has not started yet:
            setTimeout(() => fetchGameData(config), config.fetchIntervalMs);
            return;
        }

        if (!data?.NewData?.FeedbackData) throw new Error("Invalid API format");

        const d = data.NewData.FeedbackData;
        const gameName = data.GameName;
        const trackCode = data.NewData.TrackCode;

        // Track or game change → reload transform
        if (gameName !== lastGameName || trackCode !== lastTrackCode) {
            console.log(`Track change detected: ${gameName} / ${trackCode}`);

            if (!transformCache[gameName]?.[trackCode]) {
                const tfRes = await fetch("/static/track_transforms.json");
                const tfJson = await tfRes.json();

                if (!tfJson[gameName] || !tfJson[gameName][trackCode]) {
                    message = `No transform for ${gameName} / ${trackCode}`;
                    if (overlay) overlayText.textContent = message;
                    throw new Error(message);
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

        // Transformiere X/Y → Lat/Lng + Yaw
        const [lat, lng, yaw_cor] = gameToLatLng(d.CoordinatesX, d.CoordinatesY);
        const yaw = d.OrientationYaw + yaw_cor;
        const speed = data.NewData.FilteredSpeedKmh;
        const zoom = getZoomForSpeed(speed, config.minZoom, config.maxZoom);


        const newPosition = { lng: lng, lat: lat };

        if (!lastPosition) {
            marker.setLngLat([newPosition.lng, newPosition.lat]);
            lastPosition = { ...newPosition };
        } else {
            // make it smooth
            animateMarker(lastPosition, newPosition, config.fetchIntervalMs);
            lastPosition = { ...newPosition };
        }

        // Camera
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

        if (overlay) overlayText.textContent = `${trackCode} (${gameName})`;

    } catch (err) {
        console.error("API-Error (is SimHub running?):", err);
    } finally {
        fetchGameData.fetchInProgress = false;
        // Polling-Schleife weiterhin alle config.fetchIntervalMs ms
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


