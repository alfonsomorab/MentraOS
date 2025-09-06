# Echo Cancellation Implementation Attempts - Technical Summary

**Date**: September 5, 2025  
**Issue**: [GitHub #1036] SDK .speak() infinite echo loop  
**Team Members**: Alfonso
**Status**: ❌ Unresolved - Requires architectural evaluation

---

## Problem Statement

SDK `.speak()` calls create infinite echo loops on Android when using phone speaker + phone microphone:

1. User says "Hello"
2. App calls `session.audio.speak("Hello")`
3. TTS plays through phone speaker
4. Phone microphone captures TTS audio
5. Speech recognition processes captured audio as new speech
6. App responds with another `.speak()` call → **Infinite loop**

**Expected Behavior**: Microphone should be muted during TTS playback to prevent feedback loops.

---

## Root Cause Analysis

### Initial Assumptions ❌

- SDK handled microphone muting internally
- Audio requests went through Android core services
- Built-in Android AEC would resolve the issue

### Reality Discovered ✅

- **SDK `.speak()` provides NO microphone control**
- **Audio path**: Mobile app AudioManager → ExoPlayer → Phone speaker
- **Missing component**: Microphone pause during TTS playback
- **Core issue**: Physical acoustic coupling between speaker and microphone

---

## Implementation Attempts (Chronological)

### ❌ Attempt 1: Built-in Android AEC (BUILT-IN-AEC)

**Approach**: Change AudioRecord source to VOICE_COMMUNICATION for automatic echo cancellation

**Files Modified**:

- `android_core/app/src/main/java/com/augmentos/augmentos_core/smarterglassesmanager/hci/MicrophoneLocalAndBluetooth.java`

**Implementation**:

```java
// Changed from:
MediaRecorder.AudioSource.VOICE_RECOGNITION
// To:
MediaRecorder.AudioSource.VOICE_COMMUNICATION
```

**Logic**: VOICE_COMMUNICATION has built-in acoustic echo cancellation for phone calls

**Result**: ❌ No improvement - infinite loop continued

**Issue**: Built-in AEC insufficient for TTS playback scenarios

---

### ❌ Attempt 2: Enhanced TTS Microphone Pause (ASR-PAUSE)

**Approach**: Enhance existing TTS system to pause microphone during native TTS playback

**Files Modified**:

- `android_core/.../smarterglassesmanager/texttospeech/TextToSpeechSystem.java`
- `android_core/.../smarterglassesmanager/hci/PhoneMicrophoneManager.java`
- `android_core/.../smarterglassesmanager/eventbusmessages/PauseMicrophoneEvent.java`

**Implementation**:

```java
// TextToSpeechSystem.java - onStart()
@Override
public void onStart(String utteranceId) {
    Log.d(TAG, "🔇 TTS started - pausing ASR and microphone to prevent echo loop");
    EventBus.getDefault().post(new PauseAsrEvent(true));
    EventBus.getDefault().post(new PauseMicrophoneEvent(true));
}

// TextToSpeechSystem.java - onDone()
@Override
public void onDone(String utteranceId) {
    Log.d(TAG, "🔊 TTS finished - resuming ASR and microphone");
    EventBus.getDefault().post(new PauseAsrEvent(false));
    EventBus.getDefault().post(new PauseMicrophoneEvent(false));
}

// PhoneMicrophoneManager.java
@Subscribe
public void handlePauseMicrophoneEvent(PauseMicrophoneEvent event) {
    if (event.pauseMicrophone) {
        // Pause microphone
        stopMicrophoneService();
        currentStatus = MicStatus.PAUSED;
    } else {
        // Resume microphone
        startPreferredMicMode();
    }
}
```

**Result**: ❌ Worked for native TTS but not SDK `.speak()`

**Issue**: SDK `.speak()` bypasses Android core TTS system entirely

---

### ❌ Attempt 3: AugmentosService Audio Interception (AUDIO-INTERCEPT)

**Approach**: Intercept audio requests at AugmentosService level

**Files Modified**:

- `android_core/app/src/main/java/com/augmentos/augmentos_core/AugmentosService.java`

**Target Method**: `onAudioPlayRequest(JSONObject audioRequest)`

**Implementation**:

```java
@Override
public void onAudioPlayRequest(JSONObject audioRequest) {
    Log.d(TAG, "🔇 Pausing microphone for audio playback to prevent echo loop");
    EventBus.getDefault().post(new PauseMicrophoneEvent(true));

    // Forward audio request to glasses/manager...
}

@Override
public void onAudioPlayResponse(JSONObject audioResponse) {
    Log.d(TAG, "🔊 Audio completed - resuming microphone");
    EventBus.getDefault().post(new PauseMicrophoneEvent(false));

    // Forward response to cloud...
}
```

**Result**: ❌ Method never executed during SDK `.speak()` calls

**Issue**: SDK audio requests don't route through Android core

**Discovery**: SDK audio path is Mobile → AudioManager, not Mobile → Android Core

---

### ❌ Attempt 4: Mobile AudioManager Integration (MOBILE-INTERCEPT)

**Approach**: Add microphone control to mobile `AudioManagerModule.java` with broadcast communication

**Files Modified**:

- `mobile/android/app/src/main/java/com/mentra/mentra/AudioManagerModule.java`
- `android_core/app/src/main/java/com/augmentos/augmentos_core/AugmentosService.java`
- `android_core/.../smarterglassesmanager/hci/PhoneMicrophoneManager.java`

**Architecture**:

```
Mobile AudioManagerModule → Android BroadcastReceiver → EventBus → PhoneMicrophoneManager
```

**Implementation**:

_Mobile AudioManagerModule.java_:

```java
@ReactMethod
public void playAudio(String requestId, String audioUrl, float volume, boolean stopOtherAudio, Promise promise) {
    Log.d(TAG, "🔇 Pausing microphone for SDK .speak() audio playback");
    sendMicrophonePauseCommand(true);  // Pause microphone

    AudioManager audioManager = AudioManager.getInstance(reactContext);
    audioManager.playAudio(requestId, audioUrl, volume, stopOtherAudio);
}

public void sendAudioPlayResponse(String requestId, boolean success, String error, Long duration) {
    if (success) {
        Log.d(TAG, "🔊 Audio completed successfully - resuming microphone");
        sendMicrophonePauseCommand(false);  // Resume microphone
    }
}

private void sendMicrophonePauseCommand(boolean pauseMicrophone) {
    Intent intent = new Intent("com.augmentos.augmentos_core.MIC_CONTROL");
    intent.putExtra("pause_microphone", pauseMicrophone);
    intent.putExtra("source", "mobile_audio_manager");
    reactContext.sendBroadcast(intent);
}
```

_Android Core AugmentosService.java_:

```java
// BroadcastReceiver registration in onCreate()
microphoneControlReceiver = new MicrophoneControlReceiver();
IntentFilter filter = new IntentFilter("com.augmentos.augmentos_core.MIC_CONTROL");
registerReceiver(microphoneControlReceiver, filter);

// BroadcastReceiver implementation
private class MicrophoneControlReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        if ("com.augmentos.augmentos_core.MIC_CONTROL".equals(intent.getAction())) {
            boolean pauseMicrophone = intent.getBooleanExtra("pause_microphone", false);
            EventBus.getDefault().post(new PauseMicrophoneEvent(pauseMicrophone));
        }
    }
}
```

_PhoneMicrophoneManager.java_ (Enhanced):

```java
@Subscribe
public void handlePauseMicrophoneEvent(PauseMicrophoneEvent event) {
    if (event.pauseMicrophone) {
        if (currentStatus != MicStatus.PAUSED) {
            statusBeforeTTSPause = currentStatus;
            isPausedForTTS = true;
            stopMicrophoneService();
            currentStatus = MicStatus.PAUSED;
        }
    } else {
        if (isPausedForTTS) {
            isPausedForTTS = false;
            if (statusBeforeTTSPause != MicStatus.PAUSED) {
                mainHandler.postDelayed(() -> {
                    startPreferredMicMode();
                }, 100); // Small delay for audio completion
            }
        }
    }
}
```

**Result**: ✅ Communication chain working perfectly, ❌ but still infinite loop

**Verified Working**:

- ✅ Mobile sends broadcast commands
- ✅ Android core receives broadcast commands
- ✅ EventBus delivers PauseMicrophoneEvent
- ✅ Microphone actually pauses (SCO_MODE → PAUSED)
- ✅ Microphone actually resumes (PAUSED → SCO_MODE)

**Debug Logs Confirmed**:

```
AudioManagerModule: 🔇 Pausing microphone for SDK .speak() audio playback
AugmentOSService: 🎙️ Received microphone control command from mobile_audio_manager: pause=true
PhoneMicrophoneManager: 🔇 Pausing microphone for TTS playback (current status: SCO_MODE)
PhoneMicrophoneManager: 🔍 PAUSE DEBUG: Microphone service stopped, currentStatus now=PAUSED

[TTS Audio Plays]

AudioManagerModule: 🔊 Audio completed successfully - resuming microphone
AugmentOSService: 🎙️ Received microphone control command from mobile_audio_manager: pause=false
PhoneMicrophoneManager: 🔊 Resuming microphone after TTS playback (restore to: SCO_MODE)
PhoneMicrophoneManager: 🔊 Actually resuming microphone service
```

**Issue**: Despite perfect software execution, acoustic coupling between phone speaker and microphone creates unavoidable feedback

---

### ❌ Attempt 5: Extended Timing Delays

**Approach**: Increase microphone resume delay to allow acoustic settling

**Implementation**:

```java
// Extended resume delay from 100ms to 2000ms (2 seconds)
mainHandler.postDelayed(() -> {
    Log.d(TAG, "🔊 Actually resuming microphone service");
    startPreferredMicMode();
}, 2000); // 2000ms delay to ensure all audio is finished and echoes have died down
```

**Logic**: Allow TTS audio and room acoustics to fully dissipate before resuming microphone

**Result**: ❌ Still creates infinite loops

**Issue**: Timing approach insufficient for physical acoustic coupling between speaker and microphone

---
