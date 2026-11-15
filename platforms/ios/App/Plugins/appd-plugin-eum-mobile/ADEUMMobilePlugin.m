//
//  Ala'a AppD EUM - Dual-Instrumentation Debugger Engine (iOS)
//  Enhanced & Engineered by: Ala'a Mrayat
//  Copyright (c) 2018 AppDynamics Technologies. All rights reserved.
//

/********* ADEUMMobilePlugin.m Cordova Plugin Implementation *******/

#import <UIKit/UIKit.h>
#import <Cordova/CDV.h>
#import <ADEUMInstrumentation/ADEumInstrumentation.h>
#import <ADEUMInstrumentation/ADEumHTTPRequestTracker.h>
#import <ADEUMInstrumentation/ADEumServerCorrelationHeaders.h>
#import <ADEUMInstrumentation/ADEumSessionFrame.h>
#import "ADEUMPluginVersion.h"

@interface ADEUMMobilePlugin : CDVPlugin
@property (nonatomic, strong) ADEumAgentConfiguration *config;
@property (nonatomic, strong) NSMutableDictionary<NSString *, id> *keymap;
@end

// APPD-DUAL-PATCH-V10
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
}

- (void)dispose {
    [self.keymap removeAllObjects];
}

- (void)onAppTerminate {
    [self.keymap removeAllObjects];
}

- (void)onReset {
    [self.keymap removeAllObjects];
}

// Local Methods
- (void)getVersion:(CDVInvokedUrlCommand *)command {
    CDVPluginResult *result = [self finalizeSuccessfulResult:ADEumPluginHybridAgentVersion];
    [self.commandDelegate sendPluginResult:result callbackId:command.callbackId];
}

// Mobile Agent JS API interface
- (void)initWithConfiguration:(CDVInvokedUrlCommand *)command {
    CDVPluginResult *result;

    @try {
        if ([command.arguments count] != 1) {
            [self.commandDelegate sendPluginResult:result callbackId:command.callbackId];
            NSLog(@"Obj-C initWithConfiguration called -- bad command");
        } else {
            NSDictionary *settings = [command argumentAtIndex:0 withDefault:nil andClass:[NSDictionary class]];

            NSString *appKey = settings[@"appKey"];
            if (appKey) {
                // If appKey malformed this will throw exception.
                self.config = [[ADEumAgentConfiguration alloc] initWithAppKey:appKey];

                if (![self setCollectorUrl:settings[@"collectorUrl"]]) {
                    [self malformedArgument:@"collectorUrl" command:command];
                    return;
                }

                if (![self setLoggingLevel:settings[@"loggingLevel"]]) {
                    [self malformedArgument:@"loggingLevel" command:command];
                    return;
                }

                if (![self setScreenshotsEnabled:settings[@"screenshots"]]) {
                    [self malformedArgument:@"screenshotsEnabled" command:command];
                    return;
                }

                if (![self setScreenshotUrl:settings[@"screenshotUrl"]]) {
                    [self malformedArgument:@"screenshotUrl" command:command];
                    return;
                }

                if (![self setInteractionCaptureMode:settings[@"interactionCaptureMode"]]) {
                    [self malformedArgument:@"interactionCaptureMode" command:command];
                    return;
                }

                if (![self setReachabilityHostName:settings[@"reachabilityHostName"]]) {
                    [self malformedArgument:@"reachabilityHostName" command:command];
                    return;
                }

                [ADEumInstrumentation initWithConfiguration:_config a:ADEumPluginHybridAgentType b:ADEumPluginHybridAgentVersion];

                // Force generation of "App Start" beacon if API call is available
                SEL gabsSelector = NSSelectorFromString(@"generateAppStartBeacon");
                if ([ADEumInstrumentation respondsToSelector:gabsSelector]) {
                    [ADEumInstrumentation performSelector:gabsSelector];
                }

                result = [self finalizeSuccessfulResult:nil];
            }
        }

        NSLog(@"Obj-C initWithConfiguration called:%@", command.arguments);
    } @catch (NSException *exception) {
        result = [CDVPluginResult resultWithStatus:CDVCommandStatus_ERROR messageAsString:[exception reason]];
    }

    [self.commandDelegate sendPluginResult:result callbackId:command.callbackId];
}

- (void)initWithAppKey:(CDVInvokedUrlCommand *)command {
    CDVPluginResult *result;

    @try {
        if ([command.arguments count] != 1) {
            [self.commandDelegate sendPluginResult:result callbackId:command.callbackId];
            NSLog(@"Obj-C initWithAppKey called -- bad command");
        } else {
            NSString *appKey = [command argumentAtIndex:0 withDefault:nil andClass:[NSString class]];
            if (appKey) {
                // If appKey malformed this will throw exception.
                self.config = [[ADEumAgentConfiguration alloc] initWithAppKey:appKey];
                [ADEumInstrumentation initWithConfiguration:_config a:ADEumPluginHybridAgentType b:ADEumPluginHybridAgentVersion];
                // Force generation of "App Start" beacon if API call is available
                SEL gabsSelector = NSSelectorFromString(@"generateAppStartBeacon");
                if ([ADEumInstrumentation respondsToSelector:gabsSelector]) {
                    [ADEumInstrumentation performSelector:gabsSelector];
                } 
                result = [self finalizeSuccessfulResult:nil];
            }
        }

        NSLog(@"Obj-C initWithAppKey called:%@", command.arguments);
    } @catch (NSException *exception) {
        result = [CDVPluginResult resultWithStatus:CDVCommandStatus_ERROR messageAsString:[exception reason]];
    }

    [self.commandDelegate sendPluginResult:result callbackId:command.callbackId];
}

