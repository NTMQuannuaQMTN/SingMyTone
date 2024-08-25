import { PitchShifter } from "./soundtouch.min.js";

const startButton = document.getElementById('start-button');
const pitchDisplay = document.getElementById('pitch-display');
const analyzeButton = document.getElementById('analyze-button');
const songPitchDisplay = document.getElementById('song-pitch-display');
const downloadButton = document.getElementById('download-res');

let file;
let pitchDifference;
let transposedAudioBuffer = null;
let songPitch = 0;
let voicePitch = 0;

let audioContext = new (window.AudioContext || window.webkitAudioContext)();
let analyser = audioContext.createAnalyser();
analyser.fftSize = 2048;
analyser.smoothingTimeConstant = 0.3;
let arrayBuffer, audioBuffer;
let source;

const pitchValues = [];
const noiseThreshold = 20;
const spectralSubtractionFactor = 0.8;

function updatePitch(analyserNode, sampleRate) {
    const bufferLength = analyserNode.fftSize;
    const buffer = new Float32Array(bufferLength);
    analyserNode.getFloatTimeDomainData(buffer);
    const pitch = YINPitchDetection(buffer, sampleRate);
    if (isFinite(pitch) && pitch > 0) {
        return pitch;
    } else {
        return null;
    }
}

let pitchDetectionInterval;

function startAudioProcessing() {
    pitchValues.length = 0; // Reset pitch values
    audioContext.resume();

    navigator.mediaDevices.getUserMedia({ audio: true })
        .then(stream => {
            source = audioContext.createMediaStreamSource(stream);
            analyser = audioContext.createAnalyser();
            analyser.fftSize = 2048;
            source.connect(analyser);

            pitchDetectionInterval = setInterval(() => {
                const pitch = updatePitch(analyser, audioContext.sampleRate);
                if (pitch !== null) {
                    pitchValues.push(pitch);
                    pitchDisplay.textContent = `Detecting...`;
                } else {
                    pitchDisplay.textContent = 'Detecting...';
                }
            }, 100);

            setTimeout(() => {
                stopAudioProcessing();
                calculateAveragePitch();
            }, 5000);
        })
        .catch(error => console.error('Error getting user media:', error));
}

function stopAudioProcessing() {
    if (source) {
        source.disconnect(analyser);
    }
    clearInterval(pitchDetectionInterval);
    audioContext.suspend();
}

function calculateAveragePitch() {
    if (pitchValues.length === 0) {
        pitchDisplay.textContent = `No pitch data collected`;
        return;
    }

    const validPitches = pitchValues.filter(pitch => isFinite(pitch) && pitch > 50 && pitch < 500);

    if (validPitches.length === 0) {
        pitchDisplay.textContent = `No valid pitch data collected`;
        return;
    }

    const averagePitch = validPitches.reduce((a, b) => a + b, 0) / validPitches.length;
    voicePitch = averagePitch;
    pitchDisplay.textContent = `Pitch data collected successfully`;
    pitchValues.length = 0;
}

startButton.addEventListener('click', startAudioProcessing);

downloadButton.addEventListener('click', async () => {
    try {
        const file = document.getElementById('song-file').files[0];
        console.log('File:', file);

        if (!transposedAudioBuffer) {
            alert('No transposed audio available for download.');
            return;
        }

        console.log('Transposed Audio Buffer:', transposedAudioBuffer);

        // Convert AudioBuffer to MP3
        const mp3Blob = await audioBufferToMp3(transposedAudioBuffer);
        console.log('MP3 Blob created:', mp3Blob);

        const url = URL.createObjectURL(mp3Blob);

        const a = document.createElement('a');
        a.href = url;
        a.download = 'transposed-audio.mp3';
        a.click();
        URL.revokeObjectURL(url);

        console.log('Download initiated');
        downloadButton.textContent = "DOWNLOAD THE RESULTS";
    } catch (error) {
        console.error('Error in download process:', error);
        alert('An error occurred while preparing the download. Please check the console for details.');
    }
});

