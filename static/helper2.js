'use strict';

const helper = document.getElementById('helper2');
const bestFitScript = new URL('helper2-best-fit.js', document.currentScript.src);
const field = id => document.getElementById(id);
const degreesPerMeter = 180 / (Math.PI * 6378137);
const radians = Math.PI / 180;
const latitudeLimit = 85.05112878;
const emptyLine = { type: 'MultiLineString', coordinates: [] };
const emptyDirections = { type: 'FeatureCollection', features: [] };

let map;
let token;
let recording;
let yawProfile;
let yawReference;
let uploadedFile;
let anchor;
let geometry;
let moveHandle;
let rotationHandle;
let cornerHandles = [];
let frameCorners = [];
let startMarker;
let endMarker;
let ready = false;
let placed = false;
let placing = false;
let saving = false;
let importing = false;
let searchSequence = 0;
let resetBestFit;

function showStatus(message, kind = 'danger') {
    const status = field('status');
    status.hidden = !message;
    status.className = `alert alert-${kind} mb-3`;
    status.textContent = message;
}

async function requestJson(url, options) {
    const response = await fetch(url, options);
    const data = await response.json();
    if (!response.ok) {
        const error = new Error(data.error || data.message || `Request failed (${response.status}).`);
        error.replaceRequired = response.status === 409 && data.replace_required;
        throw error;
    }
    return data;
}

function prepareGeometry() {
    const axis = field('axis').value === 'xz' ? 2 : 1;
    const points = recording.points.map(point => [point[0], point[axis]]);
    const xs = points.map(point => point[0]);
    const ys = points.map(point => point[1]);
    const [minX, maxX] = [Math.min(...xs), Math.max(...xs)];
    const [minY, maxY] = [Math.min(...ys), Math.max(...ys)];
    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;
    const deltas = points.map(([x, y]) => [x - centerX, y - centerY]);

    const distances = [];
    for (let index = 1; index < points.length; index++) {
        const [x, y] = points[index];
        const [previousX, previousY] = points[index - 1];
        distances.push(Math.hypot(x - previousX, y - previousY));
    }
    const nonzero = distances.filter(distance => distance > 0).sort((a, b) => a - b);
    const typicalStep = nonzero[Math.floor(nonzero.length / 2)] || 0;
    const gap = Math.max(25, 20 * typicalStep);
    const segments = [[]];
    deltas.forEach((point, index) => {
        if (distances[index - 1] > gap) {
            segments.push([]);
        }
        segments[segments.length - 1].push(point);
    });
    const edges = [];
    let pathLength = 0;
    for (const segment of segments) {
        for (let index = 1; index < segment.length; index++) {
            const [x, y] = segment[index - 1];
            const delta = [segment[index][0] - x, segment[index][1] - y];
            const length = Math.hypot(...delta);
            if (length > 0) {
                edges.push({ x, y, delta, length, start: pathLength });
                pathLength += length;
            }
        }
    }
    const halfWidth = (maxX - minX) / 2;
    const halfHeight = (maxY - minY) / 2;
    const start = deltas[0];
    const end = deltas[deltas.length - 1];
    const closed = Math.hypot(start[0] - end[0], start[1] - end[1]) <= 4 * typicalStep;
    geometry = {
        start, end, closed, edges, pathLength,
        segments: segments.filter(segment => segment.length > 1),
        corners: [[-halfWidth, halfHeight], [halfWidth, halfHeight],
            [halfWidth, -halfHeight], [-halfWidth, -halfHeight]],
        top: [0, halfHeight],
    };
}

function alignment() {
    return {
        latitude: anchor.lat,
        longitude: anchor.lng,
        rotation: field('rotation').valueAsNumber,
        scale: field('scale').valueAsNumber,
        mirror: field('mirror').checked,
        axis: field('axis').value,
        yaw: field('yaw').valueAsNumber,
        yaw_reference: yawReference,
    };
}

function rotatedOffset([x, y], transform) {
    const angle = transform.rotation * radians;
    const east = x * transform.scale * (transform.mirror ? -1 : 1);
    const north = y * transform.scale;
    return [Math.cos(angle) * east - Math.sin(angle) * north, Math.sin(angle) * east + Math.cos(angle) * north];
}

