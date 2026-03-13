const canvas = document.getElementById("scene");
const ctx = canvas.getContext("2d");
const videoPlayer = document.getElementById("videoPlayer");
const audioPlayer = document.getElementById("audioPlayer");

const state = {
    elapsed: 0,
    previousFrameAt: 0,
    currentModeIndex: 0,
    targetModeIndex: 0,
    transitionStart: 0,
    transitionDuration: 4.2,
    switchInterval: 14,
    lastSwitchAt: 0,
    seed: Math.random() * 1000,
    recentModeIndices: [0],
    modeQueue: []
};

const mediaState = {
    objectUrl: null,
    type: null
};

const audioState = {
    context: null,
    analyser: null,
    bins: null,
    audioSource: null,
    videoSource: null,
    destinationConnected: false,
    ready: false,
    bass: 0,
    mid: 0,
    treble: 0,
    level: 0,
    slowLevel: 0,
    beat: 0
};

const TAU = Math.PI * 2;

function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}

function fract(value) {
    return value - Math.floor(value);
}

function smooth(value) {
    return value < 0.5
        ? 4 * value * value * value
        : 1 - Math.pow(-2 * value + 2, 3) / 2;
}

function seededUnit(seed) {
    return fract(Math.sin(seed * 127.1 + 311.7) * 43758.5453123);
}

function seededSigned(seed) {
    return seededUnit(seed) * 2 - 1;
}

function traceHorizontalPath(startX, endX, step, getY) {
    let started = false;
    ctx.beginPath();

    for (let x = startX; x <= endX; x += step) {
        const y = getY(x);
        if (!started) {
            ctx.moveTo(x, y);
            started = true;
        } else {
            ctx.lineTo(x, y);
        }
    }
}

function sampleSpectrum(position) {
    const p = clamp(position, 0, 1);

    if (audioState.ready && audioState.bins?.length) {
        const index = Math.min(
            audioState.bins.length - 1,
            Math.floor(p * (audioState.bins.length - 1))
        );
        return audioState.bins[index] / 255;
    }

    const fallback =
        0.3 +
        Math.sin(state.elapsed * (1.2 + p * 1.8) + p * 17.2) * 0.12 +
        Math.cos(state.elapsed * (0.55 + p * 1.2) + p * 9.4) * 0.08 +
        p * 0.12;
    return clamp(fallback, 0, 1);
}

function rotatePoint3D(x, y, z, rotationX, rotationY, rotationZ) {
    let nextX = x;
    let nextY = y;
    let nextZ = z;

    let cos = Math.cos(rotationX);
    let sin = Math.sin(rotationX);
    let rotatedY = nextY * cos - nextZ * sin;
    let rotatedZ = nextY * sin + nextZ * cos;
    nextY = rotatedY;
    nextZ = rotatedZ;

    cos = Math.cos(rotationY);
    sin = Math.sin(rotationY);
    let rotatedX = nextX * cos + nextZ * sin;
    rotatedZ = -nextX * sin + nextZ * cos;
    nextX = rotatedX;
    nextZ = rotatedZ;

    cos = Math.cos(rotationZ);
    sin = Math.sin(rotationZ);
    rotatedX = nextX * cos - nextY * sin;
    rotatedY = nextX * sin + nextY * cos;

    return {
        x: rotatedX,
        y: rotatedY,
        z: nextZ
    };
}

function projectPoint3D(x, y, z, cameraDistance = 720) {
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    const depth = z + cameraDistance;
    if (depth <= 40) {
        return null;
    }

    const scale = cameraDistance / depth;
    return {
        x: width * 0.5 + x * scale,
        y: height * 0.5 + y * scale,
        scale,
        depth
    };
}

function depthFade(depth, near, far) {
    return clamp((far - depth) / Math.max(1, far - near), 0, 1);
}

function drawProjectedPolygon(points, strokeStyle, lineWidth, alphaScale = 1) {
    if (points.some((point) => !point)) {
        return;
    }

    ctx.strokeStyle = strokeStyle;
    ctx.lineWidth = lineWidth;
    ctx.globalAlpha *= alphaScale;
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);

    for (let i = 1; i < points.length; i += 1) {
        ctx.lineTo(points[i].x, points[i].y);
    }

    ctx.closePath();
    ctx.stroke();
    ctx.globalAlpha /= alphaScale;
}

const CUBE_VERTICES = [
    [-1, -1, -1],
    [1, -1, -1],
    [1, 1, -1],
    [-1, 1, -1],
    [-1, -1, 1],
    [1, -1, 1],
    [1, 1, 1],
    [-1, 1, 1]
];

const CUBE_EDGES = [
    [0, 1],
    [1, 2],
    [2, 3],
    [3, 0],
    [4, 5],
    [5, 6],
    [6, 7],
    [7, 4],
    [0, 4],
    [1, 5],
    [2, 6],
    [3, 7]
];

function resizeCanvas() {
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.floor(window.innerWidth * ratio);
    canvas.height = Math.floor(window.innerHeight * ratio);
    canvas.style.width = `${window.innerWidth}px`;
    canvas.style.height = `${window.innerHeight}px`;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
}

function getBass() {
    if (audioState.ready) {
        return audioState.bass;
    }
    return 0.28 + Math.sin(state.elapsed * 0.9) * 0.08;
}

function getMid() {
    if (audioState.ready) {
        return audioState.mid;
    }
    return 0.24 + Math.sin(state.elapsed * 0.55 + 1.2) * 0.07;
}

function getTreble() {
    if (audioState.ready) {
        return audioState.treble;
    }
    return 0.2 + Math.cos(state.elapsed * 1.1 + 0.5) * 0.06;
}

function getLevel() {
    if (audioState.ready) {
        return audioState.level;
    }
    return 0.26 + Math.sin(state.elapsed * 0.8) * 0.06;
}

function getBeat() {
    if (audioState.ready) {
        return audioState.beat;
    }
    return Math.max(0, Math.sin(state.elapsed * 0.6)) * 0.08;
}

function fillBackground(time) {
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    const bass = getBass();
    const level = getLevel();
    const hue = 220 + Math.sin(time * 0.05) * 26 + bass * 34;
    const videoAlpha = mediaState.type === "video" ? 0.05 + level * 0.06 : 0.13;

    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = 1;
    ctx.fillStyle = `rgba(3, 5, 10, ${videoAlpha})`;
    ctx.fillRect(0, 0, width, height);

    const gradient = ctx.createLinearGradient(0, 0, width, height);
    gradient.addColorStop(0, `hsla(${(hue + 314) % 360}, 45%, 8%, ${0.34 + bass * 0.14})`);
    gradient.addColorStop(0.5, `hsla(${(hue + 18) % 360}, 52%, 10%, ${0.24 + level * 0.12})`);
    gradient.addColorStop(1, `hsla(${(hue + 90) % 360}, 40%, 8%, ${0.28 + getTreble() * 0.12})`);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);
}

async function ensureAudioGraph(element) {
    if (!audioState.context) {
        audioState.context = new window.AudioContext();
        audioState.analyser = audioState.context.createAnalyser();
        audioState.analyser.fftSize = 1024;
        audioState.bins = new Uint8Array(audioState.analyser.frequencyBinCount);
    }

    if (!audioState.destinationConnected) {
        audioState.analyser.connect(audioState.context.destination);
        audioState.destinationConnected = true;
    }

    if (element === audioPlayer && !audioState.audioSource) {
        audioState.audioSource = audioState.context.createMediaElementSource(audioPlayer);
        audioState.audioSource.connect(audioState.analyser);
    }

    if (element === videoPlayer && !audioState.videoSource) {
        audioState.videoSource = audioState.context.createMediaElementSource(videoPlayer);
        audioState.videoSource.connect(audioState.analyser);
    }

    if (audioState.context.state === "suspended") {
        await audioState.context.resume();
    }
}

function clearMedia() {
    if (mediaState.objectUrl) {
        URL.revokeObjectURL(mediaState.objectUrl);
        mediaState.objectUrl = null;
    }

    mediaState.type = null;
    audioState.ready = false;
    videoPlayer.pause();
    videoPlayer.removeAttribute("src");
    videoPlayer.load();
    audioPlayer.pause();
    audioPlayer.removeAttribute("src");
    audioPlayer.load();
    document.body.classList.remove("has-video");
}

async function loadMediaFile(file) {
    if (!file) {
        return;
    }

    clearMedia();
    mediaState.objectUrl = URL.createObjectURL(file);

    if (file.type.startsWith("video/")) {
        mediaState.type = "video";
        videoPlayer.src = mediaState.objectUrl;
        document.body.classList.add("has-video");
        await ensureAudioGraph(videoPlayer);
        await videoPlayer.play();
        audioState.ready = true;
        return;
    }

    if (file.type.startsWith("audio/")) {
        mediaState.type = "audio";
        audioPlayer.src = mediaState.objectUrl;
        await ensureAudioGraph(audioPlayer);
        await audioPlayer.play();
        audioState.ready = true;
    }
}

function updateAudioData() {
    if (!audioState.ready || !audioState.analyser || !audioState.bins) {
        audioState.bass = 0;
        audioState.mid = 0;
        audioState.treble = 0;
        audioState.level = 0;
        audioState.slowLevel = 0;
        audioState.beat = 0;
        return;
    }

    audioState.analyser.getByteFrequencyData(audioState.bins);
    const length = audioState.bins.length;
    const lowEnd = Math.floor(length * 0.12);
    const midEnd = Math.floor(length * 0.45);
    let bass = 0;
    let mid = 0;
    let treble = 0;

    for (let i = 0; i < length; i += 1) {
        const value = audioState.bins[i] / 255;
        if (i < lowEnd) {
            bass += value;
        } else if (i < midEnd) {
            mid += value;
        } else {
            treble += value;
        }
    }

    bass /= Math.max(1, lowEnd);
    mid /= Math.max(1, midEnd - lowEnd);
    treble /= Math.max(1, length - midEnd);

    const rawLevel = bass * 0.5 + mid * 0.32 + treble * 0.18;
    audioState.slowLevel += (rawLevel - audioState.slowLevel) * 0.08;
    const transient = Math.max(0, rawLevel - audioState.slowLevel);

    audioState.bass += (bass - audioState.bass) * 0.24;
    audioState.mid += (mid - audioState.mid) * 0.22;
    audioState.treble += (treble - audioState.treble) * 0.28;
    audioState.level += (rawLevel - audioState.level) * 0.32;
    audioState.beat = clamp(audioState.beat * 0.82 + transient * 3.8, 0, 1.35);
}

function drawAurora(time, alpha) {
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    const ribbons = 7;
    const bass = getBass();
    const beat = getBeat();
    const mid = getMid();
    ctx.globalAlpha = alpha;
    ctx.globalCompositeOperation = "screen";

    for (let band = 0; band < ribbons; band += 1) {
        const hue = (210 + band * 22 + time * (3 + bass * 12)) % 360;
        ctx.strokeStyle = `hsla(${hue}, 90%, ${72 - band * 3}%, ${0.06 + band * 0.018 + beat * 0.03})`;
        ctx.lineWidth = 26 + band * 12 + bass * 16;

        traceHorizontalPath(-20, width + 20, 16, (x) => {
            const nx = x / width;
            return (
                height * (0.16 + band * 0.11) +
                Math.sin(nx * 7 + time * (0.18 + band * 0.02 + bass * 0.06)) * (42 + band * 14 + bass * 46) +
                Math.cos(nx * 11 - time * (0.1 + band * 0.015 + mid * 0.05)) * (18 + band * 4 + beat * 18)
            );
        });

        ctx.stroke();
    }
}

function drawBloom(time, alpha) {
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    const blobs = 11;
    const bass = getBass();
    const mid = getMid();
    ctx.globalAlpha = alpha;
    ctx.globalCompositeOperation = "lighter";

    for (let i = 0; i < blobs; i += 1) {
        const orbit = time * (0.05 + i * 0.01 + mid * 0.04) + i * 1.3;
        const cx = width * (0.5 + Math.sin(orbit * 0.7) * (0.12 + i * 0.015 + bass * 0.03));
        const cy = height * (0.5 + Math.cos(orbit * 0.9) * (0.1 + i * 0.012 + mid * 0.03));
        const radius =
            Math.min(width, height) *
            (0.16 + i * 0.018 + Math.sin(time * (0.1 + bass * 0.08) + i) * 0.01 + bass * 0.04);
        const hue = (228 + i * 15 + time * (4 + mid * 14)) % 360;
        const gradient = ctx.createRadialGradient(cx, cy, radius * 0.08, cx, cy, radius);
        gradient.addColorStop(0, `hsla(${hue}, 95%, 78%, ${0.14 + bass * 0.16})`);
        gradient.addColorStop(0.46, `hsla(${(hue + 26) % 360}, 85%, 66%, ${0.06 + mid * 0.08})`);
        gradient.addColorStop(1, `hsla(${(hue + 70) % 360}, 80%, 24%, 0)`);
        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.arc(cx, cy, radius, 0, TAU);
        ctx.fill();
    }
}

function drawHalo(time, alpha) {
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    const rings = 8;
    const beat = getBeat();
    const bass = getBass();
    ctx.globalAlpha = alpha;
    ctx.globalCompositeOperation = "screen";

    for (let i = 0; i < rings; i += 1) {
        const phase = ((time * (0.03 + bass * 0.05)) + i / rings) % 1;
        const depth = 1 - phase;
        const radius = Math.max(20, Math.min(width, height) * (0.12 + depth * 0.5 + beat * 0.06));
        const hue = (200 + i * 18 + time * (5 + bass * 16)) % 360;
        ctx.strokeStyle = `hsla(${hue}, 100%, ${76 - i * 4}%, ${alpha * (0.02 + depth * 0.11 + beat * 0.04)})`;
        ctx.lineWidth = 1 + depth * 6 + beat * 7;
        ctx.beginPath();
        ctx.arc(width * 0.5, height * 0.5, radius, 0, TAU);
        ctx.stroke();
    }
}

function drawPetals(time, alpha) {
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    const count = 220;
    const treble = getTreble();
    const beat = getBeat();
    ctx.globalAlpha = alpha;
    ctx.globalCompositeOperation = "lighter";

    for (let i = 0; i < count; i += 1) {
        const seed = state.seed + i * 17.29;
        const drift = seededUnit(seed);
        const speed = 0.006 + drift * 0.01 + treble * 0.024;
        const phase = fract(drift + time * speed);
        const x = width * fract(Math.cos(seed * 0.78) * 21654.47);
        const y = height + 40 - phase * (height + 80);
        const sway = Math.sin(time * (0.24 + treble * 0.16) + drift * 8) * (18 + drift * 60 + beat * 40);
        const size = 1 + drift * 3.8 + treble * 2.8;
        const hue = (210 + drift * 120 + time * (2.5 + treble * 12)) % 360;
        ctx.fillStyle = `hsla(${hue}, 100%, 82%, ${0.03 + drift * 0.06 + beat * 0.03})`;
        ctx.beginPath();
        ctx.ellipse(x + sway, y, size * 1.5, size, drift * TAU, 0, TAU);
        ctx.fill();
    }
}

function drawSilk(time, alpha) {
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    const layers = 6;
    const mid = getMid();
    const bass = getBass();
    ctx.globalAlpha = alpha;
    ctx.globalCompositeOperation = "screen";

    for (let i = 0; i < layers; i += 1) {
        const hue = (250 + i * 24 + time * (4 + mid * 12)) % 360;
        ctx.strokeStyle = `hsla(${hue}, 100%, ${74 - i * 4}%, ${0.06 + i * 0.018 + mid * 0.03})`;
        ctx.lineWidth = 14 + i * 8 + bass * 10;

        traceHorizontalPath(-20, width + 20, 12, (x) => {
            const nx = x / width;
            return (
                height * 0.52 +
                Math.sin(nx * 5 + time * (0.16 + i * 0.02 + bass * 0.08) + i) * (52 + i * 14 + bass * 42) +
                Math.cos(nx * 13 - time * (0.08 + i * 0.015 + mid * 0.05)) * (14 + i * 6 + mid * 24)
            );
        });

        ctx.stroke();
    }
}

function drawDrift(time, alpha) {
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    const motes = 160;
    const treble = getTreble();
    const level = getLevel();
    ctx.globalAlpha = alpha;
    ctx.globalCompositeOperation = "screen";

    for (let i = 0; i < motes; i += 1) {
        const seed = state.seed * 0.7 + i * 9.13;
        const px = seededUnit(seed * 1.13);
        const py = seededUnit(seed * 0.91 + 17);
        const x = width * px + Math.sin(time * (0.09 + treble * 0.2) + i) * (24 + treble * 26);
        const y = height * py + Math.cos(time * (0.07 + treble * 0.15) + i * 0.3) * (28 + level * 30);
        const size = 1 + px * 5 + level * 3;
        const hue = (190 + py * 160 + time * (3 + treble * 10)) % 360;
        ctx.fillStyle = `hsla(${hue}, 100%, 80%, ${0.02 + px * 0.05 + level * 0.03})`;
        ctx.beginPath();
        ctx.arc(x, y, size, 0, TAU);
        ctx.fill();
    }
}

function drawPrism(time, alpha) {
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    const centerX = width * 0.5;
    const centerY = height * 0.5;
    const rays = 88;
    const bass = getBass();
    const mid = getMid();
    const beat = getBeat();
    const baseRadius = Math.min(width, height) * (0.08 + mid * 0.05);
    ctx.globalAlpha = alpha;
    ctx.globalCompositeOperation = "lighter";
    ctx.lineCap = "round";

    for (let i = 0; i < rays; i += 1) {
        const ratio = i / rays;
        const energy = sampleSpectrum(ratio);
        const angle = ratio * TAU + time * (0.12 + beat * 0.08) + Math.sin(time * 0.3 + ratio * 6) * 0.1;
        const outerRadius = Math.min(width, height) * (0.24 + energy * 0.42 + beat * 0.08);
        const hue = (180 + ratio * 170 + time * (8 + bass * 20)) % 360;
        ctx.strokeStyle = `hsla(${hue}, 100%, ${68 + energy * 18}%, ${0.05 + energy * 0.18 + beat * 0.04})`;
        ctx.lineWidth = 1 + energy * 4 + bass * 2;
        ctx.beginPath();
        ctx.moveTo(centerX + Math.cos(angle) * baseRadius, centerY + Math.sin(angle) * baseRadius);
        ctx.lineTo(centerX + Math.cos(angle) * outerRadius, centerY + Math.sin(angle) * outerRadius);
        ctx.stroke();
    }

    ctx.lineCap = "butt";
}

