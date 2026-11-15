//
//  Ala'a AppD EUM - Dual-Instrumentation Debugger Engine
//  Enhanced & Engineered by: Ala'a Mrayat
//  Copyright (c) 2018 AppDynamics Technologies. All rights reserved.
//

package com.appdynamics.cordova.plugin;

import org.apache.cordova.CordovaPlugin;
import org.apache.cordova.CallbackContext;
import org.apache.cordova.CordovaInterface;
import org.apache.cordova.CordovaWebView;

import com.appdynamics.eumagent.runtime.Instrumentation;
import com.appdynamics.eumagent.runtime.InstrumentationCallbacks;
import com.appdynamics.eumagent.runtime.AgentConfiguration;
import com.appdynamics.eumagent.runtime.CollectorChannel;
import com.appdynamics.eumagent.runtime.CollectorChannelFactory;
import com.appdynamics.eumagent.runtime.CallTracker;
import com.appdynamics.eumagent.runtime.HttpRequestTracker;
import com.appdynamics.eumagent.runtime.SessionFrame;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;
import java.util.UUID;
import java.util.HashMap;
import java.util.ArrayList;
import java.util.Iterator;
import java.net.URL;
import java.net.MalformedURLException;
import android.webkit.WebView;

/**
 * Android implementation of the Cordova Plugin.
 * This class is the bridge between Javascript and native agent.
 */
public class ADEUMMobilePlugin extends CordovaPlugin {
    private final static String ADEumPluginType = "Cordova";
    private final static String VERSION = "25.4.1";
    private HashMap<String, CallTracker> callTrackers;
    private HashMap<String, HttpRequestTracker> httpRequestTrackers;
    private HashMap<String, SessionFrame> sessionFrames;
    private boolean pluginInitialized;

    public void initialize(CordovaInterface cordova, CordovaWebView webView) {
        super.initialize(cordova, webView);
        callTrackers = new HashMap<String, CallTracker>();
        httpRequestTrackers = new HashMap<String, HttpRequestTracker>();
        sessionFrames = new HashMap<String, SessionFrame>();

        // Initialize the agent before the Cordova WebView loads the default page

        int appKeyResId = cordova.getActivity().getResources().getIdentifier("adeum_app_key", "string", cordova.getActivity().getPackageName());
        String appKey = cordova.getActivity().getString(appKeyResId);
        int collectorUrlResId = cordova.getActivity().getResources().getIdentifier("adeum_collector_url", "string", cordova.getActivity().getPackageName());
        String collectorUrl = cordova.getActivity().getString(collectorUrlResId);
        int screenshotUrlResId = cordova.getActivity().getResources().getIdentifier("adeum_screenshot_url", "string", cordova.getActivity().getPackageName());
        String screenshotUrl = cordova.getActivity().getString(screenshotUrlResId);
        android.content.SharedPreferences overridePrefs = cordova.getActivity().getSharedPreferences("appd_eum_override_prefs", android.content.Context.MODE_PRIVATE);
        String ovAppKey = overridePrefs.getString("appKey", "");
        String ovCollectorUrl = overridePrefs.getString("collectorUrl", "");
        String ovScreenshotUrl = overridePrefs.getString("screenshotUrl", "");
        if (!ovAppKey.isEmpty()) appKey = ovAppKey;
        if (!ovCollectorUrl.isEmpty()) collectorUrl = ovCollectorUrl;
        if (!ovScreenshotUrl.isEmpty()) screenshotUrl = ovScreenshotUrl;
        int screenshotsEnabledResId = cordova.getActivity().getResources().getIdentifier("adeum_screenshots_enabled", "string", cordova.getActivity().getPackageName());
        boolean screenshotsEnabled = false;
        try {
            screenshotsEnabled = Boolean.parseBoolean(cordova.getActivity().getString(screenshotsEnabledResId));
        } catch (Exception ex) { }
        int loggingLevelResId = cordova.getActivity().getResources().getIdentifier("adeum_logging_level", "string", cordova.getActivity().getPackageName());
        int loggingLevel = 2;
        try {
           loggingLevel = Integer.parseInt(cordova.getActivity().getString(loggingLevelResId));
           switch(loggingLevel)
           {
               case 6: //verbose
               case 5:
               case 4:
                   loggingLevel = 1;
                   break;
               case 3: //info
               case 2:
               case 1:
                   loggingLevel = 2;
                   break;
           }
        } catch (Exception ex) { }
        int interactionCaptureModeResId = cordova.getActivity().getResources().getIdentifier("adeum_interaction_capture_mode", "string", cordova.getActivity().getPackageName());
        int interactionCaptureMode = 0;
        try {
           interactionCaptureMode = Integer.parseInt(cordova.getActivity().getString(interactionCaptureModeResId));
        } catch (Exception ex) { }

        AgentConfiguration config = AgentConfiguration.builder().
                                    withAppKey(appKey).
                                    withContext(cordova.getActivity()).
                                    withCollectorURL(collectorUrl).
                                    withScreenshotURL(screenshotUrl).
                                    withLoggingLevel(loggingLevel).
                                    withJSAgentInjectionEnabled(false).
                                    withJSAgentAjaxEnabled(false).
                                    withExcludedUrlPatterns(new java.util.HashSet<String>(java.util.Arrays.asList(".*eumcollector.*"))).
                                    withCollectorChannelFactory(createLoggingCollectorChannelFactory()).
                                    withScreenshotsEnabled(screenshotsEnabled).
                                    withInteractionCaptureMode(interactionCaptureMode).
                                    build();

        // since there is no way to return an error to the host app we keep track of the error
        // in pluginInitialized flag and return it when a method is invoked on the plugin
        try {
           Instrumentation.startFromHybrid(config, ADEumPluginType, VERSION);
           pluginInitialized = true;
        } catch (IllegalArgumentException ex) {
           pluginInitialized = false;
        }
    }

