import { PitchShifter } from './soundtouch.min.js';

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
let handleAudioDataInterval;

const pitchValues = [];
const noiseThreshold = 20;
const spectralSubtractionFactor = 0.8;

function autoCorrelate(buffer, sampleRate) {
    const SIZE = buffer.length;
    const MAX_SAMPLES = Math.floor(SIZE/2);
    let best_offset = -1;
    let best_correlation = 0;
    let rms = 0;
    let foundGoodCorrelation = false;
    let correlations = new Array(MAX_SAMPLES);

    for (let i=0; i<SIZE; i++) {
        let val = buffer[i];
        rms += val*val;
    }
    rms = Math.sqrt(rms/SIZE);
    if (rms<0.01) // not enough signal
        return -1;

    let lastCorrelation=1;
    for (let offset = 0; offset < MAX_SAMPLES; offset++) {
        let correlation = 0;

        for (let i=0; i<MAX_SAMPLES; i++) {
            correlation += Math.abs((buffer[i])-(buffer[i+offset]));
        }

        correlation = 1 - (correlation/MAX_SAMPLES);
        correlations[offset] = correlation; // store it, for the tweaking we need to do below.
        if ((correlation>0.9) && (correlation > lastCorrelation)) {
            foundGoodCorrelation = true;
            if (correlation > best_correlation) {
                best_correlation = correlation;
                best_offset = offset;
            }
        } else if (foundGoodCorrelation) {
            // short-circuit - we found a good correlation, then a bad one, so we'd just be seeing copies from here.
            // Now we need to tweak the offset - by interpolating between the values to the left and right of the
            // best offset, and shifting it a bit.  This is complex, and HACKY in this code (happy to take PRs!) -
            // we need to do a curve fit on correlations[] around best_offset in order to better determine precise
            // (anti-aliased) offset.

            // we know best_offset >=1, 
            // since foundGoodCorrelation cannot go to true until the second pass (offset=1), and 
            // we can't drop into this clause until the following pass (else if).
            let shift = (correlations[best_offset+1] - correlations[best_offset-1])/correlations[best_offset];  
            return sampleRate/(best_offset+(8*shift));
        }
        lastCorrelation = correlation;
    }
    if (best_correlation > 0.01) {
        // console.log("f = " + sampleRate/best_offset + "Hz (rms: " + rms + " confidence: " + best_correlation + ")")
        return sampleRate/best_offset;
    }
    return -1;
}