function drawVortex(time, alpha) {
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    const centerX = width * 0.5;
    const centerY = height * 0.5;
    const arms = 6;
    const points = 160;
    const turns = 5;
    const bass = getBass();
    const treble = getTreble();
    const beat = getBeat();
    const maxRadius = Math.min(width, height) * 0.44;
    ctx.globalAlpha = alpha;
    ctx.globalCompositeOperation = "screen";

    for (let arm = 0; arm < arms; arm += 1) {
        const hue = (205 + arm * 28 + time * (10 + treble * 24)) % 360;
        ctx.strokeStyle = `hsla(${hue}, 100%, ${68 + arm * 3}%, ${0.05 + beat * 0.05})`;
        ctx.lineWidth = 1.4 + arm * 0.4 + bass * 2;
        ctx.beginPath();

        for (let step = 0; step <= points; step += 1) {
            const progress = step / points;
            const spiralRadius = maxRadius * progress;
            const wobble = Math.sin(progress * 18 - time * (0.8 + bass * 2) + arm) * (12 + beat * 18) * (1 - progress);
            const angle =
                time * (0.45 + treble * 0.9) +
                arm * (TAU / arms) +
                progress * TAU * (turns + bass * 3);
            const x = centerX + Math.cos(angle) * (spiralRadius + wobble);
            const y = centerY + Math.sin(angle) * (spiralRadius + wobble);

            if (step === 0) {
                ctx.moveTo(x, y);
            } else {
                ctx.lineTo(x, y);
            }
        }

        ctx.stroke();
    }
}

function drawGridPulse(time, alpha) {
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    const columns = 18;
    const rows = 12;
    const bass = getBass();
    const mid = getMid();
    const beat = getBeat();
    ctx.globalAlpha = alpha;
    ctx.globalCompositeOperation = "screen";

    for (let i = 0; i <= columns; i += 1) {
        const ratio = i / columns;
        const x = width * ratio;
        const skew = Math.sin(time * (0.4 + mid) + i * 0.45) * (10 + beat * 24);
        ctx.strokeStyle = `hsla(${(195 + ratio * 80 + time * 6) % 360}, 100%, 72%, ${0.03 + bass * 0.04})`;
        ctx.lineWidth = 1 + (i % 3 === 0 ? 1 : 0) + bass * 2;
        ctx.beginPath();
        ctx.moveTo(x + skew, 0);
        ctx.lineTo(x - skew, height);
        ctx.stroke();
    }

    for (let i = 0; i <= rows; i += 1) {
        const ratio = i / rows;
        const y = height * ratio;
        const skew = Math.cos(time * (0.45 + bass) + i * 0.65) * (14 + beat * 20);
        ctx.strokeStyle = `hsla(${(240 + ratio * 70 + time * 5) % 360}, 95%, 70%, ${0.02 + mid * 0.05})`;
        ctx.lineWidth = 1 + (i % 2 === 0 ? 0.8 : 0) + mid * 2;
        ctx.beginPath();
        ctx.moveTo(0, y + skew);
        ctx.lineTo(width, y - skew);
        ctx.stroke();
    }
}

function drawNebula(time, alpha) {
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    const clouds = 9;
    const bass = getBass();
    const mid = getMid();
    const treble = getTreble();
    const baseRadius = Math.min(width, height);
    ctx.globalAlpha = alpha;
    ctx.globalCompositeOperation = "lighter";

    for (let i = 0; i < clouds; i += 1) {
        const seed = state.seed * 0.4 + i * 31.17;
        const px = 0.2 + seededUnit(seed) * 0.6;
        const py = 0.18 + seededUnit(seed + 4) * 0.64;
        const angle = time * (0.05 + seededUnit(seed + 8) * 0.04 + mid * 0.05) + i;
        const cx = width * px + Math.cos(angle) * (24 + bass * 50);
        const cy = height * py + Math.sin(angle * 1.1) * (24 + treble * 40);
        const radius = baseRadius * (0.16 + seededUnit(seed + 12) * 0.2 + bass * 0.08);
        const hue = (210 + seededUnit(seed + 16) * 120 + time * (5 + treble * 14)) % 360;
        const gradient = ctx.createRadialGradient(cx, cy, radius * 0.1, cx, cy, radius);
        gradient.addColorStop(0, `hsla(${hue}, 96%, 76%, ${0.08 + bass * 0.1})`);
        gradient.addColorStop(0.5, `hsla(${(hue + 36) % 360}, 88%, 58%, ${0.05 + mid * 0.08})`);
        gradient.addColorStop(1, `hsla(${(hue + 86) % 360}, 90%, 20%, 0)`);
        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.arc(cx, cy, radius, 0, TAU);
        ctx.fill();
    }
}

function drawRain(time, alpha) {
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    const streaks = 140;
    const treble = getTreble();
    const beat = getBeat();
    const level = getLevel();
    ctx.globalAlpha = alpha;
    ctx.globalCompositeOperation = "lighter";
    ctx.lineCap = "round";

    for (let i = 0; i < streaks; i += 1) {
        const seed = state.seed * 1.7 + i * 11.19;
        const lane = seededUnit(seed);
        const speed = 0.35 + lane * 0.75 + treble * 1.8;
        const phase = fract(lane + time * 0.12 * speed);
        const x = width * lane + Math.sin(time * 0.5 + i) * (10 + beat * 20);
        const length = 20 + seededUnit(seed + 3) * 70 + treble * 80;
        const y = phase * (height + length) - length;
        const hue = (190 + lane * 80 + time * 10) % 360;
        ctx.strokeStyle = `hsla(${hue}, 100%, ${72 + lane * 12}%, ${0.03 + level * 0.07})`;
        ctx.lineWidth = 1 + lane * 2 + beat * 2;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x - (8 + beat * 20), y + length);
        ctx.stroke();
    }

    ctx.lineCap = "butt";
}

function drawFan(time, alpha) {
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    const centerX = width * 0.5;
    const centerY = height * 0.5;
    const spokes = 18;
    const bass = getBass();
    const mid = getMid();
    const beat = getBeat();
    ctx.globalAlpha = alpha;
    ctx.globalCompositeOperation = "screen";

    for (let i = 0; i < spokes; i += 1) {
        const ratio = i / spokes;
        const energy = sampleSpectrum(ratio);
        const angle = time * (0.08 + mid * 0.18) + ratio * TAU;
        const spread = 0.12 + energy * 0.18;
        const radius = Math.min(width, height) * (0.24 + energy * 0.34 + bass * 0.12);
        const hue = (220 + ratio * 180 + time * (7 + beat * 16)) % 360;
        ctx.strokeStyle = `hsla(${hue}, 100%, ${70 + energy * 16}%, ${0.04 + energy * 0.08 + beat * 0.04})`;
        ctx.lineWidth = 6 + energy * 10;
        ctx.beginPath();
        ctx.arc(centerX, centerY, radius, angle - spread, angle + spread);
        ctx.stroke();
    }
}

function drawOrbitals(time, alpha) {
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    const centerX = width * 0.5;
    const centerY = height * 0.5;
    const rings = 5;
    const bass = getBass();
    const treble = getTreble();
    const beat = getBeat();
    const maxRadius = Math.min(width, height) * 0.36;
    ctx.globalAlpha = alpha;
    ctx.globalCompositeOperation = "lighter";

    for (let ring = 0; ring < rings; ring += 1) {
        const radius = maxRadius * (0.28 + ring * 0.17 + bass * 0.04);
        const hue = (200 + ring * 30 + time * 12) % 360;
        ctx.strokeStyle = `hsla(${hue}, 100%, 74%, ${0.02 + beat * 0.03})`;
        ctx.lineWidth = 1 + beat * 2;
        ctx.beginPath();
        ctx.arc(centerX, centerY, radius, 0, TAU);
        ctx.stroke();

        const particles = 10 + ring * 2;
        for (let i = 0; i < particles; i += 1) {
            const ratio = i / particles;
            const direction = ring % 2 === 0 ? 1 : -1;
            const angle = time * (0.35 + ring * 0.08 + treble * 1.2) * direction + ratio * TAU;
            const energy = sampleSpectrum(fract(ratio + ring * 0.11));
            const x = centerX + Math.cos(angle) * radius;
            const y = centerY + Math.sin(angle) * radius;
            const size = 1.5 + ring * 0.7 + energy * 4 + beat * 2;
            ctx.fillStyle = `hsla(${(hue + i * 12) % 360}, 100%, ${72 + energy * 14}%, ${0.06 + energy * 0.08})`;
            ctx.beginPath();
            ctx.arc(x, y, size, 0, TAU);
            ctx.fill();
        }
    }
}

function drawLattice(time, alpha) {
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    const spacing = 28 + getLevel() * 24;
    const beat = getBeat();
    const bass = getBass();
    const lineCount = Math.ceil((width + height) / spacing) + 2;
    ctx.globalAlpha = alpha;
    ctx.globalCompositeOperation = "screen";

    for (let i = -1; i < lineCount; i += 1) {
        const offset = i * spacing + Math.sin(time * 0.2 + i * 0.4) * (10 + beat * 26);
        ctx.strokeStyle = `hsla(${(205 + i * 8 + time * 5) % 360}, 100%, 72%, ${0.02 + bass * 0.05})`;
        ctx.lineWidth = 1 + bass * 1.8;
        ctx.beginPath();
        ctx.moveTo(offset, 0);
        ctx.lineTo(offset + height, height);
        ctx.stroke();

        ctx.strokeStyle = `hsla(${(250 + i * 10 + time * 6) % 360}, 96%, 70%, ${0.02 + beat * 0.04})`;
        ctx.beginPath();
        ctx.moveTo(offset, height);
        ctx.lineTo(offset + height, 0);
        ctx.stroke();
    }
}

function drawMirage(time, alpha) {
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    const bands = 24;
    const level = getLevel();
    const treble = getTreble();
    const mid = getMid();
    ctx.globalAlpha = alpha;
    ctx.globalCompositeOperation = "screen";

    for (let i = 0; i < bands; i += 1) {
        const ratio = i / Math.max(1, bands - 1);
        const yBase = height * ratio;
        const amplitude = 8 + i * 1.1 + level * 24;
        const hue = (185 + ratio * 110 + time * (4 + treble * 10)) % 360;
        ctx.strokeStyle = `hsla(${hue}, 100%, ${70 + ratio * 12}%, ${0.03 + mid * 0.04})`;
        ctx.lineWidth = 1.5 + (i % 4 === 0 ? 1.5 : 0) + level * 1.5;

        traceHorizontalPath(-20, width + 20, 12, (x) => {
            const nx = x / width;
            return (
                yBase +
                Math.sin(nx * TAU * (1.5 + ratio * 5) + time * (0.8 + treble * 1.6) + i) * amplitude * 0.18 +
                Math.cos(nx * TAU * (0.9 + ratio * 4) - time * (0.45 + mid) + i * 0.7) * amplitude * 0.12
            );
        });

        ctx.stroke();
    }
}

function drawComets(time, alpha) {
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    const comets = 30;
    const bass = getBass();
    const treble = getTreble();
    const beat = getBeat();
    ctx.globalAlpha = alpha;
    ctx.globalCompositeOperation = "lighter";
    ctx.lineCap = "round";

    for (let i = 0; i < comets; i += 1) {
        const seed = state.seed * 1.3 + i * 23.91;
        const lane = seededUnit(seed);
        const laneY = 0.12 + seededUnit(seed + 5) * 0.76;
        const speed = 0.04 + lane * 0.05 + bass * 0.08;
        const phase = fract(lane + time * speed);
        const x = -width * 0.1 + phase * (width * 1.2);
        const y = height * laneY + Math.sin(time * 0.8 + i) * (10 + beat * 30);
        const tail = 24 + seededUnit(seed + 2) * 90 + treble * 100;
        const angle = -0.35 + seededSigned(seed + 7) * 0.15;
        const dx = Math.cos(angle) * tail;
        const dy = Math.sin(angle) * tail;
        const hue = (195 + lane * 150 + time * 8) % 360;
        ctx.strokeStyle = `hsla(${hue}, 100%, 78%, ${0.04 + treble * 0.08})`;
        ctx.lineWidth = 1.5 + lane * 2 + beat * 2;
        ctx.beginPath();
        ctx.moveTo(x - dx, y - dy);
        ctx.lineTo(x, y);
        ctx.stroke();
        ctx.fillStyle = `hsla(${(hue + 20) % 360}, 100%, 88%, ${0.08 + beat * 0.06})`;
        ctx.beginPath();
        ctx.arc(x, y, 2 + lane * 2 + beat * 2, 0, TAU);
        ctx.fill();
    }

    ctx.lineCap = "butt";
}

function drawRippleField(time, alpha) {
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    const sources = 6;
    const rings = 6;
    const bass = getBass();
    const mid = getMid();
    const beat = getBeat();
    ctx.globalAlpha = alpha;
    ctx.globalCompositeOperation = "screen";

    for (let source = 0; source < sources; source += 1) {
        const seed = state.seed * 0.6 + source * 41.2;
        const cx = width * (0.15 + seededUnit(seed) * 0.7 + Math.sin(time * 0.05 + source) * 0.05);
        const cy = height * (0.15 + seededUnit(seed + 1) * 0.7 + Math.cos(time * 0.04 + source) * 0.05);

        for (let ring = 0; ring < rings; ring += 1) {
            const phase = fract(time * (0.04 + bass * 0.08) + ring / rings + seededUnit(seed + 2));
            const depth = 1 - phase;
            const radius = Math.min(width, height) * (0.04 + phase * 0.34 + ring * 0.02);
            const hue = (200 + source * 26 + ring * 12 + time * 9) % 360;
            ctx.strokeStyle = `hsla(${hue}, 100%, ${72 + ring * 2}%, ${0.015 + depth * 0.08 + beat * 0.03})`;
            ctx.lineWidth = 1 + depth * 5 + mid * 2;
            ctx.beginPath();
            ctx.arc(cx, cy, radius, 0, TAU);
            ctx.stroke();
        }
    }
}

function drawSpectrumRing(time, alpha) {
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    const centerX = width * 0.5;
    const centerY = height * 0.5;
    const segments = 96;
    const bass = getBass();
    const mid = getMid();
    const beat = getBeat();
    const baseRadius = Math.min(width, height) * 0.22;
    ctx.globalAlpha = alpha;
    ctx.globalCompositeOperation = "lighter";
    ctx.lineCap = "round";

    for (let i = 0; i < segments; i += 1) {
        const ratio = i / segments;
        const energy = sampleSpectrum(ratio);
        const angle = ratio * TAU + time * (0.12 + beat * 0.15);
        const inner = baseRadius + Math.sin(time * 0.6 + ratio * 12) * (8 + mid * 24);
        const outer = inner + 20 + energy * 90 + bass * 30;
        const hue = (190 + ratio * 220 + time * (9 + beat * 20)) % 360;
        ctx.strokeStyle = `hsla(${hue}, 100%, ${68 + energy * 18}%, ${0.05 + energy * 0.16})`;
        ctx.lineWidth = 1.5 + energy * 4;
        ctx.beginPath();
        ctx.moveTo(centerX + Math.cos(angle) * inner, centerY + Math.sin(angle) * inner);
        ctx.lineTo(centerX + Math.cos(angle) * outer, centerY + Math.sin(angle) * outer);
        ctx.stroke();
    }

    ctx.lineCap = "butt";
}

function drawTunnel(time, alpha) {
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    const layers = 14;
    const bass = getBass();
    const level = getLevel();
    const beat = getBeat();
    ctx.globalAlpha = alpha;
    ctx.globalCompositeOperation = "screen";

    for (let i = 0; i < layers; i += 1) {
        const phase = fract(time * (0.05 + level * 0.08) + i / layers);
        const depth = 1 - phase;
        const radiusX = width * (0.08 + depth * 0.4);
        const radiusY = height * (0.05 + depth * 0.24);
        const wobbleX = Math.sin(time * 0.7 + i) * (8 + beat * 30) * depth;
        const wobbleY = Math.cos(time * 0.5 + i * 0.6) * (6 + bass * 24) * depth;
        const hue = (205 + i * 18 + time * (7 + bass * 18)) % 360;
        ctx.strokeStyle = `hsla(${hue}, 100%, ${70 + depth * 10}%, ${0.02 + depth * 0.09})`;
        ctx.lineWidth = 1 + depth * 5 + beat * 2;
        ctx.beginPath();
        ctx.ellipse(
            width * 0.5 + wobbleX,
            height * 0.5 + wobbleY,
            radiusX,
            radiusY,
            time * 0.08 + i * 0.06,
            0,
            TAU
        );
        ctx.stroke();
    }
}

function drawParallaxBands(time, alpha) {
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    const bands = 9;
    const bass = getBass();
    const mid = getMid();
    const treble = getTreble();
    ctx.globalAlpha = alpha;
    ctx.globalCompositeOperation = "screen";

    for (let i = 0; i < bands; i += 1) {
        const depth = i / Math.max(1, bands - 1);
        const horizon = height * (0.28 + depth * 0.55);
        const amplitude = 20 + i * 10 + bass * 48;
        const hue = (200 + depth * 90 + time * (4 + mid * 10)) % 360;
        ctx.fillStyle = `hsla(${hue}, 85%, ${20 + depth * 26}%, ${0.04 + depth * 0.05})`;
        ctx.beginPath();

        for (let x = -40; x <= width + 40; x += 20) {
            const nx = x / width;
            const y =
                horizon +
                Math.sin(nx * (3.2 + depth * 6) + time * (0.18 + depth * 0.05 + bass * 0.08) + i) *
                    amplitude *
                    (0.5 + depth * 0.35) +
                Math.cos(nx * (7 + depth * 5) - time * (0.12 + treble * 0.18)) * amplitude * 0.18;

            if (x === -40) {
                ctx.moveTo(x, y);
            } else {
                ctx.lineTo(x, y);
            }
        }

        ctx.lineTo(width + 40, height + 40);
        ctx.lineTo(-40, height + 40);
        ctx.closePath();
        ctx.fill();
    }
}

function drawWireTunnel3D(time, alpha) {
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    const layers = 18;
    const bass = getBass();
    const treble = getTreble();
    const beat = getBeat();
    ctx.globalAlpha = alpha;
    ctx.globalCompositeOperation = "screen";

    for (let i = 0; i < layers; i += 1) {
        const travel = fract(time * (0.09 + bass * 0.11) + i / layers);
        const worldZ = 1800 - travel * 1720;
        const frameWidth = 220 + Math.sin(time * 0.8 + i) * 30 + bass * 180;
        const frameHeight = 140 + Math.cos(time * 0.65 + i * 0.7) * 24 + getMid() * 110;
        const roll = time * (0.12 + treble * 0.22) + i * 0.15;
        const offsetX = Math.sin(time * 0.5 + i * 0.6) * (18 + beat * 60);
        const offsetY = Math.cos(time * 0.44 + i * 0.5) * (14 + beat * 44);
        const corners = [
            rotatePoint3D(-frameWidth, -frameHeight, worldZ, 0, 0, roll),
            rotatePoint3D(frameWidth, -frameHeight, worldZ, 0, 0, roll),
            rotatePoint3D(frameWidth, frameHeight, worldZ, 0, 0, roll),
            rotatePoint3D(-frameWidth, frameHeight, worldZ, 0, 0, roll)
        ].map((point) => projectPoint3D(point.x + offsetX, point.y + offsetY, point.z));

        const fade = depthFade(worldZ, 40, 1800);
        const hue = (190 + i * 14 + time * (12 + treble * 18)) % 360;
        drawProjectedPolygon(
            corners,
            `hsla(${hue}, 100%, ${68 + fade * 16}%, ${0.05 + fade * 0.12 + beat * 0.04})`,
            1 + fade * 4 + bass * 2
        );

        if (i % 2 === 0) {
            const innerCorners = [
                rotatePoint3D(-frameWidth * 0.55, -frameHeight * 0.55, worldZ, 0, 0, -roll * 0.8),
                rotatePoint3D(frameWidth * 0.55, -frameHeight * 0.55, worldZ, 0, 0, -roll * 0.8),
                rotatePoint3D(frameWidth * 0.55, frameHeight * 0.55, worldZ, 0, 0, -roll * 0.8),
                rotatePoint3D(-frameWidth * 0.55, frameHeight * 0.55, worldZ, 0, 0, -roll * 0.8)
            ].map((point) => projectPoint3D(point.x + offsetX, point.y + offsetY, point.z));

            drawProjectedPolygon(
                innerCorners,
                `hsla(${(hue + 34) % 360}, 100%, 78%, ${0.03 + fade * 0.08})`,
                1 + fade * 2
            );
        }
    }

    ctx.strokeStyle = `hsla(${(210 + time * 10) % 360}, 100%, 76%, ${0.03 + beat * 0.05})`;
    ctx.lineWidth = 1 + beat * 2;
    ctx.beginPath();
    ctx.moveTo(width * 0.5, height * 0.24);
    ctx.lineTo(width * 0.5, height * 0.76);
    ctx.stroke();
}

