let mapAPIurl;
var g_map = null;
var refreshInterval = 0;
var suspendTimer = 0;
var suspendZoomTimer = 0;
var menu_items = [];
var sources = [];
var sourceref = {};
var layers = [];
var olsource = [];
var MapTilecenter = [];
var MapTilemultiplier = [];
var RelatedMaps = [];
var suspendAutoMove = function(evt) {
    if (g_map != null) {
        clearTimeout(suspendTimer);
        suspendTimer = 1;
        $("#centerButton").show();
        g_map.getView().setRotation(0);
    }
};

$("#centerButton").click(function() {
    $("#centerButton").hide();
    suspendTimer = 0;
});

$("#menuButton").click(function() {
    document.getElementById("maps").classList.remove("show");
    document.getElementById("menu").classList.toggle("show");
});

$("#mapButton").click(function() {
    document.getElementById("menu").classList.remove("show");
    document.getElementById("maps").classList.toggle("show");
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
    if (name == "hideall") {
        for (layer of layers) {
            layer.setVisible(false);
            document.getElementById(layer.get("name")).classList.add("dropdown-content-deselect");
            console.log(layer.get("name"));
        }
    }
    if (name == "showall") {
        for (layer of layers) {
            layer.setVisible(true);
            document.getElementById(layer.get("name")).classList.remove("dropdown-content-deselect");
        }
    }
    for (layer of layers) {
        var lname = layer.get("name");
        if (lname == name) {
            if (layer.getVisible()) {
                layer.setVisible(false);
                document.getElementById(name).classList.add("dropdown-content-deselect");
            } else {
                layer.setVisible(true);
                document.getElementById(name).classList.remove("dropdown-content-deselect");
            }
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
    console.log("Calculating ahead position with rotation: " + rotation + ", speed: " + speed + ", coordinates: " + JSON.stringify(coordinates));
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
    console.log("Building map with info: " + JSON.stringify(TileMapInfo));
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
        console.log("Checking if related map exists: " + map);
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
        src: mapsource + '/Overlays/playericon.png',
        scale: 1.0,
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

    //read all the layer files and add them as layers.
    for (i = 0; i < TileMapInfo.layerfiles.length; i++) {
        x = sources.length;
        var layerinfo = TileMapInfo.layerfiles[i];
        sources[x] = new ol.source.Vector({
            format: new ol.format.GeoJSON(),
            loader: function(extent, resolution, projection) {
                var nr = 0;
                for (var key in sourceref) {
                    var value = sourceref[key];
                    if (value == this.ol_uid) {
                        nr = key;
                    }
                }
                console.log("Loading layer " + nr + " from " + mapsource + TileMapInfo.layerfiles[nr][1]);
                $.getJSON(mapsource + TileMapInfo.layerfiles[nr][1], function(overlays) {
                    olsource[nr] = {
                        "type": "FeatureCollection",
                        "features": []
                    };

                    overlays.forEach(function(overlay) {
                        //if (!overlay["ZoomLevelVisibility"] )
                        olsource[nr].features.push({
                            "type": "Feature",
                            "properties": {
                                "name": overlay.Name,
                                "kind": overlay.Typen,
                                "icon": overlay.Icon,
                                "uid": overlay.X + "|" + (overlay.Y)
                            },
                            "geometry": {
                                "type": "Point",
                                "coordinates": [(TileMapInfo.orig[0] + TileMapInfo.offset[0] + overlay.X) * TileMapInfo.coordscale[0], TileMapInfo.orig[1] + TileMapInfo.offset[1] + (overlay.Y * TileMapInfo.coordscale[1])]
                            }
                        });
                    });
                    sources[nr].addFeatures(sources[nr].getFormat().readFeatures(JSON.stringify(olsource[nr])));
                });
            }
        });
        sourceref[x] = sources[x].ol_uid;
        menu_items[i] = layerinfo[0];
        x = layers.length;
        layers[x] = new ol.layer.Vector({
            source: sources[sources.length - 1],
            name: layerinfo[0],
            updateWhileAnimating: true,
            updateWhileInteracting: true,
            minZoom: 0,
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
                    // style[0].getImage().setScale(g_map.getView().getResolutionForZoom(8) / resolution);
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
                    projection: tsProjection
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


    const closeButton = document.querySelector("dialog button");
    const dialogContent = document.querySelector("dialog p");

    closeButton.addEventListener("click", () => {
        document.getElementById("dialog-modal").close();
    });
    g_map.on('click', function(evt) {
        const feature = g_map.forEachFeatureAtPixel(evt.pixel, function(feature) {
            console.log(feature.values_['name']);

            dialogContent.innerHTML = feature.values_['name'];

            document.getElementById("dialog-modal").showModal();
            return feature;
        });

    });


    var ht = 90;
    var ct = 0;
    column = 0;
    var columncnt = Math.ceil((menu_items.length + 2) / 10);
    var vheight = Math.ceil((menu_items.length + 2) / columncnt);
    //$('.container').css('height', vheight * 1.5 + "em");
    $('.container').css('-moz-column-count', columncnt);
    $('.container').css('-webkit-column-count', columncnt);
    $('.container').css('column-count', columncnt);
    $('#container').append('<input type="button" id="hideall" value="Hide All" class="dropdown-content" onclick = "menuClick(this.id)"></input>');
    $('#container').append('<input type="button" id="showall" value="Show All" class="dropdown-content" onclick = "menuClick(this.id)"></input>');
    for (item of menu_items) {
        ct += 1;
        if (ct > 10) {
            ht = 90;
            ct = 1;
            column += 1;
        }
        $('#container').append('<input type="button" id="' + item + '" value="' + item + '" class="dropdown-content" onclick = "menuClick(this.value)"></input>');
        ht += 40;
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
            g_playerIcon.setRotation(playerrad);
        }
    }

    function refreshPositionFromApi() {
        console.log("Refreshing position from API");
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
    refreshInterval = setInterval(refreshPositionFromApi, 50);
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
        console.log("Loading map " + mapname);
        buildMap(mapinfo, mapsource);
    });;




}

var lastGame = null;

function switchGame() {
    console.log("Switching game...");
    $.getJSON(mapAPIurl, function(data) {
        console.log(data);
        if (lastGame != data.GameName) {
            lastGame = data.GameName;
            var targetGame = "FH5";
            if (data.GameName == "FH4") {
                targetGame = "FH4";
            }
            if (data.GameName !== "FH5" && data.GameName !== "FH4") {
                window.location.href = "/";
            }
            console.log("Switching to game " + targetGame);
            document.loadMap(targetGame);
        }
    });
};

fetch('/config')
    .then(response => response.json())
    .then(config => {
        console.log("Switching game to initial game");
        mapAPIurl = config.mapAPIurl;
        switchGame();
        setInterval(switchGame, 5000);

        //initially hide all layers
        menuClick('hideall');

    })
    .catch(err => console.error("Error loading config:", err));