- (void)changeAppKey:(CDVInvokedUrlCommand *)command {
    CDVPluginResult *result;
    @try {
        if ([command.arguments count] != 1) {
            [self.commandDelegate sendPluginResult:result callbackId:command.callbackId];
            NSLog(@"Obj-C changeAppKey called -- bad command");
        } else {
            NSString *appKey = [command argumentAtIndex:0 withDefault:nil andClass:[NSString class]];
            if (appKey) {
                [ADEumInstrumentation changeAppKey:appKey];
                result = [self finalizeSuccessfulResult:nil];
            }
        }

        NSLog(@"Obj-C changeAppKey called:%@", command.arguments);
    } @catch (NSException *exception) {
        result = [CDVPluginResult resultWithStatus:CDVCommandStatus_ERROR messageAsString:[exception reason]];
    }

    [self.commandDelegate sendPluginResult:result callbackId:command.callbackId];
}

- (void)startTimerWithName:(CDVInvokedUrlCommand *)command {
    CDVPluginResult *result;
    @try {
        if ([command.arguments count] != 1) {
            [self.commandDelegate sendPluginResult:result callbackId:command.callbackId];
            NSLog(@"Obj-C startTimerWithName called -- bad command");
        } else {
            NSString *name = [command argumentAtIndex:0 withDefault:nil andClass:[NSString class]];
            if (name) {
                [ADEumInstrumentation startTimerWithName:name];
                result = [self finalizeSuccessfulResult:nil];
            }
        }

        NSLog(@"Obj-C startTimerWithName called:%@", command.arguments);
    } @catch (NSException *exception) {
        result = [CDVPluginResult resultWithStatus:CDVCommandStatus_ERROR messageAsString:[exception reason]];
    }

    [self.commandDelegate sendPluginResult:result callbackId:command.callbackId];
}

- (void)stopTimerWithName:(CDVInvokedUrlCommand *)command {
    CDVPluginResult *result;
    @try {
        if ([command.arguments count] != 1) {
            [self.commandDelegate sendPluginResult:result callbackId:command.callbackId];
            NSLog(@"Obj-C stopTimerWithName called -- bad command");
        } else {
            NSString *name = [command argumentAtIndex:0 withDefault:nil andClass:[NSString class]];
            if (name) {
                [ADEumInstrumentation stopTimerWithName:name];
                result = [self finalizeSuccessfulResult:nil];
            }
        }

        NSLog(@"Obj-C stopTimerWithName called:%@", command.arguments);
    } @catch (NSException *exception) {
        result = [CDVPluginResult resultWithStatus:CDVCommandStatus_ERROR messageAsString:[exception reason]];
    }

    [self.commandDelegate sendPluginResult:result callbackId:command.callbackId];
}

- (void)reportMetricWithName:(CDVInvokedUrlCommand *)command {
    CDVPluginResult *result;
    @try {
        if ([command.arguments count] != 2) {
            [self.commandDelegate sendPluginResult:result callbackId:command.callbackId];
            NSLog(@"Obj-C reportMetricWithName called -- bad command");
        } else {
            NSString *name = [command argumentAtIndex:0 withDefault:nil andClass:[NSString class]];
            NSNumber *value = [command argumentAtIndex:1 withDefault:nil andClass:[NSNumber class]];
            if (name && value) {
                [ADEumInstrumentation reportMetricWithName:name value:[value longLongValue]];
                result = [self finalizeSuccessfulResult:nil];
            }
        }

        NSLog(@"Obj-C reportMetricWithName called:%@", command.arguments);
    } @catch (NSException *exception) {
        result = [CDVPluginResult resultWithStatus:CDVCommandStatus_ERROR messageAsString:[exception reason]];
    }

    [self.commandDelegate sendPluginResult:result callbackId:command.callbackId];
}