function drawCubeField3D(time, alpha) {
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    const cubes = 8;
    const bass = getBass();
    const mid = getMid();
    const treble = getTreble();
    const beat = getBeat();
    ctx.globalAlpha = alpha;
    ctx.globalCompositeOperation = "lighter";

    for (let i = 0; i < cubes; i += 1) {
        const orbit = time * (0.28 + i * 0.018 + mid * 0.22) + i * 1.3;
        const centerX = Math.sin(orbit * 0.7) * (120 + i * 18 + bass * 90);
        const centerY = Math.cos(orbit * 0.9) * (90 + i * 12 + mid * 70);
        const centerZ = 420 + (i % 4) * 170 + Math.sin(time * 0.8 + i) * (50 + beat * 70);
        const size = 32 + i * 5 + bass * 26;
        const rotationX = time * (0.32 + treble * 0.2) + i * 0.4;
        const rotationY = time * (0.45 + bass * 0.24) + i * 0.6;
        const rotationZ = time * (0.24 + mid * 0.18) + i * 0.3;
        const projected = CUBE_VERTICES.map(([vx, vy, vz]) => {
            const rotated = rotatePoint3D(vx * size, vy * size, vz * size, rotationX, rotationY, rotationZ);
            return projectPoint3D(rotated.x + centerX, rotated.y + centerY, rotated.z + centerZ);
        });
        const fade = depthFade(centerZ, 260, 1200);
        const hue = (200 + i * 24 + time * (14 + bass * 20)) % 360;

        ctx.strokeStyle = `hsla(${hue}, 100%, ${72 + fade * 12}%, ${0.04 + fade * 0.1 + beat * 0.04})`;
        ctx.lineWidth = 1.2 + fade * 2.8 + beat * 1.5;

        for (const [fromIndex, toIndex] of CUBE_EDGES) {
            const from = projected[fromIndex];
            const to = projected[toIndex];
            if (!from || !to) {
                continue;
            }

            ctx.beginPath();
            ctx.moveTo(from.x, from.y);
            ctx.lineTo(to.x, to.y);
            ctx.stroke();
        }

        if (projected[6]) {
            ctx.fillStyle = `hsla(${(hue + 24) % 360}, 100%, 84%, ${0.04 + fade * 0.06})`;
            ctx.beginPath();
            ctx.arc(projected[6].x, projected[6].y, 1.5 + fade * 3 + beat * 2, 0, TAU);
            ctx.fill();
        }
    }

    ctx.strokeStyle = `hsla(${(240 + time * 8) % 360}, 100%, 68%, ${0.025 + beat * 0.04})`;
    ctx.lineWidth = 1;
    ctx.strokeRect(width * 0.12, height * 0.16, width * 0.76, height * 0.68);
}

function drawStarfield3D(time, alpha) {
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    const stars = 220;
    const bass = getBass();
    const treble = getTreble();
    const beat = getBeat();
    ctx.globalAlpha = alpha;
    ctx.globalCompositeOperation = "lighter";
    ctx.lineCap = "round";

    for (let i = 0; i < stars; i += 1) {
        const seed = state.seed * 2.1 + i * 19.37;
        const spread = 420 + seededUnit(seed + 4) * 560;
        const baseX = seededSigned(seed) * spread;
        const baseY = seededSigned(seed + 1) * spread * 0.72;
        const travel = fract(seededUnit(seed + 2) - time * (0.22 + bass * 0.4 + seededUnit(seed + 5) * 0.16));
        const worldZ = 60 + travel * 1700;
        const point = projectPoint3D(baseX, baseY, worldZ);
        const tailPoint = projectPoint3D(baseX, baseY, worldZ + 120 + treble * 260);
        if (!point || !tailPoint) {
            continue;
        }

        const fade = depthFade(worldZ, 60, 1760);
        const hue = (195 + seededUnit(seed + 3) * 120 + time * (9 + treble * 18)) % 360;
        ctx.strokeStyle = `hsla(${hue}, 100%, ${70 + fade * 16}%, ${0.04 + fade * 0.1 + beat * 0.03})`;
        ctx.lineWidth = 0.8 + point.scale * 5 + beat * 1.2;
        ctx.beginPath();
        ctx.moveTo(tailPoint.x, tailPoint.y);
        ctx.lineTo(point.x, point.y);
        ctx.stroke();
    }

    ctx.lineCap = "butt";
}

function drawTorusOrbit3D(time, alpha) {
    const points = 260;
    const bass = getBass();
    const mid = getMid();
    const treble = getTreble();
    const beat = getBeat();
    const majorRadius = 180 + bass * 110;
    const minorRadius = 58 + mid * 40;
    ctx.globalAlpha = alpha;
    ctx.globalCompositeOperation = "lighter";

    for (let i = 0; i < points; i += 1) {
        const ratio = i / points;
        const u = ratio * TAU;
        const v = (ratio * 9 + time * (0.3 + treble * 0.5)) * TAU;
        const x = (majorRadius + Math.cos(v) * minorRadius) * Math.cos(u);
        const y = Math.sin(v) * minorRadius;
        const z = (majorRadius + Math.cos(v) * minorRadius) * Math.sin(u);
        const rotated = rotatePoint3D(
            x,
            y,
            z,
            time * (0.28 + bass * 0.16),
            time * (0.18 + mid * 0.22),
            time * 0.1
        );
        const projected = projectPoint3D(rotated.x, rotated.y, rotated.z + 860);
        if (!projected) {
            continue;
        }

        const fade = depthFade(rotated.z + 860, 520, 1220);
        const hue = (185 + ratio * 240 + time * (18 + beat * 24)) % 360;
        ctx.fillStyle = `hsla(${hue}, 100%, ${68 + fade * 16}%, ${0.03 + fade * 0.11})`;
        ctx.beginPath();
        ctx.arc(projected.x, projected.y, 1 + projected.scale * 8 + beat * 1.2, 0, TAU);
        ctx.fill();
    }
}

function drawSkylineDepth3D(time, alpha) {
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    const columns = 22;
    const layers = 7;
    const bass = getBass();
    const mid = getMid();
    const beat = getBeat();
    ctx.globalAlpha = alpha;
    ctx.globalCompositeOperation = "screen";

    for (let layer = 0; layer < layers; layer += 1) {
        const depthRatio = layer / Math.max(1, layers - 1);
        const worldZ = 280 + depthRatio * 1350;

        for (let column = 0; column < columns; column += 1) {
            const ratio = column / Math.max(1, columns - 1);
            const x = -420 + ratio * 840 + Math.sin(time * 0.2 + layer) * (10 + beat * 30);
            const baseY = 210;
            const seed = layer * 37 + column * 3.7 + state.seed;
            const towerHeight = 50 + seededUnit(seed) * 220 + bass * 150 + (column % 4 === 0 ? beat * 120 : 0);
            const bottom = projectPoint3D(x, baseY, worldZ);
            const top = projectPoint3D(x, baseY - towerHeight, worldZ);
            if (!bottom || !top) {
                continue;
            }

            const thickness = 2 + bottom.scale * (20 + mid * 24);
            const fade = depthFade(worldZ, 240, 1630);
            const hue = (200 + depthRatio * 90 + ratio * 40 + time * 8) % 360;
            ctx.strokeStyle = `hsla(${hue}, 100%, ${60 + fade * 20}%, ${0.04 + fade * 0.08})`;
            ctx.lineWidth = thickness;
            ctx.beginPath();
            ctx.moveTo(bottom.x, bottom.y);
            ctx.lineTo(top.x, top.y);
            ctx.stroke();
        }
    }

    for (let i = 0; i < 11; i += 1) {
        const travel = i / 10;
        const left = projectPoint3D(-500, 220, 300 + travel * 1400);
        const right = projectPoint3D(500, 220, 300 + travel * 1400);
        if (!left || !right) {
            continue;
        }

        ctx.strokeStyle = `hsla(${(215 + i * 8 + time * 5) % 360}, 100%, 72%, ${0.02 + (1 - travel) * 0.06})`;
        ctx.lineWidth = 1 + (1 - travel) * 2;
        ctx.beginPath();
        ctx.moveTo(left.x, left.y);
        ctx.lineTo(right.x, right.y);
        ctx.stroke();
    }

    ctx.fillStyle = `rgba(6, 10, 18, ${0.12 + beat * 0.04})`;
    ctx.fillRect(0, height * 0.72, width, height * 0.28);
}

// ===== エフェクト26: ダイヤモンドダスト - キラキラ舞う粒子 =====
function drawDiamondDust(time, alpha) {
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    const count = 200;
    const treble = getTreble();
    const beat = getBeat();
    ctx.globalAlpha = alpha;
    ctx.globalCompositeOperation = "lighter";
    for (let i = 0; i < count; i += 1) {
        const seed = state.seed * 1.1 + i * 7.37;
        const px = seededUnit(seed);
        const py = seededUnit(seed + 3);
        const sparkle = Math.sin(time * (3 + i * 0.1) + seed) * 0.5 + 0.5;
        const x = width * px + Math.sin(time * 0.3 + i) * (20 + treble * 30);
        const y = height * py + Math.cos(time * 0.25 + i * 0.5) * (20 + beat * 25);
        const size = (1 + px * 3 + sparkle * 4) * (0.5 + treble);
        const hue = (50 + px * 40 + time * 15) % 360;
        ctx.fillStyle = `hsla(${hue}, 80%, ${80 + sparkle * 15}%, ${0.02 + sparkle * 0.12 + beat * 0.05})`;
        ctx.beginPath();
        ctx.arc(x, y, size, 0, TAU);
        ctx.fill();
    }
}

// ===== エフェクト27: ヘキサグリッド - 六角形のパルスグリッド =====
function drawHexGrid(time, alpha) {
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    const bass = getBass();
    const mid = getMid();
    const beat = getBeat();
    const hexSize = 36 + bass * 20;
    const cols = Math.ceil(width / (hexSize * 1.5)) + 2;
    const rows = Math.ceil(height / (hexSize * Math.sqrt(3))) + 2;
    ctx.globalAlpha = alpha;
    ctx.globalCompositeOperation = "screen";
    for (let row = 0; row < rows; row += 1) {
        for (let col = 0; col < cols; col += 1) {
            const offset = row % 2 === 0 ? 0 : hexSize * 0.75;
            const cx = col * hexSize * 1.5 + offset;
            const cy = row * hexSize * Math.sqrt(3) * 0.5;
            const dist = Math.hypot(cx - width * 0.5, cy - height * 0.5) / Math.max(width, height);
            const pulse = Math.sin(time * 2 - dist * 10 + bass * 4) * 0.5 + 0.5;
            const hue = (200 + dist * 120 + time * 8) % 360;
            ctx.strokeStyle = `hsla(${hue}, 100%, ${60 + pulse * 20}%, ${0.02 + pulse * 0.08 + beat * 0.03})`;
            ctx.lineWidth = 1 + pulse * 2 + beat * 1.5;
            ctx.beginPath();
            for (let a = 0; a < 6; a += 1) {
                const angle = a * TAU / 6 + time * 0.1;
                const hx = cx + Math.cos(angle) * hexSize * 0.4;
                const hy = cy + Math.sin(angle) * hexSize * 0.4;
                if (a === 0) ctx.moveTo(hx, hy);
                else ctx.lineTo(hx, hy);
            }
            ctx.closePath();
            ctx.stroke();
        }
    }
}

// ===== エフェクト28: プラズマフィールド - 揺れるプラズマ =====
function drawPlasmaField(time, alpha) {
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    const bass = getBass();
    const mid = getMid();
    ctx.globalAlpha = alpha;
    ctx.globalCompositeOperation = "lighter";
    const blobs = 14;
    for (let i = 0; i < blobs; i += 1) {
        const angle = time * (0.08 + i * 0.02 + bass * 0.06) + i * TAU / blobs;
        const radius = Math.min(width, height) * (0.12 + i * 0.02 + mid * 0.08);
        const cx = width * 0.5 + Math.cos(angle) * radius;
        const cy = height * 0.5 + Math.sin(angle * 1.3) * radius * 0.7;
        const blobR = Math.min(width, height) * (0.1 + Math.sin(time + i) * 0.04 + bass * 0.06);
        const hue = (280 + i * 20 + time * 12) % 360;
        const grad = ctx.createRadialGradient(cx, cy, blobR * 0.05, cx, cy, blobR);
        grad.addColorStop(0, `hsla(${hue}, 100%, 80%, ${0.12 + bass * 0.12})`);
        grad.addColorStop(0.5, `hsla(${(hue + 40) % 360}, 90%, 60%, ${0.06 + mid * 0.06})`);
        grad.addColorStop(1, `hsla(${(hue + 80) % 360}, 80%, 30%, 0)`);
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(cx, cy, blobR, 0, TAU);
        ctx.fill();
    }
}

// ===== エフェクト29: ライトニング - 稲妻エフェクト =====
function drawLightning(time, alpha) {
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    const bolts = 8;
    const bass = getBass();
    const beat = getBeat();
    ctx.globalAlpha = alpha;
    ctx.globalCompositeOperation = "lighter";
    ctx.lineCap = "round";
    for (let b = 0; b < bolts; b += 1) {
        const seed = state.seed + b * 19.3 + Math.floor(time * 3) * 7.7;
        const startX = width * (0.2 + seededUnit(seed) * 0.6);
        const startY = 0;
        const endX = width * (0.15 + seededUnit(seed + 1) * 0.7);
        const endY = height;
        const segments = 16;
        const hue = (180 + b * 30 + time * 20) % 360;
        const intensity = Math.sin(time * 4 + b * 2) * 0.5 + 0.5;
        ctx.strokeStyle = `hsla(${hue}, 100%, ${75 + intensity * 20}%, ${0.04 + intensity * 0.12 + beat * 0.06})`;
        ctx.lineWidth = 1 + intensity * 3 + bass * 2;
        ctx.beginPath();
        ctx.moveTo(startX, startY);
        for (let s = 1; s <= segments; s += 1) {
            const t = s / segments;
            const x = startX + (endX - startX) * t + seededSigned(seed + s * 3.1) * (60 + bass * 80) * (1 - Math.abs(t - 0.5) * 2);
            const y = startY + (endY - startY) * t;
            ctx.lineTo(x, y);
        }
        ctx.stroke();
    }
    ctx.lineCap = "butt";
}

// ===== エフェクト30: サクラ - 桜吹雪 =====
function drawSakura(time, alpha) {
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    const count = 180;
    const treble = getTreble();
    const beat = getBeat();
    const level = getLevel();
    ctx.globalAlpha = alpha;
    ctx.globalCompositeOperation = "lighter";
    for (let i = 0; i < count; i += 1) {
        const seed = state.seed * 0.9 + i * 13.41;
        const drift = seededUnit(seed);
        const speed = 0.008 + drift * 0.012 + level * 0.02;
        const phase = fract(drift + time * speed);
        const x = width * fract(Math.sin(seed * 1.2) * 12345.67) + Math.sin(time * 0.5 + i) * (30 + beat * 40);
        const y = -30 + phase * (height + 60);
        const rot = time * (0.5 + drift) + seed;
        const size = 3 + drift * 5 + treble * 3;
        const hue = (330 + drift * 30 + time * 3) % 360;
        ctx.fillStyle = `hsla(${hue}, 80%, ${78 + drift * 12}%, ${0.04 + drift * 0.06 + beat * 0.03})`;
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(rot);
        ctx.scale(1, 0.6 + Math.sin(rot * 2) * 0.3);
        ctx.beginPath();
        ctx.arc(0, 0, size, 0, Math.PI);
        ctx.arc(0, 0, size * 0.6, Math.PI, 0);
        ctx.fill();
        ctx.restore();
    }
}

// ===== エフェクト31: ソナーパルス - ソナー波紋 =====
function drawSonarPulse(time, alpha) {
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    const centerX = width * 0.5;
    const centerY = height * 0.5;
    const pulses = 12;
    const bass = getBass();
    const beat = getBeat();
    ctx.globalAlpha = alpha;
    ctx.globalCompositeOperation = "screen";
    for (let i = 0; i < pulses; i += 1) {
        const phase = fract(time * (0.15 + bass * 0.1) + i / pulses);
        const radius = Math.min(width, height) * phase * 0.5;
        const fade = 1 - phase;
        const hue = (120 + i * 15 + time * 6) % 360;
        ctx.strokeStyle = `hsla(${hue}, 100%, 70%, ${fade * 0.12 + beat * 0.04})`;
        ctx.lineWidth = 2 + fade * 4 + bass * 3;
        ctx.beginPath();
        ctx.arc(centerX, centerY, radius, 0, TAU);
        ctx.stroke();
    }
    // ソナーライン（回転する検出線）
    const sweepAngle = time * 1.5;
    const sweepLen = Math.min(width, height) * 0.48;
    ctx.strokeStyle = `hsla(${(130 + time * 10) % 360}, 100%, 80%, ${0.08 + beat * 0.06})`;
    ctx.lineWidth = 2 + bass * 2;
    ctx.beginPath();
    ctx.moveTo(centerX, centerY);
    ctx.lineTo(centerX + Math.cos(sweepAngle) * sweepLen, centerY + Math.sin(sweepAngle) * sweepLen);
    ctx.stroke();
}

// ===== エフェクト32: マトリックスレイン - デジタル雨 =====
function drawMatrixRain(time, alpha) {
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    const columns = 40;
    const bass = getBass();
    const treble = getTreble();
    ctx.globalAlpha = alpha;
    ctx.globalCompositeOperation = "lighter";
    for (let col = 0; col < columns; col += 1) {
        const seed = state.seed + col * 5.67;
        const x = (col / columns) * width + seededSigned(seed) * 10;
        const speed = 0.1 + seededUnit(seed + 1) * 0.15 + bass * 0.1;
        const drops = 12;
        for (let d = 0; d < drops; d += 1) {
            const phase = fract(time * speed + d / drops + seededUnit(seed + 2));
            const y = phase * height;
            const fade = 1 - phase;
            const hue = (120 + col * 2 + time * 5) % 360;
            const size = 2 + fade * 4 + treble * 3;
            ctx.fillStyle = `hsla(${hue}, 100%, ${60 + fade * 30}%, ${0.03 + fade * 0.1})`;
            ctx.beginPath();
            ctx.arc(x, y, size, 0, TAU);
            ctx.fill();
        }
    }
}