function project(point, transform) {
    const [east, north] = rotatedOffset(point, transform);
    return [
        transform.longitude + east * degreesPerMeter / Math.cos(transform.latitude * radians),
        transform.latitude + north * degreesPerMeter,
    ];
}

function withinMap([lng, lat]) {
    return Math.abs(lat) <= latitudeLimit && Math.abs(lng) <= 180;
}

function updateFrame() {
    const visible = frameCorners.length > 0 && frameCorners.every(withinMap);
    for (const handle of [moveHandle, rotationHandle, ...cornerHandles]) {
        handle.getElement().hidden = !visible;
    }
    const source = map.getSource('outline-frame');
    if (!visible) {
        source.setData(emptyLine);
        return;
    }

    moveHandle.setLngLat(anchor);
    frameCorners.forEach((corner, index) => {
        const handle = cornerHandles[index];
        handle.setLngLat(corner);
        const diagonal = map.project(corner).sub(map.project(frameCorners[(index + 2) % 4]));
        const angle = Math.atan2(diagonal.y, diagonal.x);
        const cursors = ['ew-resize', 'nwse-resize', 'ns-resize', 'nesw-resize'];
        handle.getElement().style.cursor = cursors[(Math.round(angle / (Math.PI / 4)) + 8) % 4];
    });
    const top = project(geometry.top, { ...alignment(), mirror: false });
    const screenTop = map.project(top);
    const center = map.project(anchor);
    const direction = screenTop.sub(center);
    const length = direction.mag();
    const lines = [[...frameCorners, frameCorners[0]]];
    if (length > 0) {
        const handle = map.unproject(screenTop.add(direction.mult(30 / length)));
        if (withinMap([handle.lng, handle.lat])) {
            rotationHandle.setLngLat(handle);
            lines.push([top, [handle.lng, handle.lat]]);
        } else {
            rotationHandle.getElement().hidden = true;
        }
    } else {
        rotationHandle.getElement().hidden = true;
    }
    source.setData({ type: 'MultiLineString', coordinates: lines });
}

function addCornerDrag(handle, index) {
    let drag;
    handle.on('dragstart', () => {
        const transform = { ...alignment(), mirror: false };
        const opposite = (index + 2) % 4;
        const fixed = frameCorners[opposite];
        const [lng, lat] = frameCorners[index];
        const longitudeScale = Math.cos(transform.latitude * radians);
        const dx = (lng - fixed[0]) * longitudeScale;
        const dy = lat - fixed[1];
        drag = { transform, opposite, fixed, longitudeScale, dx, dy };
    });
    handle.on('drag', () => {
        if (!drag) return;
        const { transform, opposite, fixed, longitudeScale, dx, dy } = drag;
        const pointer = handle.getLngLat().wrap();
        const pointerX = (pointer.lng - fixed[0]) * longitudeScale;
        const pointerY = pointer.lat - fixed[1];
        const scale = transform.scale * (dx * pointerX + dy * pointerY) / (dx * dx + dy * dy);
        if (scale >= 0.0001 && scale <= 10000) {
            const [east, north] = rotatedOffset(geometry.corners[opposite], { ...transform, scale });
            const lat = fixed[1] - north * degreesPerMeter;
            const lng = fixed[0] - east * degreesPerMeter / Math.cos(lat * radians);
            if (withinMap([lng, lat])) {
                field('scale').value = scale;
                anchor = new mapboxgl.LngLat(lng, lat);
            }
        }
        updateOutline();
    });
    handle.on('dragend', () => { drag = null; });
}

function lapMarker() {
    const element = document.createElement('span');
    element.className = 'outline-lap-marker';
    return new mapboxgl.Marker({ element, anchor: 'bottom' }).setLngLat([0, 0]).addTo(map);
}

function updateLapMarkers(visible, transform) {
    const start = startMarker.getElement();
    const end = endMarker.getElement();
    const startPosition = visible ? project(geometry.start, transform) : null;
    const endPosition = visible && !geometry.closed ? project(geometry.end, transform) : null;
    start.hidden = !startPosition || !withinMap(startPosition);
    end.hidden = !endPosition || !withinMap(endPosition);
    if (!start.hidden) {
        start.textContent = geometry.closed ? 'Start / finish ≈' : 'Recording start';
        start.title = geometry.closed ? 'Approximate start and finish based on the recorded lap' : 'First recorded point';
        startMarker.setLngLat(startPosition);
    }
    if (!end.hidden) {
        end.textContent = 'Recording end';
        end.title = 'Last recorded point';
        endMarker.setLngLat(endPosition);
    }
}