- (void)leaveBreadcrumb:(CDVInvokedUrlCommand *)command {
    CDVPluginResult *result;
    @try {
        if ([command.arguments count] != 2) {
            [self.commandDelegate sendPluginResult:result callbackId:command.callbackId];
            NSLog(@"Obj-C leaveBreadcrumb called -- bad command");
        } else {
            NSString *breadcrumb = [command argumentAtIndex:0 withDefault:nil andClass:[NSString class]];
            NSNumber *mode = [command argumentAtIndex:1 withDefault:nil andClass:[NSNumber class]];
            if (breadcrumb && mode) {
                [ADEumInstrumentation leaveBreadcrumb:breadcrumb mode:[mode integerValue]];
                result = [self finalizeSuccessfulResult:nil];
            }
        }

        NSLog(@"Obj-C leaveBreadcrumb called:%@", command.arguments);
    } @catch (NSException *exception) {
        result = [CDVPluginResult resultWithStatus:CDVCommandStatus_ERROR messageAsString:[exception reason]];
    }

    [self.commandDelegate sendPluginResult:result callbackId:command.callbackId];
}

- (void)setUserData:(CDVInvokedUrlCommand *)command {
    CDVPluginResult *result;
    @try {
        if ([command.arguments count] != 2) {
            [self.commandDelegate sendPluginResult:result callbackId:command.callbackId];
            NSLog(@"Obj-C setUserData called -- bad command");
        } else {
            NSString *key = [command argumentAtIndex:0 withDefault:nil andClass:[NSString class]];
            NSString *value = [command argumentAtIndex:1 withDefault:nil andClass:[NSString class]];
            if (key && value) {
                [ADEumInstrumentation setUserData:key value:value];
                result = [self finalizeSuccessfulResult:nil];
            }
        }

        NSLog(@"Obj-C setUserData called:%@", command.arguments);
    } @catch (NSException *exception) {
        result = [CDVPluginResult resultWithStatus:CDVCommandStatus_ERROR messageAsString:[exception reason]];
    }

    [self.commandDelegate sendPluginResult:result callbackId:command.callbackId];
}

- (void)removeUserData:(CDVInvokedUrlCommand *)command {
    NSLog(@"Obj-C removeUserData called:" );
    CDVPluginResult *result;
    @try {
        if ([command.arguments count] != 1) {
            [self.commandDelegate sendPluginResult:result callbackId:command.callbackId];
            NSLog(@"Obj-C removeUserData called -- bad command");
        } else {
            NSString *key = [command argumentAtIndex:0 withDefault:nil andClass:[NSString class]];
            if (key) {
                [ADEumInstrumentation removeUserData:key];
                result = [self finalizeSuccessfulResult:nil];
            }
        }

        NSLog(@"Obj-C removeUserData called:%@", command.arguments);
    } @catch (NSException *exception) {
        result = [CDVPluginResult resultWithStatus:CDVCommandStatus_ERROR messageAsString:[exception reason]];
    }

    [self.commandDelegate sendPluginResult:result callbackId:command.callbackId];
}

- (void)takeScreenshot:(CDVInvokedUrlCommand *)command {
    NSLog(@"Obj-C takeScreenshot called:" );
    [ADEumInstrumentation takeScreenshot];

    CDVPluginResult *result = [self finalizeSuccessfulResult:nil];
    [self.commandDelegate sendPluginResult:result callbackId:command.callbackId];
}

- (void)beginCall:(CDVInvokedUrlCommand*)command {
    CDVPluginResult *result;

    @try {
        if ([command.arguments count] != 3) {
            [self.commandDelegate sendPluginResult:result callbackId:command.callbackId];
            NSLog(@"Obj-C beginCall called -- bad command");
        } else {
            NSString *name = [command argumentAtIndex:0 withDefault:nil andClass:[NSString class]];
            NSString *selName = [command argumentAtIndex:1 withDefault:nil andClass:[NSString class]];

            NSInteger additionalArgumentCount = [[command arguments] count] - 2;
            NSArray *additionalArguments = nil;
            if (additionalArgumentCount > 0) {
                additionalArguments = [[command arguments] subarrayWithRange:NSMakeRange(2, additionalArgumentCount)];
            }

            // Generate tracking key
            NSString *key = [self generateKey];
            NSLog(@"beginCall with key:%@ name:%@ selector:%@", key, name, selName);

            SEL sel = NSSelectorFromString(selName);

            if ([name length] > 0 && [selName length] > 0) {
                id tracker = [ADEumInstrumentation beginCall:name selector:sel withArguments:additionalArguments];
                self.keymap[key] = tracker;
                result = [self finalizeSuccessfulResult:key];
            } else {
                result = [CDVPluginResult resultWithStatus:CDVCommandStatus_ERROR messageAsString:@"Name or method missing or invalid"];
            }
        }
    } @catch (NSException *exception) {
        result = [CDVPluginResult resultWithStatus:CDVCommandStatus_ERROR messageAsString:[exception reason]];
    }

    [self.commandDelegate sendPluginResult:result callbackId:command.callbackId];
}