    @Override
    public boolean execute(String action, JSONArray args, CallbackContext callbackContext) throws JSONException {
        // Safe actions allowed even if AppDynamics was initialized with placeholder key
        try {
            if ("setNativeConfig".equals(action)) {
                this.setNativeConfig(args.optJSONObject(0), callbackContext);
                return true;
            } else if ("getNativeConfig".equals(action)) {
                this.getNativeConfig(callbackContext);
                return true;
            } else if ("resetNativeConfig".equals(action)) {
                this.resetNativeConfig(callbackContext);
                return true;
            } else if ("relayBeacon".equals(action)) {
                this.relayBeacon(args.optString(0, ""), args.optString(1, ""), callbackContext);
                return true;
            } else if ("getNativeBeaconLogs".equals(action)) {
                this.getNativeBeaconLogs(callbackContext);
                return true;
            } else if ("nativeHttpRequest".equals(action)) {
                this.nativeHttpRequest(args.optString(0, ""), args.optString(1, "GET"), args.optString(2, ""), callbackContext);
                return true;
            } else if ("nativeCrash".equals(action)) {
                this.nativeCrash();
                return true;
            }
        } catch (Throwable t) {
            callbackContext.error("Native execution error: " + t.getMessage());
            return true;
        }

        if (!checkPluginInitialized(callbackContext))
           return false;
        // this try will ensure the host app never crashes if there's an error in execution
        // of the plugin or the native agent
        try {
           if ("getVersion".equals(action)) {
               this.getVersion( callbackContext);
               return true;
           } else if ("initWithConfiguration".equals(action)) {
               JSONObject map = args.getJSONObject(0);
               this.initWithConfiguration( args, callbackContext);
               return true;
           } else if ("changeAppKey".equals(action)) {
               this.changeAppKey( args, callbackContext);
               return true;
           } else if ("startTimerWithName".equals(action)) {
               this.startTimerWithName( args, callbackContext);
               return true;
           } else if ("stopTimerWithName".equals(action)) {
               this.stopTimerWithName( args, callbackContext);
               return true;
           } else if ("reportMetricWithName".equals(action)) {
               this.reportMetricWithName( args, callbackContext);
               return true;
           } else if ("leaveBreadcrumb".equals(action)) {
               this.leaveBreadcrumb( args, callbackContext);
               return true;
           } else if ("setUserData".equals(action)) {
               this.setUserData( args, callbackContext);
               return true;
           } else if ("removeUserData".equals(action)) {
               this.removeUserData( args, callbackContext);
               return true;
           } else if ("takeScreenshot".equals(action)) {
               this.takeScreenshot( args, callbackContext);
               return true;
           } else if ("beginCall".equals(action)) {
               this.beginCall( args, callbackContext);
               return true;
           } else if ("endCall".equals(action)) {
               this.endCall( args, callbackContext);
               return true;
           } else if ("beginHttpRequest".equals(action)) {
               this.beginHttpRequest( args, callbackContext);
               return true;
           } else if ("withURL".equals(action)) {
               this.withURL( args, callbackContext);
               return true;
           } else if ("withResponseCode".equals(action)) {
               this.withResponseCode( args, callbackContext);
               return true;
           } else if ("withResponseContentLength".equals(action)) {
               this.withResponseContentLength( args, callbackContext);
               return true;
           } else if ("withRequestContentLength".equals(action)) {
               this.withRequestContentLength( args, callbackContext);
               return true;
           } else if ("withErrorMessage".equals(action)) {
               this.withErrorMessage( args, callbackContext);
               return true;
           } else if ("withRequestHeaderFields".equals(action)) {
               this.withRequestHeaderFields( args, callbackContext);
               return true;
           } else if ("withResponseHeaderFields".equals(action)) {
               this.withResponseHeaderFields( args, callbackContext);
               return true;
           } else if ("withInstrumentationSource".equals(action)) {
               this.withInstrumentationSource( args, callbackContext);
               return true;
           } else if ("reportDone".equals(action)) {
               this.reportDone( args, callbackContext);
               return true;
           } else if ("crash".equals(action)) {
               this.crash( args, callbackContext);
               return true;
           } else if ("flush".equals(action)) {
               this.flush( args, callbackContext);
               return true;
           } else if ("startNextSession".equals(action)) {
               this.startNextSession( args, callbackContext);
               return true;
           } else if ("unblockScreenshots".equals(action)) {
               this.unblockScreenshots( args, callbackContext);
               return true;
           } else if ("blockScreenshots".equals(action)) {
               this.blockScreenshots( args, callbackContext);
               return true;
           } else if ("screenshotsBlocked".equals(action)) {
               this.screenshotsBlocked( args, callbackContext);
               return true;
           } else if ("startSessionFrame".equals(action)) {
               this.startSessionFrame( args, callbackContext);
               return true;
           } else if ("updateSessionFrameName".equals(action)) {
               this.updateSessionFrameName( args, callbackContext);
               return true;
           } else if ("endSessionFrame".equals(action)) {
               this.endSessionFrame( args, callbackContext);
               return true;
           }
        } catch (Exception ex) { callbackContext.error(ex.getMessage()); }

        return false;
    }