function addDirectionLayer() {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 44;
    const drawing = canvas.getContext('2d');
    drawing.lineCap = 'round';
    drawing.lineJoin = 'round';
    drawing.beginPath();
    drawing.moveTo(14, 10);
    drawing.lineTo(29, 22);
    drawing.lineTo(14, 34);
    drawing.strokeStyle = '#082029';
    drawing.lineWidth = 13;
    drawing.stroke();
    drawing.strokeStyle = '#fff';
    drawing.lineWidth = 6;
    drawing.stroke();
    map.addImage('outline-direction', drawing.getImageData(0, 0, 44, 44), { pixelRatio: 2 });
    map.addSource('outline-directions', { type: 'geojson', data: emptyDirections });
    map.addLayer({
        id: 'outline-direction', type: 'symbol', source: 'outline-directions',
        layout: {
            'icon-image': 'outline-direction',
            'icon-rotation-alignment': 'map',
            'icon-rotate': ['get', 'angle'],
            'icon-allow-overlap': true,
            'icon-ignore-placement': true,
        },
    });
}

function updateDirections(visible, transform) {
    const source = map.getSource('outline-directions');
    if (!visible) {
        source.setData(emptyDirections);
        return;
    }

    const mercatorUnitsPerMeter = mapboxgl.MercatorCoordinate.fromLngLat(anchor).meterInMercatorCoordinateUnits();
    const pixels = geometry.pathLength * transform.scale * mercatorUnitsPerMeter * 512 * 2 ** map.getZoom();
    const count = pixels < 36 ? 0 : Math.min(160, Math.max(1, Math.round(pixels / 105)));
    const features = [];
    let edgeIndex = 0;
    for (let index = 0; index < count; index++) {
        const distance = geometry.pathLength * (index + 0.5) / count;
        while (distance > geometry.edges[edgeIndex].start + geometry.edges[edgeIndex].length) edgeIndex++;
        const edge = geometry.edges[edgeIndex];
        const fraction = (distance - edge.start) / edge.length;
        const [dx, dy] = edge.delta;
        const coordinates = project([edge.x + dx * fraction, edge.y + dy * fraction], transform);
        // Use the forward vector from the recording, transformed the same way as the outline.
        const [east, north] = rotatedOffset(edge.delta, transform);
        const angle = Math.atan2(-north, east) / radians;
        features.push({ type: 'Feature', geometry: { type: 'Point', coordinates }, properties: { angle } });
    }
    source.setData({ type: 'FeatureCollection', features });
}

function wrapYaw(angle) {
    return ((angle + 180) % 360 + 360) % 360 - 180;
}

function gameYawProfile() {
    return field('axis').value === 'xz' && yawProfile;
}

function captureYawReference() {
    const yaw = field('yaw').valueAsNumber;
    const rotation = field('rotation').valueAsNumber;
    if (Number.isFinite(yaw) && Number.isFinite(rotation)) {
        const reflection = field('mirror').checked ? -1 : 1;
        const sign = yawReference ? yawReference.sign : reflection;
        yawReference = { zero: wrapYaw(reflection * (yaw + rotation)), sign };
    }
}

function updateOutline() {
    const profile = gameYawProfile() || yawReference;
    field('yaw').readOnly = Boolean(gameYawProfile());
    field('yaw-calibration-help').hidden = Boolean(gameYawProfile());
    if (profile) {
        const rotation = field('rotation').valueAsNumber;
        const reflection = field('mirror').checked ? -1 : 1;
        if (Number.isFinite(rotation)) {
            field('yaw').value = wrapYaw(reflection * profile.zero - rotation).toFixed(4);
        }
    }
    if (!ready || !geometry || !anchor) return;
    const valid = field('scale').validity.valid && field('rotation').validity.valid;
    const transform = alignment();
    const coordinates = valid
        ? geometry.segments.map(segment => segment.map(point => project(point, transform)))
        : [];
    const inBounds = coordinates.length > 0 && coordinates.every(segment => segment.every(withinMap));
    map.getSource('outline').setData(inBounds ? { type: 'MultiLineString', coordinates } : emptyLine);
    map.setPaintProperty('outline-color', 'line-opacity', placed ? 1 : 0.6);
    const showGuides = placed && !placing && inBounds;
    updateLapMarkers(showGuides, transform);
    updateDirections(showGuides, transform);
    frameCorners = showGuides
        ? geometry.corners.map(point => project(point, { ...transform, mirror: false }))
        : [];
    updateFrame();
    field('fit').disabled = !placed || placing || !inBounds;
    field('save').disabled = saving || importing || field('fit').disabled;
}