- (void)endCall:(CDVInvokedUrlCommand*)command {
    CDVPluginResult *result;
    @try {
        if ([command.arguments count] < 1) {
            [self.commandDelegate sendPluginResult:result callbackId:command.callbackId];
            NSLog(@"Obj-C endCall called -- bad command");
        } else if ([command.arguments count] >= 1) {
            NSString *key = [command argumentAtIndex:0 withDefault:nil andClass:[NSString class]];
            if ([key length] > 0) {
                id tracker = [self.keymap objectForKey:key];
                if (tracker != nil) {
                    NSString *value = nil;
                    if ([command.arguments count] == 2) {
                        value = [command argumentAtIndex:1 withDefault:nil andClass:[NSString class]];
                        [ADEumInstrumentation endCall:tracker withValue:value];
                        NSLog(@"endCall %@ withValue:%@", key, value);
                    } else {
                        [ADEumInstrumentation endCall:tracker];
                        NSLog(@"endCall %@", key);
                    }

                    [self.keymap removeObjectForKey:key];
                    result = [self finalizeSuccessfulResult:nil];
                } else {
                    result = [CDVPluginResult resultWithStatus:CDVCommandStatus_ERROR messageAsString:@"Tracker not found"];
                }
            } else {
                result = [CDVPluginResult resultWithStatus:CDVCommandStatus_ERROR messageAsString:@"Invalid tracker object"];
            }
        }
    } @catch (NSException *exception) {
        result = [CDVPluginResult resultWithStatus:CDVCommandStatus_ERROR messageAsString:[exception reason]];
    }
    [self.commandDelegate sendPluginResult:result callbackId:command.callbackId];
}

- (void)beginHttpRequest:(CDVInvokedUrlCommand*)command {
    CDVPluginResult *result;
    @try {
        if ([command.arguments count] != 1) {
            [self.commandDelegate sendPluginResult:result callbackId:command.callbackId];
            NSLog(@"Obj-C beginHttpRequest called -- bad command");
        } else {
            NSString *url = [command argumentAtIndex:0 withDefault:nil andClass:[NSString class]];
            NSLog(@"beginHttpRequest %@", url);

            // get UUID for key
            NSString *key = [self generateKey];
            NSURL *nsurl = [[NSURL alloc] initWithString:url]; // new url from string

            if ([url length] > 0 && nsurl != nil) {
                ADEumHTTPRequestTracker *tracker = [ADEumHTTPRequestTracker requestTrackerWithURL:nsurl];
                self.keymap[key] = tracker;
                result = [self finalizeSuccessfulResult:key];
            } else {
                result = [CDVPluginResult resultWithStatus:CDVCommandStatus_ERROR  messageAsString:@"Missing or invalid URL"];
            }
        }
    } @catch (NSException *exception) {
        result = [CDVPluginResult resultWithStatus:CDVCommandStatus_ERROR messageAsString:[exception reason]];
    }
    [self.commandDelegate sendPluginResult:result callbackId:command.callbackId];
}

- (void)reportDone:(CDVInvokedUrlCommand*)command {
    CDVPluginResult *result;
    @try {
        if ([command.arguments count] != 1) {
            [self.commandDelegate sendPluginResult:result callbackId:command.callbackId];
            NSLog(@"Obj-C reportDone called -- bad command");
        } else {
            NSString *key = [command argumentAtIndex:0 withDefault:nil andClass:[NSString class]];

            if ([key length] > 0) {
                ADEumHTTPRequestTracker *tracker = [self.keymap objectForKey:key];
                if (tracker != nil) {
                    [self.keymap removeObjectForKey:key];
                    [tracker reportDone];
                    result = [self finalizeSuccessfulResult:nil];

                } else {
                    result = [CDVPluginResult resultWithStatus:CDVCommandStatus_ERROR messageAsString:@"Tracker not found"];
                }
            } else {
                result = [CDVPluginResult resultWithStatus:CDVCommandStatus_ERROR messageAsString:@"Invalid tracker object"];
            }
        }
    } @catch (NSException *exception) {
        result = [CDVPluginResult resultWithStatus:CDVCommandStatus_ERROR messageAsString:[exception reason]];
    }
    [self.commandDelegate sendPluginResult:result callbackId:command.callbackId];
}

- (void)getCorrelationHeaders:(CDVInvokedUrlCommand *)command {
    NSDictionary *headers = [ADEumServerCorrelationHeaders generate];

    CDVPluginResult *result = [self finalizeSuccessfulResult:headers];
    [self.commandDelegate sendPluginResult:result callbackId:command.callbackId];
}

/*
 * Note: Invoking any of the following methods with missing or null arguments
 * will return CDVCommandStatus_ERROR without updating underlying parameters.
 * - (void)withResponseCode:(CDVInvokedUrlCommand*)command;
 * - (void)withResponseContentLength:(CDVInvokedUrlCommand*)command;
 * - (void)withRequestContentLength:(CDVInvokedUrlCommand*)command;
 * - (void)withInstrumentationSource:(CDVInvokedUrlCommand*)command;
 * - (void)withResponseHeaderFields:(CDVInvokedUrlCommand*)command;
 * - (void)withRequestHeaderFields:(CDVInvokedUrlCommand*)command;
 * - (void)withErrorMessage:(CDVInvokedUrlCommand*)command;
 */

