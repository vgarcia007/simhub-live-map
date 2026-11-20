'use strict';

const modal = document.getElementById('track-preview');
const canvas = document.getElementById('preview-path');
const title = document.getElementById('preview-title');
const message = document.getElementById('preview-status');
let pending;

function drawPath(preview) {
    const ctx = canvas.getContext('2d');
    const { width, height } = canvas;
    const points = preview.segments.flat();
    const xs = points.map(([x]) => x);
    const ys = points.map(([, y]) => y);
    const left = Math.min(...xs);
    const bottom = Math.min(...ys);
    const spanX = Math.max(...xs) - left;
    const spanY = Math.max(...ys) - bottom;
    const scale = Math.min((width - 64) / spanX, (height - 64) / spanY);
    const project = ([x, y]) => [
        (width - spanX * scale) / 2 + (x - left) * scale,
        (height + spanY * scale) / 2 - (y - bottom) * scale,
    ];

    ctx.fillStyle = '#131a21';
    ctx.fillRect(0, 0, width, height);
    ctx.strokeStyle = '#40eaff';
    ctx.lineWidth = 3;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    for (const segment of preview.segments) {
        ctx.beginPath();
        ctx.moveTo(...project(segment[0]));
        for (const point of segment.slice(1)) ctx.lineTo(...project(point));
        ctx.stroke();
    }

    function mark(point, color) {
        ctx.beginPath();
        ctx.arc(...project(point), 6, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.fill();
    }

    if (!preview.closed) mark(points[points.length - 1], '#ff9e64');
    mark(points[0], '#6ceb9c');
}

modal.addEventListener('show.bs.modal', async event => {
    if (pending) pending.abort();
    const controller = new AbortController();
    pending = controller;
    const button = event.relatedTarget;
    title.textContent = `${button.dataset.trackName} · ${button.dataset.source}`;
    canvas.hidden = true;
    message.textContent = 'Loading the recorded path…';
    try {
        const response = await fetch(button.dataset.previewUrl, { signal: controller.signal });
        if (!response.ok) throw new Error('Preview unavailable. Refresh the list and try again.');
        const preview = await response.json();
        if (controller.signal.aborted) return;
        drawPath(preview);
        canvas.hidden = false;
        const state = preview.closed ? 'Closed loop' : preview.has_gaps ? 'Open with gaps' : 'Open path';
        const endpoints = preview.closed ? 'Green marks start/finish.' : 'Green marks the start. Orange marks the finish.';
        message.textContent = `${state} · ${preview.axis} projection. ${endpoints}`;
    } catch (error) {
        if (!controller.signal.aborted) message.textContent = error.message;
    }
});

modal.addEventListener('hide.bs.modal', () => {
    if (pending) pending.abort();
});