function setPlacementMode(active) {
    placing = active;
    field('place').setAttribute('aria-pressed', String(active));
    field('place').textContent = active ? 'Click the map to place the outline' : 'Place outline again';
    field('placement-help').textContent = active
        ? 'Search or browse to the circuit, then click where the center of the outline should go.'
        : 'Drag the center to move, a corner to scale, or the round handle to rotate.';
    if (map) map.getCanvas().style.cursor = active ? 'crosshair' : '';
    updateOutline();
}

function marker(label, symbol, kind) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `outline-handle outline-handle--${kind}`;
    button.textContent = symbol;
    button.title = label;
    button.setAttribute('aria-label', label);
    return new mapboxgl.Marker({ element: button, draggable: true });
}

function fitOutline() {
    const bounds = new mapboxgl.LngLatBounds();
    for (const corner of frameCorners.filter(withinMap)) bounds.extend(corner);
    if (bounds.isEmpty()) return;
    map.fitBounds(bounds, { padding: 65, maxZoom: 18, duration: 0 });
}

function addRacewayLayer() {
    // The satellite-streets style already loads Mapbox Streets v8 as "composite".
    const filter = ['all',
        ['==', ['geometry-type'], 'LineString'],
        ['==', ['get', 'type'], 'raceway'],
    ];
    const detailZoom = 12;
    const overviewSource = 'raceway-overview';
    const layers = [
        { id: 'raceway-border', color: '#211804', width: 9 },
        { id: 'raceway-guide', color: '#ffd34f', width: 6 },
    ];
    const layerIds = [];
    map.addSource(overviewSource, { type: 'geojson', data: emptyLine });
    for (const { id, color, width } of layers) {
        const style = {
            type: 'line',
            layout: { visibility: 'none', 'line-cap': 'round', 'line-join': 'round' },
            paint: { 'line-color': color, 'line-width': width },
        };
        map.addLayer({ ...style, id, source: 'composite', 'source-layer': 'road', filter });
        map.addLayer({
            ...style,
            id: `${id}-overview`,
            source: overviewSource,
            maxzoom: detailZoom,
            paint: { 'line-color': color, 'line-width': ['interpolate', ['linear'], ['zoom'], 8, width / 3, detailZoom, width] },
        });
        layerIds.push(id, `${id}-overview`);
    }

    const container = document.createElement('div');
    container.className = 'mapboxgl-ctrl raceway-control';
    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.textContent = 'Raceways';
    toggle.title = 'Highlight mapped raceway lines in yellow';
    toggle.setAttribute('aria-pressed', 'false');

    let visible = false;
    let lastSampledView = '';
    let overviewLines = [];
    function readRaceways() {
        const lines = [];
        for (const feature of map.querySourceFeatures('composite', { sourceLayer: 'road', filter })) {
            const geometry = feature.geometry;
            if (geometry.type === 'MultiLineString') {
                lines.push(...geometry.coordinates);
            } else if (geometry.type === 'LineString') {
                lines.push(geometry.coordinates);
            }
        }
        return lines;
    }

    function rememberRaceways() {
        if (!visible || map.getZoom() < detailZoom || map.isMoving()) return;
        // Keep the latest detailed view even after zoomed-out tiles omit its roads.
        const view = `${map.isSourceLoaded('composite')}:${map.getBounds().toArray()}`;
        if (view === lastSampledView) return;
        lastSampledView = view;
        const lines = readRaceways();
        if (lines.length) {
            overviewLines = lines;
            map.getSource(overviewSource).setData({ type: 'MultiLineString', coordinates: lines });
        }
    }

    function setVisible(active) {
        visible = active;
        for (const id of layerIds) {
            map.setLayoutProperty(id, 'visibility', visible ? 'visible' : 'none');
        }
        toggle.setAttribute('aria-pressed', String(visible));
        rememberRaceways();
    }
    toggle.addEventListener('click', () => setVisible(!visible));
    map.on('render', rememberRaceways);
    container.append(toggle);
    map.addControl({
        onAdd: () => container,
        onRemove: () => container.remove(),
    }, 'top-left');
    addBestFitControl(() => {
        if (!visible) setVisible(true);
        const lines = map.getZoom() >= detailZoom ? readRaceways() : [];
        return lines.length ? lines : overviewLines;
    });
}