- (void)withResponseCode:(CDVInvokedUrlCommand*)command {
    CDVPluginResult *result;
    @try {
        if ([command.arguments count] != 2) {
            [self.commandDelegate sendPluginResult:result callbackId:command.callbackId];
            NSLog(@"Obj-C withResponseCode called -- bad command");
        } else {
            NSString *key = [command argumentAtIndex:0 withDefault:nil andClass:[NSString class]];
            NSNumber *responseStatusCode = [command argumentAtIndex:1 withDefault:nil andClass:[NSNumber class]];
            NSLog(@"key:%@ withResponseCode:%@", key, responseStatusCode);

            if ([key length] > 0) {
                if (responseStatusCode) {
                    ADEumHTTPRequestTracker *tracker = [self.keymap objectForKey:key];
                    tracker.statusCode = responseStatusCode;
                    result = [self finalizeSuccessfulResult:key];
                } else {
                    result = [CDVPluginResult resultWithStatus:CDVCommandStatus_ERROR messageAsString:@"StatusCode missing or invalid"];
                }
            }
        }
    } @catch (NSException *exception) {
        result = [CDVPluginResult resultWithStatus:CDVCommandStatus_ERROR messageAsString:[exception reason]];
    }
    [self.commandDelegate sendPluginResult:result callbackId:command.callbackId];
}

- (void)withResponseContentLength:(CDVInvokedUrlCommand*)command {
    CDVPluginResult *result;
    @try {
        if ([command.arguments count] != 2) {
            [self.commandDelegate sendPluginResult:result callbackId:command.callbackId];
            NSLog(@"Obj-C withResponseContentLength called -- bad command");
        } else {
            NSString *key = [command argumentAtIndex:0 withDefault:nil andClass:[NSString class]];
            NSNumber *responseContentLength = [command argumentAtIndex:1 withDefault:nil andClass:[NSNumber class]];
            NSLog(@"key:%@ withResponseContentLength:%@", key, responseContentLength);

            if ([key length] > 0) {
                if (responseContentLength) {
                    ADEumHTTPRequestTracker *tracker = [self.keymap objectForKey:key];
                    NSMutableDictionary *tmpHeaders = [NSMutableDictionary dictionaryWithDictionary:tracker.allHeaderFields];
                    [tmpHeaders setValue:[responseContentLength stringValue] forKey:@"Content-Length"];
                    tracker.allHeaderFields = tmpHeaders;
                    result = [self finalizeSuccessfulResult:key];
                } else {
                    result = [CDVPluginResult resultWithStatus:CDVCommandStatus_ERROR messageAsString:@"Content-Length missing or invalid"];
                }
            }
        }
    } @catch (NSException *exception) {
        result = [CDVPluginResult resultWithStatus:CDVCommandStatus_ERROR messageAsString:[exception reason]];
    }
    [self.commandDelegate sendPluginResult:result callbackId:command.callbackId];
}

- (void)withRequestContentLength:(CDVInvokedUrlCommand*)command {
    CDVPluginResult *result;
    @try {
        if ([command.arguments count] != 2) {
            [self.commandDelegate sendPluginResult:result callbackId:command.callbackId];
            NSLog(@"Obj-C withRequestContentLength called -- bad command");
        } else {
            NSString *key = [command argumentAtIndex:0 withDefault:nil andClass:[NSString class]];
            NSNumber *requestContentLength = [command argumentAtIndex:1 withDefault:nil andClass:[NSNumber class]];
            NSLog(@"key:%@ withRequestContentLength:%@", key, requestContentLength);

            if ([key length] > 0) {
                if (requestContentLength) {
                    ADEumHTTPRequestTracker *tracker = [self.keymap objectForKey:key];
                    NSMutableDictionary *tmpHeaders = [NSMutableDictionary dictionaryWithDictionary:tracker.allRequestHeaderFields];
                    [tmpHeaders setValue:[requestContentLength stringValue] forKey:@"Content-Length"];
                    tracker.allRequestHeaderFields = tmpHeaders;
                    result = [self finalizeSuccessfulResult:key];
                } else {
                    result = [CDVPluginResult resultWithStatus:CDVCommandStatus_ERROR messageAsString:@"Content-Length missing or invalid"];
                }
            }
        }
    } @catch (NSException *exception) {
        result = [CDVPluginResult resultWithStatus:CDVCommandStatus_ERROR messageAsString:[exception reason]];
    }
    [self.commandDelegate sendPluginResult:result callbackId:command.callbackId];
}

