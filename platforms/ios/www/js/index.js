/**
 * Ala'a AppD EUM - Dual-Instrumentation Debugger & Session Replay Lab
 * 
 * Creator & Lead Engineer: Ala'a Mrayat
 * Description: Real-time dual-key bridging, beacon interception, and Session Replay
 *              for AppDynamics / Splunk Browser & Mobile RUM.
 */

(function () {
    'use strict';

    // State Management
    const state = {
        transactions: [],
        filter: 'all',
        bridgeToNative: true,
        activeTimerName: null,
        activeSessionFrame: null,
        beaconCount: 0,
        cordovaReady: false
    };

    function isAppDHeader(headerName) {
        if (!headerName) return false;
        const h = headerName.toLowerCase();
        return h.includes('adrum') || h.includes('singularity') || h.includes('appd') || h.includes('x-request-id') || h.includes('traceparent');
    }

    // --- 1. Connect Early <head> Interceptor to Inspector State ---

    function handleIncomingTx(txRecord, isUpdate) {
        if (!isUpdate) {
            recordTransaction(txRecord);
        } else {
            updateTransaction(txRecord.id, txRecord);
        }
    }
    const addOrUpdateTransaction = handleIncomingTx;

    function connectEarlyInterceptor() {
        // Expose native bridging hooks for the early <head> interceptor
        window.__EUM_BEGIN_NATIVE__ = beginNativeTracking;
        window.__EUM_FINISH_NATIVE__ = function (holder, status, errorMsg) {
            if (errorMsg || status === 0) {
                finishNativeTrackingWithError(holder, errorMsg || 'Network Request Failed');
            } else {
                finishNativeTracking(holder, status);
            }
            setTimeout(syncNativeBeaconLogs, 1500);
            setTimeout(syncNativeBeaconLogs, 6000);
        };

        // Drain any transactions captured before index.js initialized
        if (Array.isArray(window.__EUM_EARLY_TX__) && window.__EUM_EARLY_TX__.length > 0) {
            const drained = window.__EUM_EARLY_TX__.splice(0, window.__EUM_EARLY_TX__.length);
            drained.forEach(function (tx) {
                recordTransaction(tx);
            });
        }

        // Subscribe to future transaction creations and updates
        window.__EUM_ON_TX__ = handleIncomingTx;
    }

    // --- 2. Native Plugin Bridging Helpers ---

    function getNativePlugin() {
        if (window.plugins && window.plugins.ADEUMMobilePlugin &&
            typeof window.plugins.ADEUMMobilePlugin.beginHttpRequest === 'function') {
            return window.plugins.ADEUMMobilePlugin;
        }
        if (window.ADEUMMobilePlugin && typeof window.ADEUMMobilePlugin.beginHttpRequest === 'function') {
            return window.ADEUMMobilePlugin;
        }
        return null;
    }

    function beginNativeTracking(url) {
        const plugin = getNativePlugin();
        if (!plugin || typeof plugin.beginHttpRequest !== 'function') {
            logToConsole('Native ADEUMMobilePlugin not found; cannot bridge URL: ' + url, 'warn');
            return null;
        }

        const trackerHolder = { tracker: null, ready: false, pendingStatus: null, error: null };
        try {
            plugin.beginHttpRequest(url, function (tracker) {
                trackerHolder.tracker = tracker;
                trackerHolder.ready = true;
                logToConsole('Native beginHttpRequest active for: ' + url, 'info');

                if (trackerHolder.pendingStatus !== null) {
                    finishNativeTracking(trackerHolder, trackerHolder.pendingStatus);
                } else if (trackerHolder.error !== null) {
                    finishNativeTrackingWithError(trackerHolder, trackerHolder.error);
                }
            }, function (err) {
                logToConsole('Native beginHttpRequest error: ' + JSON.stringify(err), 'error');
            });
        } catch (e) {
            logToConsole('Native beginHttpRequest exception: ' + e.message, 'error');
        }

        return trackerHolder;
    }

    function finishNativeTracking(trackerHolder, statusCode) {
        if (!trackerHolder) return;
        if (!trackerHolder.ready) {
            trackerHolder.pendingStatus = statusCode;
            return;
        }

        const tracker = trackerHolder.tracker;
        if (!tracker) return;

        try {
            const isIOS = !!(window.cordova && window.cordova.platformId === 'ios');
            if (typeof tracker.withResponseCode === 'function') {
                if (isIOS) {
                    tracker.withResponseCode(statusCode, function () {
                        tracker.reportDone(function () {
                            logToConsole('Native tracker reportDone successful (Status ' + statusCode + ')', 'success');
                        }, function (err) {
                            logToConsole('Native reportDone failed: ' + JSON.stringify(err), 'error');
                        });
                    }, function (err) {
                        logToConsole('Native withResponseCode error: ' + JSON.stringify(err), 'error');
                    });
                } else {
                    // Android ADEUMMobilePlugin.java omits callbackContext.success() in withResponseCode & reportDone
                    tracker.withResponseCode(statusCode, undefined, function (err) {
                        logToConsole('Native withResponseCode error: ' + JSON.stringify(err), 'error');
                    });
                    tracker.reportDone(undefined, function (err) {
                        logToConsole('Native reportDone failed: ' + JSON.stringify(err), 'error');
                    });
                    logToConsole('Native tracker withResponseCode(' + statusCode + ') + reportDone() dispatched', 'success');
                }
            } else {
                tracker.reportDone();
            }
        } catch (e) {
            logToConsole('finishNativeTracking exception: ' + e.message, 'error');
        }
    }

    function finishNativeTrackingWithError(trackerHolder, errorMsg) {
        if (!trackerHolder) return;
        if (!trackerHolder.ready) {
            trackerHolder.error = errorMsg;
            return;
        }

        const tracker = trackerHolder.tracker;
        if (!tracker) return;

        try {
            const isIOS = !!(window.cordova && window.cordova.platformId === 'ios');
            if (typeof tracker.withErrorMessage === 'function') {
                if (isIOS) {
                    tracker.withErrorMessage(errorMsg || 'Network Request Failed', function () {
                        tracker.reportDone();
                    });
                } else {
                    tracker.withErrorMessage(errorMsg || 'Network Request Failed');
                    tracker.reportDone();
                }
            } else {
                tracker.reportDone();
            }
            logToConsole('Native tracker reported with error: ' + errorMsg, 'warn');
        } catch (e) {
            logToConsole('finishNativeTrackingWithError exception: ' + e.message, 'error');
        }
    }

    // --- 3. Transaction Recording & Inspector UI Management ---

    function recordTransaction(tx) {
        const existing = state.transactions.find(t => t.id === tx.id);
        if (!existing) {
            state.transactions.unshift(tx);
            if (state.transactions.length > 200) {
                state.transactions.pop();
            }
            if (tx.isBeacon) {
                state.beaconCount++;
                updateBeaconCounters();
            }
        }
        renderTransactions();
    }

    function updateTransaction(id, patch) {
        const found = state.transactions.find(t => t.id === id);
        if (found) {
            Object.assign(found, patch);
            if (patch.statusCode !== undefined || patch.status !== undefined) {
                const appdHeaders = [];
                for (const [k, v] of Object.entries(found.responseHeaders || {})) {
                    if (isAppDHeader(k)) {
                        appdHeaders.push(`${k}: ${v}`);
                    }
                }
                if (appdHeaders.length > 0) {
                    console.log(`[EUM-APPD-HEADERS] ⚡ Correlation: ${appdHeaders.join(' | ')}`);
                }
                if (found.responseBody && found.responseBody.length > 0 && !found.isBeacon) {
                    const preview = found.responseBody.length > 600 ? found.responseBody.substring(0, 600) + '... [truncated]' : found.responseBody;
                    console.log(`[EUM-HTTP-RESP-BODY] ${preview}`);
                }
            }
            renderTransactions();
        }
    }

    function updateBeaconCounters() {
        const chip = document.getElementById('beacon-counter-chip');
        const text = document.getElementById('beacon-summary-text');
        const activeColl = (window.__EUM_ACTIVE_CONFIG__ && window.__EUM_ACTIVE_CONFIG__.jsBeaconUrl) || 'configured collector';
        if (chip) {
            chip.textContent = state.beaconCount + (state.beaconCount === 1 ? ' Beacon' : ' Beacons');
        }
        if (text) {
            text.textContent = 'Active • Captured ' + state.beaconCount + ' beacon(s) to ' + activeColl;
        }
    }

    function renderTransactions() {
        const container = document.getElementById('transaction-list');
        const emptyState = document.getElementById('tx-empty');
        const counter = document.getElementById('tx-counter');

        if (!container) return;

        const filtered = state.transactions.filter(tx => {
            if (state.filter === 'api') return !tx.isBeacon && !tx.isReplay;
            if (state.filter === 'beacons') return tx.isBeacon && !tx.isReplay;
            if (state.filter === 'replay') return tx.isReplay || tx.method === 'REPLAY' || (tx.url && tx.url.includes('/blob-service/'));
            if (state.filter === 'bridged') return tx.bridged;
            if (state.filter === 'errors') return tx.statusCode >= 400 || tx.statusCode === 0 || String(tx.status).includes('Error');
            return true;
        });

        if (counter) {
            counter.textContent = `${filtered.length} of ${state.transactions.length} total`;
        }

        if (filtered.length === 0) {
            if (emptyState) emptyState.style.display = 'block';
            container.innerHTML = '';
            if (emptyState) container.appendChild(emptyState);
            return;
        }

        if (emptyState) emptyState.style.display = 'none';

        const html = filtered.map(tx => {
            let statusClass = 'status-2xx';
            if (tx.statusCode >= 300 && tx.statusCode < 400) statusClass = 'status-3xx';
            else if (tx.statusCode >= 400 && tx.statusCode < 500) statusClass = 'status-4xx';
            else if (tx.statusCode >= 500 || tx.statusCode === 0) statusClass = 'status-5xx';

            const appdReqHeaders = [];
            for (const [k, v] of Object.entries(tx.requestHeaders || {})) {
                if (isAppDHeader(k)) {
                    appdReqHeaders.push(`${k}: ${v}`);
                }
            }

            const appdRespHeaders = [];
            for (const [k, v] of Object.entries(tx.responseHeaders || {})) {
                if (isAppDHeader(k)) {
                    appdRespHeaders.push(`${k}: ${v}`);
                }
            }

            return `
            <div class="tx-item" id="${tx.id}">
                <div class="tx-header" onclick="window.toggleTxDetails('${tx.id}')">
                    <div class="tx-left">
                        <span class="method-tag method-${tx.method}">${tx.method}</span>
                        <span class="status-tag ${statusClass}">${tx.statusCode || tx.status}</span>
                        <span class="tx-url" title="${escapeHtml(tx.url)}">${escapeHtml(tx.url)}</span>
                    </div>
                    <div class="tx-meta">
                        ${tx.bridged ? '<span class="chip active" style="font-size:9px;">Bridged</span>' : ''}
                        ${tx.isBeacon ? '<span class="chip" style="font-size:9px; background:rgba(168,85,247,0.2); color:#c084fc;">Beacon</span>' : ''}
                        <span>${tx.duration}ms</span>
                        <span>${tx.timestamp}</span>
                    </div>
                </div>
                <div class="tx-details">
                    <div class="detail-section">
                        <div class="detail-heading">
                            <span>Full URL</span>
                            <span class="chip" style="font-size:9px;">${tx.isBeacon ? (tx.isNativeBeacon ? 'Cordova Native Mobile Beacon' : (tx.bridged ? 'Native WKWebView Beacon' : 'Browser JS Beacon')) : (tx.bridged ? 'Browser + Native Dual Reported' : 'Browser Only')}</span>
                        </div>
                        <div style="font-family: var(--code-font); font-size: 11px; word-break: break-all; color: var(--accent-blue);">${escapeHtml(tx.url)}</div>
                    </div>

                    ${(appdReqHeaders.length > 0 || appdRespHeaders.length > 0) ? `
                    <div class="detail-section">
                        <div class="detail-heading">
                            <span style="color: var(--accent-amber);">⚡ AppDynamics Correlation Headers Detected</span>
                        </div>
                        <div style="font-family: var(--code-font); font-size: 11px; background: rgba(245, 158, 11, 0.1); padding: 6px 8px; border-radius: 6px; border: 1px solid rgba(245, 158, 11, 0.25);">
                            ${appdReqHeaders.map(h => `<div class="appd-highlight">Request: ${escapeHtml(h)}</div>`).join('')}
                            ${appdRespHeaders.map(h => `<div class="appd-highlight">Response: ${escapeHtml(h)}</div>`).join('')}
                        </div>
                    </div>
                    ` : ''}

                    <div class="detail-section">
                        <div class="detail-heading">Request Headers (${Object.keys(tx.requestHeaders || {}).length})</div>
                        <pre class="code-block">${escapeHtml(JSON.stringify(tx.requestHeaders, null, 2))}</pre>
                    </div>

                    ${tx.requestBody ? `
                    <div class="detail-section">
                        <div class="detail-heading">Request / Beacon Payload</div>
                        <pre class="code-block">${escapeHtml(tx.requestBody)}</pre>
                    </div>
                    ` : ''}

                    <div class="detail-section">
                        <div class="detail-heading">Response Headers (${Object.keys(tx.responseHeaders || {}).length})</div>
                        <pre class="code-block">${escapeHtml(JSON.stringify(tx.responseHeaders, null, 2))}</pre>
                    </div>

                    <div class="detail-section">
                        <div class="detail-heading">
                            <span>Response Payload</span>
                            <span style="font-size: 10px; color: var(--text-muted);">${tx.responseBody ? tx.responseBody.length + ' chars' : 'Empty'}</span>
                        </div>
                        <pre class="code-block">${escapeHtml(tx.responseBody || '[Empty or pending response]')}</pre>
                    </div>
                </div>
            </div>
            `;
        }).join('');

        container.innerHTML = html;
    }

    window.toggleTxDetails = function (txId) {
        const el = document.getElementById(txId);
        if (el) {
            el.classList.toggle('expanded');
        }
    };

    function escapeHtml(str) {
        if (!str) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    // --- 4. Console Logger for Bridge Actions ---

    function logToConsole(message, type = 'info') {
        const consoleBox = document.getElementById('bridge-console');
        if (!consoleBox) {
            console.log('[' + type.toUpperCase() + '] ' + message);
            return;
        }

        const entry = document.createElement('div');
        entry.className = 'console-entry ' + type;
        const time = new Date().toLocaleTimeString();
        entry.innerHTML = `<span class="time">[${time}]</span> ${escapeHtml(message)}`;
        consoleBox.appendChild(entry);
        consoleBox.scrollTop = consoleBox.scrollHeight;
    }

    // --- 5. Status Checkers ---

    function checkAgentStatus() {
        const adrumStatusEl = document.getElementById('status-adrum');
        const nativeStatusEl = document.getElementById('status-native');
        const wkHandlerEl = document.getElementById('status-wkhandler');
        const chipAdrum = document.getElementById('chip-adrum');
        const chipNative = document.getElementById('chip-native');
        const chipReplay = document.getElementById('chip-replay');
        const envAdrumKey = document.getElementById('env-adrum-key');
        const envAdrumRuntime = document.getElementById('env-adrum-runtime');
        const replayStatusEl = document.getElementById('status-replay');
        const replayDescEl = document.getElementById('desc-replay');
        const envReplayState = document.getElementById('env-replay-state');
        const envReplayEndpoint = document.getElementById('env-replay-endpoint');
        const replayLiveBadge = document.getElementById('replay-live-badge');

        const activeCfg = window.__EUM_ACTIVE_CONFIG__ || {};
        const adrumReplayCfg = window['adrum-config'] && window['adrum-config'].sessionReplay;
        const isReplayConfigured = !!(adrumReplayCfg && adrumReplayCfg.enabled);
        const replayUrl = (adrumReplayCfg && adrumReplayCfg.sessionReplayUrlHttps) || activeCfg.sessionReplayUrlHttps || activeCfg.jsBeaconUrl || 'https://example-session-replay-blobs.com';
        const jsAppKey = (window.ADRUM && window.ADRUM.conf && window.ADRUM.conf.appKey) || (window['adrum-config'] && window['adrum-config'].appKey) || activeCfg.jsAppKey || 'XXX-XXX-XXX';

        const hasAdrum = typeof window.ADRUM !== 'undefined' && window.ADRUM !== null;
        if (hasAdrum) {
            const ver = (window.ADRUM.conf && window.ADRUM.conf.agentVer) || 'loaded';
            const appKey = (window.ADRUM.conf && window.ADRUM.conf.appKey) || (window['adrum-config'] && window['adrum-config'].appKey) || 'NOT_SET';
            const beaconUrl = (window.ADRUM.conf && window.ADRUM.conf.beaconUrlHttps) || (window['adrum-config'] && window['adrum-config'].beaconUrlHttps) || 'NOT_SET';

            if (adrumStatusEl) {
                adrumStatusEl.innerHTML = `<span class="dot green"></span> Active (v${ver} • ${appKey})`;
            }
            if (chipAdrum) {
                chipAdrum.className = 'chip active';
                chipAdrum.textContent = 'ADRUM ✓';
            }
            if (envAdrumKey) envAdrumKey.textContent = appKey;
            if (envAdrumRuntime) envAdrumRuntime.textContent = `v${ver} → ${beaconUrl}`;
        } else {
            if (adrumStatusEl) {
                adrumStatusEl.innerHTML = '<span class="dot red"></span> Not Detected';
            }
            if (chipAdrum) {
                chipAdrum.className = 'chip inactive';
                chipAdrum.textContent = 'ADRUM ✗';
            }
            if (envAdrumRuntime) envAdrumRuntime.textContent = 'ADRUM not loaded in memory';
        }

        // Check Session Replay Status
        if (isReplayConfigured) {
            if (replayStatusEl) {
                replayStatusEl.innerHTML = '<span class="dot purple"></span> Active (DOM Recording & Blobs)';
            }
            if (chipReplay) {
                chipReplay.className = 'chip active';
                chipReplay.style.background = 'rgba(168, 85, 247, 0.25)';
                chipReplay.style.color = '#e9d5ff';
                chipReplay.style.borderColor = '#c084fc';
                chipReplay.textContent = 'Replay ✓';
            }
            if (replayDescEl) {
                replayDescEl.textContent = 'Splunk/AppD 25.10+ (rrweb recorder active)';
            }
            if (envReplayState) {
                envReplayState.textContent = 'Active (Uploading to Blobs)';
                envReplayState.style.color = 'var(--accent-purple)';
            }
            if (envReplayEndpoint) {
                envReplayEndpoint.textContent = `${replayUrl}/blob-service/v1/appkeys/${jsAppKey}/browser/blobs`;
            }
            if (replayLiveBadge) {
                replayLiveBadge.className = 'chip active';
                replayLiveBadge.textContent = 'Recording';
            }
        } else {
            if (replayStatusEl) {
                replayStatusEl.innerHTML = '<span class="dot gray"></span> Disabled (Toggle in Config)';
            }
            if (chipReplay) {
                chipReplay.className = 'chip inactive';
                chipReplay.style.background = '';
                chipReplay.style.color = '';
                chipReplay.style.borderColor = '';
                chipReplay.textContent = 'Replay ✗';
            }
            if (replayDescEl) {
                replayDescEl.textContent = 'Session Replay disabled by runtime config';
            }
            if (envReplayState) {
                envReplayState.textContent = 'Disabled';
                envReplayState.style.color = 'var(--text-muted)';
            }
            if (replayLiveBadge) {
                replayLiveBadge.className = 'chip inactive';
                replayLiveBadge.textContent = 'Disabled';
            }
        }

        const nativePlugin = getNativePlugin();
        const hasNative = nativePlugin !== null && typeof nativePlugin === 'object';
        if (hasNative) {
            if (nativeStatusEl) {
                nativeStatusEl.innerHTML = '<span class="dot green"></span> Loaded (Native Ready)';
            }
            if (chipNative) {
                chipNative.className = 'chip active';
                chipNative.textContent = 'Native ✓';
            }
        } else {
            if (nativeStatusEl) {
                if (state.cordovaReady) {
                    nativeStatusEl.innerHTML = '<span class="dot red"></span> Plugin Not Found';
                } else {
                    nativeStatusEl.innerHTML = '<span class="dot amber"></span> Waiting deviceready...';
                }
            }
            if (chipNative) {
                chipNative.className = 'chip inactive';
                chipNative.textContent = 'Native ✗';
            }
        }

        if (wkHandlerEl) {
            const hasWkHandler = !!(window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.ADEUM_js_handler);
            if (hasWkHandler) {
                wkHandlerEl.innerHTML = '<span class="dot green"></span> Active (Native WKWebView Bridge)';
            } else {
                wkHandlerEl.innerHTML = '<span class="dot amber"></span> Not Present (WebView Direct HTTP)';
            }
        }

        const envPlatform = document.getElementById('env-platform');
        const envCordova = document.getElementById('env-cordova');
        const envUa = document.getElementById('env-ua');
        const envNativeKey = document.getElementById('env-native-key');
        const envNativeCollector = document.getElementById('env-native-collector');

        if (envNativeKey && activeCfg.nativeAppKey) {
            envNativeKey.textContent = activeCfg.nativeAppKey;
        }
        if (envNativeCollector && activeCfg.nativeCollectorUrl) {
            envNativeCollector.textContent = activeCfg.nativeCollectorUrl;
        }
        if (envPlatform) {
            const platform = (window.cordova && window.cordova.platformId) ? window.cordova.platformId.toUpperCase() : 'BROWSER / WEBVIEW';
            envPlatform.textContent = platform;
        }
        if (envCordova) {
            envCordova.textContent = state.cordovaReady ? 'YES (Device Ready)' : 'Initializing...';
        }
        if (envUa) {
            envUa.textContent = navigator.userAgent;
        }
    }

    function populateConfigInputs(force) {
        const active = window.__EUM_ACTIVE_CONFIG__ || {};
        const setVal = (id, val) => {
            const el = document.getElementById(id);
            if (el && (force || !el.dataset.dirty)) {
                el.value = val || '';
            }
        };
        setVal('cfg-js-key', active.jsAppKey || 'XXX-XXX-XXX');
        setVal('cfg-js-beacon-url', active.jsBeaconUrl || 'https://example-browser-beacon.com');
        setVal('cfg-js-cdn-url', active.jsCdnUrl || 'https://example-cdn.com/adrum/adrum-latest.js');
        setVal('cfg-native-key', active.nativeAppKey || 'XXX-XXX-XXX');
        setVal('cfg-native-collector-url', active.nativeCollectorUrl || 'https://example-mobile-collector.com');

        const setChecked = (id, checked) => {
            const el = document.getElementById(id);
            if (el && (force || !el.dataset.dirty)) {
                el.checked = !!checked;
            }
        };
        setChecked('cfg-replay-toggle', active.sessionReplayEnabled !== false);
        setVal('cfg-replay-url', active.sessionReplayUrlHttps || active.jsBeaconUrl || 'https://example-session-replay-blobs.com');
        setChecked('cfg-replay-mask-inputs', active.sessionReplayMaskAllInputs !== false);
        setChecked('cfg-replay-mask-text', !!active.sessionReplayMaskAllText);
        setChecked('cfg-replay-pack-assets', active.sessionReplayPackAssets !== false);
    }

    // --- 6. Manual Beacon Flush Helper ---

    function flushAllBeacons() {
        let actions = [];
        // 1. Flush Browser JS Agent (ADRUM)
        try {
            if (window.ADRUM && window.ADRUM.channel && typeof window.ADRUM.channel.sendBeacon === 'function') {
                window.ADRUM.channel.sendBeacon(false);
                actions.push('ADRUM.channel.sendBeacon(false)');
                console.log('[EUM-FLUSH] ⚡ Forced ADRUM.channel.sendBeacon(false)');
            } else if (window.ADRUM && typeof window.ADRUM.command === 'function') {
                window.ADRUM.command('sendBeacon');
                actions.push('ADRUM.command("sendBeacon")');
            }
        } catch (e) {
            logToConsole('ADRUM flush error: ' + e.message, 'warn');
        }

        // 2. Flush Native Mobile Agent (ADEUMMobilePlugin)
        try {
            const plugin = getNativePlugin();
            if (plugin && typeof plugin.flush === 'function') {
                plugin.flush(function () {
                    logToConsole('ADEUMMobilePlugin.flush() succeeded (Native beacons dispatched to collector)', 'success');
                    setTimeout(syncNativeBeaconLogs, 1000);
                    setTimeout(syncNativeBeaconLogs, 5800);
                }, function (err) {
                    logToConsole('ADEUMMobilePlugin.flush() error: ' + JSON.stringify(err), 'error');
                });
                actions.push('ADEUMMobilePlugin.flush()');
                console.log('[EUM-FLUSH] ⚡ Forced ADEUMMobilePlugin.flush()');
                setTimeout(syncNativeBeaconLogs, 1200);
                setTimeout(syncNativeBeaconLogs, 6000);
            }
        } catch (e) {
            logToConsole('Native flush error: ' + e.message, 'warn');
        }

        if (actions.length === 0) {
            logToConsole('No flushable EUM agents detected yet', 'warn');
        } else {
            logToConsole('Triggered flush: ' + actions.join(' + '), 'info');
        }
    }

    function syncNativeBeaconLogs() {
        if (!window.cordova || typeof window.cordova.exec !== 'function') return;
        window.cordova.exec(
            function (items) {
                if (!Array.isArray(items) || items.length === 0) return;
                let added = 0;
                for (let i = items.length - 1; i >= 0; i--) {
                    const item = items[i];
                    if (item && item.id && !state.transactions.some(t => t.id === item.id)) {
                        recordTransaction(item);
                        added++;
                    }
                }
                if (added > 0) {
                    logToConsole('Captured ' + added + ' Native Cordova beacon upload(s) -> ' + (activeCfg.nativeAppKey || 'Native Key'), 'success');
                }
            },
            function () {},
            'ADEUMMobilePlugin',
            'getNativeBeaconLogs',
            []
        );
    }

    function bridgeScreenNavigation(hash) {
        if (!state.bridgeToNative || !state.cordovaReady) return;
        const plugin = getNativePlugin();
        if (!plugin) return;

        const screenName = (hash || '#home').replace('#', '') || 'home';
        const frameLabel = 'Screen: #' + screenName;

        try {
            if (state.activeSessionFrame && typeof state.activeSessionFrame.end === 'function') {
                state.activeSessionFrame.end();
                state.activeSessionFrame = null;
            }
            if (typeof plugin.startSessionFrame === 'function') {
                plugin.startSessionFrame(frameLabel, function (sf) {
                    state.activeSessionFrame = sf;
                }, function () {});
            }
            if (typeof plugin.leaveBreadcrumb === 'function') {
                plugin.leaveBreadcrumb(frameLabel, 1, function () {}, function () {});
            }
        } catch (e) {}
    }

    // --- 7. Navigation Router ---

    function handleHashChange() {
        const hash = window.location.hash || '#home';
        const targetScreenId = 'screen-' + hash.replace('#', '');

        document.querySelectorAll('.nav-item').forEach(link => {
            const screen = link.getAttribute('data-screen');
            if ('screen-' + screen === targetScreenId) {
                link.classList.add('active');
            } else {
                link.classList.remove('active');
            }
        });

        document.querySelectorAll('.screen').forEach(sec => {
            if (sec.id === targetScreenId) {
                sec.classList.add('active');
            } else {
                sec.classList.remove('active');
            }
        });

        bridgeScreenNavigation(hash);

        if (targetScreenId === 'screen-home') {
            checkAgentStatus();
        } else if (targetScreenId === 'screen-inspector') {
            syncNativeBeaconLogs();
            renderTransactions();
        }
    }

    // --- 8. Setup Event Handlers ---

    function setupEventListeners() {
        window.addEventListener('hashchange', handleHashChange);

        const toggle = document.getElementById('toggle-native-bridge');
        const badge = document.getElementById('bridge-status-badge');
        if (toggle) {
            toggle.addEventListener('change', (e) => {
                state.bridgeToNative = e.target.checked;
                window.__EUM_BRIDGE_ENABLED__ = state.bridgeToNative;
                if (badge) {
                    if (state.bridgeToNative) {
                        badge.className = 'chip active';
                        badge.textContent = 'ON (Dual-Key Bridging)';
                    } else {
                        badge.className = 'chip';
                        badge.textContent = 'OFF (Browser Only)';
                    }
                }
                logToConsole('Native Bridge toggle changed: ' + (state.bridgeToNative ? 'ENABLED (Dual App Key)' : 'DISABLED (Browser Only)'), 'info');
            });
        }

        const relayToggle = document.getElementById('toggle-beacon-relay');
        const relayBadge = document.getElementById('beacon-relay-badge');
        if (relayToggle) {
            relayToggle.addEventListener('change', (e) => {
                window.__EUM_RELAY_BEACONS__ = e.target.checked;
                if (relayBadge) {
                    if (e.target.checked) {
                        relayBadge.className = 'chip active';
                        relayBadge.textContent = 'ON (Native HTTP)';
                    } else {
                        relayBadge.className = 'chip';
                        relayBadge.textContent = 'OFF (Raw WebView CORS)';
                    }
                }
                logToConsole('Browser Beacon CORS Relay: ' + (e.target.checked ? 'ENABLED' : 'DISABLED'), 'info');
            });
        }

        const refreshBtn = document.getElementById('btn-refresh-status');
        if (refreshBtn) {
            refreshBtn.addEventListener('click', () => {
                checkAgentStatus();
                logToConsole('Agent instrumentation status refreshed', 'info');
            });
        }

        const btnUsers = document.getElementById('btn-api-users');
        if (btnUsers) {
            btnUsers.addEventListener('click', async () => {
                showFeedback('Dispatching fetch() to jsonplaceholder...', 'info');
                try {
                    const res = await fetch('https://jsonplaceholder.typicode.com/users/1');
                    const data = await res.json();
                    showFeedback(JSON.stringify(data, null, 2), 'success', res.status + ' OK');
                } catch (err) {
                    showFeedback('Fetch failed: ' + err.message, 'error', 'Error');
                }
            });
        }

        const btnPost = document.getElementById('btn-api-post');
        if (btnPost) {
            btnPost.addEventListener('click', () => {
                showFeedback('Dispatching XMLHttpRequest to httpbin.org/post...', 'info');
                const xhr = new XMLHttpRequest();
                xhr.open('POST', 'https://httpbin.org/post');
                xhr.setRequestHeader('Content-Type', 'application/json');
                xhr.setRequestHeader('X-AppD-Test-Transaction', 'Dual-Key-Debug-' + Date.now());

                xhr.onreadystatechange = function () {
                    if (xhr.readyState === 4) {
                        if (xhr.status >= 200 && xhr.status < 300) {
                            showFeedback(xhr.responseText, 'success', xhr.status + ' OK');
                        } else {
                            showFeedback('XHR Error: HTTP ' + xhr.status + '\n' + xhr.responseText, 'error', xhr.status || 'Error');
                        }
                    }
                };

                const active = window.__EUM_ACTIVE_CONFIG__ || {};
                const samplePayload = {
                    appName: "Ala'a AppD EUM",
                    accountNumber: 'SA0000000000000000000000',
                    transferAmount: 2500.50,
                    currency: 'SAR',
                    testScenario: 'Dual AppDynamics EUM Instrumentation',
                    browserAppKey: active.jsAppKey || 'XXX-XXX-XXX',
                    nativeAppKey: active.nativeAppKey || 'XXX-XXX-XXX',
                    bridgeEnabled: state.bridgeToNative,
                    timestamp: new Date().toISOString()
                };

                xhr.send(JSON.stringify(samplePayload));
            });
        }

        const btnError = document.getElementById('btn-api-error');
        if (btnError) {
            btnError.addEventListener('click', async () => {
                showFeedback('Dispatching request to httpbin.org/status/500 to simulate error...', 'warn');
                try {
                    const res = await fetch('https://httpbin.org/status/500');
                    const text = await res.text();
                    showFeedback('Server responded with expected 500 error:\n' + (text || '[HTTP 500 Internal Server Error]'), 'error', '500 Server Error');
                } catch (err) {
                    showFeedback('Request failed: ' + err.message, 'error', 'Network Error');
                }
            });
        }

        const btnCustom = document.getElementById('btn-custom-send');
        if (btnCustom) {
            btnCustom.addEventListener('click', async () => {
                const method = document.getElementById('custom-method').value || 'GET';
                const url = document.getElementById('custom-url').value.trim();
                if (!url) {
                    alert('Please enter a valid URL');
                    return;
                }

                showFeedback(`Sending ${method} ${url}...`, 'info');
                try {
                    const opts = { method: method };
                    if (method === 'POST' || method === 'PUT') {
                        opts.headers = { 'Content-Type': 'application/json' };
                        opts.body = JSON.stringify({ customTest: true, date: new Date().toISOString() });
                    }
                    const res = await fetch(url, opts);
                    const text = await res.text();
                    showFeedback(text, res.ok ? 'success' : 'error', res.status + ' ' + res.statusText);
                } catch (err) {
                    showFeedback('Request error: ' + err.message, 'error', 'Error');
                }
            });
        }

        const btnNativeHttp = document.getElementById('btn-native-http-send');
        if (btnNativeHttp) {
            btnNativeHttp.addEventListener('click', () => {
                const method = (document.getElementById('native-http-method') && document.getElementById('native-http-method').value) || 'GET';
                const url = ((document.getElementById('native-http-url') && document.getElementById('native-http-url').value) || '').trim();
                const body = (document.getElementById('native-http-body') && document.getElementById('native-http-body').value) || '';
                if (!url) {
                    alert('Please enter a valid URL for native request');
                    return;
                }
                if (!(window.cordova && typeof window.cordova.exec === 'function')) {
                    showFeedback('Native HTTP request requires Android or iOS Cordova device/emulator.', 'error', 'No Cordova');
                    logToConsole('nativeHttpRequest unavailable outside Cordova container', 'warn');
                    return;
                }

                showFeedback(`Dispatching native OS ${method} ${url}...`, 'info', 'Running...');
                const txId = 'native_http_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6);
                addOrUpdateTransaction({
                    id: txId,
                    timestamp: new Date().toLocaleTimeString(),
                    method: 'NATIVE ' + method,
                    url: url,
                    isBeacon: false,
                    bridged: true,
                    requestHeaders: { 'Engine': 'Native HttpURLConnection / NSURLSession (Auto-Instrumented)' },
                    requestBody: body || null,
                    status: 'Pending...',
                    statusCode: 0,
                    duration: 0,
                    responseHeaders: {},
                    responseBody: ''
                }, false);

                window.cordova.exec(
                    (res) => {
                        const statusCode = (res && res.statusCode) || 200;
                        const durationMs = (res && res.durationMs) || 0;
                        const respBody = (res && res.body) || '';
                        addOrUpdateTransaction({
                            id: txId,
                            status: `${statusCode} Native OS`,
                            statusCode: statusCode,
                            duration: durationMs,
                            responseHeaders: (res && res.headers) || {},
                            responseBody: respBody
                        }, true);
                        showFeedback(respBody || `[HTTP ${statusCode} in ${durationMs}ms]`, statusCode >= 400 ? 'error' : 'success', `Native ${statusCode} (${durationMs}ms)`);
                        logToConsole(`Native HTTP ${method} ${url} -> HTTP ${statusCode} (${durationMs}ms)`, statusCode >= 400 ? 'error' : 'success');
                        setTimeout(syncNativeBeaconLogs, 6000);
                    },
                    (err) => {
                        const errStr = typeof err === 'string' ? err : JSON.stringify(err);
                        addOrUpdateTransaction({
                            id: txId,
                            status: 'Native Error: ' + errStr,
                            statusCode: 0,
                            responseBody: errStr
                        }, true);
                        showFeedback('Native HTTP failed: ' + errStr, 'error', 'Native Error');
                        logToConsole('Native HTTP failed: ' + errStr, 'error');
                    },
                    'ADEUMMobilePlugin',
                    'nativeHttpRequest',
                    [url, method, body]
                );
            });
        }

        ['cfg-js-key', 'cfg-js-beacon-url', 'cfg-js-cdn-url', 'cfg-native-key', 'cfg-native-collector-url', 'cfg-replay-url'].forEach(id => {
            const el = document.getElementById(id);
            if (el) {
                el.addEventListener('input', () => { el.dataset.dirty = '1'; });
            }
        });
        ['cfg-replay-toggle', 'cfg-replay-mask-inputs', 'cfg-replay-mask-text', 'cfg-replay-pack-assets'].forEach(id => {
            const el = document.getElementById(id);
            if (el) {
                el.addEventListener('change', () => { el.dataset.dirty = '1'; });
            }
        });

        const btnSaveCfg = document.getElementById('btn-save-eum-config');
        if (btnSaveCfg) {
            btnSaveCfg.addEventListener('click', () => {
                const readVal = (id) => ((document.getElementById(id) && document.getElementById(id).value) || '').trim();
                const readChecked = (id, fallback) => {
                    const el = document.getElementById(id);
                    return el ? el.checked : fallback;
                };
                const prev = window.__EUM_ACTIVE_CONFIG__ || {};
                const defaults = window.__EUM_DEFAULT_CONFIG__ || {};
                const next = {
                    jsAppKey: readVal('cfg-js-key') || defaults.jsAppKey || 'XXX-XXX-XXX',
                    jsBeaconUrl: (readVal('cfg-js-beacon-url') || defaults.jsBeaconUrl || 'https://example-browser-beacon.com').replace(/\/+$/, ''),
                    jsCdnUrl: readVal('cfg-js-cdn-url') || defaults.jsCdnUrl || 'https://example-cdn.com/adrum/adrum-latest.js',
                    nativeAppKey: readVal('cfg-native-key') || defaults.nativeAppKey || 'XXX-XXX-XXX',
                    nativeCollectorUrl: (readVal('cfg-native-collector-url') || defaults.nativeCollectorUrl || 'https://example-mobile-collector.com').replace(/\/+$/, ''),
                    sessionReplayEnabled: readChecked('cfg-replay-toggle', defaults.sessionReplayEnabled !== false),
                    sessionReplayUrlHttps: (readVal('cfg-replay-url') || defaults.sessionReplayUrlHttps || 'https://example-session-replay-blobs.com').replace(/\/+$/, ''),
                    sessionReplayMaskAllInputs: readChecked('cfg-replay-mask-inputs', defaults.sessionReplayMaskAllInputs !== false),
                    sessionReplayMaskAllText: readChecked('cfg-replay-mask-text', !!defaults.sessionReplayMaskAllText),
                    sessionReplayPackAssets: readChecked('cfg-replay-pack-assets', defaults.sessionReplayPackAssets !== false)
                };

                try {
                    localStorage.setItem('eum_debugger_overrides', JSON.stringify(next));
                } catch (e) {}

                // Clear dirty flags from inputs so fresh values take hold cleanly
                ['cfg-js-key', 'cfg-js-beacon-url', 'cfg-js-cdn-url', 'cfg-native-key', 'cfg-native-collector-url', 'cfg-replay-url',
                 'cfg-replay-toggle', 'cfg-replay-mask-inputs', 'cfg-replay-mask-text', 'cfg-replay-pack-assets'].forEach(id => {
                    const el = document.getElementById(id);
                    if (el) delete el.dataset.dirty;
                });

                const jsChanged = next.jsAppKey !== prev.jsAppKey || next.jsBeaconUrl !== prev.jsBeaconUrl || next.jsCdnUrl !== prev.jsCdnUrl;
                const replayChanged = next.sessionReplayEnabled !== prev.sessionReplayEnabled ||
                                      next.sessionReplayUrlHttps !== prev.sessionReplayUrlHttps ||
                                      next.sessionReplayMaskAllInputs !== prev.sessionReplayMaskAllInputs ||
                                      next.sessionReplayMaskAllText !== prev.sessionReplayMaskAllText ||
                                      next.sessionReplayPackAssets !== prev.sessionReplayPackAssets;
                const collectorChanged = next.nativeCollectorUrl !== prev.nativeCollectorUrl;
                window.__EUM_ACTIVE_CONFIG__ = Object.assign({}, prev, next);
                populateConfigInputs(true);
                checkAgentStatus();

                const statusEl = document.getElementById('cfg-save-status');
                const finalizeUi = (extraMsg) => {
                    const msgs = ['Configuration saved successfully!'];
                    if (next.nativeAppKey !== prev.nativeAppKey) msgs.push('Native App Key updated.');
                    if (replayChanged) msgs.push('Session Replay settings updated.');
                    if (collectorChanged) msgs.push('Native Collector updated.');
                    if (extraMsg) msgs.push(extraMsg);
                    msgs.push('Reloading application...');
                    if (statusEl) {
                        statusEl.style.color = 'var(--accent-green)';
                        statusEl.textContent = msgs.join(' ');
                    }
                    logToConsole(msgs.join(' '), 'success');
                    setTimeout(() => window.location.reload(), 450);
                };

                if (window.cordova && typeof window.cordova.exec === 'function') {
                    window.cordova.exec(
                        () => finalizeUi('Native configuration synced.'),
                        (err) => {
                            const errStr = typeof err === 'string' ? err : JSON.stringify(err);
                            logToConsole('setNativeConfig notice: ' + errStr, 'warn');
                            finalizeUi('Native notice: ' + errStr);
                        },
                        'ADEUMMobilePlugin',
                        'setNativeConfig',
                        [{
                            appKey: next.nativeAppKey,
                            collectorUrl: next.nativeCollectorUrl
                        }]
                    );
                } else {
                    finalizeUi();
                }
            });
        }

        const btnResetCfg = document.getElementById('btn-reset-eum-config');
        if (btnResetCfg) {
            btnResetCfg.addEventListener('click', () => {
                try { localStorage.removeItem('eum_debugger_overrides'); } catch (e) {}
                ['cfg-js-key', 'cfg-js-beacon-url', 'cfg-js-cdn-url', 'cfg-native-key', 'cfg-native-collector-url', 'cfg-replay-url',
                 'cfg-replay-toggle', 'cfg-replay-mask-inputs', 'cfg-replay-mask-text', 'cfg-replay-pack-assets'].forEach(id => {
                    const el = document.getElementById(id);
                    if (el) delete el.dataset.dirty;
                });
                const defaults = window.__EUM_DEFAULT_CONFIG__ || {
                    jsAppKey: 'XXX-XXX-XXX',
                    jsBeaconUrl: 'https://example-browser-beacon.com',
                    jsCdnUrl: 'https://example-cdn.com/adrum/adrum-latest.js',
                    nativeAppKey: 'XXX-XXX-XXX',
                    nativeCollectorUrl: 'https://example-mobile-collector.com',
                    sessionReplayEnabled: true,
                    sessionReplayUrlHttps: 'https://example-session-replay-blobs.com',
                    sessionReplayMaskAllInputs: true,
                    sessionReplayMaskAllText: false,
                    sessionReplayPackAssets: true
                };
                window.__EUM_ACTIVE_CONFIG__ = Object.assign({}, defaults);
                populateConfigInputs(true);
                checkAgentStatus();

                const statusEl = document.getElementById('cfg-save-status');
                const done = () => {
                    if (statusEl) {
                        statusEl.style.color = 'var(--accent-green)';
                        statusEl.textContent = 'Defaults restored. Reloading WebView...';
                    }
                    setTimeout(() => window.location.reload(), 450);
                };

                if (window.cordova && typeof window.cordova.exec === 'function') {
                    window.cordova.exec(done, done, 'ADEUMMobilePlugin', 'resetNativeConfig', []);
                } else {
                    done();
                }
            });
        }

        document.querySelectorAll('.filter-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
                e.target.classList.add('active');
                state.filter = e.target.getAttribute('data-filter');
                renderTransactions();
            });
        });

        const btnFlushBeacons = document.getElementById('btn-flush-beacons');
        if (btnFlushBeacons) {
            btnFlushBeacons.addEventListener('click', flushAllBeacons);
        }

        const btnFlushBridge = document.getElementById('btn-flush-all-bridge');
        if (btnFlushBridge) {
            btnFlushBridge.addEventListener('click', flushAllBeacons);
        }

        const btnClear = document.getElementById('btn-clear-log');
        if (btnClear) {
            btnClear.addEventListener('click', () => {
                state.transactions = [];
                state.beaconCount = 0;
                updateBeaconCounters();
                renderTransactions();
                logToConsole('Inspector transactions cleared', 'info');
            });
        }

        const btnExport = document.getElementById('btn-export-log');
        if (btnExport) {
            btnExport.addEventListener('click', () => {
                const jsonStr = JSON.stringify(state.transactions, null, 2);
                const blob = new Blob([jsonStr], { type: 'application/json' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = 'appd-eum-transactions-' + Date.now() + '.json';
                a.click();
                URL.revokeObjectURL(url);
                logToConsole('Exported ' + state.transactions.length + ' transactions as JSON', 'success');
            });
        }

        const btnVPage = document.getElementById('btn-trigger-vpage');
        if (btnVPage) {
            btnVPage.addEventListener('click', () => {
                if (typeof window.ADRUM !== 'undefined' && typeof window.ADRUM.markVirtualPageBegin === 'function') {
                    const pageName = 'EUM_Debugger_Virtual_Page_' + Math.floor(Math.random() * 1000);
                    try {
                        window.ADRUM.markVirtualPageBegin(pageName);
                        logToConsole('ADRUM.markVirtualPageBegin: "' + pageName + '"', 'info');
                        setTimeout(() => {
                            window.ADRUM.markVirtualPageEnd(pageName);
                            logToConsole('ADRUM.markVirtualPageEnd: "' + pageName + '" completed', 'success');
                        }, 500);
                    } catch (e) {
                        logToConsole('ADRUM virtual page error: ' + e.message, 'error');
                    }
                } else {
                    logToConsole('ADRUM or markVirtualPageBegin not available in memory', 'warn');
                }
            });
        }

        const btnStartTimer = document.getElementById('btn-start-timer');
        if (btnStartTimer) {
            btnStartTimer.addEventListener('click', () => {
                const plugin = getNativePlugin();
                const timerName = 'Checkout_Flow_Timer';
                if (plugin && typeof plugin.startTimerWithName === 'function') {
                    plugin.startTimerWithName(timerName, () => {
                        state.activeTimerName = timerName;
                        logToConsole('ADEUMMobilePlugin.startTimerWithName: "' + timerName + '" started', 'success');
                    }, (err) => {
                        logToConsole('startTimerWithName error: ' + JSON.stringify(err), 'error');
                    });
                } else {
                    logToConsole('ADEUMMobilePlugin.startTimerWithName unavailable (run on device/emulator)', 'warn');
                }
            });
        }

        const btnStopTimer = document.getElementById('btn-stop-timer');
        if (btnStopTimer) {
            btnStopTimer.addEventListener('click', () => {
                const plugin = getNativePlugin();
                const timerName = state.activeTimerName || 'Checkout_Flow_Timer';
                if (plugin && typeof plugin.stopTimerWithName === 'function') {
                    plugin.stopTimerWithName(timerName, () => {
                        logToConsole('ADEUMMobilePlugin.stopTimerWithName: "' + timerName + '" stopped and recorded', 'success');
                        state.activeTimerName = null;
                    }, (err) => {
                        logToConsole('stopTimerWithName error: ' + JSON.stringify(err), 'error');
                    });
                } else {
                    logToConsole('ADEUMMobilePlugin.stopTimerWithName unavailable (run on device/emulator)', 'warn');
                }
            });
        }

        const btnBreadcrumb = document.getElementById('btn-leave-breadcrumb');
        if (btnBreadcrumb) {
            btnBreadcrumb.addEventListener('click', () => {
                const input = document.getElementById('breadcrumb-input');
                const text = (input && input.value.trim()) ? input.value.trim() : 'Manual test breadcrumb';
                const plugin = getNativePlugin();
                if (plugin && typeof plugin.leaveBreadcrumb === 'function') {
                    plugin.leaveBreadcrumb(text, 1, () => {
                        logToConsole('ADEUMMobilePlugin.leaveBreadcrumb: "' + text + '" recorded', 'success');
                    }, (err) => {
                        logToConsole('leaveBreadcrumb error: ' + JSON.stringify(err), 'error');
                    });
                } else {
                    logToConsole('ADEUMMobilePlugin.leaveBreadcrumb unavailable (run on device/emulator)', 'warn');
                }
            });
        }

        const btnException = document.getElementById('btn-trigger-exception');
        if (btnException) {
            btnException.addEventListener('click', () => {
                logToConsole('Intentionally throwing unhandled JavaScript exception...', 'warn');
                setTimeout(() => {
                    throw new Error('AppDEumDebugger Test Exception: Simulated JS runtime error at ' + new Date().toISOString());
                }, 50);
            });
        }

        const btnNativeCrash = document.getElementById('btn-trigger-native-crash');
        if (btnNativeCrash) {
            btnNativeCrash.addEventListener('click', () => {
                if (!(window.cordova && typeof window.cordova.exec === 'function')) {
                    logToConsole('nativeCrash requires Android or iOS Cordova device/emulator', 'warn');
                    return;
                }
                if (!confirm('Trigger an intentional native app crash now? The app will terminate and report the crash to AppDynamics on next launch.')) {
                    return;
                }
                logToConsole('Triggering intentional native app crash...', 'error');
                window.cordova.exec(() => {}, () => {}, 'ADEUMMobilePlugin', 'nativeCrash', []);
            });
        }

        const btnReplayMutate = document.getElementById('btn-replay-mutate');
        let mutateCount = 0;
        if (btnReplayMutate) {
            btnReplayMutate.addEventListener('click', () => {
                mutateCount++;
                const container = document.getElementById('replay-mutation-target');
                if (container) {
                    const tag = document.createElement('div');
                    tag.className = 'chip';
                    tag.style.background = 'rgba(168, 85, 247, 0.2)';
                    tag.style.color = '#e9d5ff';
                    tag.style.borderColor = '#c084fc';
                    tag.textContent = `DOM Node #${mutateCount} (${new Date().toLocaleTimeString()})`;
                    container.appendChild(tag);
                }
                logToConsole(`DOM mutation triggered: added Node #${mutateCount} for Session Replay capture`, 'info');
            });
        }

        const btnReplayFlush = document.getElementById('btn-replay-flush');
        if (btnReplayFlush) {
            btnReplayFlush.addEventListener('click', () => {
                try {
                    if (window.ADRUM && window.ADRUM.SessionReplayQueue && typeof window.ADRUM.SessionReplayQueue.flush === 'function') {
                        window.ADRUM.SessionReplayQueue.flush(true);
                    }
                    if (window.ADRUM && window.ADRUM.channel && typeof window.ADRUM.channel.sendBeacon === 'function') {
                        window.ADRUM.channel.sendBeacon(false);
                    }
                    logToConsole('Forced Session Replay blob flush requested', 'success');
                } catch (e) {
                    logToConsole('Session Replay flush error: ' + e.message, 'warn');
                }
            });
        }

        const btnClearConsole = document.getElementById('btn-clear-console');
        if (btnClearConsole) {
            btnClearConsole.addEventListener('click', () => {
                const box = document.getElementById('bridge-console');
                if (box) box.innerHTML = '';
            });
        }
    }

    function showFeedback(text, type, statusLabel) {
        const card = document.getElementById('api-feedback-card');
        const body = document.getElementById('api-feedback-body');
        const status = document.getElementById('api-feedback-status');

        if (card && body) {
            card.style.display = 'block';
            body.textContent = text;
            if (status) {
                status.textContent = statusLabel || type.toUpperCase();
                status.className = 'chip ' + (type === 'success' ? 'active' : (type === 'error' ? 'inactive' : ''));
            }
        }
    }

    // --- 9. Initialization ---

    function init() {
        console.log('[AppDEumDebugger] Initializing JavaScript app...');
        connectEarlyInterceptor();
        setupEventListeners();
        handleHashChange();
        populateConfigInputs(true);
        checkAgentStatus();
        updateBeaconCounters();

        document.addEventListener('deviceready', onDeviceReady, false);

        setTimeout(checkAgentStatus, 1000);
        setTimeout(checkAgentStatus, 3000);
    }

    function onDeviceReady() {
        console.log('[AppDEumDebugger] Cordova deviceready event received');
        state.cordovaReady = true;
        checkAgentStatus();
        logToConsole('Cordova deviceready event fired. Platform: ' + (window.cordova.platformId || 'unknown'), 'success');

        if (window.cordova && typeof window.cordova.exec === 'function') {
            window.cordova.exec((ncfg) => {
                if (ncfg && typeof ncfg === 'object') {
                    const activeNativeKey = (window.__EUM_ACTIVE_CONFIG__ && window.__EUM_ACTIVE_CONFIG__.nativeAppKey) || '';
                    const isPlaceholder = !activeNativeKey || activeNativeKey === 'XXX-XXX-XXX';
                    if (ncfg.hasOverride || isPlaceholder) {
                        if (ncfg.appKey) window.__EUM_ACTIVE_CONFIG__.nativeAppKey = ncfg.appKey;
                        if (ncfg.collectorUrl) window.__EUM_ACTIVE_CONFIG__.nativeCollectorUrl = ncfg.collectorUrl;
                    }
                    populateConfigInputs(false);
                    checkAgentStatus();
                }
            }, () => {}, 'ADEUMMobilePlugin', 'getNativeConfig', []);
        }

        const plugin = getNativePlugin();
        if (plugin) {
            const source = (window.plugins && plugin === window.plugins.ADEUMMobilePlugin)
                ? 'window.plugins.ADEUMMobilePlugin'
                : 'window.ADEUMMobilePlugin';
            logToConsole('AppDynamics Native Cordova Plugin detected (' + source + ')', 'success');
            if (typeof plugin.getVersion === 'function') {
                plugin.getVersion((ver) => {
                    logToConsole('AppDynamics Native Plugin Version: ' + ver, 'info');
                }, () => {});
            }
            bridgeScreenNavigation(window.location.hash || '#home');
            syncNativeBeaconLogs();
            setTimeout(syncNativeBeaconLogs, 2500);
            setTimeout(syncNativeBeaconLogs, 6000);
        } else {
            logToConsole('ADEUMMobilePlugin not found after deviceready', 'warn');
        }
    }

    window.addEventListener('error', function (e) {
        logToConsole('Unhandled JS Error: ' + e.message + ' at ' + e.filename + ':' + e.lineno, 'error');
        const plugin = getNativePlugin();
        if (state.bridgeToNative && plugin && typeof plugin.leaveBreadcrumb === 'function') {
            try {
                plugin.leaveBreadcrumb('JS Error: ' + e.message, 1, function () {}, function () {});
            } catch (err) {}
        }
    });

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