function addBestFitControl(racewaysForFit) {
    const controls = document.createElement('div');
    controls.className = 'best-fit-controls';
    const fit = document.createElement('button');
    fit.type = 'button';
    fit.className = 'btn btn-outline-warning w-100';
    fit.textContent = 'Best fit to raceway';
    const undo = document.createElement('button');
    undo.type = 'button';
    undo.className = 'btn btn-link btn-sm px-0';
    undo.textContent = 'Undo best fit';
    undo.hidden = true;
    const status = document.createElement('div');
    status.className = 'form-text';
    status.setAttribute('role', 'status');
    controls.append(fit, undo, status);
    field('placement-help').after(controls);

    let previous;
    resetBestFit = () => {
        previous = null;
        undo.hidden = true;
        status.textContent = '';
    };

    function apply(transform) {
        anchor = new mapboxgl.LngLat(transform.longitude, transform.latitude);
        field('scale').value = transform.scale;
        field('rotation').value = transform.rotation;
        updateOutline();
    }

    undo.addEventListener('click', () => {
        apply(previous);
        resetBestFit();
        status.textContent = 'Previous position, scale and rotation restored.';
    });

    fit.addEventListener('click', async () => {
        if (!placed || placing || field('fit').disabled) {
            status.textContent = 'Place and roughly align the outline on the map first.';
            return;
        }
        const raceways = racewaysForFit();
        if (!raceways.length) {
            status.textContent = 'No mapped raceway loaded. Zoom in until the yellow line appears.';
            return;
        }
        const original = alignment();
        const originalRecording = recording;
        const outline = geometry.segments.map(segment => segment.map(point => project(point, original)));
        status.textContent = 'Finding a closer alignment…';
        fit.disabled = true;
        undo.disabled = true;
        let worker;
        try {
            worker = new Worker(bestFitScript);
            const result = await new Promise((resolve, reject) => {
                worker.onmessage = event => resolve(event.data);
                worker.onerror = () => reject(new Error('The alignment calculation could not run.'));
                worker.postMessage({ outline, raceways, latitude: original.latitude, longitude: original.longitude });
            });
            if (recording !== originalRecording) return;
            if (placing || JSON.stringify(alignment()) !== JSON.stringify(original)) {
                status.textContent = 'The outline moved during the fit. Try again from its current position.';
                return;
            }
            if (result.error) throw new Error(result.error);
            if (!result.changed) {
                status.textContent = 'No closer alignment found.';
                return;
            }
            const rotation = (original.rotation + result.rotation + 540) % 360 - 180;
            const scale = original.scale * result.scale;
            const next = { ...original, latitude: result.latitude, longitude: result.longitude, scale, rotation };
            if (scale < 0.0001 || scale > 10000
                || !withinMap([next.longitude, next.latitude])
                || geometry.corners.some(point => !withinMap(project(point, next)))) {
                throw new Error('The fitted outline would fall outside the supported map bounds.');
            }
            previous = original;
            apply(next);
            undo.hidden = false;
            const percent = Math.round(result.coverage * 100);
            status.textContent = `Refined. ${percent}% of samples are within ${Math.round(result.tolerance)} m of a mapped raceway. Review before saving.`;
        } catch (error) {
            if (recording === originalRecording) status.textContent = error.message;
        } finally {
            if (worker) worker.terminate();
            fit.disabled = false;
            undo.disabled = false;
        }
    });
}

