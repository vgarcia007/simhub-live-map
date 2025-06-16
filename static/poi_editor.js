let game, trackcode;



fetch('/config')
    .then(res => res.json())
    .then(config => {
        game = document.getElementById('game').value;
        trackcode = document.getElementById('trackcode').value;
        initEditor(config);
    })
    .catch(err => console.error("Error loading config:", err));

function initEditor(config) {
    mapboxgl.accessToken = config.mapboxToken;
    const map = new mapboxgl.Map({
        container: 'map',
        style: 'mapbox://styles/mapbox/satellite-streets-v12',
        center: [0, 0],
        zoom: 2
    });

    let geojsonData = {
        type: 'FeatureCollection',
        features: []
    };
    let idCounter = 0;
    let markers = {}; // holds our draggable markers by feature.id
    let selectedId = null; // currently selected feature

    // helper: render all markers from geojsonData
    // Hilfsfunktion: Meter in Pixel am aktuellen Breitengrad und Zoom umrechnen
    function metersToPixelsAtLat(meters, lat, zoom) {
        const earthCircumference = 40075016.686; // in meters
        const latitudeRadians = lat * Math.PI / 180;
        const metersPerPixel = (earthCircumference * Math.cos(latitudeRadians)) / Math.pow(2, zoom + 8);
        // Add 20 meters to compensate for the observed offset
        return (meters*2) / metersPerPixel;
    }

    function renderMarkers() {
        console.log('Rendering markers...');
        for (let mid in markers) {
            markers[mid].remove();
        }
        markers = {};

        geojsonData.features.forEach(feature => {
            const [lng, lat] = feature.geometry.coordinates;
            const zoom = map.getZoom();
            const pxRadius = metersToPixelsAtLat(config.maxPoiDistance, lat, zoom);

            const markerRadius = 6;
            const size = Math.ceil(pxRadius * 2 + markerRadius * 2);

            const svgNS = "http://www.w3.org/2000/svg";
            const svg = document.createElementNS(svgNS, "svg");
            svg.setAttribute("width", size);
            svg.setAttribute("height", size);
            svg.style.overflow = "visible";
            svg.style.pointerEvents = "auto";
            svg.style.cursor = "pointer";

            const center = size / 2;

            // Transparent circle
            const circle = document.createElementNS(svgNS, "circle");
            circle.setAttribute("cx", center);
            circle.setAttribute("cy", center);
            circle.setAttribute("r", pxRadius);
            circle.setAttribute("fill", "#B4222233");
            circle.setAttribute("stroke", "#B42222");
            circle.setAttribute("stroke-width", "1");
            svg.appendChild(circle);

            // Red marker circle
            const markerCircle = document.createElementNS(svgNS, "circle");
            markerCircle.setAttribute("cx", center);
            markerCircle.setAttribute("cy", center);
            markerCircle.setAttribute("r", markerRadius);
            markerCircle.setAttribute("fill", "#B42222");
            svg.appendChild(markerCircle);

            svg.addEventListener('click', e => {
                e.stopPropagation();
                if (selectedId !== null) saveFromForm();
                selectFeature(feature.id);
            });

            const marker = new mapboxgl.Marker({
                    element: svg,
                    draggable: true,
                    anchor: 'center'
                })
                .setLngLat(feature.geometry.coordinates)
                .addTo(map);

            marker.on('dragend', () => {
                const lngLat = marker.getLngLat();
                feature.geometry.coordinates = [lngLat.lng, lngLat.lat];
                map.getSource('geojson').setData(geojsonData);
            });

            markers[feature.id] = marker;
        });
        
        map.on('zoom', renderMarkers);
    }


    map.on('zoom', renderMarkers);

    /**
     * Zooms/fits the map to show all current markers.
     */
    function zoomToMarkers() {
        const bounds = new mapboxgl.LngLatBounds();

        // If there are no features, bail out
        if (!geojsonData.features.length) return;

        // Extend bounds to include each feature's coordinates
        geojsonData.features.forEach(feature => {
            bounds.extend(feature.geometry.coordinates);
        });

        const ne = bounds.getNorthEast();
        const sw = bounds.getSouthWest();

        // If there's only one unique point (bounds collapsed), do a center+zoom
        if (ne.lng === sw.lng && ne.lat === sw.lat) {
            map.setCenter(bounds.getCenter());
            map.setZoom(14); // pick whatever zoom level you like for single points
        } else {
            // Multiple points: fit the bounds with padding
            map.fitBounds(bounds, {
                padding: 40, // px
                maxZoom: 18, // don't zoom in too far
                duration: 1000 // animate the transition
            });
        }
    }


    // load existing points, assign IDs, render markers+layer
    async function loadGeoJSON(url) {
        try {
            const res = await fetch(url);
            if (!res.ok) return;
            geojsonData = await res.json();
            geojsonData.features.forEach(f => {
                if (f.id == null) {
                    f.id = idCounter++;
                } else {
                    idCounter = Math.max(idCounter, f.id + 1);
                }
            });
            map.getSource('geojson').setData(geojsonData);
            renderMarkers();
            zoomToMarkers();
        } catch (e) {
            console.error('Error loading GeoJSON data:', e);
        }
    }

    // save only on button
    async function saveGeoJSON(url) {
        try {
            const res = await fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(geojsonData)
            });
            if (!res.ok) console.error('Error saving GeoJSON data');
        } catch (e) {
            console.error('Error saving GeoJSON data:', e);
        }
    }

    map.on('load', () => {
        map.addSource('geojson', {
            type: 'geojson',
            data: geojsonData
        });
        map.addLayer({
            id: 'points',
            type: 'circle',
            source: 'geojson',
            paint: {
                'circle-radius': 12,
                'circle-color': '#B42222'
            }
        });
        loadGeoJSON(`/poi-editor/${game}/${trackcode}`);
    });

    // selecting via layer (optional fallback)
    map.on('click', 'points', e => {
        const feat = e.features[0];
        if (!feat) return;
        if (selectedId !== null) saveFromForm();
        selectFeature(feat.id);
    });

    // deselect on empty-space click
    map.on('click', e => {
        const hits = map.queryRenderedFeatures(e.point, {
            layers: ['points']
        });
        if (hits.length === 0 && selectedId !== null) {
            saveFromForm();
            deselectFeature();
        }
    });

    // add-point remains, but then re-render markers
    document.getElementById('add-point').addEventListener('click', () => {
        const coords = map.getCenter().toArray();
        const newF = {
            type: 'Feature',
            id: idCounter++,
            properties: {
                name: '',
                direction: '',
                markerIcon: '',
                hidden: true
            },
            geometry: {
                type: 'Point',
                coordinates: coords
            }
        };
        geojsonData.features.push(newF);
        map.getSource('geojson').setData(geojsonData);
        renderMarkers();
        deselectFeature();
    });

    document.getElementById('save-geojson').addEventListener('click', () => {
        saveGeoJSON(`/poi-editor/${game}/${trackcode}`);
    });

    // Funktion zum Löschen eines Markers
    function deleteSelectedFeature() {
        if (selectedId == null) return;

        // Entferne das Feature aus geojsonData
        geojsonData.features = geojsonData.features.filter(f => f.id !== selectedId);

        // Entferne den Marker von der Karte
        if (markers[selectedId]) {
            markers[selectedId].remove();
            delete markers[selectedId];
        }

        // Aktualisiere die GeoJSON-Datenquelle
        map.getSource('geojson').setData(geojsonData);

        // Deselektiere das Feature
        deselectFeature();
    }

    // Event-Listener für den Lösch-Button hinzufügen
    document.getElementById('delete-point').addEventListener('click', deleteSelectedFeature);

    // fill form & highlight
    function selectFeature(id) {
        selectedId = id;
        const feature = geojsonData.features.find(f => f.id === id);
        if (!feature) return;
        document.getElementById('point-name').value = feature.properties.name;
        document.getElementById('point-direction').value = feature.properties.direction;
        const direction_select = document.getElementById('point-direction');
        const ts = direction_select.tomselect;
        console.log('Selected feature:', feature);
        document.getElementById('point-hidden').checked = feature.properties.hidden;
        document.getElementById('point-icon').value = feature.properties.markerIcon;
        document.getElementById('point-properties').style.display = 'block';
        ts.setValue(feature.properties.direction);
        
    }

    function deselectFeature() {
        selectedId = null;
        document.getElementById('point-properties').style.display = 'none';
    }

    // save form fields back into geojsonData & update layer
    function saveFromForm() {
        if (selectedId == null) return;
        const f = geojsonData.features.find(f => f.id === selectedId);
        if (!f) return;
        f.properties.name = document.getElementById('point-name').value;
        f.properties.direction = document.getElementById('point-direction').value;
        f.properties.hidden = document.getElementById('point-hidden').checked;
        f.properties.markerIcon = document.getElementById('point-icon').value;
        map.getSource('geojson').setData(geojsonData);
    }

    // instant-update on input
    ['point-name', 'point-direction', 'point-icon'].forEach(id =>
        document.getElementById(id).addEventListener('input', saveFromForm)
    );
    document.getElementById('point-hidden')
        .addEventListener('change', saveFromForm);

    // search as before…
    document.getElementById('search-button').addEventListener('click', () => {
        const query = document.getElementById('search-input').value;
        if (!query) return;
        fetch(`https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(query)}.json?access_token=${mapboxgl.accessToken}`)
            .then(r => r.json())
            .then(data => {
                if (data.features?.length) {
                    const [lng, lat] = data.features[0].center;
                    map.flyTo({
                        center: [lng, lat],
                        zoom: 14
                    });
                } else {
                    alert('Ort nicht gefunden.');
                }
            })
            .catch(err => console.error('Geocoding error:', err));
    });
}


document.addEventListener('DOMContentLoaded', () => {

    new TomSelect('#point-direction', {
        controlInput: null,
        render: {
            option: function(data, escape) {
                // data.text ist der sichtbare Text, data.$option ist das <option>-Element
                const icon = data.$option.getAttribute('data-icon');
                return `<div class="d-flex align-items-center">
                        <i class="${escape(icon)} me-2"></i>
                        <span>${escape(data.text)}</span>
                    </div>`;
            },
            item: function(data, escape) {
                const icon = data.$option.getAttribute('data-icon');
                return `<div class="d-flex align-items-center">
                        <i class="${escape(icon)} me-1"></i>
                        <span>${escape(data.text)}</span>
                    </div>`;
            }
        }
    });
});