    public void onReset() {
      if (callTrackers != null)
         callTrackers.clear();
      if (httpRequestTrackers != null)
         httpRequestTrackers.clear();
      if (sessionFrames != null)
            sessionFrames.clear();
    }

    private void getVersion(CallbackContext callbackContext) {
      callbackContext.success(VERSION);
    }

    private void initWithAppKey(JSONArray args, CallbackContext callbackContext) throws JSONException{
        AgentConfiguration config = AgentConfiguration.builder().withAppKey(args.getString(0)).build();
        Instrumentation.startFromHybrid(config, ADEumPluginType, VERSION);
        callbackContext.success(VERSION);
    }

    private void initWithConfiguration(JSONArray args, CallbackContext callbackContext) throws JSONException{
        JSONObject map = args.getJSONObject(0);
        int loggingLevel = map.getInt("loggingLevel");
        //map from shared values to android agent specific ones
        int loggingLevelAndroid = 3;
        switch(loggingLevel)
        {
            case 6: //verbose
            case 5:
            case 4:
                loggingLevelAndroid = 1;
                break;
            case 3: //info
            case 2:
            case 1:
                loggingLevelAndroid = 2;
                break;
        }

        AgentConfiguration config = AgentConfiguration.builder().
                                    withAppKey(map.getString("appKey")).
                                    withContext(cordova.getActivity()).
                                    withCollectorURL(map.getString("collectorUrl")).
                                    withScreenshotURL(map.getString("screenshotUrl")).
                                    withLoggingLevel(loggingLevelAndroid).
                                    withJSAgentInjectionEnabled(false).
                                    withJSAgentAjaxEnabled(false).
                                    withExcludedUrlPatterns(new java.util.HashSet<String>(java.util.Arrays.asList(".*eumcollector.*"))).
                                    withCollectorChannelFactory(createLoggingCollectorChannelFactory()).
                                    withScreenshotsEnabled(map.getBoolean("screenshots")).
                                    build();

        Instrumentation.startFromHybrid(config, ADEumPluginType, VERSION);
        callbackContext.success(VERSION);
    }

    private void changeAppKey(JSONArray args, CallbackContext callbackContext) throws JSONException {
        Instrumentation.changeAppKey(args.getString(0));
        callbackContext.success(VERSION);
    }

    private void startTimerWithName(JSONArray args, CallbackContext callbackContext)  throws JSONException {
        Instrumentation.startTimer(args.getString(0));
        callbackContext.success(VERSION);
    }

    private void stopTimerWithName(JSONArray args, CallbackContext callbackContext) throws JSONException {
        Instrumentation.stopTimer(args.getString(0));
        callbackContext.success(VERSION);
    }

    private void reportMetricWithName(JSONArray args, CallbackContext callbackContext) throws JSONException {
        try {
            Instrumentation.reportMetric(args.getString(0), Long.parseLong(args.getString(1)));
            callbackContext.success(VERSION);
        } catch(NumberFormatException ex) {
            callbackContext.error("Metric value must be an integer.");
        }
        callbackContext.success(VERSION);
    }

    private void leaveBreadcrumb(JSONArray args, CallbackContext callbackContext) throws JSONException {
        if (args.length() > 1) {
            try {
               Instrumentation.leaveBreadcrumb(args.getString(0), Integer.parseInt(args.getString(1)));
            } catch(NumberFormatException ex) {
                callbackContext.error("Mode value must be an integer - 0 for crashes only or 1 for crashes and sessions.");
            }
        } else {
            Instrumentation.leaveBreadcrumb(args.getString(0));
        }
        callbackContext.success(VERSION);
    }

    private void setUserData(JSONArray args, CallbackContext callbackContext) throws JSONException {
        Instrumentation.setUserData(args.getString(0), args.getString(1));
        callbackContext.success(VERSION);
    }

    private void removeUserData(JSONArray args, CallbackContext callbackContext) throws JSONException {
        Instrumentation.setUserData(args.getString(0), null);
        callbackContext.success();
    }

