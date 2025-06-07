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
        const res = await fetch(config.mapAPIurl);
        const data = await res.json();

        if (!data || typeof data !== 'object') throw new Error("Invalid API response");
        if (!data.NewData || typeof data.NewData !== 'object') throw new Error("Invalid API format");
        if (!data.NewData.FeedbackData || typeof data.NewData.FeedbackData !== 'object') throw new Error("Invalid API format");

        if (!data.IsGameInRace) {
            if(infobox_warning_IsGameInRace_id) {
                InfoBoxEntryUpdate(infobox_warning_IsGameInRace_id, 'fa-solid fa-satellite-dish fa-fw', 'GPS', 'Waiting for position data...'); 
            }else {
                infobox_warning_IsGameInRace_id = InfoBoxEntryAdd('fa-solid fa-satellite-dish fa-fw', 'GPS', 'Waiting for position data...'); 
            }
            if(infobox_warning_LapInfo_id) {
                InfoBoxEntryDelete(infobox_warning_LapInfo_id);
                infobox_warning_LapInfo_id = null;
            }
            fetchGameData.fetchInProgress = false;
            // Continue polling, even if the race has not started yet:
            setTimeout(() => fetchGameData(config), config.fetchIntervalMs);
            return;
        }else {
            if(infobox_warning_IsGameInRace_id) {
                InfoBoxEntryDelete(infobox_warning_IsGameInRace_id);
                infobox_warning_IsGameInRace_id = null;
            }

        }
        

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
                    if(infobox_warning_TrackInfo_id) {
                        InfoBoxEntryUpdate(infobox_warning_TrackInfo_id, 'fa-solid fa-road fa-fw', trackCode, gameName);
                    }else {
                        infobox_warning_TrackInfo_id = InfoBoxEntryAdd('fa-solid fa-road fa-fw', trackCode, gameName);
                    }


                    throw new Error("Transformation missing");

                }else {

                    if(infobox_warning_NoTransform_id) {
                        InfoBoxEntryDelete(infobox_warning_NoTransform_id);
                        infobox_warning_NoTransform_id = null;
                    }

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

        if(infobox_warning_NoTransform_id) {
            InfoBoxEntryUpdate(infobox_warning_NoTransform_id, 'fa-solid fa-road-circle-xmark fa-fw', 'Transform missing', 'Please Create a Transform for this Track<br><a href="/helper">Click here to create</a>');
        }

        if(infobox_warning_NoTransform_id) {
            InfoBoxEntryDelete(infobox_warning_NoTransform_id);
            infobox_warning_NoTransform_id = null;
        }

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

        if(infobox_warning_TrackInfo_id) {
            InfoBoxEntryUpdate(infobox_warning_TrackInfo_id, 'fa-solid fa-road fa-fw', trackCode, gameName);
        }else {
            infobox_warning_TrackInfo_id = InfoBoxEntryAdd('fa-solid fa-road fa-fw', trackCode, gameName);
        }

        distance = 'Lap ' + CurrentLap + ' · Sector ' + CurrentSectorIndex;
        if(infobox_warning_LapInfo_id) {
            InfoBoxEntryUpdate(infobox_warning_LapInfo_id, 'fa-solid fa-stopwatch fa-fw', time = String(CurrentLapTime), distance);
        }else {
            infobox_warning_LapInfo_id = InfoBoxEntryAdd('fa-solid fa-stopwatch fa-fw', time = String(CurrentLapTime), distance);
        }
        

    } catch (err) {

        //check wich error we have
        
        
        if(infobox_warning_IsGameInRace_id) {
            InfoBoxEntryDelete(infobox_warning_IsGameInRace_id);
            infobox_warning_IsGameInRace_id = null;
        }

        if(infobox_warning_LapInfo_id) {
            InfoBoxEntryDelete(infobox_warning_LapInfo_id);
            infobox_warning_LapInfo_id = null;
        }

        if (err.message.includes("Invalid API format")) {
            console.error("Invalid API format:", err);
            if(infobox_warning_Error_id) {
                InfoBoxEntryUpdate(infobox_warning_Error_id, 'fa-solid fa-triangle-exclamation fa-fw', 'API', 'Is SimHub and Game running?');
            }else {
                infobox_warning_Error_id = InfoBoxEntryAdd('fa-solid fa-triangle-exclamation fa-fw', 'API', 'Is SimHub and Game running?'); 
            }
            if(infobox_warning_NoTransform_id) {
                InfoBoxEntryDelete(infobox_warning_NoTransform_id);
            }
            if(infobox_warning_TrackInfo_id) {
                InfoBoxEntryDelete(infobox_warning_TrackInfo_id);
                infobox_warning_TrackInfo_id = null;
            }
        }
        if (err.message.includes("Transformation missing")) {
            if(infobox_warning_NoTransform_id) {
                InfoBoxEntryUpdate(infobox_warning_NoTransform_id, 'fa-solid fa-road-circle-xmark fa-fw', 'Transform missing', 'Please Create a Transform for this Track<br><a href="/helper">Click here to create</a>');
            }else {
                infobox_warning_NoTransform_id = InfoBoxEntryAdd('fa-solid fa-road-circle-xmark fa-fw', 'Transform missing', 'Please Create a Transform for this Track<br><a href="/helper">Click here to create</a>');
            }
            
            if(infobox_warning_Error_id) {
                InfoBoxEntryDelete(infobox_warning_Error_id);
            }

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


