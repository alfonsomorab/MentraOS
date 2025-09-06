package com.mentra.mentra;

import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReactContextBaseJavaModule;
import com.facebook.react.bridge.ReactMethod;
import com.facebook.react.bridge.Promise;
import com.facebook.react.modules.core.DeviceEventManagerModule;
import com.facebook.react.bridge.WritableMap;
import com.facebook.react.bridge.Arguments;

import android.content.Intent;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;

import androidx.annotation.NonNull;

/**
 * React Native bridge module for AudioManager
 */
public class AudioManagerModule extends ReactContextBaseJavaModule {
    private static final String TAG = "AudioManagerModule";
    private ReactApplicationContext reactContext;
    private static boolean sttPaused = false;
    private Handler timeoutHandler = new Handler(Looper.getMainLooper());
    private Runnable currentTimeoutRunnable;

    public AudioManagerModule(ReactApplicationContext reactContext) {
        super(reactContext);
        this.reactContext = reactContext;
    }

    @NonNull
    @Override
    public String getName() {
        return "AudioManagerModule";
    }

    /**
     * Send an audio play response event to React Native
     */
    public void sendAudioPlayResponse(String requestId, boolean success, String error, Long duration) {
        WritableMap params = Arguments.createMap();
        params.putString("requestId", requestId);
        params.putBoolean("success", success);
        if (error != null) {
            params.putString("error", error);
        }
        if (duration != null) {
            params.putDouble("duration", duration);
        }

        if (reactContext.hasActiveCatalystInstance()) {
            reactContext
                .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter.class)
                .emit("AudioPlayResponse", params);
        }

        // Always resume STT regardless of success/failure
        sendSTTPauseCommand(false);  // Resume STT processing

        Log.d(TAG, "Sent audio play response - requestId: " + requestId + ", success: " + success + ", error: " + error);
    }

    @ReactMethod
    public void playAudio(
            String requestId,
            String audioUrl,
            float volume,
            boolean stopOtherAudio,
            Promise promise
    ) {
        try {
            Log.d(TAG, "playAudio called with requestId: " + requestId);
            sendSTTPauseCommand(true);  // Pause STT processing

            AudioManager audioManager = AudioManager.getInstance(reactContext);

            // Set the response callback before playing
            audioManager.setResponseCallback(this::sendAudioPlayResponse);

            audioManager.playAudio(
                    requestId,
                    audioUrl,
                    volume,
                    stopOtherAudio
            );

            promise.resolve("Audio play started");
        } catch (Exception e) {
            // CRITICAL: Resume STT if audio failed to start
            sendSTTPauseCommand(false);
            Log.e(TAG, "Failed to play audio, resuming STT", e);
            promise.reject("AUDIO_PLAY_ERROR", e.getMessage(), e);
        }
    }

    @ReactMethod
    public void stopAudio(String requestId, Promise promise) {
        try {
            Log.d(TAG, "stopAudio called with requestId: " + requestId);

            AudioManager audioManager = AudioManager.getInstance(reactContext);
            audioManager.stopAudio(requestId);

            promise.resolve("Audio stopped");
        } catch (Exception e) {
            Log.e(TAG, "Failed to stop audio", e);
            promise.reject("AUDIO_STOP_ERROR", e.getMessage(), e);
        }
    }

    @ReactMethod
    public void stopAllAudio(Promise promise) {
        try {
            Log.d(TAG, "stopAllAudio called");

            AudioManager audioManager = AudioManager.getInstance(reactContext);
            audioManager.stopAllAudio();

            promise.resolve("All audio stopped");
        } catch (Exception e) {
            Log.e(TAG, "Failed to stop all audio", e);
            promise.reject("AUDIO_STOP_ALL_ERROR", e.getMessage(), e);
        }
    }

    private void sendSTTPauseCommand(boolean pauseSTT) {
        // Prevent redundant commands
        if (sttPaused == pauseSTT) {
            Log.d(TAG, "STT already in requested state: " + pauseSTT);
            return;
        }
        
        sttPaused = pauseSTT;
        Intent intent = new Intent("com.augmentos.augmentos_core.STT_CONTROL");
        intent.putExtra("pause_stt", pauseSTT);
        intent.putExtra("source", "mobile_audio_manager");
        reactContext.sendBroadcast(intent);
        
        if (pauseSTT) {
            // Cancel any existing timeout first
            if (currentTimeoutRunnable != null) {
                timeoutHandler.removeCallbacks(currentTimeoutRunnable);
            }
            
            // Create new timeout
            currentTimeoutRunnable = () -> {
                if (sttPaused) {
                    Log.w(TAG, "STT timeout safety - force resuming STT after 30s");
                    sendSTTPauseCommand(false);
                }
            };
            timeoutHandler.postDelayed(currentTimeoutRunnable, 30000);
        } else {
            // Cancel timeout when manually resuming
            if (currentTimeoutRunnable != null) {
                timeoutHandler.removeCallbacks(currentTimeoutRunnable);
                currentTimeoutRunnable = null;
            }
        }
    }
}