async function initMap() {
    const config = await requestJson(helper.dataset.configUrl);
    if (!config.mapboxToken) throw new Error('Configure a Mapbox token before opening the editor.');
    token = config.mapboxToken;
    mapboxgl.accessToken = token;
    // A failed WebGL initialization can leave nodes behind in the map container.
    field('map').replaceChildren();
    map = new mapboxgl.Map({
        container: 'map',
        style: 'mapbox://styles/mapbox/satellite-streets-v12',
        projection: 'mercator',
        center: anchor ? [anchor.lng, anchor.lat] : [0, 0],
        zoom: anchor ? 14 : 2,
        maxBounds: [[-180, -latitudeLimit], [180, latitudeLimit]],
        renderWorldCopies: false,
        pitchWithRotate: false,
        dragRotate: false,
    });
    map.touchZoomRotate.disableRotation();
    map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), 'top-right');
    map.on('error', () => {
        if (!ready) showStatus('The satellite map could not load. Check the Mapbox token and connection.');
    });
    map.on('load', () => {
        addRacewayLayer();
        map.addSource('outline', { type: 'geojson', data: emptyLine });
        map.addLayer({
            id: 'outline-border', type: 'line', source: 'outline',
            layout: { 'line-cap': 'round', 'line-join': 'round' },
            paint: { 'line-color': '#082029', 'line-width': 7 },
        });
        map.addLayer({
            id: 'outline-color', type: 'line', source: 'outline',
            layout: { 'line-cap': 'round', 'line-join': 'round' },
            paint: { 'line-color': '#40eaff', 'line-width': 3 },
        });
        map.addSource('outline-frame', { type: 'geojson', data: emptyLine });
        map.addLayer({
            id: 'outline-frame', type: 'line', source: 'outline-frame',
            paint: { 'line-color': '#fff', 'line-width': 1.5, 'line-dasharray': [3, 2] },
        });
        addDirectionLayer();
        startMarker = lapMarker();
        endMarker = lapMarker();
        moveHandle = marker('Move outline', '✥', 'move').setLngLat([0, 0]).addTo(map);
        rotationHandle = marker('Rotate outline', '↻', 'rotate').setLngLat([0, 0]).addTo(map);
        for (const [index, corner] of ['top left', 'top right', 'bottom right', 'bottom left'].entries()) {
            const handle = marker(`Scale outline from ${corner} corner`, '', 'scale').setLngLat([0, 0]).addTo(map);
            addCornerDrag(handle, index);
            cornerHandles.push(handle);
        }
        moveHandle.on('drag', () => {
            anchor = moveHandle.getLngLat().wrap();
            updateOutline();
        });
        rotationHandle.on('drag', () => {
            const position = rotationHandle.getLngLat().wrap();
            const east = (position.lng - anchor.lng) * Math.cos(anchor.lat * radians);
            const north = position.lat - anchor.lat;
            const angle = Math.atan2(north, east) / radians - 90;
            field('rotation').value = ((angle + 540) % 360 - 180).toFixed(4);
            updateOutline();
        });
        map.on('zoom', () => {
            updateFrame();
            if (frameCorners.length) updateDirections(true, alignment());
        });
        map.on('click', event => {
            if (!placing || event.originalEvent.target.closest('.outline-handle')) return;
            const firstPlacement = !placed;
            anchor = event.lngLat.wrap();
            placed = true;
            setPlacementMode(false);
            if (firstPlacement) fitOutline();
        });
        map.on('moveend', () => {
            if (!placed) {
                anchor = map.getCenter().wrap();
                updateOutline();
            }
        });
        ready = true;
        if (!anchor) anchor = map.getCenter().wrap();
        setPlacementMode(placing);
        if (placed) fitOutline();
    });
}

async function openRecording(data, track, displayName, transform, yaw = 0, profile = null) {
    recording = data;
    yawProfile = profile;
    yawReference = transform && transform.yaw_reference;
    if (resetBestFit) resetBestFit();
    searchSequence++;
    const name = displayName || recording.display_name || track;
    field('recording-name').textContent = name;
    const details = [
        recording.game,
        recording.track_name && `Recording ID ${recording.track_name}`,
        recording.track_config,
        `${recording.points.length.toLocaleString()} points`,
        recording.skipped && `${recording.skipped} invalid samples skipped`,
    ];
    field('recording-details').textContent = details.filter(Boolean).join(' · ');
    field('query').value = /^\d+$/.test(name) ? '' : circuitName(name);
    field('search-results').replaceChildren();
    field('track-name').value = track;
    field('display-name').value = name;
    field('scale').value = transform ? transform.scale : 1;
    field('rotation').value = transform ? transform.rotation : 0;
    field('yaw').value = transform ? transform.yaw : yaw;
    field('axis').value = transform ? transform.axis : 'xz';
    field('axis').disabled = recording.game === 'FM8';
    field('mirror').checked = transform ? transform.mirror : Boolean(yawProfile && yawProfile.sign === -1);
    if (!gameYawProfile() && !yawReference) captureYawReference();
    prepareGeometry();
    placed = Boolean(transform);
    anchor = transform
        ? { lng: transform.longitude, lat: transform.latitude }
        : map && map.getCenter().wrap();
    field('workspace').hidden = false;
    setPlacementMode(!placed);
    if (!map) await initMap();
}

