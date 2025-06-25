let mapAPIurl;
let fetchIntervalMs;
var g_map = null;
var refreshInterval = 0;
var suspendTimer = 0;
var suspendZoomTimer = 0;
var menu_items = [];
var menu_icons = [];
var sources = [];
var sourceref = {};
var layers = [];
var olsource = [];
var MapTilecenter = [];
var MapTilemultiplier = [];
var RelatedMaps = [];
let followButton = document.getElementById("followButton");
var suspendAutoMove = function(evt) {
    if (g_map != null) {
        clearTimeout(suspendTimer);
        suspendTimer = 1;
        followButton.style.display = "flex";
        //g_map.getView().setRotation(0);
    }
};

let nav_info_box = document.getElementById("nav-info-box");

let nav_setting_box = document.getElementById("nav-setting-box");

let poi_info_box = document.getElementById("poi-info-box");
let poiInfoIcon = document.getElementById("poiInfoIcon");
let poiInfo = document.getElementById("poiInfo");

$("#followButton").click(function() {
     followButton.style.display = "none";
     suspendTimer = 0;
 });

var suspendAutoZoom = function(evt) {
    if (g_map != null) {
        clearTimeout(suspendZoomTimer);
        suspendZoomTimer = setTimeout(function() {
            suspendZoomTimer = 0;
        }, 10000);
    }
};

$("#map").on('mousedown', suspendAutoMove);
$("#map").on('click', suspendAutoMove);
$("#map").on('drag', suspendAutoMove);
$("#map").on('wheel', suspendAutoZoom);

function menuClick(name) {
    console.log("Menu click: " + name);
    if (name == "hideall") {
        for (let i = 0; i < layers.length; i++) {
            if (menu_items.includes(layers[i].get("name"))) {
                layers[i].setVisible(false);
                let el = document.getElementById(layers[i].get("name"));
                if (el) el.classList.add("dropdown-content-deselect");
            }
        }
        return;
    }
    if (name == "showall") {
        for (let i = 0; i < layers.length; i++) {
            if (menu_items.includes(layers[i].get("name"))) {
                layers[i].setVisible(true);
                let el = document.getElementById(layers[i].get("name"));
                if (el) el.classList.remove("dropdown-content-deselect");
            }
        }
        return;
    }
    for (layer of layers){
        console.log("Checking layer: " + layer.get("name"));
        var lname = layer.get("name");
        if (lname == name){
            console.log("Toggling layer: " + lname);
            console.log("Layer visibility before toggle: " + layer.getVisible());
            if (layer.getVisible()){
                layer.setVisible(false);
                document.getElementById(name).classList.add("dropdown-content-deselect");
            } else {
                layer.setVisible(true);
                document.getElementById(name).classList.remove("dropdown-content-deselect");
            }
            console.log("Layer visibility after toggle: " + layer.getVisible());
        }
    }
}

function mapClick(name) {
    document.loadMap(name);
}

function getLang() {
    if (navigator.languages != undefined)
        return navigator.languages[0];
    else
        return "en-us";
}

function GetAheadPosition(map, rotation, speed, coordinates) {
    //console.log("Calculating ahead position with rotation: " + rotation + ", speed: " + speed + ", coordinates: " + JSON.stringify(coordinates));
    var aheadDistance = speed * 5;
    var height = map.getSize()[1];
    var maxAheadDistance = height / 3.0 * map.getView().getResolution();
    var aheadDistance = Math.max(-maxAheadDistance, Math.min(aheadDistance, maxAheadDistance));

    var aheadCoordinates = [
        coordinates[0] + Math.sin(-rotation) * aheadDistance,
        coordinates[1] + Math.cos(-rotation) * aheadDistance
    ];

    return aheadCoordinates;
}