    private void takeScreenshot(JSONArray args, CallbackContext callbackContext) throws JSONException {
        Instrumentation.takeScreenshot();
        callbackContext.success();
    }

    private void beginCall(JSONArray args, CallbackContext callbackContext) throws JSONException {
        CallTracker tracker = Instrumentation.beginCall(args.getString(0), args.getString(1), args.getString(2));
        String uuid = UUID.randomUUID().toString();
        callTrackers.put(uuid, tracker);
        callbackContext.success(uuid);
    }

    private void endCall(JSONArray args, CallbackContext callbackContext) throws JSONException {
        if (args.length() > 1) {
            CallTracker tracker = callTrackers.get(args.getString(0));
            if(tracker != null) {
              tracker.reportCallEndedWithReturnValue(args.getString(1));
              callTrackers.remove(args.getString(0));
              callbackContext.success();
            } else
               callbackContext.error("CallTracker object has already been destroyed.");
        }
        else if (args.length() > 0) {
            CallTracker tracker = callTrackers.get(args.getString(0));
            if (tracker != null) {
               tracker.reportCallEnded();
               callTrackers.remove(args.getString(0));
               callbackContext.success();
            } else
               callbackContext.error("CallTracker object has already been destroyed.");
        }
     }

     private void beginHttpRequest(JSONArray args, CallbackContext callbackContext) throws JSONException {
        try {
           HttpRequestTracker tracker = Instrumentation.beginHttpRequest(new URL(args.getString(0)));
           String uuid = UUID.randomUUID().toString();
           httpRequestTrackers.put(uuid, tracker);
           callbackContext.success(uuid);
        } catch (MalformedURLException me) { callbackContext.error("URL argument is not valid."); }
     }

     private void withURL(JSONArray args, CallbackContext callbackContext) throws JSONException {
         if (args.length() > 1) {
             HttpRequestTracker tracker = httpRequestTrackers.get(args.getString(0));
             if (tracker != null) {
                try {
                    tracker.withURL(new URL(args.getString(1)));
                } catch (MalformedURLException me) { callbackContext.error("URL argument is not valid."); }
             } else
                callbackContext.error("Invalid tracker object.");
         } else
            callbackContext.error("URL argument missing.");
    }

    private void withErrorMessage(JSONArray args, CallbackContext callbackContext) throws JSONException {
      if (args.length() > 1) {
          HttpRequestTracker tracker = httpRequestTrackers.get(args.getString(0));
          if (tracker != null) {
            tracker.withError(args.getString(1));
          } else
             callbackContext.error("Invalid tracker object.");
      } else
         callbackContext.error("URL argument missing.");
    }

    private void withResponseCode(JSONArray args, CallbackContext callbackContext) throws JSONException {
      if (args.length() > 1) {
          HttpRequestTracker tracker = httpRequestTrackers.get(args.getString(0));
          if (tracker != null) {
            tracker.withResponseCode(args.getInt(1));
          } else
             callbackContext.error("Invalid tracker object.");
      } else
         callbackContext.error("URL argument missing.");
    }

    private void withRequestContentLength(JSONArray args, CallbackContext callbackContext) throws JSONException {
      if (args.length() > 1) {
          HttpRequestTracker tracker = httpRequestTrackers.get(args.getString(0));
          if (tracker != null) {
            tracker.withRequestContentLength(args.getLong(1));
          } else
             callbackContext.error("Invalid tracker object.");
      } else
         callbackContext.error("URL argument missing.");
    }

    private void withResponseContentLength(JSONArray args, CallbackContext callbackContext) throws JSONException {
      if (args.length() > 1) {
          HttpRequestTracker tracker = httpRequestTrackers.get(args.getString(0));
          if (tracker != null) {
            tracker.withResponseContentLength(args.getLong(1));
          } else
             callbackContext.error("Invalid tracker object.");
      } else
         callbackContext.error("URL argument missing.");
    }

    private void withRequestHeaderFields(JSONArray args, CallbackContext callbackContext) throws JSONException {
      if (args.length() > 1) {
          HttpRequestTracker tracker = httpRequestTrackers.get(args.getString(0));
          if (tracker != null) {
            JSONObject headersObj = args.getJSONObject(1);
            HashMap headersMap = new HashMap();
			      Iterator itor = headersObj.keys();
			      while (itor.hasNext()) {
				       String key = (String)itor.next();
				       String val = headersObj.getString(key);
				       ArrayList list = new ArrayList();
				       list.add(val);
				       // AppD magic headers must be uppercase CORE-39486
				      if (key.startsWith("adrum")) {
					       key = key.toUpperCase();
				      }
				     headersMap.put(key, list);
			      }
            tracker.withRequestHeaderFields(headersMap);
          } else
             callbackContext.error("Invalid tracker object.");
      } else
         callbackContext.error("URL argument missing.");
    }