- (void)withResponseHeaderFields:(CDVInvokedUrlCommand*)command {
    CDVPluginResult *result;
    @try {
        if ([command.arguments count] != 2) {
            [self.commandDelegate sendPluginResult:result callbackId:command.callbackId];
            NSLog(@"Obj-C withResponseHeaderFields called -- bad command");
        } else {
            NSString *key = [command argumentAtIndex:0 withDefault:nil andClass:[NSString class]];
            NSDictionary *headers = [command argumentAtIndex:1 withDefault:nil andClass:[NSDictionary class]];
            NSLog(@"key:%@ withResponseHeaderFields:%@", key, headers);

            if ([key length] > 0) {
                if ([headers count] > 0) {
                    ADEumHTTPRequestTracker *tracker = [self.keymap objectForKey:key];
                    tracker.allHeaderFields = [self updatedTrackerHeaders:tracker.allHeaderFields newHeaders:headers];
                    result = [self finalizeSuccessfulResult:key];
                } else {
                    result = [CDVPluginResult resultWithStatus:CDVCommandStatus_ERROR messageAsString:@"Headers missing or invalid"];
                }
            }
        }
    } @catch (NSException *exception) {
        result = [CDVPluginResult resultWithStatus:CDVCommandStatus_ERROR messageAsString:[exception reason]];
    }
    [self.commandDelegate sendPluginResult:result callbackId:command.callbackId];
}

- (void)withRequestHeaderFields:(CDVInvokedUrlCommand*)command {
    CDVPluginResult *result;
    @try {
        if ([command.arguments count] != 2) {
            [self.commandDelegate sendPluginResult:result callbackId:command.callbackId];
            NSLog(@"Obj-C withRequestHeaderFields called -- bad command");
        } else {
            NSString *key = [command argumentAtIndex:0 withDefault:nil andClass:[NSString class]];
            NSDictionary *headers = [command argumentAtIndex:1 withDefault:nil andClass:[NSDictionary class]];
            NSLog(@"key:%@ withRequestHeaderFields:%@", key, headers);

            if ([key length] > 0) {
                if ([headers count] > 0) {
                    ADEumHTTPRequestTracker *tracker = [self.keymap objectForKey:key];
                    tracker.allRequestHeaderFields = [self updatedTrackerHeaders:tracker.allRequestHeaderFields newHeaders:headers];
                    result = [self finalizeSuccessfulResult:key];
                } else {
                    result = [CDVPluginResult resultWithStatus:CDVCommandStatus_ERROR messageAsString:@"Headers missing or invalid"];
                }
            }
        }
    } @catch (NSException *exception) {
        result = [CDVPluginResult resultWithStatus:CDVCommandStatus_ERROR messageAsString:[exception reason]];
    }
    [self.commandDelegate sendPluginResult:result callbackId:command.callbackId];
}

- (void)withInstrumentationSource:(CDVInvokedUrlCommand*)command {
    CDVPluginResult *result;
    @try {
        if ([command.arguments count] != 2) {
            [self.commandDelegate sendPluginResult:result callbackId:command.callbackId];
            NSLog(@"Obj-C withInstrumentationSource called -- bad command");
        } else {
            NSString *key = [command argumentAtIndex:0 withDefault:nil andClass:[NSString class]];
            NSString *informationSource = [command argumentAtIndex:1 withDefault:nil andClass:[NSString class]];
            NSLog(@"key:%@ withInstrumentationSource:%@", key, informationSource);

            if ([key length] > 0) {
                if (informationSource) {
                    ADEumHTTPRequestTracker *tracker = [self.keymap objectForKey:key];
                    tracker.instrumentationSource = informationSource;
                    result = [self finalizeSuccessfulResult:key];
                } else {
                    result = [CDVPluginResult resultWithStatus:CDVCommandStatus_ERROR messageAsString:@"InformationSource missing or invalid"];
                }
            }
        }
    } @catch (NSException *exception) {
        result = [CDVPluginResult resultWithStatus:CDVCommandStatus_ERROR messageAsString:[exception reason]];
    }
    [self.commandDelegate sendPluginResult:result callbackId:command.callbackId];
}

- (void)withErrorMessage:(CDVInvokedUrlCommand*)command {
    CDVPluginResult *result;
    @try {
        if ([command.arguments count] != 2) {
            [self.commandDelegate sendPluginResult:result callbackId:command.callbackId];
            NSLog(@"Obj-C withErrorMessage called -- bad command");
        } else {
            NSString *key = [command argumentAtIndex:0 withDefault:nil andClass:[NSString class]];
            NSString *errorMessage = [command argumentAtIndex:1 withDefault:nil andClass:[NSString class]];
            NSLog(@"key:%@ withErrorMessage:%@", key, errorMessage);

            if ([key length] > 0) {
                if ([errorMessage length] > 0) {
                    ADEumHTTPRequestTracker *tracker = [self.keymap objectForKey:key];
                    if ([tracker isMemberOfClass:[ADEumHTTPRequestTracker class]]) {
                        NSError *error = [NSError errorWithDomain:@"com.appdynamics.cordova"
                                                             code:-100
                                                         userInfo:@{NSLocalizedDescriptionKey: errorMessage}];

                        tracker.error = error;
                        result = [self finalizeSuccessfulResult:key];
                    } else {
                        result = [CDVPluginResult resultWithStatus:CDVCommandStatus_ERROR messageAsString:@"Http tracker not found"];
                    }
                } else {
                    result = [CDVPluginResult resultWithStatus:CDVCommandStatus_ERROR messageAsString:@"Error message missing or invalid"];
                }
            }
        }
    } @catch (NSException *exception) {
        result = [CDVPluginResult resultWithStatus:CDVCommandStatus_ERROR messageAsString:[exception reason]];
    }
    [self.commandDelegate sendPluginResult:result callbackId:command.callbackId];
}

