fetch('/config')
    .then(response => response.json())
    .then(config => {
    var CONFIG = config;
    initMap(CONFIG);
    fetchGameData(CONFIG);
    
    })
    .catch(err => console.error("Error loading config:", err));


let gameToLatLng = null;
let lastGameName = null;
let lastTrackCode = null;
let transformCache = {};
let map, marker; // Make map and marker accessible globally

function getZoomForSpeed(speedKmh, minZoom, maxZoom) {
    if (speedKmh <= 50) return maxZoom;
    if (speedKmh >= 150) return minZoom;
    const factor = (speedKmh - 50) / (150 - 50);
    const zoom = maxZoom - factor * (maxZoom - minZoom);
    return Math.round(zoom * 10) / 10;
}

async function fetchGameData(config) {
    if (fetchGameData.fetchInProgress) return;
    fetchGameData.fetchInProgress = true;

    try {
        const res = await fetch(config.mapAPIurl);
        const data = await res.json();

        if (!data.IsGameInRace) {
            const overlay = document.getElementById('race-overlay');
            const overlayText = document.getElementById('race-overlay-text');
            if (overlay) {
                overlay.style.display = 'flex';
                overlayText.textContent = 'Waiting for race to start...';
            }
            setTimeout(() => fetchGameData(config), config.fetchIntervalMs);
            return;
        } else {
            const overlay = document.getElementById('race-overlay');
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
                throw new Error(`No transform for ${gameName} / ${trackCode}`);
            }

            transformCache[gameName] = transformCache[gameName] || {};
            transformCache[gameName][trackCode] = tfJson[gameName][trackCode];
            }

            const coeffs = transformCache[gameName][trackCode];
            gameToLatLng = (x, y) => [
            coeffs.lat[0] * x + coeffs.lat[1] * y + coeffs.lat[2],
            coeffs.lng[0] * x + coeffs.lng[1] * y + coeffs.lng[2]
            ];

            lastGameName = gameName;
            lastTrackCode = trackCode;
        }

        if (!gameToLatLng) throw new Error("Transformation missing");

        const [lat, lng] = gameToLatLng(d.CoordinatesX, d.CoordinatesY);
        const yaw = d.OrientationYaw;
        const speed = data.NewData.FilteredSpeedKmh;
        const zoom = getZoomForSpeed(speed, config.minZoom, config.maxZoom);

        marker.setLatLng([lat, lng]);
        map.flyTo([lat, lng], zoom, { animate: true, duration: config.fetchIntervalMs / 1000 });

        const iconDiv = document.getElementById('car-marker');
        if (iconDiv) iconDiv.style.transform = `rotate(${yaw}deg)`;

        document.getElementById('map-container').style.transform = `translate(-50%, -50%) rotate(${-yaw}deg)`;
    } catch (err) {
        console.error("API-Error (is SimHub running?):", err);
    } finally {
        fetchGameData.fetchInProgress = false;
        setTimeout(() => fetchGameData(config), config.fetchIntervalMs);
    }
}

function initMap(CONFIG) {
    if (CONFIG.defaultMapCenter && CONFIG.defaultMapZoom) {
    map = L.map('map').setView(CONFIG.defaultMapCenter, CONFIG.defaultMapZoom);
    layer = CONFIG.layerSelect || 'default';
    layerURL = CONFIG.layerURLs[layer] || 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
    L.tileLayer(layerURL, {
        maxZoom: 19,
        minZoom: 10,
        attribution: '&copy; OpenStreetMap'
    }).addTo(map);

    marker = L.marker(CONFIG.defaultMapCenter, {
        icon: L.divIcon({
        className: '',
        html: '<div class="car-icon" id="car-marker"></div>',
        iconSize: [32, 32],
        iconAnchor: [16, 16]
        })
    }).addTo(map);
    } else {
    console.warn("Default map center or zoom not set in config");
    }
}