    private void withResponseHeaderFields(JSONArray args, CallbackContext callbackContext) throws JSONException {
      if (args.length() > 1) {
          HttpRequestTracker tracker = httpRequestTrackers.get(args.getString(0));
          if (tracker != null) {
            JSONObject headersObj = args.getJSONObject(1);
            HashMap headersMap = new HashMap();
            Iterator itor = headersObj.keys();
            while (itor.hasNext()) {
               String key = (String)itor.next();
               String val = headersObj.getString(key);
               ArrayList list = new ArrayList();
               list.add(val);
               // AppD magic headers must be uppercase CORE-39486
               if (key.startsWith("adrum")) {
                 key = key.toUpperCase();
               }
               headersMap.put(key, list);
             }
            tracker.withResponseHeaderFields(headersMap);
          } else
             callbackContext.error("Invalid tracker object.");
      } else
         callbackContext.error("URL argument missing.");
    }

    private void withInstrumentationSource(JSONArray args, CallbackContext callbackContext) throws JSONException {
      if (args.length() > 1) {
          HttpRequestTracker tracker = httpRequestTrackers.get(args.getString(0));
          if (tracker != null) {
            tracker.withInstrumentationSource(args.getString(1));
          } else
             callbackContext.error("Invalid tracker object.");
      } else
         callbackContext.error("URL argument missing.");
    }

    private void reportDone(JSONArray args, CallbackContext callbackContext) throws JSONException {
      if (args.length() > 0) {
          HttpRequestTracker tracker = httpRequestTrackers.get(args.getString(0));
          if (tracker != null) {
            tracker.reportDone();
          } else
             callbackContext.error("Invalid tracker object.");
      } else
         callbackContext.error("URL argument missing.");
    }

    private void startNextSession(JSONArray args, CallbackContext callbackContext) throws JSONException {
        Instrumentation.startNextSession();
        callbackContext.success();
    }

    private void unblockScreenshots(JSONArray args, CallbackContext callbackContext) throws JSONException {
        Instrumentation.unblockScreenshots();
        callbackContext.success();
    }

    private void blockScreenshots(JSONArray args, CallbackContext callbackContext) throws JSONException {
        Instrumentation.blockScreenshots();
        callbackContext.success();
    }

    private void screenshotsBlocked(JSONArray args, CallbackContext callbackContext) throws JSONException {
        callbackContext.success(String.valueOf(Instrumentation.screenshotsBlocked()));
    }

    private void startSessionFrame(JSONArray args, CallbackContext callbackContext) throws JSONException {
       if (args.length() > 0) {
          SessionFrame sessionFrame = Instrumentation.startSessionFrame(args.getString(0));
          String uuid = UUID.randomUUID().toString();
          sessionFrames.put(uuid, sessionFrame);
          callbackContext.success(uuid);
       } else
          callbackContext.error("sessionFrameName argument is missing.");
    }

    private void updateSessionFrameName(JSONArray args, CallbackContext callbackContext) throws JSONException {
       if (args.length() > 1) {
          SessionFrame sessionFrame = sessionFrames.get(args.getString(0));
          if (sessionFrame != null) {
             sessionFrame.updateName(args.getString(1));
          } else
             callbackContext.error("Invalid SessionFrame object.");
       } else
          callbackContext.error("sessionFrameName argument is missing.");
    }

    private void endSessionFrame(JSONArray args, CallbackContext callbackContext) throws JSONException {
        SessionFrame sessionFrame = sessionFrames.get(args.getString(0));
        if (sessionFrame != null) {
            sessionFrame.end();
            sessionFrames.remove(sessionFrame);
        } else
            callbackContext.error("Invalid SessionFrame object.");
    }

    private void crash(JSONArray args, CallbackContext callbackContext) throws JSONException {
        throw new RuntimeException("Crash Attempt");
    }

    private void flush(JSONArray args, CallbackContext callbackContext) throws JSONException {
        try {
            HttpRequestTracker tracker = Instrumentation.beginHttpRequest(new URL("http://flush.queue"));
            tracker.withResponseCode(200).reportDone();
            callbackContext.success();
        } catch (MalformedURLException mue) { }
    }

    private boolean checkPluginInitialized(CallbackContext callbackContext) {
       if (pluginInitialized) {
          return true;
       } else {
          callbackContext.error("Plugin was not initialized due to missing or invalid App Key.");
          return false;
       }
    }

    // APPD-DUAL-PATCH-V10
    private static final java.util.List<JSONObject> NATIVE_BEACON_LOGS = new java.util.ArrayList<JSONObject>();

    private static void appendNativeBeaconLog(JSONObject entry) {
        synchronized (NATIVE_BEACON_LOGS) {
            NATIVE_BEACON_LOGS.add(0, entry);
            if (NATIVE_BEACON_LOGS.size() > 50) {
                NATIVE_BEACON_LOGS.remove(NATIVE_BEACON_LOGS.size() - 1);
            }
        }
    }

    private void getNativeBeaconLogs(CallbackContext callbackContext) {
        JSONArray arr = new JSONArray();
        synchronized (NATIVE_BEACON_LOGS) {
            for (JSONObject item : NATIVE_BEACON_LOGS) {
                arr.put(item);
            }
        }
        callbackContext.success(arr);
    }