- (void)startNextSession:(CDVInvokedUrlCommand *)command {
    NSLog(@"Obj-C startNextSession called:" );
    [ADEumInstrumentation startNextSession];

    CDVPluginResult *result = [self finalizeSuccessfulResult:nil];
    [self.commandDelegate sendPluginResult:result callbackId:command.callbackId];
}

- (void)unblockScreenshots:(CDVInvokedUrlCommand *)command {
    [ADEumInstrumentation unblockScreenshots];

    CDVPluginResult *result = [self finalizeSuccessfulResult:nil];
    [self.commandDelegate sendPluginResult:result callbackId:command.callbackId];
}

- (void)blockScreenshots:(CDVInvokedUrlCommand *)command {
    [ADEumInstrumentation blockScreenshots];

    CDVPluginResult *result = [self finalizeSuccessfulResult:nil];
    [self.commandDelegate sendPluginResult:result callbackId:command.callbackId];
}

- (void)screenshotsBlocked:(CDVInvokedUrlCommand *)command {
    CDVPluginResult *result = [self finalizeSuccessfulResult:[NSNumber numberWithBool:[ADEumInstrumentation screenshotsBlocked]]];
    [self.commandDelegate sendPluginResult:result callbackId:command.callbackId];
}

- (void)startSessionFrame:(CDVInvokedUrlCommand*)command {
    CDVPluginResult *result;

    @try {
        if ([command.arguments count] < 1) {
            [self.commandDelegate sendPluginResult:result callbackId:command.callbackId];
            NSLog(@"Obj-C startSessionFrame called with invalid arguments");
        } else {
            NSString *sessionFrameName = [command argumentAtIndex:0 withDefault:nil andClass:[NSString class]];
            // Generate tracking key
            NSString *key = [self generateKey];

            if ([sessionFrameName length] > 0) {
                id sessionFrame = [ADEumInstrumentation startSessionFrame:sessionFrameName];
                self.keymap[key] = sessionFrame;
                result = [self finalizeSuccessfulResult:key];
            } else {
                result = [CDVPluginResult resultWithStatus:CDVCommandStatus_ERROR messageAsString:@"SessionFrameName is missing or invalid"];
            }
        }
    } @catch (NSException *exception) {
        result = [CDVPluginResult resultWithStatus:CDVCommandStatus_ERROR messageAsString:[exception reason]];
    }

    [self.commandDelegate sendPluginResult:result callbackId:command.callbackId];
}

- (void)endSessionFrame:(CDVInvokedUrlCommand*)command {
    CDVPluginResult *result;
    @try {
        if ([command.arguments count] < 1) {
            [self.commandDelegate sendPluginResult:result callbackId:command.callbackId];
            NSLog(@"Obj-C endSessionFrame called -- bad command");
        } else if ([command.arguments count] >= 1) {
            NSString *key = [command argumentAtIndex:0 withDefault:nil andClass:[NSString class]];
            if ([key length] > 0) {
                ADEumSessionFrame *sessionFrame = [self.keymap objectForKey:key];
                if (sessionFrame != nil) {
                    [sessionFrame end];
                    NSLog(@"endSessionFrame %@", key);
                    [self.keymap removeObjectForKey:key];
                    result = [self finalizeSuccessfulResult:nil];
                } else {
                    result = [CDVPluginResult resultWithStatus:CDVCommandStatus_ERROR messageAsString:@"SessionFrame not found"];
                }
            } else {
                result = [CDVPluginResult resultWithStatus:CDVCommandStatus_ERROR messageAsString:@"Invalid SessionFrame object"];
            }
        }
    } @catch (NSException *exception) {
        result = [CDVPluginResult resultWithStatus:CDVCommandStatus_ERROR messageAsString:[exception reason]];
    }
    [self.commandDelegate sendPluginResult:result callbackId:command.callbackId];
}

- (void)updateSessionFrameName:(CDVInvokedUrlCommand*)command {
    CDVPluginResult *result;
    @try {
        if ([command.arguments count] < 2) {
            [self.commandDelegate sendPluginResult:result callbackId:command.callbackId];
            NSLog(@"Obj-C updateSessionFrameName called -- bad command");
        } else if ([command.arguments count] >= 2) {
            NSString *key = [command argumentAtIndex:0 withDefault:nil andClass:[NSString class]];
            NSString *sessionFrameName = [command argumentAtIndex:1 withDefault:nil andClass:[NSString class]];
            if ([key length] > 0 && [sessionFrameName length] > 0) {
                ADEumSessionFrame *sessionFrame = [self.keymap objectForKey:key];
                if (sessionFrame != nil) {
                    [sessionFrame updateName:sessionFrameName];
                    NSLog(@"updateSessionFrameName %@, %@", key, sessionFrameName);
                    result = [self finalizeSuccessfulResult:nil];
                } else {
                    result = [CDVPluginResult resultWithStatus:CDVCommandStatus_ERROR messageAsString:@"SessionFrame not found"];
                }
            } else {
                result = [CDVPluginResult resultWithStatus:CDVCommandStatus_ERROR messageAsString:@"Invalid SessionFrame object"];
            }
        }
    } @catch (NSException *exception) {
        result = [CDVPluginResult resultWithStatus:CDVCommandStatus_ERROR messageAsString:[exception reason]];
    }
    [self.commandDelegate sendPluginResult:result callbackId:command.callbackId];
}