function updatePitch(analyserNode, sampleRate) {
    const bufferLength = analyserNode.fftSize;
    const buffer = new Float32Array(bufferLength);
    analyserNode.getFloatTimeDomainData(buffer);
    const ac = autoCorrelate(buffer, sampleRate);
    if (ac === -1) {
        return null;
    } else {
        return ac;
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
                    pitchDisplay.textContent = `Pitch: ${pitch.toFixed(2)} Hz`;
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

    // Filter out outliers (values that are too low or too high for human voice)
    const filteredPitches = pitchValues.filter(pitch => pitch > 50 && pitch < 500);

    if (filteredPitches.length === 0) {
        pitchDisplay.textContent = `No valid pitch data collected`;
        return;
    }

    const averagePitch = filteredPitches.reduce((a, b) => a + b, 0) / filteredPitches.length;
    voicePitch = averagePitch;
    pitchDisplay.textContent = `Pitch data collected successfully`;
    pitchValues.length = 0;
}

startButton.addEventListener('click', startAudioProcessing);

downloadButton.addEventListener('click', async () => {
    try {
        downloadButton.textContent = "TRANSPOSING AND DOWNLOADING, PLEASE WAIT"
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
        downloadButton.textContent = "DOWNLOAD THE RESULTS"
    } catch (error) {
        console.error('Error in download process:', error);
        alert('An error occurred while preparing the download. Please check the console for details.');
    }
});

function calculatePitchDifference(songPitch, voicePitch) {
    const Clowest = 16.35;
    const moveSong = Math.floor(Math.log2(songPitch / Clowest) * 12);
    const moveVoice = Math.floor(Math.log2(voicePitch / Clowest) * 12);
    console.log(moveSong);
    console.log(moveVoice);
    return moveVoice - moveSong;
}

analyzeButton.addEventListener('click', async () => {
    analyzeButton.textContent = 'ANALYZING, PLEASE WAIT';
    const fileInput = document.getElementById('song-file');
    file = fileInput.files[0];
    songPitch = await analyzeSong(file);
    songPitchDisplay.textContent = `Analyzed successfully`;

    pitchDifference = calculatePitchDifference(songPitch, voicePitch);

    try {
        // Show a loading indicator
        analyzeButton.disabled = true;

        transposedAudioBuffer = await transposeAudio(file, pitchDifference);
        console.log("Transposition complete");

        // Enable download button or perform further actions
        downloadButton.disabled = false;
    } catch (error) {
        console.error("Error during transposition:", error);
    } finally {
        // Reset button state
        analyzeButton.disabled = false;
        analyzeButton.textContent = 'ANALYZE SONG';
    }
});

async function transposeAudio(file, pitchDifference) {
    // Ensure we have the audio buffer
    if (!audioBuffer) {
        arrayBuffer = await readFileAsArrayBuffer(file);
        audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
    }

    const pitchShift = Math.pow(2, pitchDifference / 12);
    
    // Create a new audio context for offline processing
    const offlineContext = new OfflineAudioContext(
        audioBuffer.numberOfChannels,
        audioBuffer.length,
        audioBuffer.sampleRate
    );

    // Create source node
    const source = offlineContext.createBufferSource();
    source.buffer = audioBuffer;

    // Create pitch shifter node
    const pitchShifter = new PitchShifter(offlineContext, audioBuffer, 4096);
    pitchShifter.pitch = pitchShift;

    // Connect nodes
    source.connect(pitchShifter.node);
    pitchShifter.node.connect(offlineContext.destination);

    // Start the source
    source.start();

    // Render the audio
    return offlineContext.startRendering().then(renderedBuffer => {
        console.log("Pitch-shifted buffer created:", renderedBuffer);
        return renderedBuffer;
    });
}

async function analyzeSong(file) {
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
    const analyser = audioContext.createAnalyser();
    analyser.fftSize = 2048;
    analyser.smoothingTimeConstant = 0.3;

    try {
        arrayBuffer = await readFileAsArrayBuffer(file);
        audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
        window.audioBuffer = audioBuffer;
        console.log(window.audioBuffer);

        window.originalArrayBuffer = arrayBuffer;

        const source = audioContext.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(analyser);
        source.start();

        // Wait for a short duration to gather data
        await new Promise(resolve => setTimeout(resolve, 1000));
        console.log('Original Audio Buffer Data:', audioBuffer.getChannelData(0).slice(0, 10));
        const frequencyData = new Uint8Array(analyser.frequencyBinCount);
        analyser.getByteFrequencyData(frequencyData);

        let peakFrequency = 0;
        let peakValue = 0;
        for (let i = 0; i < frequencyData.length; i++) {
            const value = frequencyData[i];
            if (value > peakValue) {
                peakFrequency = i * audioContext.sampleRate / analyser.fftSize;
                peakValue = value;
            }
        }

        // Close audio context
        audioContext.close();

        // Return the peak frequency as the pitch value
        return peakFrequency;
    } catch (error) {
        console.error('Error analyzing song:', error);
        return null;
    }
}

function wait(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function readFileAsArrayBuffer(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        const blob = new Blob([file], { type: file.type }); // Create a Blob object from the File object
        reader.onload = () => {
            resolve(reader.result);
        };
        reader.onerror = () => {
            reject(reader.error);
        };
        reader.readAsArrayBuffer(blob); // Pass the Blob object to readAsArrayBuffer
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