function buildMap(TileMapInfo, mapsource) {
    //console.log("Building map with info: " + JSON.stringify(TileMapInfo));
    var tsProjection = new ol.proj.Projection({ // https://stackoverflow.com/questions/47612523/how-to-configure-openlayers-for-a-flat-11-pixel-coordinate-system
        code: 'ZOOMIFY',
        units: 'pixels',
        extent: [
            TileMapInfo.x1, -TileMapInfo.y2, TileMapInfo.x2, -TileMapInfo.y1 // x1, -y2, x2, -y1 (reverse y direction)
        ]
    })

    var mousePosition = new ol.control.MousePosition({
        coordinateFormat: ol.coordinate.createStringXY(0),
    });

    MapTilecenter = TileMapInfo.center;
    MapTilemultiplier = TileMapInfo.multiplier;
    var existingmap = false;
    $.ajaxSetup({
        async: false
    });
    for (map of TileMapInfo.relatedmaps) {
        //console.log("Checking if related map exists: " + map);
        existingmap = false;
        $.getJSON("/static/addons/tsmap-" + map, function(mapexists) {
            if (mapexists) {
                existingmap = true;
            }
        });
        if (existingmap) {
            RelatedMaps.push(map);
        }
    }
    $.ajaxSetup({
        async: true
    });
    //RelatedMaps = TileMapInfo.relatedmaps;

    // Adding a marker for the player position/rotation.
    var g_playerIcon = new ol.style.Icon({
        anchor: [0.5, 0.5],
        anchorXUnits: 'fraction',
        anchorYUnits: 'fraction',
        rotateWithView: false,
        src: '/static/marker-new.png',
        scale: 0.2,
        snapToPixel: false
    });

    var playerIconStyle = new ol.style.Style({
        image: g_playerIcon,
        snapToPixel: false
    });

    var g_playerFeature = new ol.Feature({
        geometry: new ol.geom.Point([(TileMapInfo.x2 - TileMapInfo.x1) / 2 + TileMapInfo.x1, -1 * ((TileMapInfo.y2 - TileMapInfo.y1) / 2 + TileMapInfo.y1)]),
        snapToPixel: false
    });

    g_playerFeature.setStyle(playerIconStyle);

    var featureSource = new ol.source.Vector({
        features: [g_playerFeature],
        wrapX: false,
        snapToPixel: false

    });

    var vectorLayer = new ol.layer.Vector({
        source: featureSource,
        name: "Player Layer",
        updateWhileAnimating: true,
        updateWhileInteracting: true,
    });

    var styleCache = [];


    // Zähler für asynchrones Layer-Laden
    let layersToLoad = TileMapInfo.layerfiles.length;
    let layersLoaded = 0;

    // Layerdaten und Icons unabhängig laden
    menu_items = [];
    menu_icons = [];

    function buildMenu() {
        let z = 0;
        for (item of menu_items) {
            var image = mapsource + "/Overlays/" + menu_icons[z];
            console.log("Loading icon for layer " + item + ": " + image);
            var entry = `
                <div class="destination-entry horizon-layer-toggle" id="${item}" onclick="menuClick('${item}')">
                    <div class="entry-icon"><img src="${image}"  height="50px" width="50"></div>
                    <div class="entry-text">
                        <div class="entry-name link-dark">${item}</div>
                    </div>
                </div>
            `;

            $('#nib-entries').append(entry);
            z++;

        }
        ht = 90;
        ct = 0;
        column = 0;
        columncnt = Math.ceil((RelatedMaps.length) / 10);
        vheight = Math.ceil((RelatedMaps.length) / columncnt);
        $('.mapcontainer').css('-moz-column-count', columncnt);
        $('.mapcontainer').css('-webkit-column-count', columncnt);
        $('.mapcontainer').css('column-count', columncnt);
        for (map of RelatedMaps) {
            ct += 1;
            if (ct > 10) {
                ht = 90;
                ct = 1;
                column += 1;
            }
            $('#mapcontainer').append('<input type="button" id="' + map + '" value="' + map + '" class="dropdown-content" onclick = "mapClick(this.value)"></input>');
            ht += 40;
        }
        if (RelatedMaps.length == 0) {
            $("#mapButton").hide();
        } else {
            $("#mapButton").show();
        }
    }

    // Layerdaten und Icons laden
    for (let i = 0; i < TileMapInfo.layerfiles.length; i++) {
        let layerinfo = TileMapInfo.layerfiles[i];
        menu_items[i] = layerinfo[0];
        $.getJSON(mapsource + layerinfo[1], function(overlays) {
            // Füge das erste Icon des Layers als menu_icon hinzu (oder leer, falls keines vorhanden)
            let icon = overlays.length > 0 ? overlays[0].Icon : "";
            menu_icons[i] = icon;
            // Features erzeugen und in die Quelle einfügen
            if (sources[i]) {
                let features = [];
                overlays.forEach(function(overlay) {
                    features.push(new ol.Feature({
                        geometry: new ol.geom.Point([
                            (TileMapInfo.orig[0] + TileMapInfo.offset[0] + overlay.X) * TileMapInfo.coordscale[0],
                            TileMapInfo.orig[1] + TileMapInfo.offset[1] + (overlay.Y * TileMapInfo.coordscale[1])
                        ]),
                        name: overlay.Name,
                        kind: overlay.Typen,
                        icon: overlay.Icon,
                        uid: overlay.X + '|' + overlay.Y
                    }));
                });
                sources[i].addFeatures(features);
            }
            layersLoaded++;
            if (layersLoaded === layersToLoad) {
                buildMenu();
            }
        });
    }

    // ...OpenLayers-Layer wie gehabt, aber OHNE eigenen loader...
    for (let i = 0; i < TileMapInfo.layerfiles.length; i++) {
        let x = sources.length;
        var layerinfo = TileMapInfo.layerfiles[i];
        sources[x] = new ol.source.Vector({
            format: new ol.format.GeoJSON(),
            // kein loader mehr
        });
        sourceref[x] = sources[x].ol_uid;
        x = layers.length;
        layers[x] = new ol.layer.Vector({
            source: sources[sources.length - 1],
            name: layerinfo[0],
            updateWhileAnimating: true,
            updateWhileInteracting: true,
            minZoom: 0,
            declutter: true,
            renderMode: 'image',
            style: (function() {
                return function(feature, resolution) {
                    var style = styleCache[feature.get('uid')];
                    if (!style) {
                        style = [new ol.style.Style({
                            image: new ol.style.Icon(({
                                rotateWithView: false,
                                anchor: [0.5, 0.5],
                                anchorXUnits: 'fraction',
                                anchorYUnits: 'fraction',
                                snapToPixel: false,
                                src: mapsource + "/Overlays/" + feature.get('icon'),
                            })),
                        })];
                        styleCache[feature.get('uid')] = style;
                    }
                    style[0].getImage().setScale(0.5);
                    return style;
                };
            })(),
        });
    }

    var mousePositionControl = new ol.control.MousePosition({
        coordinateFormat: ol.coordinate.createStringXY(0),
    });
    var ext = 'jpg';
    var tilegrid = new ol.tilegrid.TileGrid({
        extent: tsProjection.getExtent(),
        resolutions: TileMapInfo.resolutions
    });
    g_map = new ol.Map({
        target: 'map',
        controls: [mousePositionControl],
        layers: [
            new ol.layer.Tile({
                source: new ol.source.XYZ({
                    tileGrid: tilegrid,
                    url: mapsource + '/Tiles/{z}/{x}/{y}.' + ext,
                    projection: tsProjection,
                    declutter: true,
                    renderMode: 'image'
                }),
                name: "Tiles",
            })
        ],
        loadTilesWhileAnimating: true,
        loadTilesWhileInteracting: true,
        fractionalZoom: true,
        view: new ol.View({
            center: TileMapInfo.center,
            zoom: 0,
            minZoom: 0,
            maxZoom: TileMapInfo.maxZoom,
            projection: tsProjection,
            extent: tsProjection.getExtent(),
        }),
    });

    for (const layer of layers) {
        g_map.addLayer(layer);
        layer.setVisible(false);
    }
    g_map.addLayer(vectorLayer);
    if (!window.playerToTargetLineSource) {
        window.playerToTargetLineSource = new ol.source.Vector();
    }
    if (!window.playerToTargetLineLayer) {
        window.playerToTargetLineLayer = new ol.layer.Vector({
            source: window.playerToTargetLineSource,
            style: new ol.style.Style({
                stroke: new ol.style.Stroke({
                    color: '#ff0000',
                    width: 3
                })
            }),
            name: 'PlayerToTargetLine',
            updateWhileAnimating: true,
            updateWhileInteracting: true,
        });
    }
    g_map.addLayer(window.playerToTargetLineLayer);

    g_map.on('click', function(evt) {
        const feature = g_map.forEachFeatureAtPixel(evt.pixel, function(feature) {
            // Prüfe, ob es ein Zielmarker ist (kein Spieler-Feature)
            if (feature !== g_playerFeature) {
                currentTargetFeature = feature;
                // Linie sofort aktualisieren
                updatePlayerToTargetLine(g_playerFeature.getGeometry().getCoordinates(), rad =null);
            }
            console.log("Clicked feature:", feature);
            var image = mapsource + "/Overlays/" + feature.get('icon');
            var html = `
                <div class="box-header">
                    <i class="fa-solid fa-location-dot google-pin"></i>
                    <span class="nib-title text-dark"></span>
                    <i class="fa-solid fa-xmark ms-auto" role="button" onclick="nav_info_box.style.display='block'; nav_setting_box.style.display='none'; window.playerToTargetLineSource.clear(); poi_info_box.style.display = 'none';; window.currentTargetFeature = null;"></i>
                </div>
                <div class="nib-entries" id="setting-entries">


                    <div class="destination-entry">
                        <div class="entry-icon"><img src="${image}"   height="50px" width="auto"></div>
                        <div class="entry-text w-100">
                            <div class="entry-name link-dark">${feature.get('name')}</div>
                            <div class="entry-info text-end pt-1"><button type="button" class="btn btn-success">Mark as done</button></span></div>
                        </div>
                    </div>
                </div>
            `;

            nav_setting_box.innerHTML = html;
            nav_setting_box.style.display = 'block';
            nav_info_box.style.display = 'none';
            poi_info_box.style.display = 'block';
            poiInfo.innerHTML = feature.get('name');
            poiInfoIcon.innerHTML = `<img src="${image}" height="50px" width="auto" style="margin: 10px;">`;


            return feature;
        });

    });

    /*
        var ht = 90;
        var ct = 0;
        column = 0;
        var columncnt = Math.ceil((menu_items.length + 2) / 10);
        var vheight = Math.ceil((menu_items.length + 2) / columncnt);
        //$('.container').css('height', vheight * 1.5 + "em");
        $('.container').css('-moz-column-count', columncnt);
        $('.container').css('-webkit-column-count', columncnt);
        $('.container').css('column-count', columncnt);
        $('#nib-entries').append('<input type="button" id="hideall" value="Hide All" class="dropdown-content" onclick = "menuClick(this.id)"></input>');
        $('#nib-entries').append('<input type="button" id="showall" value="Show All" class="dropdown-content" onclick = "menuClick(this.id)"></input>');
        z=0;
        for (item of menu_items) {
            var entry = `
                <div class="destination-entry" onclick = "menuClick(this.value)">
                    <div class="entry-icon"><img src=""></div>
                    <div class="entry-text">
                        <div class="entry-name link-dark">${item}</div>
                        <div class="entry-info">${menu_icons[z]}</div>
                    </div>
                </div>
            `;
            ct += 1;
            if (ct > 10) {
                ht = 90;
                ct = 1;
                column += 1;
            }
            $('#nib-entries').append(entry);
            ht += 40;
            z++;
        }
    
        ht = 90;
        ct = 0;
        column = 0;
        columncnt = Math.ceil((RelatedMaps.length) / 10);
        vheight = Math.ceil((RelatedMaps.length) / columncnt);
        //$('.mapcontainer').css('height', vheight * 1.5 + "em");
        $('.mapcontainer').css('-moz-column-count', columncnt);
        $('.mapcontainer').css('-webkit-column-count', columncnt);
        $('.mapcontainer').css('column-count', columncnt);
        for (map of RelatedMaps) {
            ct += 1;
            if (ct > 10) {
                ht = 90;
                ct = 1;
                column += 1;
            }
            $('#mapcontainer').append('<input type="button" id="' + map + '" value="' + map + '" class="dropdown-content" onclick = "mapClick(this.value)"></input>');
            ht += 40;
        }
        if (RelatedMaps.length == 0) {
            $("#mapButton").hide();
        } else {
            $("#mapButton").show();
        }
    */
    function zoomChanged() {
        var zoom = g_map.getView().getZoom();
        if (zoom >= 1) {
            overlaylayer.setVisibility(true);
        } else if (zoom < 1) {
            overlaylayer.setVisibility(false);
        }
    }

    var speeds = [];
    var coordsqueue = [];
    var lastLat = 0;
    var lastLong = 0;

    function Average(coords, index) {
        var sum = 0;
        for (var idx = 0; idx < coords.length; idx++) {
            sum += coords[idx][index];
        }
        return sum / coords.length;

    }

    document.setPosition = function setPosition(lat, long, yaw, speedkmh) {

        speeds.push(speedkmh);
        while (speeds.length > 10) {
            speeds.shift();
        }
        //lat = Math.round(lat, 2);
        //long = Math.round(long, 2);
        //if (Math.sqrt((lat - lastLat) * (lat - lastLat) + (long - lastLong) * (long - lastLong)) > 0.5)
        {
            lastLat = MapTilecenter[0] + (lat * MapTilemultiplier[0]);
            lastLong = MapTilecenter[1] + (long * MapTilemultiplier[1]);
        }

        var avg = speeds.reduce((a, v, i) => (a * i + v) / (i + 1));
        if (yaw < 0) {
            yaw += 360
        }
        var rad = (-yaw) * Math.PI / 180;
        var playerrad = (yaw) * Math.PI / 180;
        var coords = [lastLat, lastLong];
        coordsqueue.push(coords);
        while (coordsqueue.length > 5) {
            coordsqueue.shift();
        }
        coords = [
            Average(coordsqueue, 0),
            Average(coordsqueue, 1)
        ]



        g_playerFeature.getGeometry().setCoordinates(coords);
        //g_playerIcon.setRotation(playerrad);

        if (suspendTimer == 0) {
            g_playerIcon.setRotation(0);
            var animation = {
                center: GetAheadPosition(g_map, rad, avg, coords),
                duration: 10,
                rotation: rad,
            };
            if (suspendZoomTimer === 0) {
                var SpeedZoom = 7;
                if (speedkmh > 50) {
                    speedperc = speedkmh;
                    if (speedkmh > 500) {
                        speedperc = 500;
                    }
                    SpeedZoom = 7 - (2 * (0.01 * (speedperc / 5)));
                }
                g_map.getView().setZoom(SpeedZoom);
                /* animation["zoom"] = TileMapInfo.maxZoom;*/
            }

            //g_map.getView().animate(animation);

            g_map.getView().setCenter(GetAheadPosition(g_map, rad, speedkmh, coords));
            g_map.getView().setRotation(rad);
        } else {
            //g_playerIcon.setRotation(playerrad);
        }
        updatePlayerToTargetLine(coords, rad);
    }

    function refreshPositionFromApi() {
        //console.log("Refreshing position from API");
        $.getJSON(mapAPIurl, function(data) {
            if (data.GameRunning == true) {
                let coords = data.NewData.CarCoordinates;
                var rot = data.NewData.OrientationYaw;
                var speed = data.NewData.SpeedKmh;
                document.setPosition(coords[0], coords[2], rot, speed);
            }
        });
    }

    var hash = window.location.hash;
    //if (hash != "#norefresh") {
    refreshInterval = setInterval(refreshPositionFromApi, fetchIntervalMs);
    //}
}