    private CollectorChannelFactory createLoggingCollectorChannelFactory() {
        return new CollectorChannelFactory() {
            @Override
            public CollectorChannel newCollectorChannel() {
                return new CollectorChannel() {
                    private java.net.HttpURLConnection conn;
                    private long startMs = System.currentTimeMillis();
                    private long bytesWritten = 0L;
                    private boolean logged = false;

                    private synchronized java.net.HttpURLConnection ensureConnection() throws java.io.IOException {
                        if (conn == null) {
                            startMs = System.currentTimeMillis();
                            conn = (java.net.HttpURLConnection) getURL().openConnection();
                            conn.setReadTimeout(getReadTimeout());
                            conn.setConnectTimeout(getConnectTimeout());
                            conn.setRequestMethod(getRequestMethod());
                            for (java.util.Map.Entry<String, java.util.List<String>> e : getRequestProperties().entrySet()) {
                                for (String v : e.getValue()) {
                                    conn.addRequestProperty(e.getKey(), v);
                                }
                            }
                        }
                        return conn;
                    }

                    private synchronized void recordAttempt(int statusCode, String errMsg) {
                        if (logged) return;
                        logged = true;
                        long dur = Math.max(1L, System.currentTimeMillis() - startMs);
                        String urlStr = getURL() != null ? getURL().toString() : "";
                        JSONObject reqHeaders = new JSONObject();
                        String appKey = "";
                        try {
                            for (java.util.Map.Entry<String, java.util.List<String>> e : getRequestProperties().entrySet()) {
                                if (e.getKey() != null && e.getValue() != null && !e.getValue().isEmpty()) {
                                    reqHeaders.put(e.getKey(), e.getValue().get(0));
                                    if ("ky".equalsIgnoreCase(e.getKey())) appKey = e.getValue().get(0);
                                }
                            }
                        } catch (Exception ignored) {}

                        JSONObject respHeaders = new JSONObject();
                        String reqId = "n/a";
                        try {
                            if (conn != null && conn.getHeaderFields() != null) {
                                for (java.util.Map.Entry<String, java.util.List<String>> e : conn.getHeaderFields().entrySet()) {
                                    if (e.getKey() != null && e.getValue() != null && !e.getValue().isEmpty()) {
                                        respHeaders.put(e.getKey(), e.getValue().get(0));
                                        if ("AppD-Request-Id".equalsIgnoreCase(e.getKey())) reqId = e.getValue().get(0);
                                    }
                                }
                            }
                        } catch (Exception ignored) {}

                        android.util.Log.i("AppDynamics", "[EUM-NATIVE-BEACON] " + urlStr + " -> HTTP " + statusCode + " (" + dur + "ms) bytes=" + bytesWritten + " ky=" + appKey + " AppD-Request-Id=" + reqId);

                        try {
                            String timeStr = new java.text.SimpleDateFormat("h:mm:ss a", java.util.Locale.US).format(new java.util.Date());
                            JSONObject logObj = new JSONObject();
                            logObj.put("id", "native_beacon_" + startMs + "_" + Integer.toHexString(System.identityHashCode(this)));
                            logObj.put("timestamp", timeStr);
                            logObj.put("method", "BEACON");
                            logObj.put("url", urlStr);
                            logObj.put("isBeacon", true);
                            logObj.put("bridged", true);
                            logObj.put("isNativeBeacon", true);
                            logObj.put("status", errMsg != null ? ("Error: " + errMsg) : (statusCode + " OK (Cordova Native " + (appKey.isEmpty() ? "EUM-AAB-AVW" : appKey) + ")"));
                            logObj.put("statusCode", statusCode);
                            logObj.put("duration", dur);
                            logObj.put("requestHeaders", reqHeaders);
                            logObj.put("requestBody", "[Native Mobile RUM GZIP Payload: " + bytesWritten + " compressed bytes -> AppKey " + (appKey.isEmpty() ? "EUM-AAB-AVW" : appKey) + "]");
                            logObj.put("responseHeaders", respHeaders);
                            logObj.put("responseBody", errMsg != null ? errMsg : ("[HTTP " + statusCode + " accepted by Collector • AppD-Request-Id=" + reqId + "]"));
                            appendNativeBeaconLog(logObj);
                        } catch (Exception ignored) {}
                    }

                    @Override
                    public java.io.OutputStream getOutputStream() {
                        try {
                            java.net.HttpURLConnection c = ensureConnection();
                            c.setDoOutput(true);
                            final java.io.OutputStream raw = c.getOutputStream();
                            return new java.io.FilterOutputStream(raw) {
                                @Override
                                public void write(int b) throws java.io.IOException {
                                    out.write(b);
                                    bytesWritten++;
                                }
                                @Override
                                public void write(byte[] b, int off, int len) throws java.io.IOException {
                                    out.write(b, off, len);
                                    bytesWritten += len;
                                }
                            };
                        } catch (java.io.IOException ioe) {
                            throw new RuntimeException(ioe);
                        }
                    }

                    @Override
                    public java.io.InputStream getInputStream() {
                        try {
                            java.net.HttpURLConnection c = ensureConnection();
                            try {
                                return c.getInputStream();
                            } catch (java.io.IOException ioe) {
                                int code = 0;
                                try { code = c.getResponseCode(); } catch (Exception ignored) {}
                                recordAttempt(code, ioe.getMessage());
                                throw new RuntimeException(ioe);
                            }
                        } catch (java.io.IOException ioe) {
                            throw new RuntimeException(ioe);
                        }
                    }

                    @Override
                    public int getResponseCode() {
                        try {
                            java.net.HttpURLConnection c = ensureConnection();
                            int code = c.getResponseCode();
                            recordAttempt(code, null);
                            return code;
                        } catch (java.io.IOException ioe) {
                            throw new RuntimeException(ioe);
                        }
                    }

                    @Override
                    public java.util.Map<String, java.util.List<String>> getHeaderFields() {
                        try {
                            return ensureConnection().getHeaderFields();
                        } catch (Exception e) {
                            return java.util.Collections.emptyMap();
                        }
                    }
                };
            }
        };
    }