//for internal testing only
- (void)crash:(CDVInvokedUrlCommand *)command {
    NSLog(@"Obj-C crash called:" );
    CDVPluginResult *result = [self finalizeSuccessfulResult:nil];

    [self crashme];

    [self.commandDelegate sendPluginResult:result callbackId:command.callbackId];
}

- (void)crashme {
    assert(NO);
}

#pragma mark - Support methods
- (CDVPluginResult *)finalizeSuccessfulResult:(id)key {
    [self flush:nil];

    if ([key isKindOfClass:[NSString class]]) {
        return [CDVPluginResult resultWithStatus:CDVCommandStatus_OK messageAsString:key];
    } else if ([key isKindOfClass:[NSDictionary class]]) {
        return [CDVPluginResult resultWithStatus:CDVCommandStatus_OK messageAsDictionary:key];
    } else {
        return [CDVPluginResult resultWithStatus:CDVCommandStatus_OK];
    }
}

- (NSString *)generateKey {
    return [[NSUUID alloc] init].UUIDString;
}

- (NSDictionary *)updatedTrackerHeaders:(NSDictionary *)oldHeader newHeaders:(NSDictionary *)newHeaders {
    NSMutableDictionary *mergedHeaders = [NSMutableDictionary dictionaryWithDictionary:oldHeader];
    for (NSString *key in newHeaders) {
        [mergedHeaders setValue:[newHeaders objectForKey:key] forKey:key];
    }
    return mergedHeaders;
}

- (void)malformedArgument:(NSString *)argument command:(CDVInvokedUrlCommand *)command {
    CDVPluginResult *result = [CDVPluginResult resultWithStatus:CDVCommandStatus_ERROR messageAsString:argument];
    [self.commandDelegate sendPluginResult:result callbackId:command.callbackId];
}

- (BOOL)setCollectorUrl:(id)argument {
    BOOL ret = NO;
    if (!argument) { // Optional argument
        return YES;
    }

    if ([argument isKindOfClass:[NSString class]]) {
        if ([NSURL URLWithString:argument]) {
            self.config.collectorURL = argument;
            ret = YES;
        }
    }
    return ret;
}

- (BOOL)setLoggingLevel:(id)argument {
    BOOL ret = NO;
    if (!argument) { // Optional argument
        return YES;
    }

    if ([argument isKindOfClass:[NSNumber class]]) {
        NSInteger loggingLevel = [argument integerValue];
        if ((loggingLevel >= ADEumLoggingLevelOff) && (loggingLevel <= ADEumLoggingLevelAll)) {
            self.config.loggingLevel = [argument integerValue];
        }
        ret = YES;
    }
    return ret;
}

- (BOOL)setScreenshotsEnabled:(id)argument {
    BOOL ret = NO;

    if (!argument) { // Optional argument
        return YES;
    }

    if ([argument isKindOfClass:[NSNumber class]]) {
        self.config.screenshotsEnabled = [argument boolValue];
        ret = YES;
    } else if ([argument isKindOfClass:[NSString class]]) {
        if( [@"true" caseInsensitiveCompare:argument] == NSOrderedSame ) {
           self.config.screenshotsEnabled = YES;
        } else {
           self.config.screenshotsEnabled = NO;
        }
        ret = YES;
    }
    return ret;
}

- (BOOL)setScreenshotUrl:(id)argument {
    BOOL ret = NO;

    if (!argument) { // Optional argument
        return YES;
    }

    if ([argument isKindOfClass:[NSString class]]) {
        if ([NSURL URLWithString:argument]) {
            self.config.screenshotURL = argument;
            ret = YES;
        }
    }
    return ret;
}

- (BOOL)setInteractionCaptureMode:(id)argument {
    BOOL ret = NO;

    if (!argument) { // Optional argument
        return YES;
    }

    if ([argument isKindOfClass:[NSNumber class]]) {
        self.config.interactionCaptureMode = [argument integerValue];
        ret = YES;
    }
    return ret;
}

- (BOOL)setReachabilityHostName:(id)argument {
    BOOL ret = NO;

    if (!argument) { // Optional argument
        return YES;
    }

    if ([argument isKindOfClass:[NSString class]]) {
        self.config.reachabilityHostName = argument;
        ret = YES;
    }
    return ret;
}

- (void)flush:(CDVInvokedUrlCommand *)command {
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
}


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

@end