// ===== エフェクト33: フラクタルツリー - 再帰的な木の枝 =====
function drawFractalTree(time, alpha) {
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    const bass = getBass();
    const mid = getMid();
    const beat = getBeat();
    ctx.globalAlpha = alpha;
    ctx.globalCompositeOperation = "screen";
    ctx.lineCap = "round";

    function branch(x, y, angle, length, depth) {
        if (depth <= 0 || length < 3) return;
        const endX = x + Math.cos(angle) * length;
        const endY = y + Math.sin(angle) * length;
        const hue = (140 + depth * 25 + time * 8) % 360;
        ctx.strokeStyle = `hsla(${hue}, 90%, ${50 + depth * 8}%, ${0.04 + depth * 0.02 + beat * 0.02})`;
        ctx.lineWidth = depth * 1.2 + bass * 2;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(endX, endY);
        ctx.stroke();
        const spread = 0.4 + Math.sin(time * 0.5 + depth) * 0.2 + mid * 0.3;
        branch(endX, endY, angle - spread, length * 0.68, depth - 1);
        branch(endX, endY, angle + spread, length * 0.68, depth - 1);
    }
    branch(width * 0.5, height * 0.85, -Math.PI / 2 + Math.sin(time * 0.3) * 0.1, 100 + bass * 60, 8);
    ctx.lineCap = "butt";
}

// ===== エフェクト34: ギャラクシースワール - 渦巻く銀河 =====
function drawGalaxySwirl(time, alpha) {
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    const centerX = width * 0.5;
    const centerY = height * 0.5;
    const stars = 300;
    const bass = getBass();
    const mid = getMid();
    const beat = getBeat();
    ctx.globalAlpha = alpha;
    ctx.globalCompositeOperation = "lighter";
    for (let i = 0; i < stars; i += 1) {
        const ratio = i / stars;
        const arm = i % 3;
        const dist = ratio * Math.min(width, height) * 0.4;
        const spiralAngle = ratio * TAU * 3 + arm * TAU / 3 + time * (0.2 + bass * 0.3);
        const wobble = Math.sin(ratio * 20 + time * 2) * (10 + mid * 20);
        const x = centerX + Math.cos(spiralAngle) * (dist + wobble);
        const y = centerY + Math.sin(spiralAngle) * (dist + wobble) * 0.6;
        const hue = (220 + ratio * 60 + arm * 40 + time * 10) % 360;
        const size = 0.8 + (1 - ratio) * 3 + beat * 2;
        ctx.fillStyle = `hsla(${hue}, 90%, ${70 + ratio * 20}%, ${0.03 + (1 - ratio) * 0.08})`;
        ctx.beginPath();
        ctx.arc(x, y, size, 0, TAU);
        ctx.fill();
    }
}

// ===== エフェクト35: サウンドバー - 縦棒スペクトラム =====
function drawSoundBars(time, alpha) {
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    const bars = 48;
    const bass = getBass();
    const beat = getBeat();
    ctx.globalAlpha = alpha;
    ctx.globalCompositeOperation = "lighter";
    for (let i = 0; i < bars; i += 1) {
        const ratio = i / bars;
        const energy = sampleSpectrum(ratio);
        const barWidth = width / bars * 0.7;
        const barHeight = energy * height * 0.5 + beat * 30;
        const x = ratio * width;
        const y = height * 0.5 - barHeight * 0.5;
        const hue = (180 + ratio * 200 + time * 10) % 360;
        const grad = ctx.createLinearGradient(x, y + barHeight, x, y);
        grad.addColorStop(0, `hsla(${hue}, 100%, 50%, ${0.03 + energy * 0.1})`);
        grad.addColorStop(1, `hsla(${(hue + 60) % 360}, 100%, 80%, ${0.06 + energy * 0.15 + beat * 0.04})`);
        ctx.fillStyle = grad;
        ctx.fillRect(x, y, barWidth, barHeight);
    }
}

// ===== エフェクト36: エレクトリックフィールド - 電場ベクトル =====
function drawElectricField(time, alpha) {
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    const gridX = 16;
    const gridY = 10;
    const bass = getBass();
    const mid = getMid();
    const beat = getBeat();
    ctx.globalAlpha = alpha;
    ctx.globalCompositeOperation = "screen";
    ctx.lineCap = "round";
    for (let gx = 0; gx < gridX; gx += 1) {
        for (let gy = 0; gy < gridY; gy += 1) {
            const x = (gx + 0.5) / gridX * width;
            const y = (gy + 0.5) / gridY * height;
            const angle = Math.sin(x * 0.01 + time * 0.8 + bass * 4) * Math.cos(y * 0.01 + time * 0.6 + mid * 3);
            const len = 15 + Math.sin(time + gx + gy) * 8 + beat * 20;
            const hue = (200 + angle * 60 + time * 8) % 360;
            ctx.strokeStyle = `hsla(${hue}, 100%, 72%, ${0.04 + beat * 0.04})`;
            ctx.lineWidth = 1.5 + bass * 1.5;
            ctx.beginPath();
            ctx.moveTo(x, y);
            ctx.lineTo(x + Math.cos(angle * TAU) * len, y + Math.sin(angle * TAU) * len);
            ctx.stroke();
        }
    }
    ctx.lineCap = "butt";
}

// ===== エフェクト37: バブルライズ - 泡の上昇 =====
function drawBubbleRise(time, alpha) {
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    const count = 80;
    const treble = getTreble();
    const beat = getBeat();
    const level = getLevel();
    ctx.globalAlpha = alpha;
    ctx.globalCompositeOperation = "screen";
    for (let i = 0; i < count; i += 1) {
        const seed = state.seed * 1.4 + i * 8.23;
        const lane = seededUnit(seed);
        const speed = 0.02 + lane * 0.03 + level * 0.04;
        const phase = fract(lane * 10 + time * speed);
        const x = width * lane + Math.sin(time * 0.6 + i) * (20 + treble * 30);
        const y = height + 20 - phase * (height + 40);
        const size = 4 + lane * 12 + beat * 6;
        const hue = (200 + lane * 80 + time * 6) % 360;
        ctx.strokeStyle = `hsla(${hue}, 80%, 75%, ${0.04 + (1 - lane) * 0.06 + beat * 0.03})`;
        ctx.lineWidth = 1 + lane * 1.5;
        ctx.beginPath();
        ctx.arc(x, y, size, 0, TAU);
        ctx.stroke();
        // ハイライト
        ctx.fillStyle = `hsla(${hue}, 60%, 90%, ${0.02 + beat * 0.02})`;
        ctx.beginPath();
        ctx.arc(x - size * 0.25, y - size * 0.25, size * 0.25, 0, TAU);
        ctx.fill();
    }
}

// ===== エフェクト38: DNA螺旋 - 二重螺旋構造 =====
function drawDNAHelix(time, alpha) {
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    const points = 80;
    const bass = getBass();
    const mid = getMid();
    const beat = getBeat();
    ctx.globalAlpha = alpha;
    ctx.globalCompositeOperation = "lighter";
    const amplitude = Math.min(width, height) * (0.08 + bass * 0.05);
    for (let strand = 0; strand < 2; strand += 1) {
        const hue = strand === 0 ? (200 + time * 8) % 360 : (320 + time * 8) % 360;
        ctx.strokeStyle = `hsla(${hue}, 100%, 72%, ${0.06 + mid * 0.04})`;
        ctx.lineWidth = 2 + bass * 2;
        ctx.beginPath();
        for (let i = 0; i <= points; i += 1) {
            const t = i / points;
            const y = t * height;
            const offset = strand * Math.PI;
            const x = width * 0.5 + Math.sin(t * TAU * 3 + time * 1.5 + offset) * amplitude;
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        }
        ctx.stroke();
    }
    // 連結棒
    for (let i = 0; i < points; i += 4) {
        const t = i / points;
        const y = t * height;
        const x1 = width * 0.5 + Math.sin(t * TAU * 3 + time * 1.5) * amplitude;
        const x2 = width * 0.5 + Math.sin(t * TAU * 3 + time * 1.5 + Math.PI) * amplitude;
        const hue = (260 + t * 80 + time * 10) % 360;
        ctx.strokeStyle = `hsla(${hue}, 90%, 68%, ${0.04 + beat * 0.03})`;
        ctx.lineWidth = 1 + beat * 1.5;
        ctx.beginPath();
        ctx.moveTo(x1, y);
        ctx.lineTo(x2, y);
        ctx.stroke();
    }
}

// ===== エフェクト39: フレームバースト - 炎のような噴出 =====
function drawFlameBurst(time, alpha) {
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    const particles = 200;
    const bass = getBass();
    const beat = getBeat();
    const level = getLevel();
    ctx.globalAlpha = alpha;
    ctx.globalCompositeOperation = "lighter";
    for (let i = 0; i < particles; i += 1) {
        const seed = state.seed * 0.8 + i * 6.47;
        const angle = seededUnit(seed) * TAU;
        const speed = seededUnit(seed + 1) * 0.3 + bass * 0.2;
        const life = fract(time * speed + seededUnit(seed + 2));
        const dist = life * Math.min(width, height) * (0.2 + bass * 0.15);
        const x = width * 0.5 + Math.cos(angle + time * 0.2) * dist;
        const y = height * 0.7 - life * height * 0.4 + Math.sin(time + i) * (5 + beat * 15);
        const fade = 1 - life;
        const hue = (20 + life * 40 + time * 5) % 360;
        const size = fade * (3 + bass * 4 + beat * 3);
        ctx.fillStyle = `hsla(${hue}, 100%, ${50 + fade * 40}%, ${0.03 + fade * 0.1})`;
        ctx.beginPath();
        ctx.arc(x, y, size, 0, TAU);
        ctx.fill();
    }
}

// ===== エフェクト40: ウェーブインターフェア - 干渉波 =====
function drawWaveInterference(time, alpha) {
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    const waves = 5;
    const bass = getBass();
    const mid = getMid();
    ctx.globalAlpha = alpha;
    ctx.globalCompositeOperation = "screen";
    for (let w = 0; w < waves; w += 1) {
        const hue = (210 + w * 30 + time * 6) % 360;
        ctx.strokeStyle = `hsla(${hue}, 100%, 70%, ${0.04 + mid * 0.04})`;
        ctx.lineWidth = 2 + bass * 2;
        const sourceX = width * (0.2 + w * 0.15);
        const sourceY = height * 0.5 + Math.sin(time * 0.3 + w) * 50;
        traceHorizontalPath(-20, width + 20, 8, (x) => {
            const dx = x - sourceX;
            const dy = 0;
            const dist = Math.sqrt(dx * dx + 1);
            return sourceY + Math.sin(dist * 0.05 - time * (2 + bass * 3) + w * 1.5) * (30 + mid * 40) / (1 + dist * 0.003);
        });
        ctx.stroke();
    }
}

// ===== エフェクト41: ピクセルストーム - ピクセルの嵐 =====
function drawPixelStorm(time, alpha) {
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    const bass = getBass();
    const treble = getTreble();
    const beat = getBeat();
    const pixelSize = 6 + bass * 4;
    const cols = Math.ceil(width / pixelSize);
    const rows = Math.ceil(height / pixelSize);
    ctx.globalAlpha = alpha;
    ctx.globalCompositeOperation = "lighter";
    const step = 3;
    for (let r = 0; r < rows; r += step) {
        for (let c = 0; c < cols; c += step) {
            const nx = c / cols;
            const ny = r / rows;
            const wave = Math.sin(nx * 8 + time * 2 + bass * 4) * Math.cos(ny * 6 - time * 1.5 + treble * 3);
            if (wave < 0.3) continue;
            const hue = (200 + wave * 160 + time * 10) % 360;
            ctx.fillStyle = `hsla(${hue}, 100%, ${60 + wave * 30}%, ${0.03 + wave * 0.08 + beat * 0.03})`;
            ctx.fillRect(c * pixelSize, r * pixelSize, pixelSize - 1, pixelSize - 1);
        }
    }
}

// ===== エフェクト42: ストリングス - 弦楽器の弦 =====
function drawStrings(time, alpha) {
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    const strings = 20;
    const bass = getBass();
    const mid = getMid();
    const treble = getTreble();
    ctx.globalAlpha = alpha;
    ctx.globalCompositeOperation = "screen";
    for (let s = 0; s < strings; s += 1) {
        const ratio = s / strings;
        const energy = sampleSpectrum(ratio);
        const y0 = height * (0.1 + ratio * 0.8);
        const hue = (190 + ratio * 160 + time * 8) % 360;
        ctx.strokeStyle = `hsla(${hue}, 100%, ${65 + energy * 25}%, ${0.03 + energy * 0.08})`;
        ctx.lineWidth = 1 + energy * 3 + bass * 1.5;
        traceHorizontalPath(0, width, 10, (x) => {
            const nx = x / width;
            const vibration = Math.sin(nx * Math.PI) * energy * (30 + mid * 40);
            return y0 + vibration * Math.sin(nx * TAU * (2 + s * 0.5) + time * (3 + treble * 5));
        });
        ctx.stroke();
    }
}

// ===== エフェクト43: コンステレーション - 星座のような接続 =====
function drawConstellation(time, alpha) {
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    const count = 60;
    const bass = getBass();
    const mid = getMid();
    const beat = getBeat();
    ctx.globalAlpha = alpha;
    ctx.globalCompositeOperation = "lighter";
    const positions = [];
    for (let i = 0; i < count; i += 1) {
        const seed = state.seed * 2 + i * 11.13;
        const x = width * seededUnit(seed) + Math.sin(time * 0.2 + i * 0.5) * (20 + bass * 30);
        const y = height * seededUnit(seed + 1) + Math.cos(time * 0.15 + i * 0.3) * (20 + mid * 25);
        positions.push({ x, y });
        const hue = (200 + i * 5 + time * 6) % 360;
        ctx.fillStyle = `hsla(${hue}, 90%, 80%, ${0.05 + beat * 0.04})`;
        ctx.beginPath();
        ctx.arc(x, y, 2 + beat * 2, 0, TAU);
        ctx.fill();
    }
    const maxDist = 120 + bass * 60;
    for (let i = 0; i < count; i += 1) {
        for (let j = i + 1; j < count; j += 1) {
            const dx = positions[i].x - positions[j].x;
            const dy = positions[i].y - positions[j].y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            if (dist < maxDist) {
                const fade = 1 - dist / maxDist;
                const hue = (210 + (i + j) * 3 + time * 5) % 360;
                ctx.strokeStyle = `hsla(${hue}, 80%, 70%, ${fade * 0.06})`;
                ctx.lineWidth = fade * 2;
                ctx.beginPath();
                ctx.moveTo(positions[i].x, positions[i].y);
                ctx.lineTo(positions[j].x, positions[j].y);
                ctx.stroke();
            }
        }
    }
}

// ===== エフェクト44: ペンデュラムウェーブ - 振り子の波 =====
function drawPendulumWave(time, alpha) {
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    const pendulums = 30;
    const bass = getBass();
    const mid = getMid();
    const beat = getBeat();
    ctx.globalAlpha = alpha;
    ctx.globalCompositeOperation = "lighter";
    const pivotY = height * 0.1;
    for (let i = 0; i < pendulums; i += 1) {
        const ratio = i / pendulums;
        const x = width * (0.1 + ratio * 0.8);
        const freq = 0.8 + i * 0.06 + bass * 0.3;
        const angle = Math.sin(time * freq) * (0.8 + mid * 0.4);
        const length = height * 0.5;
        const bobX = x + Math.sin(angle) * length;
        const bobY = pivotY + Math.cos(angle) * length;
        const hue = (200 + ratio * 180 + time * 8) % 360;
        ctx.strokeStyle = `hsla(${hue}, 60%, 60%, ${0.03 + mid * 0.03})`;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x, pivotY);
        ctx.lineTo(bobX, bobY);
        ctx.stroke();
        ctx.fillStyle = `hsla(${hue}, 100%, 75%, ${0.06 + beat * 0.05})`;
        ctx.beginPath();
        ctx.arc(bobX, bobY, 4 + beat * 4, 0, TAU);
        ctx.fill();
    }
}

// ===== エフェクト45: フローフィールド - 流体場 =====
function drawFlowField(time, alpha) {
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    const lines = 120;
    const bass = getBass();
    const treble = getTreble();
    const beat = getBeat();
    ctx.globalAlpha = alpha;
    ctx.globalCompositeOperation = "screen";
    ctx.lineCap = "round";
    for (let i = 0; i < lines; i += 1) {
        const seed = state.seed * 1.6 + i * 14.71;
        let x = width * seededUnit(seed);
        let y = height * seededUnit(seed + 1);
        const hue = (190 + seededUnit(seed + 2) * 120 + time * 7) % 360;
        ctx.strokeStyle = `hsla(${hue}, 100%, 72%, ${0.03 + beat * 0.03})`;
        ctx.lineWidth = 1 + bass * 1.5;
        ctx.beginPath();
        ctx.moveTo(x, y);
        const steps = 20;
        for (let s = 0; s < steps; s += 1) {
            const angle = Math.sin(x * 0.005 + time * 0.5) * Math.cos(y * 0.005 + time * 0.4) * TAU + bass * Math.sin(time + s);
            x += Math.cos(angle) * (5 + treble * 8);
            y += Math.sin(angle) * (5 + treble * 8);
            ctx.lineTo(x, y);
        }
        ctx.stroke();
    }
    ctx.lineCap = "butt";
}

// ===== エフェクト46: モアレ - モアレ模様 =====
function drawMoire(time, alpha) {
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    const bass = getBass();
    const mid = getMid();
    const beat = getBeat();
    ctx.globalAlpha = alpha;
    ctx.globalCompositeOperation = "screen";
    const circles = 2;
    for (let c = 0; c < circles; c += 1) {
        const cx = width * (0.35 + c * 0.3) + Math.sin(time * 0.4 + c * 2) * (40 + bass * 60);
        const cy = height * 0.5 + Math.cos(time * 0.3 + c * 1.5) * (30 + mid * 40);
        const rings = 24;
        for (let r = 1; r <= rings; r += 1) {
            const radius = r * (18 + bass * 8);
            const hue = (210 + c * 60 + r * 5 + time * 6) % 360;
            ctx.strokeStyle = `hsla(${hue}, 80%, 68%, ${0.03 + beat * 0.02})`;
            ctx.lineWidth = 1 + mid * 1;
            ctx.beginPath();
            ctx.arc(cx, cy, radius, 0, TAU);
            ctx.stroke();
        }
    }
}