function calculatePitchDifference(songPitch, voicePitch) {
    if (!isFinite(songPitch) || !isFinite(voicePitch) || songPitch <= 0 || voicePitch <= 0) {
        console.error('Invalid pitch values for difference calculation');
        return 0;
    }
    const Clowest = 16.35;
    const moveSong = Math.floor(Math.log2(songPitch / Clowest) * 12);
    const moveVoice = Math.floor(Math.log2(voicePitch / Clowest) * 12);
    console.log('Song move:', moveSong);
    console.log('Voice move:', moveVoice);
    return moveVoice - moveSong;
}

analyzeButton.addEventListener('click', async () => {
    analyzeButton.textContent = 'ANALYZING, PLEASE WAIT';
    const fileInput = document.getElementById('song-file');
    file = fileInput.files[0];
    songPitch = await analyzeSong(file);
    if (songPitch !== null) {
        songPitchDisplay.textContent = `Song analyzed successfully`;
    } else {
        songPitchDisplay.textContent = 'Unable to detect song pitch';
        analyzeButton.textContent = 'ANALYZE SONG';
        return;
    }

    pitchDifference = calculatePitchDifference(songPitch, voicePitch);

    try {
        analyzeButton.disabled = true;
        transposedAudioBuffer = await transposeAudio(file, pitchDifference);
        console.log("Transposition complete");
        downloadButton.disabled = false;
    } catch (error) {
        console.error("Error during transposition:", error);
    } finally {
        analyzeButton.disabled = false;
        analyzeButton.textContent = 'ANALYZE SONG';
    }
});

async function transposeAudio(file, pitchDifference) {
    if (!audioBuffer) {
        arrayBuffer = await readFileAsArrayBuffer(file);
        audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
    }

    const pitchShift = Math.pow(2, pitchDifference / 12);

    const offlineContext = new OfflineAudioContext(
        audioBuffer.numberOfChannels,
        audioBuffer.length,
        audioBuffer.sampleRate
    );

    const source = offlineContext.createBufferSource();
    source.buffer = audioBuffer;

    const pitchShifter = new PitchShifter(offlineContext, audioBuffer, 4096);
    pitchShifter.pitch = pitchShift;

    source.connect(pitchShifter.node);
    pitchShifter.node.connect(offlineContext.destination);

    source.start();

    return offlineContext.startRendering().then(renderedBuffer => {
        console.log("Pitch-shifted buffer created:", renderedBuffer);
        return renderedBuffer;
    });
}

async function analyzeSong(file) {
    try {
        const arrayBuffer = await readFileAsArrayBuffer(file);
        const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

        const sampleRate = audioBuffer.sampleRate;
        const analyzeDuration = 30; // Analyze 30 seconds
        const analyzeLength = Math.min(analyzeDuration * sampleRate, audioBuffer.length);

        const channelData = audioBuffer.getChannelData(0).slice(0, analyzeLength);

        const pitches = [];
        const frameSize = 2048;
        const hopSize = 512;

        for (let i = 0; i < channelData.length - frameSize; i += hopSize) {
            const frame = channelData.slice(i, i + frameSize);
            const pitch = YINPitchDetection(frame, sampleRate);
            if (pitch > 0) {
                pitches.push(pitch);
            }
        }

        if (pitches.length === 0) {
            console.log('No valid pitches detected');
            return null;
        }

        // Sort pitches and take the median
        pitches.sort((a, b) => a - b);
        const medianPitch = pitches[Math.floor(pitches.length / 2)];

        console.log('Detected pitches:', pitches);
        console.log('Median pitch:', medianPitch);

        return medianPitch;
    } catch (error) {
        console.error('Error processing the audio file:', error);
        return null;
    }
}