document.loadMap = function loadMap(mapname) {
    if (g_map != null) {
        clearInterval(refreshInterval);
        g_map.setTarget(null);
        g_map = null;
        element = document.getElementById("hideall");
        element.parentNode.removeChild(element);
        element = document.getElementById("showall");
        element.parentNode.removeChild(element);

        for (item of menu_items) {
            element = document.getElementById(item);
            element.parentNode.removeChild(element);
        }

        for (item of RelatedMaps) {
            element = document.getElementById(item);
            element.parentNode.removeChild(element);
        }
        menu_items = [];
        sources = [];
        sourceref = {};
        layers = [];
        olsource = [];
        MapTilecenter = [];
        MapTilemultiplier = [];
        RelatedMaps = [];


    }
    var mapsource = "/static/addons/tsmap-" + mapname.toLowerCase();
    $.getJSON(mapsource + "/TileMapInfo.json", function(mapinfo) {
        //console.log("Loading map " + mapname);
        buildMap(mapinfo, mapsource);
    });;




}

var lastGame = null;

function switchGame() {
    //console.log("Switching game...");
    $.getJSON(mapAPIurl, function(data) {
        //console.log(data);
        if (lastGame != data.GameName) {
            lastGame = data.GameName;
            var targetGame = "FH5";
            if (data.GameName == "FH4") {
                targetGame = "FH4";
            }
            if (data.GameName !== "FH5" && data.GameName !== "FH4") {
                window.location.href = "/";
            }
            //console.log("Switching to game " + targetGame);
            document.loadMap(targetGame);
        }
    });
};

