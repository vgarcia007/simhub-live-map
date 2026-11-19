'use strict';

const degreesPerMeter = 180 / (Math.PI * 6378137);
const radians = Math.PI / 180;

function samplePath(segments) {
    const edges = [];
    let length = 0;
    for (const segment of segments) {
        for (let index = 1; index < segment.length; index++) {
            const [x, y] = segment[index - 1];
            const dx = segment[index][0] - x;
            const dy = segment[index][1] - y;
            const size = Math.hypot(dx, dy);
            if (size > 0) {
                edges.push({ x, y, dx, dy, size, start: length });
                length += size;
            }
        }
    }
    if (length === 0) return [];
    const count = Math.min(240, Math.max(16, Math.ceil(length / 5)));
    const samples = [];
    let index = 0;
    for (let sample = 0; sample < count; sample++) {
        const distance = (sample + 0.5) * length / count;
        while (distance > edges[index].start + edges[index].size) index++;
        const edge = edges[index];
        const fraction = (distance - edge.start) / edge.size;
        samples.push([edge.x + fraction * edge.dx, edge.y + fraction * edge.dy]);
    }
    return samples;
}

function indexSegments(lines, radius, cellSize) {
    const cells = new Map();
    const limit = Math.ceil(radius / cellSize);
    for (const line of lines) {
        for (let index = 1; index < line.length; index++) {
            const [x, y] = line[index - 1];
            const [nextX, nextY] = line[index];
            const dx = nextX - x;
            const dy = nextY - y;
            const lengthSquared = dx * dx + dy * dy;
            if (lengthSquared === 0) continue;
            const left = Math.max(-limit, Math.floor(Math.min(x, nextX) / cellSize) - 1);
            const right = Math.min(limit, Math.floor(Math.max(x, nextX) / cellSize) + 1);
            const bottom = Math.max(-limit, Math.floor(Math.min(y, nextY) / cellSize) - 1);
            const top = Math.min(limit, Math.floor(Math.max(y, nextY) / cellSize) + 1);
            const segment = { x, y, dx, dy, lengthSquared };
            for (let column = left; column <= right; column++) {
                for (let row = bottom; row <= top; row++) {
                    const key = `${column},${row}`;
                    if (!cells.has(key)) cells.set(key, []);
                    cells.get(key).push(segment);
                }
            }
        }
    }
    return cells;
}

function nearestDistance(x, y, cells, reach) {
    const segments = cells.get(`${Math.floor(x / reach)},${Math.floor(y / reach)}`) || [];
    let nearest = reach * reach;
    for (const edge of segments) {
        const offsetX = x - edge.x;
        const offsetY = y - edge.y;
        const fraction = Math.max(0, Math.min(1, (offsetX * edge.dx + offsetY * edge.dy) / edge.lengthSquared));
        const dx = offsetX - edge.dx * fraction;
        const dy = offsetY - edge.dy * fraction;
        nearest = Math.min(nearest, dx * dx + dy * dy);
    }
    return Math.sqrt(nearest);
}

function bestFit({ outline, raceways, latitude, longitude }) {
    const cosLatitude = Math.cos(latitude * radians);
    const local = ([lng, lat]) => [(lng - longitude) * cosLatitude / degreesPerMeter, (lat - latitude) / degreesPerMeter];
    const samples = samplePath(outline.map(segment => segment.map(local)));
    if (!samples.length) throw new Error('The recording has no continuous sections to fit.');

    const radius = Math.max(...samples.map(([x, y]) => Math.hypot(x, y)));
    const reach = Math.max(22, Math.min(95, radius * 0.13));
    const maxShift = Math.max(25, Math.min(220, radius * 0.25));
    const maxTurn = 15;
    const maxScaleChange = Math.log(1.25);
    const cells = indexSegments(raceways.map(line => line.map(local)), radius * 1.25 + maxShift, reach);
    if (!cells.size) throw new Error('No mapped raceway is close to this outline.');

    const tolerance = Math.min(25, reach * 0.55);
    function evaluate([east, north, angle, logScale]) {
        const scale = Math.exp(logScale);
        const cosine = Math.cos(angle * radians) * scale;
        const sine = Math.sin(angle * radians) * scale;
        let loss = 0;
        let matches = 0;
        for (const [x, y] of samples) {
            const distance = nearestDistance(east + cosine * x - sine * y, north + sine * x + cosine * y, cells, reach);
            loss += distance < tolerance ? distance * distance / (2 * tolerance) : distance - tolerance / 2;
            if (distance < tolerance) matches++;
        }
        return {
            loss: loss / samples.length,
            coverage: matches / samples.length,
        };
    }

    let position = [0, 0, 0, 0];
    const initial = evaluate(position);
    let best = initial;
    // Progress from coarse moves to sub-metre adjustments around the current alignment.
    for (let level = 0; level < 7; level++) {
        const factor = 2 ** -level;
        const steps = [maxShift / 2, maxShift / 2, maxTurn / 2, maxScaleChange / 2];
        for (let pass = 0; pass < 5; pass++) {
            let improved = false;
            for (let axis = 0; axis < steps.length; axis++) {
                const origin = position;
                for (const direction of [-1, 1]) {
                    const candidate = [...origin];
                    candidate[axis] += direction * steps[axis] * factor;
                    const [east, north, turn, scale] = candidate;
                    if (Math.hypot(east, north) > maxShift || Math.abs(turn) > maxTurn || Math.abs(scale) > maxScaleChange) continue;
                    const result = evaluate(candidate);
                    if (result.loss + 0.0001 < best.loss) {
                        best = result;
                        position = candidate;
                        improved = true;
                    }
                }
            }
            if (!improved) break;
        }
    }

    if (best.coverage < 0.35) throw new Error('Too little of the outline matches a raceway. Align it closer first.');
    if (initial.loss - best.loss < 0.2) return { changed: false };
    const [east, north, rotation, logScale] = position;
    return {
        changed: true,
        latitude: latitude + north * degreesPerMeter,
        longitude: longitude + east * degreesPerMeter / cosLatitude,
        rotation,
        scale: Math.exp(logScale),
        coverage: best.coverage,
        tolerance,
    };
}

self.onmessage = event => {
    try {
        self.postMessage(bestFit(event.data));
    } catch (error) {
        self.postMessage({ error: error.message });
    }
};