    private void executeNativeHttp(final String method, final String urlString, final String bodyString, final String contentType, final CallbackContext callbackContext) {
        cordova.getThreadPool().execute(new Runnable() {
            public void run() {
                java.net.HttpURLConnection conn = null;
                long startMs = System.currentTimeMillis();
                try {
                    java.net.URL url = new java.net.URL(urlString);
                    conn = (java.net.HttpURLConnection) url.openConnection();
                    conn.setRequestMethod(method);
                    conn.setConnectTimeout(15000);
                    conn.setReadTimeout(15000);
                    boolean hasBody = "POST".equalsIgnoreCase(method) || "PUT".equalsIgnoreCase(method) || "PATCH".equalsIgnoreCase(method);
                    if (hasBody) {
                        conn.setDoOutput(true);
                        if (contentType != null && !contentType.isEmpty()) {
                            conn.setRequestProperty("Content-Type", contentType);
                        }
                        byte[] bytes = bodyString != null ? bodyString.getBytes("UTF-8") : new byte[0];
                        java.io.OutputStream os = conn.getOutputStream();
                        os.write(bytes);
                        os.flush();
                        os.close();
                    }

                    int statusCode = conn.getResponseCode();
                    java.io.InputStream is = statusCode >= 400 ? conn.getErrorStream() : conn.getInputStream();
                    StringBuilder sb = new StringBuilder();
                    if (is != null) {
                        java.io.BufferedReader br = new java.io.BufferedReader(new java.io.InputStreamReader(is, "UTF-8"));
                        String line;
                        while ((line = br.readLine()) != null) {
                            sb.append(line);
                        }
                        br.close();
                    }

                    JSONObject headersJson = new JSONObject();
                    java.util.Map<String, java.util.List<String>> headerFields = conn.getHeaderFields();
                    if (headerFields != null) {
                        for (java.util.Map.Entry<String, java.util.List<String>> entry : headerFields.entrySet()) {
                            if (entry.getKey() != null && entry.getValue() != null && !entry.getValue().isEmpty()) {
                                headersJson.put(entry.getKey(), entry.getValue().get(0));
                            }
                        }
                    }

                    long dur = Math.max(1L, System.currentTimeMillis() - startMs);
                    android.util.Log.i("AppDynamics", "[EUM-NATIVE-HTTP] " + method + " " + urlString + " -> HTTP " + statusCode + " (" + dur + "ms)");

                    JSONObject res = new JSONObject();
                    res.put("statusCode", statusCode);
                    res.put("durationMs", dur);
                    res.put("method", method);
                    res.put("url", urlString);
                    res.put("headers", headersJson);
                    res.put("body", sb.toString());
                    callbackContext.success(res);
                } catch (Exception e) {
                    callbackContext.error(e.getMessage() != null ? e.getMessage() : "Native HTTP request failed");
                } finally {
                    if (conn != null) conn.disconnect();
                }
            }
        });
    }

    private void relayBeacon(final String urlString, final String bodyString, final CallbackContext callbackContext) {
        executeNativeHttp("POST", urlString, bodyString, "text/plain; charset=UTF-8", callbackContext);
    }

    private void nativeHttpRequest(final String urlString, final String method, final String bodyString, final CallbackContext callbackContext) {
        String resolvedUrl = (urlString != null && !urlString.trim().isEmpty()) ? urlString.trim() : "https://jsonplaceholder.typicode.com/todos/1";
        String resolvedMethod = (method != null && !method.trim().isEmpty()) ? method.trim().toUpperCase(java.util.Locale.US) : "GET";
        executeNativeHttp(resolvedMethod, resolvedUrl, bodyString, "application/json; charset=UTF-8", callbackContext);
    }

    private void nativeCrash() {
        android.util.Log.w("AppDynamics", "[ADEUMMobilePlugin] Triggering intentional native Android crash");
        new Thread(new Runnable() {
            public void run() {
                throw new RuntimeException("AppDEumDebugger Intentional Native Android Crash");
            }
        }, "ADEum-Test-Crash").start();
    }

