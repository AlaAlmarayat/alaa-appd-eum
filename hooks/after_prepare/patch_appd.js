#!/usr/bin/env node
/**
 * Ala'a AppD EUM - Post-Prepare Automation & SDK Bytecode Patch Hook
 * 
 * Creator & Lead Engineer: Ala'a Mrayat
 */
const fs = require('fs');
const path = require('path');

const PATCH_MARKER = 'APPD-DUAL-PATCH-V10';

module.exports = function(context) {
    const projectRoot = context.opts.projectRoot || path.resolve(__dirname, '../../');
    console.log('[Hook patch_appd] Running post-prepare AppDynamics configuration check...');

    // 1. Android Patching
    const androidResDir = path.join(projectRoot, 'platforms', 'android', 'app', 'src', 'main', 'res', 'values');
    const targetStringsXml = path.join(androidResDir, 'strings.xml');
    const sourceStringsXml = path.join(projectRoot, 'res', 'values', 'strings.xml');

    if (fs.existsSync(sourceStringsXml)) {
        if (!fs.existsSync(androidResDir)) {
            fs.mkdirSync(androidResDir, { recursive: true });
        }
        fs.copyFileSync(sourceStringsXml, targetStringsXml);
        console.log('[Hook patch_appd] Synced AppDynamics strings to ' + targetStringsXml);
    }

    // Check Android app/build.gradle for AppDynamics classpath
    const appBuildGradle = path.join(projectRoot, 'platforms', 'android', 'app', 'build.gradle');
    if (fs.existsSync(appBuildGradle)) {
        let content = fs.readFileSync(appBuildGradle, 'utf8');
        const appdClasspath = "classpath 'com.appdynamics:appdynamics-gradle-plugin:26.8.0'";
        if (/classpath\s+['"]com\.appdynamics:appdynamics-gradle-plugin:[^'"]+['"]/.test(content)) {
            if (!content.includes(appdClasspath)) {
                content = content.replace(/classpath\s+['"]com\.appdynamics:appdynamics-gradle-plugin:[^'"]+['"]/, appdClasspath);
                fs.writeFileSync(appBuildGradle, content, 'utf8');
                console.log('[Hook patch_appd] Updated AppD gradle plugin to 26.8.0 in app/build.gradle');
            }
        } else {
            content = content.replace(/(dependencies\s*\{)/, `$1\n        ${appdClasspath}`);
            fs.writeFileSync(appBuildGradle, content, 'utf8');
            console.log('[Hook patch_appd] Injected AppD gradle plugin 26.8.0 to app/build.gradle');
        }
    }

    // Sync Android network_security_config.xml and raw CA bundle
    const netSecSource = path.join(projectRoot, 'res', 'xml', 'network_security_config.xml');
    const netSecTargetDir = path.join(projectRoot, 'platforms', 'android', 'app', 'src', 'main', 'res', 'xml');
    const netSecTarget = path.join(netSecTargetDir, 'network_security_config.xml');
    if (fs.existsSync(netSecSource)) {
        if (!fs.existsSync(netSecTargetDir)) {
            fs.mkdirSync(netSecTargetDir, { recursive: true });
        }
        fs.copyFileSync(netSecSource, netSecTarget);
    }

    const caSource = path.join(projectRoot, 'res', 'raw', 'appd_ca_bundle.pem');
    const caTargetDir = path.join(projectRoot, 'platforms', 'android', 'app', 'src', 'main', 'res', 'raw');
    const caTarget = path.join(caTargetDir, 'appd_ca_bundle.pem');
    if (fs.existsSync(caSource)) {
        if (!fs.existsSync(caTargetDir)) {
            fs.mkdirSync(caTargetDir, { recursive: true });
        }
        fs.copyFileSync(caSource, caTarget);
    }

    // Suppress unsupported compileSdk warning for Android Studio 2024.2 + AGP 8.7.2
    const gradlePropsPath = path.join(projectRoot, 'platforms', 'android', 'gradle.properties');
    if (fs.existsSync(gradlePropsPath)) {
        let props = fs.readFileSync(gradlePropsPath, 'utf8');
        if (!props.includes('android.suppressUnsupportedCompileSdk')) {
            props += '\nandroid.suppressUnsupportedCompileSdk=36\n';
            fs.writeFileSync(gradlePropsPath, props, 'utf8');
            console.log('[Hook patch_appd] Added android.suppressUnsupportedCompileSdk=36 to gradle.properties');
        }
    }

    // Patch Android ADEUMMobilePlugin.java cleanly from pristine source when upgrading
    const pristineAndroidJava = path.join(projectRoot, 'plugins', 'appd-plugin-eum-mobile', 'src', 'android', 'com', 'appdynamics', 'cordova', 'plugin', 'ADEUMMobilePlugin.java');
    const androidPluginJava = path.join(projectRoot, 'platforms', 'android', 'app', 'src', 'main', 'java', 'com', 'appdynamics', 'cordova', 'plugin', 'ADEUMMobilePlugin.java');
    if (fs.existsSync(androidPluginJava)) {
        let currentJava = fs.readFileSync(androidPluginJava, 'utf8');
        if (!currentJava.includes(PATCH_MARKER)) {
            let javaSrc = fs.existsSync(pristineAndroidJava) ? fs.readFileSync(pristineAndroidJava, 'utf8') : currentJava;

            javaSrc = javaSrc.replace(
                'import com.appdynamics.eumagent.runtime.AgentConfiguration;',
                'import com.appdynamics.eumagent.runtime.AgentConfiguration;\nimport com.appdynamics.eumagent.runtime.CollectorChannel;\nimport com.appdynamics.eumagent.runtime.CollectorChannelFactory;'
            );

            javaSrc = javaSrc.replace(
                /withJSAgentAjaxEnabled\(true\)/g,
                'withJSAgentInjectionEnabled(false).\n                                    withJSAgentAjaxEnabled(false).\n                                    withExcludedUrlPatterns(new java.util.HashSet<String>(java.util.Arrays.asList(".*eumcollector.*"))).\n                                    withCollectorChannelFactory(createLoggingCollectorChannelFactory())'
            );

            javaSrc = javaSrc.replace(
                'String screenshotUrl = cordova.getActivity().getString(screenshotUrlResId);',
                `String screenshotUrl = cordova.getActivity().getString(screenshotUrlResId);
        android.content.SharedPreferences overridePrefs = cordova.getActivity().getSharedPreferences("appd_eum_override_prefs", android.content.Context.MODE_PRIVATE);
        String ovAppKey = overridePrefs.getString("appKey", "");
        String ovCollectorUrl = overridePrefs.getString("collectorUrl", "");
        String ovScreenshotUrl = overridePrefs.getString("screenshotUrl", "");
        if (!ovAppKey.isEmpty()) appKey = ovAppKey;
        if (!ovCollectorUrl.isEmpty()) collectorUrl = ovCollectorUrl;
        if (!ovScreenshotUrl.isEmpty()) screenshotUrl = ovScreenshotUrl;`
            );

            javaSrc = javaSrc.replace(
                'if (!checkPluginInitialized(callbackContext))\n           return false;',
                `// Safe actions allowed even if AppDynamics was initialized with placeholder key
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
           return false;`
            );

            const androidAdditions = `
    // ${PATCH_MARKER}
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
`;
            javaSrc = javaSrc.replace(/\}\s*$/, androidAdditions + '\n}');
            fs.writeFileSync(androidPluginJava, javaSrc, 'utf8');
            console.log('[Hook patch_appd] Updated Android ADEUMMobilePlugin.java (' + PATCH_MARKER + ')');
        }
    }

    // 2. iOS Patching
    const infoPlistPath = path.join(projectRoot, 'platforms', 'ios', 'App', 'App-Info.plist');
    if (fs.existsSync(infoPlistPath)) {
        let plist = fs.readFileSync(infoPlistPath, 'utf8');
        let updatedPlist = plist
            .replace(/(<key>ADEUM_LOGGING_LEVEL<\/key>\s*<string>)[^<]*(<\/string>)/, '$11$2')
            .replace(/(<key>ForceWebviewInstrumentation<\/key>\s*<)true(\/>)/, '$1false$2')
            .replace(/(<key>ForceAjaxInstrumentation<\/key>\s*<)true(\/>)/, '$1false$2')
            .replace(/(<key>ADEUM_APP_KEY<\/key>\s*<string>)[^<]*(<\/string>)/, '$1XXX-XXX-XXX$2')
            .replace(/(<key>ADEUM_COLLECTOR_URL<\/key>\s*<string>)[^<]*(<\/string>)/, '$1https://example-mobile-collector.com$2')
            .replace(/(<key>ADEUM_SCREENSHOT_URL<\/key>\s*<string>)[^<]*(<\/string>)/, '$1https://example-screenshots.com$2');
        if (!updatedPlist.includes('<key>CFBundleDisplayName</key>')) {
            updatedPlist = updatedPlist.replace('<dict>', '<dict>\n\t<key>CFBundleDisplayName</key>\n\t<string>Ala\'a AppD EUM</string>');
        }
        if (updatedPlist !== plist) {
            fs.writeFileSync(infoPlistPath, updatedPlist, 'utf8');
            console.log('[Hook patch_appd] Synced iOS App-Info.plist (defaults, LOGGING_LEVEL=1, ForceWebviewInstrumentation=false)');
        }
    }

    const pristineIosM = path.join(projectRoot, 'plugins', 'appd-plugin-eum-mobile', 'src', 'ios', 'ADEUMMobilePlugin.m');
    const iosPluginM = path.join(projectRoot, 'platforms', 'ios', 'App', 'Plugins', 'appd-plugin-eum-mobile', 'ADEUMMobilePlugin.m');
    if (fs.existsSync(iosPluginM)) {
        let currentIos = fs.readFileSync(iosPluginM, 'utf8');
        if (!currentIos.includes(PATCH_MARKER)) {
            let src = fs.existsSync(pristineIosM) ? fs.readFileSync(pristineIosM, 'utf8') : currentIos;

            src = src.replace(
                '#import <Cordova/CDV.h>',
                '#import <UIKit/UIKit.h>\n#import <Cordova/CDV.h>'
            );

            const earlyInitAndChannel = `// ${PATCH_MARKER}
static NSMutableArray<NSDictionary *> *ADEUMNativeBeaconLogs(void) {
    static NSMutableArray<NSDictionary *> *logs = nil;
    static dispatch_once_t onceToken;
    dispatch_once(&onceToken, ^{
        logs = [[NSMutableArray alloc] init];
    });
    return logs;
}

@interface ADEUMLoggingCollectorChannel : NSObject <ADEumCollectorChannel>
@end

@implementation ADEUMLoggingCollectorChannel

- (NSData *)sendSynchronousRequest:(NSURLRequest *)request
                 returningResponse:(NSURLResponse **)response
                             error:(NSError **)error {
    NSDate *start = [NSDate date];
    NSURLSessionConfiguration *sessionCfg = [NSURLSessionConfiguration ephemeralSessionConfiguration];
    sessionCfg.timeoutIntervalForRequest = request.timeoutInterval > 0 ? request.timeoutInterval : 30.0;
    NSURLSession *session = [NSURLSession sessionWithConfiguration:sessionCfg];

    __block NSData *respData = nil;
    __block NSURLResponse *respObj = nil;
    __block NSError *respErr = nil;
    dispatch_semaphore_t sem = dispatch_semaphore_create(0);

    NSURLSessionDataTask *task = [session dataTaskWithRequest:request completionHandler:^(NSData *data, NSURLResponse *res, NSError *err) {
        respData = data;
        respObj = res;
        respErr = err;
        dispatch_semaphore_signal(sem);
    }];
    [task resume];
    dispatch_semaphore_wait(sem, DISPATCH_TIME_FOREVER);
    [session finishTasksAndInvalidate];

    if (response) *response = respObj;
    if (error) *error = respErr;

    long durationMs = (long)MAX(1.0, [[NSDate date] timeIntervalSinceDate:start] * 1000.0);
    NSHTTPURLResponse *httpResp = [respObj isKindOfClass:[NSHTTPURLResponse class]] ? (NSHTTPURLResponse *)respObj : nil;
    NSInteger statusCode = httpResp ? httpResp.statusCode : 0;
    NSDictionary *reqHeaders = request.allHTTPHeaderFields ?: @{};
    NSDictionary *respHeaders = httpResp ? (httpResp.allHeaderFields ?: @{}) : @{};
    NSString *urlStr = request.URL.absoluteString ?: @"";
    NSString *appKey = reqHeaders[@"ky"] ?: reqHeaders[@"KY"] ?: @"EUM-AAB-AVW";
    NSString *reqId = respHeaders[@"AppD-Request-Id"] ?: respHeaders[@"appd-request-id"] ?: @"n/a";
    unsigned long reqBytes = (unsigned long)(request.HTTPBody ? request.HTTPBody.length : 0);

    if (respErr) {
        NSLog(@"[EUM-NATIVE-BEACON] ❌ POST %@ -> Error: %@ (%ldms) ky=%@", urlStr, respErr.localizedDescription, durationMs, appKey);
    } else {
        NSLog(@"[EUM-NATIVE-BEACON] ✅ POST %@ -> HTTP %ld (%ldms) bytes=%lu ky=%@ AppD-Request-Id=%@", urlStr, (long)statusCode, durationMs, reqBytes, appKey, reqId);
    }

    NSDateFormatter *df = [[NSDateFormatter alloc] init];
    df.dateFormat = @"h:mm:ss a";
    NSString *timeStr = [df stringFromDate:[NSDate date]];
    NSString *entryId = [NSString stringWithFormat:@"native_beacon_%.0f_%@", [[NSDate date] timeIntervalSince1970] * 1000.0, [[NSUUID UUID].UUIDString substringToIndex:6]];

    NSDictionary *entry = @{
        @"id": entryId,
        @"timestamp": timeStr ?: @"",
        @"method": @"BEACON",
        @"url": urlStr,
        @"isBeacon": @YES,
        @"bridged": @YES,
        @"isNativeBeacon": @YES,
        @"status": respErr ? [NSString stringWithFormat:@"Error: %@", respErr.localizedDescription] : [NSString stringWithFormat:@"%ld OK (Cordova Native %@)", (long)statusCode, appKey],
        @"statusCode": @(statusCode),
        @"duration": @(durationMs),
        @"requestHeaders": reqHeaders,
        @"requestBody": [NSString stringWithFormat:@"[Native Mobile RUM Payload: %lu bytes -> AppKey %@]", reqBytes, appKey],
        @"responseHeaders": respHeaders,
        @"responseBody": respErr ? respErr.localizedDescription : [NSString stringWithFormat:@"[HTTP %ld accepted by Collector • AppD-Request-Id=%@]", (long)statusCode, reqId]
    };

    @synchronized ([ADEUMLoggingCollectorChannel class]) {
        NSMutableArray<NSDictionary *> *logs = ADEUMNativeBeaconLogs();
        [logs insertObject:entry atIndex:0];
        if (logs.count > 50) {
            [logs removeLastObject];
        }
    }

    return respData;
}

@end

@implementation ADEUMMobilePlugin

+ (void)load {
    [[NSNotificationCenter defaultCenter] addObserverForName:UIApplicationDidFinishLaunchingNotification
                                                      object:nil
                                                       queue:[NSOperationQueue mainQueue]
                                                  usingBlock:^(NSNotification * _Nonnull note) {
        [ADEUMMobilePlugin initializeAppDynamicsFromPlist];
    }];
}

+ (void)initializeAppDynamicsFromPlist {
    static dispatch_once_t onceToken;
    dispatch_once(&onceToken, ^{
        NSDictionary *adeumSettings = [[[NSBundle mainBundle] infoDictionary] objectForKey:@"ADEUM_Settings"];
        NSUserDefaults *defaults = [NSUserDefaults standardUserDefaults];
        NSString *ovAppKey = [defaults stringForKey:@"appd_override_app_key"];
        NSString *ovCollectorUrl = [defaults stringForKey:@"appd_override_collector_url"];
        NSString *ovScreenshotUrl = [defaults stringForKey:@"appd_override_screenshot_url"];
        NSString *appKey = (ovAppKey && [ovAppKey length] > 0) ? ovAppKey : [adeumSettings objectForKey:@"ADEUM_APP_KEY"];
        NSString *collectorUrl = (ovCollectorUrl && [ovCollectorUrl length] > 0) ? ovCollectorUrl : [adeumSettings objectForKey:@"ADEUM_COLLECTOR_URL"];
        NSString *screenshotUrl = (ovScreenshotUrl && [ovScreenshotUrl length] > 0) ? ovScreenshotUrl : [adeumSettings objectForKey:@"ADEUM_SCREENSHOT_URL"];
        NSString *screenshotsEnabled = [adeumSettings objectForKey:@"ADEUM_SCREENSHOTS_ENABLED"];
        NSInteger loggingLevelInt = [[adeumSettings objectForKey:@"ADEUM_LOGGING_LEVEL"] integerValue];
        NSString *reachabilityHost = [adeumSettings objectForKey:@"ADEUM_REACHABILITY_HOST"];
        NSInteger interactionCaptureModeInt = [[adeumSettings objectForKey:@"ADEUM_INTERACTION_CAPTURE_MODE"] integerValue];

        if (!appKey || [appKey length] == 0) {
            NSLog(@"[ADEUMMobilePlugin] Early init skipped: ADEUM_APP_KEY missing.");
            return;
        }

        ADEumAgentConfiguration *cfg = [[ADEumAgentConfiguration alloc] initWithAppKey:appKey];
        if (collectorUrl && [collectorUrl length] > 0) {
            cfg.collectorURL = collectorUrl;
        }
        if (screenshotUrl && [screenshotUrl length] > 0) {
            cfg.screenshotURL = screenshotUrl;
        }
        if ([screenshotsEnabled isKindOfClass:[NSString class]]) {
            cfg.screenshotsEnabled = ([@"true" caseInsensitiveCompare:screenshotsEnabled] == NSOrderedSame);
        } else if ([screenshotsEnabled isKindOfClass:[NSNumber class]]) {
            cfg.screenshotsEnabled = [(NSNumber *)screenshotsEnabled boolValue];
        }
        if (loggingLevelInt >= ADEumLoggingLevelOff && loggingLevelInt <= ADEumLoggingLevelAll) {
            cfg.loggingLevel = (ADEumLoggingLevel)loggingLevelInt;
        } else {
            cfg.loggingLevel = ADEumLoggingLevelError;
        }
        cfg.interactionCaptureMode = (ADEumInteractionCaptureMode)interactionCaptureModeInt;
        if (reachabilityHost && [reachabilityHost length] > 0) {
            cfg.reachabilityHostName = reachabilityHost;
        }
        // Disable Native SDK's WebView JS injector so Browser JS Agent (EUM-AAB-AUE) runs cleanly;
        // Native HTTP/Session/Breadcrumb tracking routes explicitly through ADEUMMobilePlugin -> EUM-AAB-AVW.
        cfg.jsAgentEnabled = NO;
        cfg.jsAgentAjaxEnabled = NO;
        cfg.excludedUrlPatterns = [NSSet setWithObject:@".*eumcollector.*"];
        cfg.collectorChannel = [[ADEUMLoggingCollectorChannel alloc] init];

        NSLog(@"[ADEUMMobilePlugin] Early init (pre-WKWebView) AppKey=%@ Collector=%@ LoggingLevel=%ld jsAgentEnabled=NO",
              appKey, cfg.collectorURL, (long)cfg.loggingLevel);

        [ADEumInstrumentation initWithConfiguration:cfg a:ADEumPluginHybridAgentType b:ADEumPluginHybridAgentVersion];
        SEL gabsSelector = NSSelectorFromString(@"generateAppStartBeacon");
        if ([ADEumInstrumentation respondsToSelector:gabsSelector]) {
            [ADEumInstrumentation performSelector:gabsSelector];
        }
    });
}

// Manage keymap store
- (void)pluginInitialize {
    self.keymap = [[NSMutableDictionary alloc] initWithCapacity:0];
    [ADEUMMobilePlugin initializeAppDynamicsFromPlist];
    NSLog(@"[ADEUMMobilePlugin] pluginInitialize complete (Cordova WebView ready)");
}`;

            src = src.replace(
                /@implementation ADEUMMobilePlugin[\s\S]*?- \(void\)pluginInitialize \{[\s\S]*?\n\}/,
                earlyInitAndChannel
            );

            src = src.replace(
                /-\s*\(void\)flush:\(CDVInvokedUrlCommand\s*\*\)command\s*\{[\s\S]*?\n\}/,
                `- (void)flush:(CDVInvokedUrlCommand *)command {
    SEL fbnSelector = NSSelectorFromString(@"flushBeaconsNow");
    if ([ADEumInstrumentation respondsToSelector:fbnSelector]) {
        [ADEumInstrumentation performSelector:fbnSelector];
    } else {
        ADEumHTTPRequestTracker *t = [ADEumHTTPRequestTracker requestTrackerWithURL:[NSURL URLWithString:@"http://flush-beacons.com"]];
        t.statusCode = @200;
        [t reportDone];
    }
    if (command != nil) {
        CDVPluginResult *res = [CDVPluginResult resultWithStatus:CDVCommandStatus_OK];
        [self.commandDelegate sendPluginResult:res callbackId:command.callbackId];
    }
}`
            );

            const iosExtraMethods = `
- (void)getNativeBeaconLogs:(CDVInvokedUrlCommand *)command {
    NSArray *snapshot = nil;
    @synchronized ([ADEUMLoggingCollectorChannel class]) {
        snapshot = [ADEUMNativeBeaconLogs() copy];
    }
    CDVPluginResult *result = [CDVPluginResult resultWithStatus:CDVCommandStatus_OK messageAsArray:(snapshot ?: @[])];
    [self.commandDelegate sendPluginResult:result callbackId:command.callbackId];
}

- (void)executeNativeRequestWithMethod:(NSString *)method
                             urlString:(NSString *)urlString
                            bodyString:(NSString *)bodyString
                           contentType:(NSString *)contentType
                               logTag:(NSString *)logTag
                              command:(CDVInvokedUrlCommand *)command {
    if (!urlString || [urlString length] == 0) {
        CDVPluginResult *err = [CDVPluginResult resultWithStatus:CDVCommandStatus_ERROR messageAsString:@"Missing URL"];
        [self.commandDelegate sendPluginResult:err callbackId:command.callbackId];
        return;
    }

    NSDate *start = [NSDate date];
    NSURL *url = [NSURL URLWithString:urlString];
    NSMutableURLRequest *req = [NSMutableURLRequest requestWithURL:url];
    NSString *upperMethod = method ? [method uppercaseString] : @"GET";
    req.HTTPMethod = upperMethod;
    if ([upperMethod isEqualToString:@"POST"] || [upperMethod isEqualToString:@"PUT"] || [upperMethod isEqualToString:@"PATCH"]) {
        if (contentType && [contentType length] > 0) {
            [req setValue:contentType forHTTPHeaderField:@"Content-Type"];
        }
        req.HTTPBody = [(bodyString ?: @"") dataUsingEncoding:NSUTF8StringEncoding];
    }

    NSURLSessionDataTask *task = [[NSURLSession sharedSession] dataTaskWithRequest:req completionHandler:^(NSData *data, NSURLResponse *response, NSError *error) {
        CDVPluginResult *result = nil;
        long durationMs = (long)MAX(1.0, [[NSDate date] timeIntervalSinceDate:start] * 1000.0);
        if (error) {
            NSLog(@"[ADEUMMobilePlugin] %@ error: %@", logTag, error.localizedDescription);
            result = [CDVPluginResult resultWithStatus:CDVCommandStatus_ERROR messageAsString:error.localizedDescription];
        } else {
            NSHTTPURLResponse *httpResp = (NSHTTPURLResponse *)response;
            NSInteger statusCode = httpResp ? httpResp.statusCode : 0;
            NSDictionary *headers = httpResp ? httpResp.allHeaderFields : @{};
            NSString *respBody = data ? [[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding] : @"";
            if (!respBody) respBody = @"";
            NSLog(@"[ADEUMMobilePlugin] %@ %@ %@ -> HTTP %ld (%ldms)", logTag, upperMethod, urlString, (long)statusCode, durationMs);
            result = [CDVPluginResult resultWithStatus:CDVCommandStatus_OK messageAsDictionary:@{
                @"statusCode": @(statusCode),
                @"durationMs": @(durationMs),
                @"method": upperMethod,
                @"url": urlString,
                @"headers": headers,
                @"body": respBody
            }];
        }
        [self.commandDelegate sendPluginResult:result callbackId:command.callbackId];
    }];
    [task resume];
}

- (void)relayBeacon:(CDVInvokedUrlCommand *)command {
    NSString *urlString = [command argumentAtIndex:0 withDefault:nil andClass:[NSString class]];
    NSString *bodyString = [command argumentAtIndex:1 withDefault:@"" andClass:[NSString class]];
    [self executeNativeRequestWithMethod:@"POST"
                               urlString:urlString
                              bodyString:bodyString
                             contentType:@"text/plain; charset=UTF-8"
                                  logTag:@"relayBeacon"
                                 command:command];
}

- (void)nativeHttpRequest:(CDVInvokedUrlCommand *)command {
    NSString *rawUrl = [command argumentAtIndex:0 withDefault:@"https://jsonplaceholder.typicode.com/todos/1" andClass:[NSString class]];
    NSString *urlString = ([rawUrl length] > 0) ? rawUrl : @"https://jsonplaceholder.typicode.com/todos/1";
    NSString *rawMethod = [command argumentAtIndex:1 withDefault:@"GET" andClass:[NSString class]];
    NSString *method = ([rawMethod length] > 0) ? rawMethod : @"GET";
    NSString *bodyString = [command argumentAtIndex:2 withDefault:@"" andClass:[NSString class]];
    [self executeNativeRequestWithMethod:method
                               urlString:urlString
                              bodyString:bodyString
                             contentType:@"application/json; charset=UTF-8"
                                  logTag:@"[EUM-NATIVE-HTTP]"
                                 command:command];
}

- (void)nativeCrash:(CDVInvokedUrlCommand *)command {
    NSLog(@"[ADEUMMobilePlugin] Triggering intentional native iOS crash");
    dispatch_async(dispatch_get_main_queue(), ^{
        @throw [NSException exceptionWithName:@"AppDEumDebuggerCrash"
                                       reason:@"Intentional Native iOS Crash"
                                     userInfo:nil];
    });
}

- (NSDictionary *)currentNativeConfigDictionary {
    NSDictionary *adeumSettings = [[[NSBundle mainBundle] infoDictionary] objectForKey:@"ADEUM_Settings"];
    NSUserDefaults *defaults = [NSUserDefaults standardUserDefaults];
    NSString *ovAppKey = [defaults stringForKey:@"appd_override_app_key"] ?: @"";
    NSString *ovCollectorUrl = [defaults stringForKey:@"appd_override_collector_url"] ?: @"";
    NSString *ovScreenshotUrl = [defaults stringForKey:@"appd_override_screenshot_url"] ?: @"";
    BOOL hasOverride = ([ovAppKey length] > 0 || [ovCollectorUrl length] > 0 || [ovScreenshotUrl length] > 0);
    return @{
        @"appKey": ([ovAppKey length] > 0 ? ovAppKey : (adeumSettings[@"ADEUM_APP_KEY"] ?: @"")),
        @"collectorUrl": ([ovCollectorUrl length] > 0 ? ovCollectorUrl : (adeumSettings[@"ADEUM_COLLECTOR_URL"] ?: @"")),
        @"screenshotUrl": ([ovScreenshotUrl length] > 0 ? ovScreenshotUrl : (adeumSettings[@"ADEUM_SCREENSHOT_URL"] ?: @"")),
        @"hasOverride": @(hasOverride)
    };
}

- (void)setNativeConfig:(CDVInvokedUrlCommand *)command {
    NSDictionary *cfg = [command argumentAtIndex:0 withDefault:@{} andClass:[NSDictionary class]];
    NSUserDefaults *defaults = [NSUserDefaults standardUserDefaults];
    NSString *appKey = [cfg[@"appKey"] isKindOfClass:[NSString class]] ? [cfg[@"appKey"] stringByTrimmingCharactersInSet:[NSCharacterSet whitespaceAndNewlineCharacterSet]] : @"";
    NSString *collectorUrl = [cfg[@"collectorUrl"] isKindOfClass:[NSString class]] ? [cfg[@"collectorUrl"] stringByTrimmingCharactersInSet:[NSCharacterSet whitespaceAndNewlineCharacterSet]] : @"";
    NSString *screenshotUrl = [cfg[@"screenshotUrl"] isKindOfClass:[NSString class]] ? [cfg[@"screenshotUrl"] stringByTrimmingCharactersInSet:[NSCharacterSet whitespaceAndNewlineCharacterSet]] : @"";

    if ([appKey length] > 0) [defaults setObject:appKey forKey:@"appd_override_app_key"];
    if ([collectorUrl length] > 0) [defaults setObject:collectorUrl forKey:@"appd_override_collector_url"];
    if ([screenshotUrl length] > 0) [defaults setObject:screenshotUrl forKey:@"appd_override_screenshot_url"];
    [defaults synchronize];

    if ([appKey length] > 0 && ![appKey isEqualToString:@"XXX-XXX-XXX"]) {
        @try {
            [ADEumInstrumentation changeAppKey:appKey];
        } @catch (NSException *e) {
            NSLog(@"[ADEUMMobilePlugin] changeAppKey exception: %@", e.reason);
        }
    }
    CDVPluginResult *res = [CDVPluginResult resultWithStatus:CDVCommandStatus_OK messageAsDictionary:[self currentNativeConfigDictionary]];
    [self.commandDelegate sendPluginResult:res callbackId:command.callbackId];
}

- (void)getNativeConfig:(CDVInvokedUrlCommand *)command {
    CDVPluginResult *res = [CDVPluginResult resultWithStatus:CDVCommandStatus_OK messageAsDictionary:[self currentNativeConfigDictionary]];
    [self.commandDelegate sendPluginResult:res callbackId:command.callbackId];
}

- (void)resetNativeConfig:(CDVInvokedUrlCommand *)command {
    NSUserDefaults *defaults = [NSUserDefaults standardUserDefaults];
    [defaults removeObjectForKey:@"appd_override_app_key"];
    [defaults removeObjectForKey:@"appd_override_collector_url"];
    [defaults removeObjectForKey:@"appd_override_screenshot_url"];
    [defaults synchronize];
    NSDictionary *adeumSettings = [[[NSBundle mainBundle] infoDictionary] objectForKey:@"ADEUM_Settings"];
    NSString *defKey = adeumSettings[@"ADEUM_APP_KEY"];
    if ([defKey isKindOfClass:[NSString class]] && [defKey length] > 0 && ![defKey isEqualToString:@"XXX-XXX-XXX"]) {
        @try {
            [ADEumInstrumentation changeAppKey:defKey];
        } @catch (NSException *e) {
            NSLog(@"[ADEUMMobilePlugin] reset changeAppKey exception: %@", e.reason);
        }
    }
    CDVPluginResult *res = [CDVPluginResult resultWithStatus:CDVCommandStatus_OK messageAsDictionary:[self currentNativeConfigDictionary]];
    [self.commandDelegate sendPluginResult:res callbackId:command.callbackId];
}
`;
            src = src.replace(/@end\s*$/, iosExtraMethods + '\n@end\n');
            fs.writeFileSync(iosPluginM, src, 'utf8');
            console.log('[Hook patch_appd] Updated iOS ADEUMMobilePlugin.m (' + PATCH_MARKER + ')');
        }
    }

    console.log('[Hook patch_appd] AppDynamics configuration verified successfully.');
};