async function importRecording(loadFile) {
    if (saving || importing) return;
    importing = true;
    updateOutline();
    showStatus('');
    try {
        const file = await loadFile();
        const form = new FormData();
        form.append('recording', file);
        const imported = await requestJson(helper.dataset.importUrl, { method: 'POST', body: form });
        uploadedFile = file;
        await openRecording(imported.recording, imported.track_key, imported.display_name, null, imported.yaw, imported.yaw_profile);
    } catch (error) {
        showStatus(error.message);
    } finally {
        importing = false;
        updateOutline();
    }
}

field('place').addEventListener('click', () => setPlacementMode(placed ? !placing : true));
field('fit').addEventListener('click', fitOutline);
field('display-name').addEventListener('input', () => {
    field('recording-name').textContent = field('display-name').value.trim() || field('track-name').value;
});
field('axis').addEventListener('change', () => {
    yawReference = null;
    if (!gameYawProfile()) captureYawReference();
    prepareGeometry();
    updateOutline();
});
field('yaw').addEventListener('input', captureYawReference);
for (const id of ['scale', 'rotation', 'mirror']) field(id).addEventListener('input', updateOutline);

function circuitName(name) {
    name = name.replace(/_/g, ' ');
    return name.replace(/(?:[\s_-]+(?:full|short|club|sprint|endurance|national|gp|layout|reverse|alt))+$/i, '').trim() || name;
}

function searchWords(text) {
    return text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().match(/[a-z0-9]+/g) || [];
}

function describeSearchResult(feature, words) {
    const properties = feature.properties;
    const name = properties.name_preferred || properties.name || '';
    const nameWords = searchWords(name);
    const normalizedName = nameWords.join(' ');
    const categories = properties.poi_category_ids || [];
    const accessory = /\b(?:parking|museum|hotel|entrance|ingresso|einfahrt|station|camping|meeting point|visitor cent(?:re|er)|golf)\b/i.test(name)
        || categories.some(category => ['museum', 'parking_lot', 'lodging', 'motorsports_store'].includes(category));
    const raceway = !accessory && (properties.maki === 'racetrack' || categories.includes('racetrack')
        || (properties.feature_type === 'poi' && /\b(?:raceway|race track|racetrack|speedway|circuit|autodrom[eo]|motodrom|rennstrecke|nordschleife)\b/i.test(name)));
    const matches = words.filter(word => nameWords.includes(word)).length;
    const exact = normalizedName === words.join(' ');
    const score = (raceway ? 100 : 0) + (exact ? 15 : 0) + 10 * matches - (accessory ? 20 : 0);
    return { feature, name, raceway, matches, score };
}