function YINPitchDetection(buffer, sampleRate) {
    const threshold = 0.10; // Threshold for peak detection
    const minFreq = 100;    // Minimum frequency to detect (human voice lower limit)
    const maxFreq = 5000;   // Maximum frequency (upper voice range, including B6)

    const bufferLength = buffer.length;
    const yinBuffer = new Float32Array(bufferLength / 2);

    let tau;
    let minTau = -1;

    // Step 1: Autocorrelation
    for (tau = 1; tau < yinBuffer.length; tau++) {
        let sum = 0;
        for (let i = 0; i < yinBuffer.length; i++) {
            const delta = buffer[i] - buffer[i + tau];
            sum += delta * delta;
        }
        yinBuffer[tau] = sum / tau;
    }

    // Step 2: Cumulative mean normalization
    let runningSum = 0;
    for (tau = 1; tau < yinBuffer.length; tau++) {
        runningSum += yinBuffer[tau];
        yinBuffer[tau] *= tau / runningSum;
    }

    // Step 3: Find the first minimum below the threshold
    for (tau = 1; tau < yinBuffer.length; tau++) {
        if (yinBuffer[tau] < threshold && (minTau === -1 || yinBuffer[tau] < yinBuffer[minTau])) {
            minTau = tau;
        }
    }

    // Step 4: Convert tau to frequency
    if (minTau !== -1) {
        const detectedFreq = sampleRate / minTau;

        // Ensure the detected frequency is within the expected range
        if (detectedFreq >= minFreq && detectedFreq <= maxFreq) {
            return detectedFreq;
        }
    }

    return -1; // No valid pitch detected
}

async function readFileAsArrayBuffer(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        const blob = new Blob([file], { type: file.type });
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(reader.error);
        reader.readAsArrayBuffer(blob);
    });
}

async function audioBufferToMp3(audioBuffer) {
    const channels = audioBuffer.numberOfChannels;
    const sampleRate = audioBuffer.sampleRate;
    const mp3Encoder = new lamejs.Mp3Encoder(channels, sampleRate, 128);
    const mp3Data = [];

    const sampleBlockSize = 1152; // can be anything but make it a multiple of 576 to make encoders life easier

    const left = audioBuffer.getChannelData(0);
    const right = channels > 1 ? audioBuffer.getChannelData(1) : null;

    const samples = new Int16Array(sampleBlockSize * channels);

    for (let i = 0; i < left.length; i += sampleBlockSize) {
        for (let j = 0; j < sampleBlockSize && i + j < left.length; j++) {
            const leftSample = Math.max(-1, Math.min(1, left[i + j]));
            samples[j * channels] = leftSample < 0 ? leftSample * 0x8000 : leftSample * 0x7FFF;

            if (channels > 1) {
                const rightSample = Math.max(-1, Math.min(1, right[i + j]));
                samples[j * channels + 1] = rightSample < 0 ? rightSample * 0x8000 : rightSample * 0x7FFF;
            }
        }

        let mp3buf;
        if (channels === 1) {
            mp3buf = mp3Encoder.encodeBuffer(samples);
        } else {
            // For stereo, we need to pass separate left and right channel arrays
            const leftChunk = new Int16Array(sampleBlockSize);
            const rightChunk = new Int16Array(sampleBlockSize);
            for (let k = 0; k < sampleBlockSize; k++) {
                leftChunk[k] = samples[k * 2];
                rightChunk[k] = samples[k * 2 + 1];
            }
            mp3buf = mp3Encoder.encodeBuffer(leftChunk, rightChunk);
        }

        if (mp3buf.length > 0) {
            mp3Data.push(new Int8Array(mp3buf));
        }
    }

    let mp3buf = mp3Encoder.flush();
    if (mp3buf.length > 0) {
        mp3Data.push(new Int8Array(mp3buf));
    }

    const blob = new Blob(mp3Data, { type: 'audio/mp3' });
    return blob;
}