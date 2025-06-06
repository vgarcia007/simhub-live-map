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
let infoBox = document.getElementById('nav-info-box');
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

function setInfoBox(text1 = null, text2 = null, time = null, distance = null) {
    // if all is null, do not show the info box
    if (!text1 && !text2 && distance === null && time === null) {
        infoBox.style.display = 'none';
        return;
    }
    
    if (text1) {
        infoBox.querySelector('.text1').textContent = text1;
    }else {
        infoBox.querySelector('.text1').textContent = '';
    }
    if (text2) {
        infoBox.querySelector('.text2').textContent = text2;
    }else {
        infoBox.querySelector('.text2').textContent = '';
    }
    if (distance !== null) {
        infoBox.querySelector('.distance').textContent = distance;
    }else {
        infoBox.querySelector('.distance').textContent = '';
    }
    if (time !== null) {
        infoBox.querySelector('.lap-time').textContent = time;
    }else {
        infoBox.querySelector('.lap-time').textContent = '';
    }
    // Show the info box
    infoBox.style.display = 'block';
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
            setInfoBox(text1 = "Message", text2 = "Waiting for race to start...", time = null, distance = null);
            fetchGameData.fetchInProgress = false;
            // Continue polling, even if the race has not started yet:
            setTimeout(() => fetchGameData(config), config.fetchIntervalMs);
            return;
        }else {
            setInfoBox();
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

                    setInfoBox(text1 = gameName, text2 = trackCode, time = "No transform for", distance = "<a href='/helper'>Click here to create</a>"); 
                    throw new Error(message);
                }else {
                    setInfoBox();
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
        const CurrentLapTime = data.NewData.CurrentLapTime;
        const CurrentLap = data.NewData.CurrentLap;
        const CurrentSectorIndex = data.NewData.CurrentSectorIndex;
        const zoom = config.defaultMapZoom;
        if (config.speedZoom){
            zoom = getZoomForSpeed(speed, config.minZoom, config.maxZoom);
        }
        


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
            if (config.speedZoom){
                map['easeTo']({
                    center: [lng, lat],
                    bearing: yaw,
                    zoom: zoom,
                    duration: config.fetchIntervalMs,
                    easing: t => t
                });
            }else{
                map['easeTo']({
                    center: [lng, lat],
                    bearing: yaw,
                    duration: config.fetchIntervalMs,
                    easing: t => t
                });
            }
        }

        distance = 'Lap ' + CurrentLap + ' · Sector ' + CurrentSectorIndex;
        const Se = (data.NewData.SectorDistances && data.NewData.SectorDistances[CurrentSectorIndex]) ? data.NewData.SectorDistances[CurrentSectorIndex] : 'N/A';
        setInfoBox(text1 = gameName, text2 = trackCode, time = String(CurrentLapTime), distance = distance); 

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