field('search').addEventListener('submit', async event => {
    event.preventDefault();
    if (!map || !token) return;
    const query = field('query').value.trim();
    if (!query) return;
    const sequence = ++searchSequence;
    const results = field('search-results');
    results.textContent = 'Searching…';

    const short = circuitName(query);
    const recordingName = circuitName(field('display-name').value.trim() || recording.display_name || '');
    const words = searchWords(short);
    const recordingWords = searchWords(recordingName);
    // When the input is a short version of the uploaded name, search for the full circuit name.
    const term = words.length && words.every((word, index) => word === recordingWords[index])
        && recordingWords.length > words.length ? recordingName : short;
    const searchBox = 'https://api.mapbox.com/search/searchbox/v1/forward';
    const geocoding = 'https://api.mapbox.com/search/geocode/v6/forward';

    function search(url, text, filters = {}) {
        const params = new URLSearchParams({ q: text, access_token: token, limit: '8', ...filters });
        return requestJson(`${url}?${params}`).then(response => response.features || []);
    }

    try {
        const lookups = await Promise.allSettled([
            search(searchBox, term, { types: 'poi', poi_category: 'racetrack' }),
            search(searchBox, term),
        ]);
        const describe = feature => describeSearchResult(feature, searchWords(term));
        const hits = lookups.flatMap(lookup => lookup.status === 'fulfilled' ? lookup.value.map(describe) : []);
        if (!hits.some(hit => hit.raceway && hit.matches > 0) && !/\b(?:circuit|raceway|racetrack|speedway)\b/i.test(term)) {
            try {
                const tracks = await search(searchBox, `${term} circuit`, { types: 'poi' });
                hits.push(...tracks.map(describe).filter(hit => hit.raceway && hit.matches > 0));
            } catch {
                // A place result can still be useful if the circuit-specific lookup fails.
            }
        }
        if (!hits.length) hits.push(...(await search(geocoding, short)).map(describe));
        if (sequence !== searchSequence) return;

        results.replaceChildren();
        const shown = new Set();
        hits.sort((left, right) => right.score - left.score);
        for (const { feature, name, raceway } of hits) {
            if (feature.geometry.type !== 'Point') continue;
            const properties = feature.properties;
            const address = properties.full_address || properties.place_formatted;
            const key = properties.mapbox_id || `${name}:${feature.geometry.coordinates}`;
            if (shown.has(key)) continue;
            shown.add(key);
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'list-group-item list-group-item-action';
            button.textContent = [name, raceway && 'Raceway', address !== name && address].filter(Boolean).join(' · ');
            button.addEventListener('click', () => {
                if (!placed) {
                    anchor = map.getCenter().wrap();
                    setPlacementMode(true);
                }
                const bounds = properties.bbox || feature.bbox;
                if (raceway && bounds && bounds.length === 4) {
                    map.fitBounds([[bounds[0], bounds[1]], [bounds[2], bounds[3]]], { padding: 60, maxZoom: 15 });
                } else {
                    map.flyTo({ center: feature.geometry.coordinates, zoom: 15 });
                }
                results.replaceChildren();
            });
            results.append(button);
            if (shown.size >= 7) break;
        }
        if (!shown.size) results.textContent = 'No matches. Try the circuit name or a nearby town.';
    } catch {
        if (sequence === searchSequence) results.textContent = 'Search unavailable. You can still browse the map.';
    }
});

field('alignment').addEventListener('submit', async event => {
    event.preventDefault();
    if (field('save').disabled) return;
    const form = new FormData();
    form.append('game', recording.game);
    form.append('track', field('track-name').value);
    form.append('display_name', field('display-name').value.trim());
    form.append('alignment', JSON.stringify(alignment()));
    if (uploadedFile) form.append('recording', uploadedFile);
    const options = { method: 'POST', body: form };
    saving = true;
    updateOutline();
    try {
        let saved;
        try {
            saved = await requestJson(helper.dataset.saveUrl, options);
        } catch (error) {
            if (!error.replaceRequired) throw error;
            if (!window.confirm(error.message)) return;
            form.append('replace', 'yes');
            saved = await requestJson(helper.dataset.saveUrl, options);
        }
        uploadedFile = null;
        window.history.replaceState(null, '', saved.url);
        showStatus(`Saved ${saved.point_count.toLocaleString()} reference points.`, 'success');
    } catch (error) {
        showStatus(error.message);
    } finally {
        saving = false;
        updateOutline();
    }
});

if (helper.dataset.recordingUrl) {
    requestJson(helper.dataset.recordingUrl)
        .then(saved => openRecording(saved.recording, helper.dataset.track, saved.display_name, saved.alignment, 0, saved.yaw_profile))
        .catch(error => showStatus(error.message));
}

const upload = field('uploaded-recording');
if (upload) {
    const { file, recording, track_key, display_name, yaw, yaw_profile } = JSON.parse(upload.textContent);
    upload.remove();
    const bytes = Uint8Array.from(atob(file), character => character.charCodeAt(0));
    uploadedFile = new File([bytes], 'simhub-recording.shtl');
    openRecording(recording, track_key, display_name, null, yaw, yaw_profile)
        .catch(error => showStatus(error.message));
} else if (helper.dataset.catalogUrl) {
    importRecording(async () => {
        const response = await fetch(helper.dataset.catalogUrl);
        if (!response.ok) {
            throw new Error('This recording is unavailable. Refresh the recordings list and select it again.');
        }
        return new File([await response.blob()], 'simhub-recording.shtl');
    });
}
