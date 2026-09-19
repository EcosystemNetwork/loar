// Microphone capture for the live voice client (src/lib/voice/LiveVoiceSession.ts).
//
// Runs on the audio thread and forwards each 128-sample block to the main
// thread, which resamples and frames it. It's a static same-origin file rather
// than a Blob URL because the site's CSP (script-src 'self') forbids blob:
// scripts, and AudioWorklet modules are subject to script-src.
class PcmCapture extends AudioWorkletProcessor {
  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    // slice(): the engine reuses this buffer for the next quantum.
    if (channel && channel.length) this.port.postMessage(channel.slice(0));
    return true;
  }
}

registerProcessor('pcm-capture', PcmCapture);