// ===== エフェクト47: サンドストーム - 砂嵐パーティクル =====
function drawSandstorm(time, alpha) {
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    const count = 300;
    const bass = getBass();
    const level = getLevel();
    const beat = getBeat();
    ctx.globalAlpha = alpha;
    ctx.globalCompositeOperation = "lighter";
    for (let i = 0; i < count; i += 1) {
        const seed = state.seed * 1.2 + i * 5.13;
        const px = seededUnit(seed);
        const py = seededUnit(seed + 1);
        const speed = 0.15 + px * 0.2 + bass * 0.3;
        const x = fract(px + time * speed) * (width + 40) - 20;
        const y = height * py + Math.sin(time * 2 + i * 0.1) * (10 + beat * 20);
        const size = 0.5 + px * 2 + level * 1.5;
        const hue = (30 + py * 30 + time * 4) % 360;
        ctx.fillStyle = `hsla(${hue}, 70%, ${60 + px * 20}%, ${0.02 + px * 0.04})`;
        ctx.beginPath();
        ctx.arc(x, y, size, 0, TAU);
        ctx.fill();
    }
}

// ===== エフェクト48: カレイドスコープ - 万華鏡 =====
function drawKaleidoscope(time, alpha) {
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    const centerX = width * 0.5;
    const centerY = height * 0.5;
    const segments = 12;
    const bass = getBass();
    const mid = getMid();
    const beat = getBeat();
    ctx.globalAlpha = alpha;
    ctx.globalCompositeOperation = "lighter";
    for (let seg = 0; seg < segments; seg += 1) {
        const baseAngle = seg * TAU / segments + time * 0.1;
        const shapes = 8;
        for (let s = 0; s < shapes; s += 1) {
            const dist = 30 + s * 28 + bass * 40;
            const wobble = Math.sin(time * 1.5 + s * 0.8 + seg) * (10 + mid * 15);
            const x = centerX + Math.cos(baseAngle) * (dist + wobble);
            const y = centerY + Math.sin(baseAngle) * (dist + wobble);
            const size = 3 + s * 1.5 + beat * 3;
            const hue = (s * 40 + seg * 30 + time * 12) % 360;
            ctx.fillStyle = `hsla(${hue}, 100%, ${70 + s * 3}%, ${0.03 + beat * 0.03})`;
            ctx.beginPath();
            ctx.arc(x, y, size, 0, TAU);
            ctx.fill();
        }
    }
}

// ===== エフェクト49: リサージュ - リサージュ図形 =====
function drawLissajous(time, alpha) {
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    const centerX = width * 0.5;
    const centerY = height * 0.5;
    const curves = 5;
    const bass = getBass();
    const mid = getMid();
    const beat = getBeat();
    const maxR = Math.min(width, height) * 0.35;
    ctx.globalAlpha = alpha;
    ctx.globalCompositeOperation = "lighter";
    for (let c = 0; c < curves; c += 1) {
        const freqX = 2 + c;
        const freqY = 3 + c;
        const phase = time * (0.3 + c * 0.1 + bass * 0.2);
        const hue = (200 + c * 35 + time * 10) % 360;
        ctx.strokeStyle = `hsla(${hue}, 100%, 72%, ${0.04 + mid * 0.04})`;
        ctx.lineWidth = 1.5 + c * 0.5 + beat * 2;
        ctx.beginPath();
        const points = 200;
        for (let i = 0; i <= points; i += 1) {
            const t = i / points * TAU;
            const x = centerX + Math.sin(freqX * t + phase) * maxR * (0.5 + c * 0.1);
            const y = centerY + Math.sin(freqY * t + phase * 1.3) * maxR * (0.5 + c * 0.1) * 0.7;
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        }
        ctx.stroke();
    }
}