    private String readDefaultString(String key) {
        int resId = cordova.getActivity().getResources().getIdentifier(key, "string", cordova.getActivity().getPackageName());
        return resId != 0 ? cordova.getActivity().getString(resId) : "";
    }

    private void setNativeConfig(JSONObject cfg, CallbackContext callbackContext) {
        try {
            if (cfg == null) cfg = new JSONObject();
            String appKey = cfg.optString("appKey", "").trim();
            String collectorUrl = cfg.optString("collectorUrl", "").trim();
            String screenshotUrl = cfg.optString("screenshotUrl", "").trim();

            android.content.SharedPreferences prefs = cordova.getActivity().getSharedPreferences("appd_eum_override_prefs", android.content.Context.MODE_PRIVATE);
            android.content.SharedPreferences.Editor ed = prefs.edit();
            if (!appKey.isEmpty()) ed.putString("appKey", appKey);
            if (!collectorUrl.isEmpty()) ed.putString("collectorUrl", collectorUrl);
            if (!screenshotUrl.isEmpty()) ed.putString("screenshotUrl", screenshotUrl);
            ed.commit();

            if (!appKey.isEmpty() && !appKey.equals("XXX-XXX-XXX")) {
                if (!pluginInitialized) {
                    try {
                        AgentConfiguration config = AgentConfiguration.builder()
                            .withAppKey(appKey)
                            .withContext(cordova.getActivity())
                            .withCollectorURL(!collectorUrl.isEmpty() ? collectorUrl : readDefaultString("adeum_collector_url"))
                            .withScreenshotURL(!screenshotUrl.isEmpty() ? screenshotUrl : readDefaultString("adeum_screenshot_url"))
                            .withLoggingLevel(1)
                            .withJSAgentInjectionEnabled(false)
                            .withJSAgentAjaxEnabled(false)
                            .withExcludedUrlPatterns(new java.util.HashSet<String>(java.util.Arrays.asList(".*eumcollector.*")))
                            .withCollectorChannelFactory(createLoggingCollectorChannelFactory())
                            .build();
                        Instrumentation.startFromHybrid(config, ADEumPluginType, VERSION);
                        pluginInitialized = true;
                        android.util.Log.i("AppDynamics", "[ADEUMMobilePlugin] Started Instrumentation live with appKey: " + appKey);
                    } catch (Throwable t) {
                        android.util.Log.w("AppDynamics", "[ADEUMMobilePlugin] Failed to start native agent: " + t.getMessage());
                    }
                } else {
                    try {
                        Instrumentation.changeAppKey(appKey);
                        android.util.Log.i("AppDynamics", "[ADEUMMobilePlugin] Changed appKey to: " + appKey);
                    } catch (Throwable t) {
                        android.util.Log.w("AppDynamics", "[ADEUMMobilePlugin] Failed to changeAppKey: " + t.getMessage());
                    }
                }
            }
            getNativeConfig(callbackContext);
        } catch (Exception e) {
            callbackContext.error(e.getMessage() != null ? e.getMessage() : "Failed to save native config");
        }
    }

    private void getNativeConfig(CallbackContext callbackContext) {
        try {
            android.content.SharedPreferences prefs = cordova.getActivity().getSharedPreferences("appd_eum_override_prefs", android.content.Context.MODE_PRIVATE);
            String appKey = prefs.getString("appKey", "");
            String collectorUrl = prefs.getString("collectorUrl", "");
            String screenshotUrl = prefs.getString("screenshotUrl", "");
            boolean hasOverride = !appKey.isEmpty() || !collectorUrl.isEmpty() || !screenshotUrl.isEmpty();

            JSONObject res = new JSONObject();
            res.put("appKey", appKey.isEmpty() ? readDefaultString("adeum_app_key") : appKey);
            res.put("collectorUrl", collectorUrl.isEmpty() ? readDefaultString("adeum_collector_url") : collectorUrl);
            res.put("screenshotUrl", screenshotUrl.isEmpty() ? readDefaultString("adeum_screenshot_url") : screenshotUrl);
            res.put("hasOverride", hasOverride);
            res.put("pluginInitialized", pluginInitialized);
            callbackContext.success(res);
        } catch (Exception e) {
            callbackContext.error(e.getMessage());
        }
    }

    private void resetNativeConfig(CallbackContext callbackContext) {
        try {
            android.content.SharedPreferences prefs = cordova.getActivity().getSharedPreferences("appd_eum_override_prefs", android.content.Context.MODE_PRIVATE);
            prefs.edit().clear().commit();
            String defKey = readDefaultString("adeum_app_key");
            if (!defKey.isEmpty() && !defKey.equals("XXX-XXX-XXX")) {
                try {
                    Instrumentation.changeAppKey(defKey);
                } catch (Throwable t) {}
            }
            getNativeConfig(callbackContext);
        } catch (Exception e) {
            callbackContext.error(e.getMessage());
        }
    }

}