fetch('/config')
    .then(response => response.json())
    .then(config => {
        //console.log("Switching game to initial game");
        mapAPIurl = config.mapAPIurl;
        fetchIntervalMs = config.fetchIntervalMs;
        switchGame();
        setInterval(switchGame, 5000);

        //initially hide all layers
        menuClick('hideall');

    })
    .catch(err => console.error("Error loading config:", err));

// Globale Variable für das Ziel und die Linie
var currentTargetFeature = null;
var playerToTargetLineFeature = null;
var playerToTargetLineSource = new ol.source.Vector();
var playerToTargetLineLayer = new ol.layer.Vector({
    source: playerToTargetLineSource,
    style: new ol.style.Style({
        stroke: new ol.style.Stroke({
            color: '#ff0000',
            width: 3
        })
    }),
    name: 'PlayerToTargetLine',
    updateWhileAnimating: true,
    updateWhileInteracting: true,
});

// Funktion zum Zeichnen/Aktualisieren der Linie
function updatePlayerToTargetLine(playerCoords, rad = null) {
    if (!currentTargetFeature) {
        window.playerToTargetLineSource.clear();
        window.playerToTargetLineFeature = null; // <--- NEU
        return;
    }
    var targetCoords = currentTargetFeature.getGeometry().getCoordinates();
    var dx = playerCoords[0] - targetCoords[0];
    var dy = playerCoords[1] - targetCoords[1];
    var dist = Math.sqrt(dx*dx + dy*dy);

    if (rad !== null) {
        let yaw = -rad * 180 / Math.PI;
        // Optional: auf [0,360) normieren
        yaw = (yaw + 360) % 360;
        const dx = targetCoords[0] - playerCoords[0];
        const dy = targetCoords[1] - playerCoords[1];
        let angleRad = Math.atan2(dy, dx);

        // 2) In Grad umwandeln (0° = Osten, + gegen CCW)
        let angleDeg = angleRad * 180 / Math.PI;

        // 3) In einen Kompasskurs überführen:
        //    Unser „0“ soll Norden statt Osten sein,
        //    und wir wollen CW-Messung statt CCW.
        //    Daher: bearing = 90° − angleDeg
        let bearing = 90 - angleDeg;

        // 4) Normieren auf [0,360)
        bearing = (bearing + 360) % 360;
        console.log("Bearing to target: " + bearing + "°");
        console.log("Distance to target: " + dist + "m");
        console.log("Player yaw: " + rad);
        var correctedBearing = bearing - yaw; // Adjusted to match the original logic
        //const correctedBearing = bearing + rad -90;
        console.log("Player corrected yaw: " + correctedBearing);

        console.log("Corrected bearing for icon: " + correctedBearing + "°");
        // Set the icon rotation based on the corrected bearing
        var directionIcon = '<i class="fa-solid fa-arrow-up fa-rotate-by" style="--fa-rotate-angle: '+correctedBearing+'deg;"></i>';
        poiInfoIcon.innerHTML = directionIcon;
    }
    poiInfo.innerHTML = dist.toFixed(2) + "m";
    if (dist < 40) {
        currentTargetFeature = null;
        window.playerToTargetLineSource.clear();
        window.playerToTargetLineFeature = null; // <--- NEU
        poi_info_box.style.display = 'none';
        return;
    }
    var line = new ol.geom.LineString([playerCoords, targetCoords]);
    // Immer ein neues Feature anlegen, wenn das alte nicht mehr im Source ist
    if (!window.playerToTargetLineFeature || window.playerToTargetLineSource.getFeatures().indexOf(window.playerToTargetLineFeature) === -1) {
        window.playerToTargetLineFeature = new ol.Feature({ geometry: line });
        window.playerToTargetLineSource.clear();
        window.playerToTargetLineSource.addFeature(window.playerToTargetLineFeature);
    } else {
        window.playerToTargetLineFeature.setGeometry(line);
    }
    // Stil mit Glow, Transparenz und Pfeilspitze
    window.playerToTargetLineLayer.setStyle(function(feature) {
        const styles = [];
        // Glow-Effekt (breite, halbtransparente Linie)
        styles.push(new ol.style.Style({
            stroke: new ol.style.Stroke({
                color: 'rgba(68,136,221, 1)',
                width: 15
            })
        }));
        // Hauptlinie
        styles.push(new ol.style.Style({
            stroke: new ol.style.Stroke({
                color: 'rgb(255, 255, 255)',
                width: 8,
                lineDash: [12, 12], // gestrichelt
            })
        }));

        return styles;
    });
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