// ===== エフェクト50: パルスウェーブ - パルス波形 =====
function drawPulseWave(time, alpha) {
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    const layers = 8;
    const bass = getBass();
    const mid = getMid();
    const beat = getBeat();
    ctx.globalAlpha = alpha;
    ctx.globalCompositeOperation = "screen";
    for (let l = 0; l < layers; l += 1) {
        const y0 = height * (0.2 + l * 0.08);
        const hue = (200 + l * 20 + time * 8) % 360;
        ctx.strokeStyle = `hsla(${hue}, 100%, ${68 + l * 3}%, ${0.04 + bass * 0.04})`;
        ctx.lineWidth = 2 + l * 0.5 + beat * 2;
        ctx.beginPath();
        for (let x = 0; x <= width; x += 4) {
            const nx = x / width;
            const wave = Math.sin(nx * TAU * (3 + l) - time * (2 + bass * 3 + l * 0.3));
            const pulse = wave > 0 ? 1 : -1;
            const smooth_val = pulse * (20 + l * 5 + mid * 30);
            const y = y0 + smooth_val + Math.sin(nx * 20 + time * 4) * beat * 10;
            if (x === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        }
        ctx.stroke();
    }
}

// ===== エフェクト51: スパークリングリング - 火花のリング =====
function drawSparkRing(time, alpha) {
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    const centerX = width * 0.5;
    const centerY = height * 0.5;
    const sparks = 120;
    const bass = getBass();
    const beat = getBeat();
    const maxR = Math.min(width, height) * (0.28 + bass * 0.12);
    ctx.globalAlpha = alpha;
    ctx.globalCompositeOperation = "lighter";
    for (let i = 0; i < sparks; i += 1) {
        const angle = (i / sparks) * TAU + time * (0.6 + beat * 0.8);
        const energy = sampleSpectrum(i / sparks);
        const r = maxR + energy * 60 + Math.sin(time * 3 + i * 0.5) * (15 + beat * 25);
        const x = centerX + Math.cos(angle) * r;
        const y = centerY + Math.sin(angle) * r;
        const size = 1.5 + energy * 5 + beat * 3;
        const hue = (30 + i * 3 + time * 15) % 360;
        ctx.fillStyle = `hsla(${hue}, 100%, ${75 + energy * 20}%, ${0.04 + energy * 0.12})`;
        ctx.beginPath();
        ctx.arc(x, y, size, 0, TAU);
        ctx.fill();
    }
}

// ===== エフェクト52: ノイズテレイン - ノイズ地形 =====
function drawNoiseTerrain(time, alpha) {
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    const rows = 20;
    const bass = getBass();
    const mid = getMid();
    const beat = getBeat();
    ctx.globalAlpha = alpha;
    ctx.globalCompositeOperation = "screen";
    for (let r = 0; r < rows; r += 1) {
        const depth = r / rows;
        const yBase = height * (0.3 + depth * 0.5);
        const hue = (200 + depth * 60 + time * 5) % 360;
        ctx.strokeStyle = `hsla(${hue}, 80%, ${55 + depth * 25}%, ${0.03 + (1 - depth) * 0.06})`;
        ctx.lineWidth = 1 + (1 - depth) * 3 + beat * 1.5;
        traceHorizontalPath(-20, width + 20, 14, (x) => {
            const nx = x / width;
            return yBase + Math.sin(nx * 6 + time * (0.3 + depth * 0.1) + r * 0.8) * (20 + bass * 40) * (1 - depth * 0.5) +
                Math.cos(nx * 12 + time * 0.5 + r) * (8 + mid * 18) * (1 - depth * 0.6);
        });
        ctx.stroke();
    }
}

// ===== エフェクト53: ギアメッシュ - 歯車の噛み合い =====
function drawGearMesh(time, alpha) {
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    const gears = 7;
    const bass = getBass();
    const mid = getMid();
    const beat = getBeat();
    ctx.globalAlpha = alpha;
    ctx.globalCompositeOperation = "screen";
    for (let g = 0; g < gears; g += 1) {
        const seed = state.seed + g * 29.7;
        const cx = width * (0.15 + seededUnit(seed) * 0.7);
        const cy = height * (0.15 + seededUnit(seed + 1) * 0.7);
        const radius = 30 + seededUnit(seed + 2) * 60 + bass * 30;
        const teeth = 8 + Math.floor(seededUnit(seed + 3) * 10);
        const rot = time * (0.3 + g * 0.1) * (g % 2 === 0 ? 1 : -1);
        const hue = (200 + g * 40 + time * 8) % 360;
        ctx.strokeStyle = `hsla(${hue}, 90%, 70%, ${0.04 + mid * 0.04 + beat * 0.03})`;
        ctx.lineWidth = 1.5 + bass * 1.5;
        ctx.beginPath();
        for (let t = 0; t <= teeth * 4; t += 1) {
            const angle = rot + (t / (teeth * 4)) * TAU;
            const bump = t % 4 < 2 ? 1 : 0.7;
            const r = radius * bump;
            const x = cx + Math.cos(angle) * r;
            const y = cy + Math.sin(angle) * r;
            if (t === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        }
        ctx.closePath();
        ctx.stroke();
    }
}

// ===== エフェクト54: オーロラカーテン - 縦のオーロラ =====
function drawAuroraCurtain(time, alpha) {
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    const curtains = 12;
    const bass = getBass();
    const treble = getTreble();
    const beat = getBeat();
    ctx.globalAlpha = alpha;
    ctx.globalCompositeOperation = "lighter";
    for (let c = 0; c < curtains; c += 1) {
        const x0 = width * (c / curtains);
        const hue = (120 + c * 20 + time * 6) % 360;
        const grad = ctx.createLinearGradient(x0, 0, x0, height);
        grad.addColorStop(0, `hsla(${hue}, 100%, 75%, ${0.06 + bass * 0.08})`);
        grad.addColorStop(0.3, `hsla(${(hue + 40) % 360}, 90%, 60%, ${0.04 + treble * 0.06})`);
        grad.addColorStop(0.7, `hsla(${(hue + 80) % 360}, 80%, 45%, ${0.02 + beat * 0.04})`);
        grad.addColorStop(1, `hsla(${hue}, 70%, 30%, 0)`);
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.moveTo(x0, 0);
        for (let y = 0; y <= height; y += 20) {
            const wave = Math.sin(y * 0.01 + time * (1 + c * 0.1) + c * 2) * (20 + bass * 30);
            ctx.lineTo(x0 + wave, y);
        }
        ctx.lineTo(x0 + width / curtains + 10, height);
        ctx.lineTo(x0 + width / curtains + 10, 0);
        ctx.closePath();
        ctx.fill();
    }
}

// ===== エフェクト55: ワープスピード - ワープ航行エフェクト =====
function drawWarpSpeed(time, alpha) {
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    const centerX = width * 0.5;
    const centerY = height * 0.5;
    const stars = 200;
    const bass = getBass();
    const beat = getBeat();
    ctx.globalAlpha = alpha;
    ctx.globalCompositeOperation = "lighter";
    ctx.lineCap = "round";
    for (let i = 0; i < stars; i += 1) {
        const seed = state.seed * 3 + i * 7.89;
        const angle = seededUnit(seed) * TAU;
        const speed = 0.1 + seededUnit(seed + 1) * 0.3 + bass * 0.4;
        const phase = fract(time * speed + seededUnit(seed + 2));
        const dist = phase * Math.max(width, height) * 0.7;
        const x = centerX + Math.cos(angle) * dist;
        const y = centerY + Math.sin(angle) * dist;
        const tailDist = Math.max(0, dist - 30 - bass * 80);
        const tx = centerX + Math.cos(angle) * tailDist;
        const ty = centerY + Math.sin(angle) * tailDist;
        const hue = (200 + phase * 80 + time * 10) % 360;
        ctx.strokeStyle = `hsla(${hue}, 80%, ${70 + phase * 20}%, ${0.03 + phase * 0.08 + beat * 0.03})`;
        ctx.lineWidth = 0.5 + phase * 3;
        ctx.beginPath();
        ctx.moveTo(tx, ty);
        ctx.lineTo(x, y);
        ctx.stroke();
    }
    ctx.lineCap = "butt";
}

// ===== エフェクト56: クリスタル - クリスタル結晶 =====
function drawCrystal(time, alpha) {
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    const crystals = 15;
    const bass = getBass();
    const mid = getMid();
    const beat = getBeat();
    ctx.globalAlpha = alpha;
    ctx.globalCompositeOperation = "lighter";
    for (let i = 0; i < crystals; i += 1) {
        const seed = state.seed + i * 17.33;
        const cx = width * seededUnit(seed);
        const cy = height * seededUnit(seed + 1);
        const size = 20 + seededUnit(seed + 2) * 40 + bass * 25;
        const sides = 4 + Math.floor(seededUnit(seed + 3) * 4);
        const rot = time * (0.2 + i * 0.05) + seededUnit(seed + 4) * TAU;
        const hue = (180 + i * 20 + time * 8) % 360;
        ctx.strokeStyle = `hsla(${hue}, 90%, 75%, ${0.04 + mid * 0.05 + beat * 0.03})`;
        ctx.lineWidth = 1 + beat * 1.5;
        ctx.beginPath();
        for (let s = 0; s <= sides; s += 1) {
            const angle = rot + s * TAU / sides;
            const x = cx + Math.cos(angle) * size;
            const y = cy + Math.sin(angle) * size;
            if (s === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        }
        ctx.closePath();
        ctx.stroke();
        // 内側のハイライト
        const innerSize = size * 0.5;
        ctx.strokeStyle = `hsla(${(hue + 40) % 360}, 100%, 85%, ${0.03 + beat * 0.02})`;
        ctx.beginPath();
        for (let s = 0; s <= sides; s += 1) {
            const angle = rot + s * TAU / sides + TAU / sides / 2;
            const x = cx + Math.cos(angle) * innerSize;
            const y = cy + Math.sin(angle) * innerSize;
            if (s === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        }
        ctx.closePath();
        ctx.stroke();
    }
}

// ===== エフェクト57: エコーウェーブ - エコーする波 =====
function drawEchoWave(time, alpha) {
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    const echoes = 10;
    const bass = getBass();
    const mid = getMid();
    const treble = getTreble();
    const beat = getBeat();
    ctx.globalAlpha = alpha;
    ctx.globalCompositeOperation = "screen";
    for (let e = 0; e < echoes; e += 1) {
        const delay = e * 0.3;
        const t = time - delay;
        const fade = 1 - e / echoes;
        const hue = (220 + e * 15 + time * 7) % 360;
        ctx.strokeStyle = `hsla(${hue}, 100%, ${65 + fade * 20}%, ${0.03 + fade * 0.06 + beat * 0.02})`;
        ctx.lineWidth = 1 + fade * 3 + bass * 2;
        traceHorizontalPath(-20, width + 20, 10, (x) => {
            const nx = x / width;
            return height * 0.5 +
                Math.sin(nx * 8 + t * (1.5 + bass * 2)) * (40 + mid * 50) * fade +
                Math.cos(nx * 14 - t * (0.8 + mid)) * (15 + treble * 20) * fade;
        });
        ctx.stroke();
    }
}

// ===== エフェクト58: グラビティウェル - 重力井戸 =====
function drawGravityWell(time, alpha) {
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    const centerX = width * 0.5;
    const centerY = height * 0.5;
    const particles = 180;
    const bass = getBass();
    const mid = getMid();
    const beat = getBeat();
    ctx.globalAlpha = alpha;
    ctx.globalCompositeOperation = "lighter";
    for (let i = 0; i < particles; i += 1) {
        const seed = state.seed * 1.5 + i * 9.73;
        const startAngle = seededUnit(seed) * TAU;
        const speed = 0.2 + seededUnit(seed + 1) * 0.4 + bass * 0.3;
        const phase = fract(time * speed * 0.1 + seededUnit(seed + 2));
        const dist = (1 - phase) * Math.min(width, height) * 0.4;
        const spiralAngle = startAngle + phase * TAU * 3;
        const x = centerX + Math.cos(spiralAngle) * dist;
        const y = centerY + Math.sin(spiralAngle) * dist;
        const size = 1 + phase * 3 + beat * 2;
        const hue = (260 + phase * 60 + time * 8) % 360;
        ctx.fillStyle = `hsla(${hue}, 100%, ${65 + phase * 25}%, ${0.03 + phase * 0.08})`;
        ctx.beginPath();
        ctx.arc(x, y, size, 0, TAU);
        ctx.fill();
    }
}

// ===== エフェクト59: メテオシャワー - 流星群 =====
function drawMeteorShower(time, alpha) {
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    const meteors = 25;
    const bass = getBass();
    const treble = getTreble();
    const beat = getBeat();
    ctx.globalAlpha = alpha;
    ctx.globalCompositeOperation = "lighter";
    ctx.lineCap = "round";
    for (let i = 0; i < meteors; i += 1) {
        const seed = state.seed * 2.2 + i * 31.7;
        const startX = seededUnit(seed) * width * 1.2 - width * 0.1;
        const startY = -20;
        const angle = 0.6 + seededUnit(seed + 1) * 0.4;
        const speed = 0.06 + seededUnit(seed + 2) * 0.1 + bass * 0.08;
        const phase = fract(time * speed + seededUnit(seed + 3));
        const dist = phase * Math.max(width, height) * 1.2;
        const x = startX + Math.cos(angle) * dist;
        const y = startY + Math.sin(angle) * dist;
        const tailLen = 40 + seededUnit(seed + 4) * 100 + treble * 80;
        const tx = x - Math.cos(angle) * tailLen;
        const ty = y - Math.sin(angle) * tailLen;
        const hue = (40 + seededUnit(seed + 5) * 40 + time * 12) % 360;
        const fade = 1 - phase;
        ctx.strokeStyle = `hsla(${hue}, 100%, ${70 + fade * 20}%, ${0.03 + fade * 0.1 + beat * 0.04})`;
        ctx.lineWidth = 1 + fade * 3 + beat * 2;
        ctx.beginPath();
        ctx.moveTo(tx, ty);
        ctx.lineTo(x, y);
        ctx.stroke();
    }
    ctx.lineCap = "butt";
}

// ===== エフェクト60: シンセグリッド - シンセウェーブ風グリッド =====
function drawSynthGrid(time, alpha) {
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    const bass = getBass();
    const mid = getMid();
    const beat = getBeat();
    ctx.globalAlpha = alpha;
    ctx.globalCompositeOperation = "screen";
    const rows = 16;
    const cols = 20;
    const perspective = 0.7;
    // 横線（奥行き感あり）
    for (let r = 0; r < rows; r += 1) {
        const depth = r / rows;
        const y = height * (0.4 + depth * 0.6);
        const scale = 0.3 + depth * 0.7;
        const hue = (280 + depth * 60 + time * 8) % 360;
        ctx.strokeStyle = `hsla(${hue}, 100%, ${55 + depth * 25}%, ${0.03 + depth * 0.06 + beat * 0.02})`;
        ctx.lineWidth = 1 + depth * 2 + bass * 1.5;
        ctx.beginPath();
        ctx.moveTo(width * (0.5 - scale * 0.5) + Math.sin(time * 0.3 + r) * (5 + beat * 15), y);
        ctx.lineTo(width * (0.5 + scale * 0.5) + Math.sin(time * 0.3 + r) * (5 + beat * 15), y);
        ctx.stroke();
    }
    // 縦線（収束点に向かう）
    for (let c = 0; c < cols; c += 1) {
        const ratio = c / (cols - 1);
        const topX = width * 0.5;
        const bottomX = width * ratio;
        const hue = (300 + ratio * 60 + time * 6) % 360;
        ctx.strokeStyle = `hsla(${hue}, 90%, 65%, ${0.02 + mid * 0.04})`;
        ctx.lineWidth = 1 + mid * 1;
        ctx.beginPath();
        ctx.moveTo(topX, height * 0.4);
        ctx.lineTo(bottomX, height);
        ctx.stroke();
    }
}

// ===== エフェクト61: 波紋の池 - 多重波紋 =====
function drawPondRipples(time, alpha) {
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    const sources = 4;
    const bass = getBass();
    const mid = getMid();
    const beat = getBeat();
    ctx.globalAlpha = alpha;
    ctx.globalCompositeOperation = "screen";
    for (let s = 0; s < sources; s += 1) {
        const seed = state.seed * 0.5 + s * 37.3;
        const cx = width * (0.2 + seededUnit(seed) * 0.6);
        const cy = height * (0.2 + seededUnit(seed + 1) * 0.6);
        const rings = 8;
        for (let r = 0; r < rings; r += 1) {
            const phase = fract(time * (0.2 + bass * 0.15) + r / rings);
            const radius = phase * Math.min(width, height) * 0.3;
            const fade = (1 - phase) * (1 - phase);
            const hue = (200 + s * 40 + r * 10 + time * 6) % 360;
            ctx.strokeStyle = `hsla(${hue}, 90%, 72%, ${fade * 0.1 + beat * 0.03})`;
            ctx.lineWidth = 1 + fade * 4;
            ctx.beginPath();
            ctx.ellipse(cx, cy, radius, radius * 0.4, Math.sin(time * 0.2 + s) * 0.3, 0, TAU);
            ctx.stroke();
        }
    }
}

// ===== エフェクト62: ネオンサイン - ネオン管文字風 =====
function drawNeonSign(time, alpha) {
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    const bass = getBass();
    const mid = getMid();
    const beat = getBeat();
    ctx.globalAlpha = alpha;
    ctx.globalCompositeOperation = "lighter";
    const shapes = 8;
    for (let s = 0; s < shapes; s += 1) {
        const seed = state.seed + s * 21.4;
        const cx = width * (0.15 + seededUnit(seed) * 0.7);
        const cy = height * (0.15 + seededUnit(seed + 1) * 0.7);
        const size = 30 + seededUnit(seed + 2) * 60 + bass * 20;
        const flicker = 0.5 + Math.sin(time * (6 + s * 2) + seed) * 0.3 + beat * 0.2;
        const hue = (s * 45 + time * 5) % 360;
        ctx.strokeStyle = `hsla(${hue}, 100%, 70%, ${0.05 * flicker + mid * 0.05})`;
        ctx.lineWidth = 3 + beat * 2;
        ctx.shadowColor = `hsla(${hue}, 100%, 60%, ${0.3 * flicker})`;
        ctx.shadowBlur = 15 + beat * 10;
        const type = Math.floor(seededUnit(seed + 3) * 3);
        ctx.beginPath();
        if (type === 0) {
            ctx.arc(cx, cy, size, 0, TAU);
        } else if (type === 1) {
            for (let v = 0; v <= 3; v += 1) {
                const angle = v * TAU / 3 + time * 0.2;
                const x = cx + Math.cos(angle) * size;
                const y = cy + Math.sin(angle) * size;
                if (v === 0) ctx.moveTo(x, y);
                else ctx.lineTo(x, y);
            }
            ctx.closePath();
        } else {
            ctx.rect(cx - size * 0.7, cy - size * 0.5, size * 1.4, size);
        }
        ctx.stroke();
        ctx.shadowBlur = 0;
    }
}

// ===== エフェクト63: ウォーターフォール - 滝エフェクト =====
function drawWaterfall(time, alpha) {
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    const drops = 250;
    const bass = getBass();
    const level = getLevel();
    const beat = getBeat();
    ctx.globalAlpha = alpha;
    ctx.globalCompositeOperation = "lighter";
    const fallWidth = width * 0.3;
    const startX = width * 0.35;
    for (let i = 0; i < drops; i += 1) {
        const seed = state.seed * 0.7 + i * 4.53;
        const lane = seededUnit(seed);
        const speed = 0.05 + lane * 0.08 + bass * 0.06;
        const phase = fract(time * speed + seededUnit(seed + 1));
        const x = startX + lane * fallWidth + Math.sin(time * 1.5 + i * 0.3) * (5 + beat * 12);
        const y = phase * height;
        const size = 1 + lane * 2 + level * 2;
        const hue = (200 + lane * 30 + phase * 20 + time * 5) % 360;
        ctx.fillStyle = `hsla(${hue}, 80%, ${70 + phase * 15}%, ${0.02 + (1 - phase) * 0.06})`;
        ctx.beginPath();
        ctx.ellipse(x, y, size * 0.5, size * 1.5, 0, 0, TAU);
        ctx.fill();
    }
}

// ===== エフェクト64: フィボナッチスパイラル - 黄金螺旋 =====
function drawFibonacciSpiral(time, alpha) {
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    const centerX = width * 0.5;
    const centerY = height * 0.5;
    const points = 300;
    const bass = getBass();
    const mid = getMid();
    const beat = getBeat();
    const goldenAngle = 2.399963;
    ctx.globalAlpha = alpha;
    ctx.globalCompositeOperation = "lighter";
    for (let i = 0; i < points; i += 1) {
        const ratio = i / points;
        const angle = i * goldenAngle + time * (0.2 + bass * 0.3);
        const dist = Math.sqrt(i) * (8 + mid * 4);
        const x = centerX + Math.cos(angle) * dist;
        const y = centerY + Math.sin(angle) * dist;
        const size = 1 + (1 - ratio) * 4 + beat * 2;
        const hue = (i * 1.5 + time * 10) % 360;
        ctx.fillStyle = `hsla(${hue}, 90%, ${65 + ratio * 25}%, ${0.03 + (1 - ratio) * 0.06 + beat * 0.02})`;
        ctx.beginPath();
        ctx.arc(x, y, size, 0, TAU);
        ctx.fill();
    }
}

// ===== エフェクト65: グリッチ - グリッチエフェクト =====
function drawGlitch(time, alpha) {
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    const bass = getBass();
    const beat = getBeat();
    const treble = getTreble();
    ctx.globalAlpha = alpha;
    ctx.globalCompositeOperation = "lighter";
    const slices = 20;
    const glitchIntensity = beat + bass * 0.5;
    for (let i = 0; i < slices; i += 1) {
        const seed = state.seed + i * 3.7 + Math.floor(time * 8) * 11.1;
        const y = (i / slices) * height;
        const sliceHeight = height / slices;
        const offset = seededSigned(seed) * (30 + glitchIntensity * 100);
        const hue = (i * 18 + time * 20) % 360;
        const channel = Math.floor(seededUnit(seed + 1) * 3);
        const r = channel === 0 ? 1 : 0;
        const g = channel === 1 ? 1 : 0;
        const b = channel === 2 ? 1 : 0;
        ctx.fillStyle = `rgba(${r * 255}, ${g * 255}, ${b * 255}, ${0.03 + glitchIntensity * 0.06})`;
        ctx.fillRect(offset, y, width * (0.3 + seededUnit(seed + 2) * 0.5), sliceHeight * 0.8);
    }
}

// ===== エフェクト66: サイバーサーキット - 回路パターン =====
function drawCyberCircuit(time, alpha) {
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    const bass = getBass();
    const mid = getMid();
    const beat = getBeat();
    ctx.globalAlpha = alpha;
    ctx.globalCompositeOperation = "screen";
    const paths = 30;
    ctx.lineCap = "round";
    for (let p = 0; p < paths; p += 1) {
        const seed = state.seed * 0.3 + p * 12.9;
        let x = width * seededUnit(seed);
        let y = height * seededUnit(seed + 1);
        const hue = (180 + p * 10 + time * 6) % 360;
        ctx.strokeStyle = `hsla(${hue}, 100%, 70%, ${0.03 + mid * 0.04})`;
        ctx.lineWidth = 1 + bass * 1.5;
        ctx.beginPath();
        ctx.moveTo(x, y);
        const segments = 8;
        for (let s = 0; s < segments; s += 1) {
            const dir = Math.floor(seededUnit(seed + s * 2 + 10 + Math.floor(time * 0.5)) * 4);
            const len = 20 + seededUnit(seed + s + 20) * 40 + beat * 20;
            if (dir === 0) x += len;
            else if (dir === 1) x -= len;
            else if (dir === 2) y += len;
            else y -= len;
            ctx.lineTo(x, y);
        }
        ctx.stroke();
        // ジャンクションポイント
        ctx.fillStyle = `hsla(${hue}, 100%, 85%, ${0.05 + beat * 0.04})`;
        ctx.beginPath();
        ctx.arc(x, y, 3 + beat * 2, 0, TAU);
        ctx.fill();
    }
    ctx.lineCap = "butt";
}

// ===== エフェクト67: トルネード - 竜巻 =====
function drawTornado(time, alpha) {
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    const centerX = width * 0.5;
    const levels = 40;
    const bass = getBass();
    const treble = getTreble();
    const beat = getBeat();
    ctx.globalAlpha = alpha;
    ctx.globalCompositeOperation = "lighter";
    for (let l = 0; l < levels; l += 1) {
        const ratio = l / levels;
        const y = height * (0.1 + ratio * 0.8);
        const radius = (10 + ratio * 120 + bass * 50) * (1 + Math.sin(time * 2 + l * 0.3) * 0.2);
        const angle = time * (3 - ratio * 2) + l * 0.4;
        const x = centerX + Math.cos(angle) * radius * 0.3;
        const hue = (200 + ratio * 80 + time * 10) % 360;
        ctx.strokeStyle = `hsla(${hue}, 90%, ${60 + ratio * 25}%, ${0.03 + (1 - ratio) * 0.05 + beat * 0.02})`;
        ctx.lineWidth = 1 + (1 - ratio) * 3 + treble * 2;
        ctx.beginPath();
        ctx.ellipse(x, y, radius, radius * 0.15, angle * 0.1, 0, TAU);
        ctx.stroke();
    }
}

// ===== エフェクト68: ポリゴンモーフ - 変形する多角形 =====
function drawPolygonMorph(time, alpha) {
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    const centerX = width * 0.5;
    const centerY = height * 0.5;
    const bass = getBass();
    const mid = getMid();
    const beat = getBeat();
    ctx.globalAlpha = alpha;
    ctx.globalCompositeOperation = "lighter";
    const layers = 8;
    for (let l = 0; l < layers; l += 1) {
        const sides = 3 + Math.floor(Math.sin(time * 0.2 + l * 0.5) * 1.5 + 1.5) + l;
        const radius = 50 + l * 30 + bass * 40 + Math.sin(time * 0.8 + l) * 15;
        const rot = time * (0.15 + l * 0.03) * (l % 2 === 0 ? 1 : -1);
        const hue = (l * 40 + time * 8) % 360;
        ctx.strokeStyle = `hsla(${hue}, 100%, ${65 + l * 4}%, ${0.04 + mid * 0.04 + beat * 0.03})`;
        ctx.lineWidth = 1.5 + l * 0.3 + beat * 2;
        ctx.beginPath();
        for (let s = 0; s <= sides; s += 1) {
            const angle = rot + s * TAU / sides;
            const x = centerX + Math.cos(angle) * radius;
            const y = centerY + Math.sin(angle) * radius;
            if (s === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        }
        ctx.closePath();
        ctx.stroke();
    }
}

// ===== エフェクト69: アトミック - 原子模型 =====
function drawAtomic(time, alpha) {
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    const centerX = width * 0.5;
    const centerY = height * 0.5;
    const orbits = 5;
    const bass = getBass();
    const mid = getMid();
    const beat = getBeat();
    ctx.globalAlpha = alpha;
    ctx.globalCompositeOperation = "lighter";
    // 核
    const nucleusSize = 8 + bass * 12 + beat * 8;
    const nucleusHue = (60 + time * 15) % 360;
    ctx.fillStyle = `hsla(${nucleusHue}, 100%, 80%, ${0.1 + beat * 0.08})`;
    ctx.beginPath();
    ctx.arc(centerX, centerY, nucleusSize, 0, TAU);
    ctx.fill();
    // 電子軌道
    for (let o = 0; o < orbits; o += 1) {
        const orbitRadius = 60 + o * 40 + mid * 30;
        const tilt = o * Math.PI / orbits + time * 0.1;
        const hue = (200 + o * 35 + time * 8) % 360;
        ctx.strokeStyle = `hsla(${hue}, 80%, 65%, ${0.03 + mid * 0.03})`;
        ctx.lineWidth = 1 + beat * 1;
        ctx.beginPath();
        ctx.ellipse(centerX, centerY, orbitRadius, orbitRadius * 0.3, tilt, 0, TAU);
        ctx.stroke();
        // 電子
        const electronAngle = time * (1.5 + o * 0.3) + o * TAU / orbits;
        const ex = centerX + Math.cos(electronAngle) * orbitRadius * Math.cos(tilt) - Math.sin(electronAngle) * orbitRadius * 0.3 * Math.sin(tilt);
        const ey = centerY + Math.cos(electronAngle) * orbitRadius * Math.sin(tilt) + Math.sin(electronAngle) * orbitRadius * 0.3 * Math.cos(tilt);
        ctx.fillStyle = `hsla(${hue}, 100%, 85%, ${0.08 + beat * 0.06})`;
        ctx.beginPath();
        ctx.arc(ex, ey, 3 + beat * 3, 0, TAU);
        ctx.fill();
    }
}

// ===== エフェクト70: シャドウモス - うごめく苔影 =====
function drawShadowMoss(time, alpha) {
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    const patches = 100;
    const bass = getBass();
    const mid = getMid();
    const beat = getBeat();
    ctx.globalAlpha = alpha;
    ctx.globalCompositeOperation = "screen";
    for (let i = 0; i < patches; i += 1) {
        const seed = state.seed * 0.6 + i * 8.91;
        const px = seededUnit(seed);
        const py = seededUnit(seed + 1);
        const x = width * px + Math.sin(time * 0.4 + i * 0.2) * (10 + bass * 20);
        const y = height * py + Math.cos(time * 0.3 + i * 0.15) * (10 + mid * 18);
        const size = 5 + seededUnit(seed + 2) * 15 + bass * 8;
        const hue = (100 + py * 60 + time * 3) % 360;
        const grad = ctx.createRadialGradient(x, y, 0, x, y, size);
        grad.addColorStop(0, `hsla(${hue}, 70%, 50%, ${0.04 + beat * 0.03})`);
        grad.addColorStop(1, `hsla(${hue}, 60%, 30%, 0)`);
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(x, y, size, 0, TAU);
        ctx.fill();
    }
}

// ===== エフェクト71: ダイヤモンドグリッド - ダイヤ格子 =====
function drawDiamondGrid(time, alpha) {
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    const bass = getBass();
    const mid = getMid();
    const beat = getBeat();
    const spacing = 40 + bass * 20;
    ctx.globalAlpha = alpha;
    ctx.globalCompositeOperation = "screen";
    for (let x = -spacing; x < width + spacing; x += spacing) {
        for (let y = -spacing; y < height + spacing; y += spacing) {
            const offset = (Math.floor(y / spacing) % 2) * spacing * 0.5;
            const cx = x + offset;
            const dist = Math.hypot(cx - width * 0.5, y - height * 0.5) / Math.max(width, height);
            const pulse = Math.sin(dist * 10 - time * 2 + bass * 4) * 0.5 + 0.5;
            const size = (spacing * 0.3 + pulse * spacing * 0.15) * (0.8 + mid * 0.4);
            const hue = (220 + dist * 100 + time * 6) % 360;
            ctx.strokeStyle = `hsla(${hue}, 90%, ${60 + pulse * 25}%, ${0.02 + pulse * 0.06 + beat * 0.02})`;
            ctx.lineWidth = 1 + pulse * 1.5;
            ctx.save();
            ctx.translate(cx, y);
            ctx.rotate(Math.PI / 4 + time * 0.05);
            ctx.strokeRect(-size / 2, -size / 2, size, size);
            ctx.restore();
        }
    }
}

// ===== エフェクト72: プリズムレインボー - プリズム虹 =====
function drawPrismRainbow(time, alpha) {
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    const bass = getBass();
    const mid = getMid();
    const beat = getBeat();
    ctx.globalAlpha = alpha;
    ctx.globalCompositeOperation = "lighter";
    const beams = 7;
    const centerX = width * 0.5;
    const centerY = height * 0.3;
    for (let b = 0; b < beams; b += 1) {
        const hue = b * 50;
        const spread = (b - 3) * 0.15 + Math.sin(time * 0.5 + b) * 0.05;
        const len = Math.max(width, height) * 0.8;
        const angle = -Math.PI / 2 + spread + Math.sin(time * 0.3) * 0.1;
        const endX = centerX + Math.cos(angle) * len;
        const endY = centerY + Math.sin(angle) * len;
        const grad = ctx.createLinearGradient(centerX, centerY, endX, endY);
        grad.addColorStop(0, `hsla(${hue}, 100%, 80%, ${0.08 + bass * 0.08})`);
        grad.addColorStop(0.5, `hsla(${hue}, 100%, 65%, ${0.04 + mid * 0.06})`);
        grad.addColorStop(1, `hsla(${hue}, 100%, 50%, 0)`);
        ctx.strokeStyle = grad;
        ctx.lineWidth = 8 + b * 2 + beat * 5;
        ctx.beginPath();
        ctx.moveTo(centerX, centerY);
        ctx.lineTo(endX, endY);
        ctx.stroke();
    }
}

// ===== エフェクト73: スネークトレイル - 蛇行する軌跡 =====
function drawSnakeTrail(time, alpha) {
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    const snakes = 8;
    const bass = getBass();
    const mid = getMid();
    const beat = getBeat();
    ctx.globalAlpha = alpha;
    ctx.globalCompositeOperation = "lighter";
    ctx.lineCap = "round";
    for (let s = 0; s < snakes; s += 1) {
        const seed = state.seed + s * 23.1;
        const hue = (s * 45 + time * 10) % 360;
        ctx.strokeStyle = `hsla(${hue}, 100%, 72%, ${0.04 + mid * 0.04})`;
        ctx.lineWidth = 2 + s * 0.5 + beat * 2;
        ctx.beginPath();
        const points = 60;
        for (let p = 0; p <= points; p += 1) {
            const t = p / points;
            const baseX = width * (0.1 + seededUnit(seed) * 0.8);
            const baseY = height * (0.1 + seededUnit(seed + 1) * 0.8);
            const angle = time * (0.5 + s * 0.1) + t * TAU * 2;
            const dist = t * Math.min(width, height) * (0.15 + bass * 0.1);
            const x = baseX + Math.cos(angle) * dist + Math.sin(t * 10 + time * 2) * (15 + mid * 20);
            const y = baseY + Math.sin(angle * 1.3) * dist + Math.cos(t * 8 + time * 1.5) * (15 + beat * 20);
            if (p === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        }
        ctx.stroke();
    }
    ctx.lineCap = "butt";
}

// ===== エフェクト74: ストロボライト - ストロボ光 =====
function drawStrobeLight(time, alpha) {
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    const bass = getBass();
    const beat = getBeat();
    const mid = getMid();
    ctx.globalAlpha = alpha;
    ctx.globalCompositeOperation = "lighter";
    const beams = 16;
    const centerX = width * 0.5;
    const centerY = height * 0.3;
    for (let b = 0; b < beams; b += 1) {
        const angle = (b / beams) * TAU + time * 0.3 + Math.sin(time * 2 + b) * 0.2;
        const len = Math.max(width, height) * (0.4 + bass * 0.3);
        const spread = 0.04 + beat * 0.06;
        const hue = (b * 22 + time * 12) % 360;
        const intensity = Math.sin(time * (4 + b * 0.5)) * 0.5 + 0.5;
        ctx.fillStyle = `hsla(${hue}, 100%, ${70 + intensity * 25}%, ${0.02 + intensity * 0.06 + beat * 0.03})`;
        ctx.beginPath();
        ctx.moveTo(centerX, centerY);
        ctx.lineTo(centerX + Math.cos(angle - spread) * len, centerY + Math.sin(angle - spread) * len);
        ctx.lineTo(centerX + Math.cos(angle + spread) * len, centerY + Math.sin(angle + spread) * len);
        ctx.closePath();
        ctx.fill();
    }
}

// ===== エフェクト75: コズミックダスト - 宇宙塵 =====
function drawCosmicDust(time, alpha) {
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    const count = 250;
    const bass = getBass();
    const mid = getMid();
    const treble = getTreble();
    const beat = getBeat();
    ctx.globalAlpha = alpha;
    ctx.globalCompositeOperation = "lighter";
    for (let i = 0; i < count; i += 1) {
        const seed = state.seed * 2.5 + i * 6.29;
        const px = seededUnit(seed);
        const py = seededUnit(seed + 1);
        const depth = seededUnit(seed + 2);
        const speed = 0.02 + depth * 0.05 + bass * 0.04;
        const x = fract(px + time * speed * (depth > 0.5 ? 1 : -1)) * (width + 60) - 30;
        const y = height * py + Math.sin(time * 0.5 + i * 0.1) * (8 + treble * 15);
        const size = 0.5 + depth * 3 + mid * 2;
        const hue = (200 + depth * 100 + py * 40 + time * 5) % 360;
        ctx.fillStyle = `hsla(${hue}, 80%, ${65 + depth * 25}%, ${0.01 + depth * 0.05 + beat * 0.02})`;
        ctx.beginPath();
        ctx.arc(x, y, size, 0, TAU);
        ctx.fill();
    }
}

function drawHelixTower(time, alpha) {
    const w = canvas.clientWidth, h = canvas.clientHeight, cx = w*0.5, cy = h*0.5;
    const bass = getBass(), mid = getMid(), beat = getBeat();
    ctx.globalAlpha = alpha; ctx.globalCompositeOperation = "lighter";
    for (let l = 0; l < 30; l++) {
        const t = l/30, y = h*(0.05+t*0.9);
        const r = 40+t*100+bass*60, angle = time*(2-t)+l*0.5;
        const x1 = cx+Math.cos(angle)*r, x2 = cx+Math.cos(angle+Math.PI)*r;
        const hue = (200+t*120+time*10)%360;
        ctx.fillStyle = `hsla(${hue},100%,${70+beat*20}%,${0.04+mid*0.05})`;
        ctx.beginPath(); ctx.arc(x1,y,3+beat*3,0,TAU); ctx.fill();
        ctx.beginPath(); ctx.arc(x2,y,3+beat*3,0,TAU); ctx.fill();
        ctx.strokeStyle = `hsla(${hue},80%,65%,${0.03+mid*0.03})`;
        ctx.lineWidth = 1+beat; ctx.beginPath(); ctx.moveTo(x1,y); ctx.lineTo(x2,y); ctx.stroke();
    }
}
function drawShockwave(time, alpha) {
    const w = canvas.clientWidth, h = canvas.clientHeight, cx = w*0.5, cy = h*0.5;
    const bass = getBass(), beat = getBeat(), mid = getMid();
    ctx.globalAlpha = alpha; ctx.globalCompositeOperation = "screen";
    for (let i = 0; i < 8; i++) {
        const phase = fract(time*(0.12+bass*0.1)+i/8);
        const r = Math.min(w,h)*phase*0.5;
        const fade = Math.pow(1-phase,2);
        const hue = (0+i*40+time*12)%360;
        ctx.strokeStyle = `hsla(${hue},100%,${65+fade*25}%,${fade*0.14+beat*0.05})`;
        ctx.lineWidth = 2+fade*8+bass*4;
        ctx.beginPath(); ctx.arc(cx,cy,r,0,TAU); ctx.stroke();
    }
}
function drawNorthernLights(time, alpha) {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    const bass = getBass(), mid = getMid(), treble = getTreble();
    ctx.globalAlpha = alpha; ctx.globalCompositeOperation = "lighter";
    for (let b = 0; b < 10; b++) {
        const hue = (100+b*25+time*4)%360;
        const grad = ctx.createLinearGradient(0,h*0.1,0,h*0.6);
        grad.addColorStop(0, `hsla(${hue},100%,70%,${0.06+bass*0.08})`);
        grad.addColorStop(1, `hsla(${hue},80%,40%,0)`);
        ctx.fillStyle = grad;
        ctx.beginPath(); ctx.moveTo(-20,h*0.6);
        for (let x = -20; x <= w+20; x += 16) {
            const nx = x/w;
            const y = h*(0.15+b*0.04)+Math.sin(nx*6+time*(0.3+b*0.04)+b)*( 30+bass*40)+Math.cos(nx*10-time*0.5+b*2)*(12+mid*20);
            ctx.lineTo(x,y);
        }
        ctx.lineTo(w+20,h*0.6); ctx.closePath(); ctx.fill();
    }
}
function drawParticleWeb(time, alpha) {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    const bass = getBass(), mid = getMid(), beat = getBeat();
    ctx.globalAlpha = alpha; ctx.globalCompositeOperation = "lighter";
    const n = 40, pos = [];
    for (let i = 0; i < n; i++) {
        const s = state.seed*1.8+i*13.7;
        const x = w*seededUnit(s)+Math.sin(time*0.3+i)*( 25+bass*35);
        const y = h*seededUnit(s+1)+Math.cos(time*0.25+i*0.4)*(25+mid*30);
        pos.push({x,y});
        ctx.fillStyle = `hsla(${(i*9+time*8)%360},100%,80%,${0.05+beat*0.04})`;
        ctx.beginPath(); ctx.arc(x,y,2+beat*2,0,TAU); ctx.fill();
    }
    const maxD = 140+bass*70;
    for (let i = 0; i < n; i++) for (let j = i+1; j < n; j++) {
        const d = Math.hypot(pos[i].x-pos[j].x, pos[i].y-pos[j].y);
        if (d < maxD) {
            const f = 1-d/maxD;
            ctx.strokeStyle = `hsla(${((i+j)*6+time*5)%360},90%,72%,${f*0.05})`;
            ctx.lineWidth = f*1.5; ctx.beginPath();
            ctx.moveTo(pos[i].x,pos[i].y); ctx.lineTo(pos[j].x,pos[j].y); ctx.stroke();
        }
    }
}
function drawRippleGrid(time, alpha) {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    const bass = getBass(), mid = getMid(), beat = getBeat();
    const sp = 32+bass*16; ctx.globalAlpha = alpha; ctx.globalCompositeOperation = "screen";
    for (let x = sp; x < w; x += sp) for (let y = sp; y < h; y += sp) {
        const d = Math.hypot(x-w*0.5,y-h*0.5)/Math.max(w,h);
        const wave = Math.sin(d*20-time*3+bass*5)*0.5+0.5;
        const sz = 2+wave*4+beat*3;
        ctx.fillStyle = `hsla(${(d*200+time*8)%360},100%,${60+wave*25}%,${0.02+wave*0.06})`;
        ctx.beginPath(); ctx.arc(x,y,sz,0,TAU); ctx.fill();
    }
}
function drawPlasmaBall(time, alpha) {
    const w = canvas.clientWidth, h = canvas.clientHeight, cx = w*0.5, cy = h*0.5;
    const bass = getBass(), treble = getTreble(), beat = getBeat();
    ctx.globalAlpha = alpha; ctx.globalCompositeOperation = "lighter"; ctx.lineCap = "round";
    const tendrils = 16, coreR = 20+bass*15;
    ctx.fillStyle = `hsla(${(280+time*10)%360},100%,80%,${0.08+beat*0.06})`;
    ctx.beginPath(); ctx.arc(cx,cy,coreR,0,TAU); ctx.fill();
    for (let t = 0; t < tendrils; t++) {
        const angle = t*TAU/tendrils+time*0.5;
        const hue = (260+t*20+time*12)%360;
        ctx.strokeStyle = `hsla(${hue},100%,75%,${0.04+treble*0.06})`;
        ctx.lineWidth = 1.5+beat*2; ctx.beginPath(); ctx.moveTo(cx,cy);
        let px=cx, py=cy;
        for (let s = 0; s < 12; s++) {
            const r = coreR+(s+1)*15+treble*s*5;
            const a = angle+Math.sin(time*3+t+s*0.7)*0.5;
            px = cx+Math.cos(a)*r; py = cy+Math.sin(a)*r;
            ctx.lineTo(px,py);
        }
        ctx.stroke();
    }
    ctx.lineCap = "butt";
}
function drawStarBurst(time, alpha) {
    const w = canvas.clientWidth, h = canvas.clientHeight, cx = w*0.5, cy = h*0.5;
    const bass = getBass(), beat = getBeat(), mid = getMid();
    ctx.globalAlpha = alpha; ctx.globalCompositeOperation = "lighter";
    const rays = 36;
    for (let i = 0; i < rays; i++) {
        const angle = i*TAU/rays+time*0.2;
        const energy = sampleSpectrum(i/rays);
        const len = Math.min(w,h)*(0.15+energy*0.35+beat*0.1);
        const hue = (i*10+time*14)%360;
        ctx.strokeStyle = `hsla(${hue},100%,${70+energy*20}%,${0.03+energy*0.1})`;
        ctx.lineWidth = 2+energy*5+bass*3;
        ctx.beginPath(); ctx.moveTo(cx,cy);
        ctx.lineTo(cx+Math.cos(angle)*len, cy+Math.sin(angle)*len); ctx.stroke();
    }
}
function drawWaveMesh(time, alpha) {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    const bass = getBass(), mid = getMid(), beat = getBeat();
    ctx.globalAlpha = alpha; ctx.globalCompositeOperation = "screen";
    for (let i = 0; i < 14; i++) {
        const vert = i%2===0;
        const hue = (200+i*18+time*6)%360;
        ctx.strokeStyle = `hsla(${hue},90%,68%,${0.03+mid*0.04})`;
        ctx.lineWidth = 1+bass*1.5;
        ctx.beginPath();
        if (vert) {
            const x0 = w*(i/14);
            for (let y = 0; y <= h; y += 10) {
                const ny = y/h;
                const x = x0+Math.sin(ny*8+time*(1+bass*2)+i)*( 20+mid*30);
                if (y===0) ctx.moveTo(x,y); else ctx.lineTo(x,y);
            }
        } else {
            const y0 = h*((i-1)/14);
            for (let x = 0; x <= w; x += 10) {
                const nx = x/w;
                const y = y0+Math.sin(nx*8+time*(1+mid*2)+i)*(20+bass*30);
                if (x===0) ctx.moveTo(x,y); else ctx.lineTo(x,y);
            }
        }
        ctx.stroke();
    }
}
function drawFireflies(time, alpha) {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    const treble = getTreble(), beat = getBeat(), level = getLevel();
    ctx.globalAlpha = alpha; ctx.globalCompositeOperation = "lighter";
    for (let i = 0; i < 100; i++) {
        const s = state.seed*1.3+i*9.47;
        const px = seededUnit(s), py = seededUnit(s+1);
        const blink = Math.sin(time*(2+i*0.1)+s)*0.5+0.5;
        const x = w*px+Math.sin(time*0.4+i*0.3)*(20+treble*25);
        const y = h*py+Math.cos(time*0.35+i*0.2)*(20+level*20);
        const sz = (1+blink*4+beat*3)*( 0.5+treble);
        const hue = (60+px*40+time*5)%360;
        ctx.fillStyle = `hsla(${hue},90%,${70+blink*25}%,${0.02+blink*0.1})`;
        ctx.beginPath(); ctx.arc(x,y,sz,0,TAU); ctx.fill();
    }
}
function drawRadialBars(time, alpha) {
    const w = canvas.clientWidth, h = canvas.clientHeight, cx = w*0.5, cy = h*0.5;
    const bass = getBass(), beat = getBeat();
    ctx.globalAlpha = alpha; ctx.globalCompositeOperation = "lighter";
    const bars = 64, innerR = Math.min(w,h)*0.1;
    for (let i = 0; i < bars; i++) {
        const ratio = i/bars, energy = sampleSpectrum(ratio);
        const angle = ratio*TAU+time*0.15;
        const outerR = innerR+energy*Math.min(w,h)*0.3+beat*20;
        const hue = (ratio*360+time*12)%360;
        ctx.strokeStyle = `hsla(${hue},100%,${65+energy*25}%,${0.04+energy*0.12})`;
        ctx.lineWidth = TAU*innerR/bars*0.6;
        ctx.beginPath();
        ctx.moveTo(cx+Math.cos(angle)*innerR, cy+Math.sin(angle)*innerR);
        ctx.lineTo(cx+Math.cos(angle)*outerR, cy+Math.sin(angle)*outerR);
        ctx.stroke();
    }
}
function drawCloudDrift(time, alpha) {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    const bass = getBass(), mid = getMid(), beat = getBeat();
    ctx.globalAlpha = alpha; ctx.globalCompositeOperation = "lighter";
    for (let i = 0; i < 12; i++) {
        const s = state.seed*0.9+i*22.3;
        const speed = 0.02+seededUnit(s)*0.03+bass*0.03;
        const cx = fract(seededUnit(s+1)+time*speed)*( w+200)-100;
        const cy = h*(0.15+seededUnit(s+2)*0.5)+Math.sin(time*0.3+i)*(15+mid*20);
        const r = 40+seededUnit(s+3)*60+bass*30;
        const hue = (210+i*15+time*4)%360;
        const g = ctx.createRadialGradient(cx,cy,r*0.1,cx,cy,r);
        g.addColorStop(0, `hsla(${hue},60%,70%,${0.05+mid*0.05})`);
        g.addColorStop(1, `hsla(${hue},50%,50%,0)`);
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx,cy,r,0,TAU); ctx.fill();
    }
}
function drawLaserGrid(time, alpha) {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    const bass = getBass(), mid = getMid(), beat = getBeat();
    ctx.globalAlpha = alpha; ctx.globalCompositeOperation = "screen";
    const n = 12;
    for (let i = 0; i < n; i++) {
        const hue = (i*30+time*10)%360;
        const intensity = sampleSpectrum(i/n);
        ctx.strokeStyle = `hsla(${hue},100%,${65+intensity*25}%,${0.03+intensity*0.08})`;
        ctx.lineWidth = 1+intensity*3+beat*2;
        const x = w*(i/n)+Math.sin(time*0.5+i)*( 10+beat*20);
        ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,h); ctx.stroke();
        const y = h*(i/n)+Math.cos(time*0.4+i)*(10+beat*20);
        ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(w,y); ctx.stroke();
    }
}
function drawPulseCircles(time, alpha) {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    const bass = getBass(), mid = getMid(), beat = getBeat();
    ctx.globalAlpha = alpha; ctx.globalCompositeOperation = "lighter";
    for (let i = 0; i < 20; i++) {
        const s = state.seed+i*15.3;
        const cx = w*seededUnit(s), cy = h*seededUnit(s+1);
        const phase = fract(time*(0.3+seededUnit(s+2)*0.2)+seededUnit(s+3));
        const r = phase*60+bass*30; const fade = 1-phase;
        const hue = (i*18+time*8)%360;
        ctx.strokeStyle = `hsla(${hue},100%,72%,${fade*0.1+beat*0.04})`;
        ctx.lineWidth = 1+fade*3; ctx.beginPath(); ctx.arc(cx,cy,r,0,TAU); ctx.stroke();
    }
}
function drawOrbitTrails(time, alpha) {
    const w = canvas.clientWidth, h = canvas.clientHeight, cx = w*0.5, cy = h*0.5;
    const bass = getBass(), mid = getMid(), beat = getBeat();
    ctx.globalAlpha = alpha; ctx.globalCompositeOperation = "lighter"; ctx.lineCap = "round";
    for (let o = 0; o < 6; o++) {
        const r = 60+o*45+bass*40;
        const hue = (o*55+time*10)%360;
        ctx.strokeStyle = `hsla(${hue},100%,72%,${0.04+mid*0.04})`;
        ctx.lineWidth = 2+o*0.5+beat*2; ctx.beginPath();
        const dir = o%2===0?1:-1;
        for (let p = 0; p <= 80; p++) {
            const t = p/80, angle = time*(0.5+o*0.12)*dir+t*TAU*0.7;
            const x = cx+Math.cos(angle)*(r+Math.sin(t*10+time)*( 10+beat*15));
            const y = cy+Math.sin(angle)*(r+Math.cos(t*8+time)*(10+beat*15));
            if (p===0) ctx.moveTo(x,y); else ctx.lineTo(x,y);
        }
        ctx.stroke();
    }
    ctx.lineCap = "butt";
}
function drawFractalRings(time, alpha) {
    const w = canvas.clientWidth, h = canvas.clientHeight, cx = w*0.5, cy = h*0.5;
    const bass = getBass(), beat = getBeat(), mid = getMid();
    ctx.globalAlpha = alpha; ctx.globalCompositeOperation = "screen";
    for (let i = 0; i < 12; i++) {
        const r = 20+i*25+bass*20;
        const segments = 3+i;
        const rot = time*(0.1+i*0.03)*(i%2===0?1:-1);
        const hue = (i*30+time*8)%360;
        ctx.strokeStyle = `hsla(${hue},100%,70%,${0.03+mid*0.04+beat*0.02})`;
        ctx.lineWidth = 1+beat*1.5; ctx.beginPath();
        for (let s = 0; s <= segments; s++) {
            const a = rot+s*TAU/segments;
            const x = cx+Math.cos(a)*r, y = cy+Math.sin(a)*r;
            if (s===0) ctx.moveTo(x,y); else ctx.lineTo(x,y);
        }
        ctx.closePath(); ctx.stroke();
    }
}
function drawLightPillars(time, alpha) {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    const bass = getBass(), mid = getMid(), beat = getBeat();
    ctx.globalAlpha = alpha; ctx.globalCompositeOperation = "lighter";
    const pillars = 14;
    for (let i = 0; i < pillars; i++) {
        const x = w*(i+0.5)/pillars+Math.sin(time*0.3+i)*(8+beat*15);
        const energy = sampleSpectrum(i/pillars);
        const pillarH = h*(0.2+energy*0.6+bass*0.15);
        const hue = (i*25+time*8)%360;
        const g = ctx.createLinearGradient(x,h-pillarH,x,h);
        g.addColorStop(0, `hsla(${hue},100%,80%,0)`);
        g.addColorStop(0.3, `hsla(${hue},100%,75%,${0.05+energy*0.1})`);
        g.addColorStop(1, `hsla(${hue},90%,60%,${0.03+energy*0.08+beat*0.03})`);
        ctx.fillStyle = g;
        ctx.fillRect(x-4-energy*6,h-pillarH,8+energy*12,pillarH);
    }
}
function drawSpiralGalaxy3D(time, alpha) {
    const bass = getBass(), mid = getMid(), beat = getBeat();
    ctx.globalAlpha = alpha; ctx.globalCompositeOperation = "lighter";
    for (let i = 0; i < 200; i++) {
        const t = i/200, arm = i%2;
        const angle = t*TAU*4+arm*Math.PI+time*(0.15+bass*0.2);
        const dist = t*200+mid*50;
        const x = Math.cos(angle)*dist, y = Math.sin(angle)*dist*0.5, z = Math.sin(angle)*dist*0.3;
        const rot = rotatePoint3D(x,y,z,time*0.15,time*0.1,0);
        const proj = projectPoint3D(rot.x,rot.y,rot.z+800);
        if (!proj) continue;
        const fade = depthFade(rot.z+800,400,1200);
        const hue = (t*120+arm*60+time*10)%360;
        ctx.fillStyle = `hsla(${hue},90%,${65+fade*25}%,${0.02+fade*0.06+beat*0.02})`;
        ctx.beginPath(); ctx.arc(proj.x,proj.y,1+proj.scale*5+beat,0,TAU); ctx.fill();
    }
}
function drawSineField(time, alpha) {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    const bass = getBass(), mid = getMid(), beat = getBeat();
    ctx.globalAlpha = alpha; ctx.globalCompositeOperation = "screen";
    for (let i = 0; i < 16; i++) {
        const hue = (i*22+time*7)%360;
        ctx.strokeStyle = `hsla(${hue},100%,68%,${0.03+mid*0.04})`;
        ctx.lineWidth = 1+bass*1.5;
        traceHorizontalPath(-20,w+20,10,(x)=>{
            const nx = x/w;
            return h*(0.1+i*0.05)+Math.sin(nx*TAU*(1+i*0.5)+time*(1+i*0.1+bass*2))*( 15+mid*25+beat*10);
        });
        ctx.stroke();
    }
}
function drawButterfly(time, alpha) {
    const w = canvas.clientWidth, h = canvas.clientHeight, cx = w*0.5, cy = h*0.5;
    const bass = getBass(), mid = getMid(), beat = getBeat();
    ctx.globalAlpha = alpha; ctx.globalCompositeOperation = "lighter";
    for (let c = 0; c < 4; c++) {
        const hue = (c*80+time*10)%360;
        ctx.strokeStyle = `hsla(${hue},100%,72%,${0.04+mid*0.04})`;
        ctx.lineWidth = 1.5+c*0.3+beat*2; ctx.beginPath();
        for (let i = 0; i <= 200; i++) {
            const t = i/200*TAU*4;
            const r = Math.exp(Math.cos(t))-2*Math.cos(4*t)+Math.pow(Math.sin(t/12),5);
            const scale = 50+c*15+bass*30;
            const x = cx+Math.sin(t+time*0.2+c*0.5)*r*scale;
            const y = cy-Math.cos(t+time*0.2+c*0.5)*r*scale*0.8;
            if (i===0) ctx.moveTo(x,y); else ctx.lineTo(x,y);
        }
        ctx.stroke();
    }
}
function drawSmokeRings(time, alpha) {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    const bass = getBass(), mid = getMid(), beat = getBeat();
    ctx.globalAlpha = alpha; ctx.globalCompositeOperation = "screen";
    for (let i = 0; i < 10; i++) {
        const s = state.seed*0.4+i*18.7;
        const phase = fract(time*(0.04+seededUnit(s)*0.03)+seededUnit(s+1));
        const cx = w*(0.3+seededUnit(s+2)*0.4);
        const cy = h*0.8-phase*h*0.7;
        const r = 15+phase*50+bass*25;
        const fade = (1-phase)*(1-phase);
        const hue = (200+i*20+time*5)%360;
        ctx.strokeStyle = `hsla(${hue},70%,65%,${fade*0.08+beat*0.02})`;
        ctx.lineWidth = 1+fade*4;
        ctx.beginPath(); ctx.ellipse(cx+Math.sin(time+i)*( 15+mid*20),cy,r,r*0.4,Math.sin(time*0.5+i)*0.3,0,TAU); ctx.stroke();
    }
}
function drawPixelRain(time, alpha) {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    const bass = getBass(), treble = getTreble(), beat = getBeat();
    const pxSz = 4; ctx.globalAlpha = alpha; ctx.globalCompositeOperation = "lighter";
    for (let i = 0; i < 200; i++) {
        const s = state.seed*2+i*4.31;
        const col = seededUnit(s), speed = 0.1+col*0.2+bass*0.15;
        const phase = fract(time*speed+seededUnit(s+1));
        const x = Math.floor(w*col/pxSz)*pxSz;
        const y = Math.floor(phase*h/pxSz)*pxSz;
        const hue = (col*360+time*12)%360;
        const fade = 1-phase;
        ctx.fillStyle = `hsla(${hue},100%,${60+fade*30}%,${0.03+fade*0.08+beat*0.03})`;
        ctx.fillRect(x,y,pxSz,pxSz);
    }
}
function drawHorizonGlow(time, alpha) {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    const bass = getBass(), mid = getMid(), beat = getBeat();
    ctx.globalAlpha = alpha; ctx.globalCompositeOperation = "lighter";
    const layers = 6;
    for (let l = 0; l < layers; l++) {
        const y0 = h*(0.4+l*0.08);
        const hue = (200+l*30+time*5)%360;
        const g = ctx.createLinearGradient(0,y0-40,0,y0+60);
        g.addColorStop(0, `hsla(${hue},100%,70%,0)`);
        g.addColorStop(0.5, `hsla(${hue},100%,65%,${0.05+bass*0.06+beat*0.03})`);
        g.addColorStop(1, `hsla(${hue},80%,50%,0)`);
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.moveTo(-20,y0+60);
        for (let x = -20; x <= w+20; x += 14) {
            const nx = x/w;
            const y = y0+Math.sin(nx*5+time*(0.4+l*0.06)+l)*(15+mid*25)+Math.cos(nx*9-time*0.3+l*2)*(8+bass*15);
            ctx.lineTo(x,y);
        }
        ctx.lineTo(w+20,y0+60); ctx.closePath(); ctx.fill();
    }
}
function drawChainLightning(time, alpha) {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    const bass = getBass(), beat = getBeat(), treble = getTreble();
    ctx.globalAlpha = alpha; ctx.globalCompositeOperation = "lighter"; ctx.lineCap = "round";
    const chains = 6;
    for (let c = 0; c < chains; c++) {
        const s = state.seed+c*33.1+Math.floor(time*2)*7.3;
        let x = w*seededUnit(s), y = h*0.1+seededUnit(s+1)*h*0.3;
        const hue = (180+c*40+time*15)%360;
        const intensity = Math.sin(time*5+c*2)*0.5+0.5;
        ctx.strokeStyle = `hsla(${hue},100%,${70+intensity*25}%,${0.04+intensity*0.1+beat*0.05})`;
        ctx.lineWidth = 1+intensity*3+bass*2; ctx.beginPath(); ctx.moveTo(x,y);
        for (let seg = 0; seg < 20; seg++) {
            x += seededSigned(s+seg*2.7)*(40+bass*50);
            y += 15+seededUnit(s+seg*3.1)*20+treble*10;
            ctx.lineTo(x,y);
        }
        ctx.stroke();
    }
    ctx.lineCap = "butt";
}
function drawHypnoSpiral(time, alpha) {
    const w = canvas.clientWidth, h = canvas.clientHeight, cx = w*0.5, cy = h*0.5;
    const bass = getBass(), mid = getMid(), beat = getBeat();
    ctx.globalAlpha = alpha; ctx.globalCompositeOperation = "screen";
    for (let s = 0; s < 4; s++) {
        const hue = (s*90+time*12)%360;
        ctx.strokeStyle = `hsla(${hue},100%,70%,${0.04+mid*0.04})`;
        ctx.lineWidth = 2+s*0.5+beat*2; ctx.beginPath();
        for (let i = 0; i <= 200; i++) {
            const t = i/200;
            const r = t*Math.min(w,h)*0.4;
            const angle = t*TAU*6+s*TAU/4+time*(0.5+bass*0.4);
            const x = cx+Math.cos(angle)*r, y = cy+Math.sin(angle)*r;
            if (i===0) ctx.moveTo(x,y); else ctx.lineTo(x,y);
        }
        ctx.stroke();
    }
}

const modes = [
    { name: "Aurora", draw: drawAurora },
    { name: "Bloom", draw: drawBloom },
    { name: "Halo", draw: drawHalo },
    { name: "Petals", draw: drawPetals },
    { name: "Silk", draw: drawSilk },
    { name: "Drift", draw: drawDrift },
    { name: "Prism", draw: drawPrism },
    { name: "Vortex", draw: drawVortex },
    { name: "Grid Pulse", draw: drawGridPulse },
    { name: "Nebula", draw: drawNebula },
    { name: "Rain", draw: drawRain },
    { name: "Fan", draw: drawFan },
    { name: "Orbitals", draw: drawOrbitals },
    { name: "Lattice", draw: drawLattice },
    { name: "Mirage", draw: drawMirage },
    { name: "Comets", draw: drawComets },
    { name: "Ripple Field", draw: drawRippleField },
    { name: "Spectrum Ring", draw: drawSpectrumRing },
    { name: "Tunnel", draw: drawTunnel },
    { name: "Parallax Bands", draw: drawParallaxBands },
    { name: "Wire Tunnel 3D", draw: drawWireTunnel3D },
    { name: "Cube Field 3D", draw: drawCubeField3D },
    { name: "Starfield 3D", draw: drawStarfield3D },
    { name: "Torus Orbit 3D", draw: drawTorusOrbit3D },
    { name: "Skyline Depth 3D", draw: drawSkylineDepth3D },
    { name: "Diamond Dust", draw: drawDiamondDust },
    { name: "Hex Grid", draw: drawHexGrid },
    { name: "Plasma Field", draw: drawPlasmaField },
    { name: "Lightning", draw: drawLightning },
    { name: "Sakura", draw: drawSakura },
    { name: "Sonar Pulse", draw: drawSonarPulse },
    { name: "Matrix Rain", draw: drawMatrixRain },
    { name: "Fractal Tree", draw: drawFractalTree },
    { name: "Galaxy Swirl", draw: drawGalaxySwirl },
    { name: "Sound Bars", draw: drawSoundBars },
    { name: "Electric Field", draw: drawElectricField },
    { name: "Bubble Rise", draw: drawBubbleRise },
    { name: "DNA Helix", draw: drawDNAHelix },
    { name: "Flame Burst", draw: drawFlameBurst },
    { name: "Wave Interference", draw: drawWaveInterference },
    { name: "Pixel Storm", draw: drawPixelStorm },
    { name: "Strings", draw: drawStrings },
    { name: "Constellation", draw: drawConstellation },
    { name: "Pendulum Wave", draw: drawPendulumWave },
    { name: "Flow Field", draw: drawFlowField },
    { name: "Moire", draw: drawMoire },
    { name: "Sandstorm", draw: drawSandstorm },
    { name: "Kaleidoscope", draw: drawKaleidoscope },
    { name: "Lissajous", draw: drawLissajous },
    { name: "Pulse Wave", draw: drawPulseWave },
    { name: "Spark Ring", draw: drawSparkRing },
    { name: "Noise Terrain", draw: drawNoiseTerrain },
    { name: "Gear Mesh", draw: drawGearMesh },
    { name: "Aurora Curtain", draw: drawAuroraCurtain },
    { name: "Warp Speed", draw: drawWarpSpeed },
    { name: "Crystal", draw: drawCrystal },
    { name: "Echo Wave", draw: drawEchoWave },
    { name: "Gravity Well", draw: drawGravityWell },
    { name: "Meteor Shower", draw: drawMeteorShower },
    { name: "Synth Grid", draw: drawSynthGrid },
    { name: "Pond Ripples", draw: drawPondRipples },
    { name: "Neon Sign", draw: drawNeonSign },
    { name: "Waterfall", draw: drawWaterfall },
    { name: "Fibonacci Spiral", draw: drawFibonacciSpiral },
    { name: "Glitch", draw: drawGlitch },
    { name: "Cyber Circuit", draw: drawCyberCircuit },
    { name: "Tornado", draw: drawTornado },
    { name: "Polygon Morph", draw: drawPolygonMorph },
    { name: "Atomic", draw: drawAtomic },
    { name: "Shadow Moss", draw: drawShadowMoss },
    { name: "Diamond Grid", draw: drawDiamondGrid },
    { name: "Prism Rainbow", draw: drawPrismRainbow },
    { name: "Snake Trail", draw: drawSnakeTrail },
    { name: "Strobe Light", draw: drawStrobeLight },
    { name: "Cosmic Dust", draw: drawCosmicDust },
    { name: "Helix Tower", draw: drawHelixTower },
    { name: "Shockwave", draw: drawShockwave },
    { name: "Northern Lights", draw: drawNorthernLights },
    { name: "Particle Web", draw: drawParticleWeb },
    { name: "Ripple Grid", draw: drawRippleGrid },
    { name: "Plasma Ball", draw: drawPlasmaBall },
    { name: "Star Burst", draw: drawStarBurst },
    { name: "Wave Mesh", draw: drawWaveMesh },
    { name: "Fireflies", draw: drawFireflies },
    { name: "Radial Bars", draw: drawRadialBars },
    { name: "Cloud Drift", draw: drawCloudDrift },
    { name: "Laser Grid", draw: drawLaserGrid },
    { name: "Pulse Circles", draw: drawPulseCircles },
    { name: "Orbit Trails", draw: drawOrbitTrails },
    { name: "Fractal Rings", draw: drawFractalRings },
    { name: "Light Pillars", draw: drawLightPillars },
    { name: "Spiral Galaxy 3D", draw: drawSpiralGalaxy3D },
    { name: "Sine Field", draw: drawSineField },
    { name: "Butterfly", draw: drawButterfly },
    { name: "Smoke Rings", draw: drawSmokeRings },
    { name: "Pixel Rain", draw: drawPixelRain },
    { name: "Horizon Glow", draw: drawHorizonGlow },
    { name: "Chain Lightning", draw: drawChainLightning },
    { name: "Hypno Spiral", draw: drawHypnoSpiral }
];

function rememberModeIndex(index) {
    state.recentModeIndices.push(index);
    const maxRecent = Math.min(6, Math.max(2, Math.floor(modes.length / 3)));

    while (state.recentModeIndices.length > maxRecent) {
        state.recentModeIndices.shift();
    }
}

function shuffleIndices(indices) {
    const shuffled = [...indices];

    for (let i = shuffled.length - 1; i > 0; i -= 1) {
        const swapIndex = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[i]];
    }

    return shuffled;
}

function refillModeQueue() {
    const blocked = new Set(state.recentModeIndices);
    const available = modes
        .map((_, index) => index)
        .filter((index) => index !== state.currentModeIndex && !blocked.has(index));
    const deferred = modes
        .map((_, index) => index)
        .filter((index) => index !== state.currentModeIndex && blocked.has(index));

    state.modeQueue = shuffleIndices(available).concat(shuffleIndices(deferred));
}

function nextModeIndex() {
    if (modes.length <= 1) {
        return state.currentModeIndex;
    }

    const blocked = new Set(state.recentModeIndices);
    if (state.modeQueue.length === 0) {
        refillModeQueue();
    }

    while (state.modeQueue.length > 0) {
        const candidate = state.modeQueue.shift();
        if (candidate !== state.currentModeIndex && !blocked.has(candidate)) {
            return candidate;
        }
    }

    refillModeQueue();
    return state.modeQueue.shift() ?? state.currentModeIndex;
}

function queueNextMode() {
    state.targetModeIndex = nextModeIndex();
    state.transitionStart = state.elapsed;
    state.lastSwitchAt = state.elapsed;
}

function initializeModeCycle() {
    if (modes.length === 0) {
        return;
    }

    const initialIndex = Math.floor(Math.random() * modes.length);
    state.currentModeIndex = initialIndex;
    state.targetModeIndex = initialIndex;
    state.recentModeIndices = [initialIndex];
    refillModeQueue();
}

function drawMode(index, alpha) {
    const mode = modes[index];
    if (!mode) {
        return;
    }

    mode.draw(state.elapsed, alpha);
}

function drawBeatGlow() {
    const beat = getBeat();
    if (beat <= 0.02) {
        return;
    }

    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    const pulse = ctx.createRadialGradient(
        width * 0.5,
        height * 0.5,
        0,
        width * 0.5,
        height * 0.5,
        Math.max(width, height) * (0.35 + beat * 0.12)
    );
    pulse.addColorStop(0, `rgba(255, 255, 255, ${0.02 + beat * 0.08})`);
    pulse.addColorStop(1, "rgba(255, 255, 255, 0)");
    ctx.globalCompositeOperation = "screen";
    ctx.fillStyle = pulse;
    ctx.fillRect(0, 0, width, height);
}

function drawFrame() {
    fillBackground(state.elapsed);

    if (state.currentModeIndex === state.targetModeIndex) {
        drawMode(state.currentModeIndex, 1);
        drawBeatGlow();
        return;
    }

    const progress = clamp((state.elapsed - state.transitionStart) / state.transitionDuration, 0, 1);
    const blend = smooth(progress);

    drawMode(state.currentModeIndex, 1 - blend * 0.25);
    drawMode(state.targetModeIndex, blend);
    drawBeatGlow();

    if (progress >= 1) {
        state.currentModeIndex = state.targetModeIndex;
        rememberModeIndex(state.currentModeIndex);
        state.seed = Math.random() * 1000;
    }
}

function render(now) {
    if (state.previousFrameAt === 0) {
        state.previousFrameAt = now;
        state.lastSwitchAt = 0;
    }

    const delta = (now - state.previousFrameAt) / 1000;
    state.previousFrameAt = now;
    state.elapsed += delta;

    updateAudioData();
    drawFrame();

    if (
        state.currentModeIndex === state.targetModeIndex &&
        state.elapsed - state.lastSwitchAt >= state.switchInterval
    ) {
        queueNextMode();
    }

    requestAnimationFrame(render);
}

window.addEventListener("resize", resizeCanvas);
window.addEventListener("dragover", (event) => {
    event.preventDefault();
});
window.addEventListener("drop", async (event) => {
    event.preventDefault();
    const file = event.dataTransfer?.files?.[0];
    if (!file) {
        return;
    }

    try {
        await loadMediaFile(file);
    } catch (error) {
        console.error(error);
        clearMedia();
    }
});

initializeModeCycle();
resizeCanvas();
requestAnimationFrame(render);
