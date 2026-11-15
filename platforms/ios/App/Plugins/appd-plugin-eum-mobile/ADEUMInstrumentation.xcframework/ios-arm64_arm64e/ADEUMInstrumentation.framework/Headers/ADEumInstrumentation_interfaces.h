//  Copyright (c) 2020 AppDynamics Technologies. All rights reserved.

#import <Foundation/Foundation.h>
#import <UIKit/UIKit.h>
#import <ADEUMInstrumentation/ADEumCollectorChannel.h>
#import <ADEUMInstrumentation/ADEumCrashReportCallback.h>
#import <ADEUMInstrumentation/ADEumNetworkRequestCallback.h>
#import <ADEUMInstrumentation/ADEumSessionFrame.h>
#import <ADEUMInstrumentation/ADEumDataCompressor.h>

/**
 *  Breadcrumb visibility constants.
 */
typedef NS_ENUM(NSInteger, ADEumBreadcrumbVisibility) {
    /**
     *  Breadcrumb is visible only for Crash Reports.
     */
    ADEumBreadcrumbVisibilityCrashesOnly,
    /**
     *  Breadcrumb is visible for both Crash Reports and Sessions
     */
    ADEumBreadcrumbVisibilityCrashesAndSessions,
};

/** Interaction events to capture constants.*/
typedef NS_OPTIONS(NSUInteger, ADEumInteractionCaptureMode) {
    /** Capture none, this is the default */
    ADEumInteractionCaptureModeNone = 0UL,
    /** Capture button presses */
    ADEumInteractionCaptureModeButtonPressed = (1UL << 0),
    /** Capture table cell selection */
    ADEumInteractionCaptureModeTableCellSelected = (1UL << 1),
    /** Capture text field selection */
    ADEumInteractionCaptureModeTextFieldSelected = (1UL << 2),
    /** Capture text view selection. */
    ADEUmInteractionCaptureModeTextViewSelected = (1UL << 3),
    /** Capture all tracked events. */
    ADEumInteractionCaptureModeAll = ~0UL,
};

/** Logging levels constants. */
typedef NS_ENUM(NSUInteger, ADEumLoggingLevel) {
    /** Agent will emit no messages at all */
    ADEumLoggingLevelOff,
    /** Error messages only, this is the default */
    ADEumLoggingLevelError,
    /** Warning messages or higher */
    ADEumLoggingLevelWarn,
    /** Information, may be useful to developer */
    ADEumLoggingLevelInfo,
    /** Debug, useful for support personel and developers */
    ADEumLoggingLevelDebug,
    /** Verbose, useful for support personel */
    ADEumLoggingLevelVerbose,
    /** All messages */
    ADEumLoggingLevelAll,
};

/** Error report severity constants. */
typedef NS_ENUM(NSUInteger, ADEumErrorSeverityLevel) {
    /** Info Level - An error happened, but it did not cause a problem. */
    ADEumErrorSeverityLevelInfo,
    /** Warning Level - An error happened but the app recovered gracefully. */
    ADEumErrorSeverityLevelWarning,
    /** Critical Level - An error happened and caused problems to the app. */
    ADEumErrorSeverityLevelCritical,
};

/**
 *  The mask element class defines one area and its role in the recording mask.
 */
typedef NS_ENUM(NSUInteger, ADEumMaskType) {
    /// Covers area that will not be recorded.
    /// Covering masks can be partially erased if at least
    /// partially covered by erasing masks on higher layers.
    ADEumMaskTypeCovering,
    /// Erases the lower layers of the mask.
    ADEumMaskTypeErasing,
};

/**
 *  Rendering modes
 */
typedef NS_ENUM(NSInteger, ADEumRenderingMode) {
    /**
     *  Regularly captures the app screen which the session replay module immediately processes to remove sensitive data. The frames are then complied to make the session recording.
     */
    ADEumNative,
    /**
     *  Captures the app using only a wireframe representation of the screen data. No user data is recorded. This is the preferred rendering method for user data security.
     */
    ADEumWireframe,
};

@interface ADEumMaskElement : NSObject
/// A rectangle that bounds the masked area.
@property (nonatomic, readonly) CGRect rect;
/// A type of mask element.
@property (nonatomic, readonly) enum ADEumMaskType maskType;
/// Creates a new mask element instance with prepared preconfigured values.
/// \param rect A rectangle that bounds the masked area.
///
/// \param maskType A type of mask element.
///
- (nonnull instancetype)initWithRect:(CGRect)rect maskType:(enum ADEumMaskType)maskType;
@end


ADEUM_ASSUME_NONNULL_BEGIN

/** The configuration of the AppDynamics SDK */
@interface ADEumAgentConfiguration : NSObject

/**
 * The application key.
 *
 * @warning This property is required.
 */
@property (nonatomic, copy) NSString *appKey;

/**
 * The URL of the collector. It should be compliant with "1.4. Hierarchical URI and
 * Relative Forms" of [RFC2396](https://www.ietf.org/rfc/rfc2396.txt).
 *
 * The SDK will send beacons to this collector.
 */
@property (nonatomic, copy) NSString * ADEUM_NULLABLE collectorURL;

/**
 * The URL of the screenshot service. It should be compliant with "1.4. Hierarchical
 * URI and Relative Forms" of [RFC2396](https://www.ietf.org/rfc/rfc2396.txt).
 *
 * The SDK will send screenshot tiles to this service.
 */
@property (nonatomic, copy) NSString * ADEUM_NULLABLE screenshotURL;

/**
 * The URL of the  session replay service. It should be compliant with "1.4. Hierarchical URI and
 * Relative Forms" of [RFC2396](https://www.ietf.org/rfc/rfc2396.txt).
 *
 * The SDK will send video bolb to session replay service.
 */
@property (nonatomic, copy) NSString * ADEUM_NULLABLE sessionReplayURL;


/**
 * The Session replay rendering mode for the agent.
 * Default rendering mode is `ADEumNative`.
 * The Session replay offers two rendering modes to create session recordings. Each rendering mode renders the app screen in a different way.
 */
@property (nonatomic) ADEumRenderingMode renderingMode;

/**
 * The hostname used to determine whether the device is connected to the internet.
 *
 * In order to determine if a device is connected to the internet, the agent SDK
 * checks if a network route to the specific host is available. If that host is
 * not reachable, the device is marked as "offline".
 *
 * If the application has restrictions on the IP addresses it is allowed to freely
 * access, then this property should be used with a host the application can reach
 * that is expected to be available to ensure the connection type is accurate.
 *
 * The default hostname is www.google.com.
 */
@property (nonatomic, copy) NSString * ADEUM_NULLABLE reachabilityHostName;

/**
 * Boolean value that indicates whether logging is enabled.
 *
 * Default logging level is ADEumLoggingLevelError, setting this changes loggingLevel to:
 *
 * - `NO`/`false`: `ADEumLoggingLevelError` (the default)
 * - `YES`/`true`: `ADEumLoggingLevelAll`
 *
 * @warning Not recommended for production.
 * @deprecated Please use loggingLevel instead.
 * @warning **Backward Compatibility**: Setting this will overwrite the setting
 * in `loggingLevel`.
 *
 * For this reason it is recommended to use loggingLevel directly.
 */
@property (nonatomic) BOOL enableLogging __attribute__((deprecated("Please use loggingLevel instead")));

/**
 * The logging level for the agent.
 *
 * Default logging level is `ADEumLoggingLevelError`.
 *
 * @warning See enableLogging for information on how the two interact.
 * @warning Setting this beyond ADEumLoggingLevelError is not recommended for production.
 */
@property (nonatomic) ADEumLoggingLevel loggingLevel;


/**
 * Enable this key to view the console log messages in `Visual Studio Code`
 *
 * Default  value for this  is `NO`
 *
 * @warning Enabling this key while viewing log messages in Xcode will result in the printing of duplicate log messages.
 * @warning Enable this key only in DEBUG mode.
 */
@property (nonatomic) BOOL enableLoggingInVSCode;

/**
 * The custom collector channel, if used.
 *
 * This is only needed when customizing the communication channel between the SDK and the collector.
 * Most users will not need this.
 */
@property (nonatomic, strong) id<ADEumCollectorChannel> ADEUM_NULLABLE collectorChannel;

/**
 * The name of this mobile application, if used.
 *
 * If set, all data reported from this application is associated with the given application
 * name, and appears together in dashboards. If not set, the mobile application name is
 * determined automatically based on the identifier of the main application bundle.
 * Most users will not need this.
 *
 * @warning `applicationName` must not be an empty string, and must contain only
 * alphanumeric characters and periods in reverse-DNS format.
 */
@property (nonatomic, strong) NSString * ADEUM_NULLABLE applicationName;

/**
 * The url regex patterns for excluding url request tracking, if used
 *
 * If set, any url matching one of defined patterns won't be tracked.
 */
@property (nonatomic, strong) NSSet * ADEUM_NULLABLE excludedUrlPatterns;

/**
 * The agent supports the use of a "callback" to send notifications of
 * crashes being reported. You can use this callback to get these reports.
 *
 * @see ADEumCrashReportCallback
 *
 */
@property (nonatomic, weak) id<ADEumCrashReportCallback> ADEUM_NULLABLE crashReportCallback;

/**
 * Bitmask value that indicates what types of user interaction events should be captured.
 * The default value is ADEumInteractionCaptureModeNone which means no interactions are captured.
 *
 * @warning Using ADEumInteractionCaptureModeAll means that all currently known and to-be implemented
 * interactions are captured. This could conceivably include personal user information. If you have any
 * concerns around this, we recommend turning on only the interactions you want captured by using the
 * individual specific constants.
 *
 */
@property (nonatomic) ADEumInteractionCaptureMode interactionCaptureMode;

/**
 * Boolean value that indicates if automatic instrumentation is enabled. The default is YES.
 */
@property (nonatomic) BOOL enableAutoInstrument;

/**
 * Boolean value that enables or disables the screenshots.
 *
 * Default is enabled
 *
 * This must be `YES` in order for any of the other screenshot
 * methods to be used, either in the app or via the controller.
 *
 * Recommended for most applications to leave this option enabled, and control the screenshots
 * from the controller configuration page.
 */
@property (nonatomic) BOOL screenshotsEnabled;


/**
 * Boolean value that enables or disables the  session replay.
 *
 * Default is enabled
 *
 *
 * Recommended for most applications to leave this option enabled, and control the session replay
 * from the controller configuration page.
 */
@property (nonatomic) BOOL sessionReplayEnabled;

/**
 * Boolean value that enables or disables JS Agent instrumentation of WKWebViews.
 *
 * Default is enabled
 *
 * Recommended for most applications to leave this option enabled.
 */
@property (nonatomic) BOOL jsAgentEnabled;

/**
 * Boolean value that enables or disables JS Agent collection of WKWebView Ajax activity
 *
 * Default is disabled
 *
 */
@property (nonatomic) BOOL jsAgentAjaxEnabled;

/**
 * Boolean value that enables or disables JS Agent Fetch flag
 *
 * Default is enabled
 *
 */
@property (nonatomic) BOOL jsAgentFetchEnabled;

/**
 * Boolean value that enables or disables JS Agent ZonePromise flag
 *
 * Default is enabled
 *
 */
@property (nonatomic) BOOL jsAgentZonePromiseEnabled;

/**
 * Boolean value that enables the sending of TraceID, housed in a
 *
 * Default is disabled
 *
 * Enabiling this flag we cause a TraceID and SpanID to be generated
 * and added to a traceparent header, in turn added to each network
 * request.   No further processing occurs with the TraceID and it's value
 * is not available in our UI
 *
 * Recommended for most applications to leave this option disabled.
 */
@property (nonatomic) BOOL traceparentHeaderEnabled;


/**
 * The agent becomes disabled after three unsuccessful attempts to send beacons, where each attempt occurs after a delay.
 * The failure count resets after a successful attempt or upon relaunching the app.
 *
 * Default is 3 attempts.
 *
 * Recommended for most applications to leave this option 3 attempts.
 *
 * Changing the `numberOfRetryAttempts` updates retry attempts. If it's set to negative value, we keep trying without any limit.
 */
@property (nonatomic) int numberOfRetryAttempts;

/**
 * Boolean value that enables or disables the ANR Detection system.
 *
 * Default is disabled
 *
 * Recommended for most applications to leave this option disabled.
 * Enable it in applications that use the the standard iOS user interface components.
 */
@property (nonatomic) BOOL anrDetectionEnabled;

/**
 * Boolean value that enables or disables the sending of stack traces during an ANR event.
 *
 * Default is disabled
 *
 * Recommended for most applications to leave this option disabled.
 */
@property (nonatomic) BOOL anrStackTraceEnabled;

/**
 * Boolean value that enables, or disables, the Crash Reporter feature
 *
 * Default is enabled
 *
 * Most applications should leave this feature enabled.  Disable it if you are
 * using a different crash reporting tool and conflicts are occuring.
 */
@property (nonatomic) BOOL crashReportingEnabled;

/**
 * Integer value specifying the interval between periodic beacon flushes to the network.
 *
 * Default is 60 seconds
 *
 * Most applications should not change this value. The value should be no less
 * than 1 second. Depending on what other code paths are executed which may also
 * initiate flushes other than the periodic beacon flush this value governs,
 * values higher than the default may result in a corresponding delay in beacons
 * reaching the collector.
 */
@property (nonatomic) int flushInterval;

/**
 * The agent supports the use of a "callback" to modify or redact URL components
 * prior to sending the beacon to the collector.
 *
 * @see ADEumNetworkRequestCallback
 *
 */
@property (nonatomic, weak) id<ADEumNetworkRequestCallback> ADEUM_NULLABLE networkRequestCallback;

/**
 * An optional data compressor conforming to the `ADEumDataCompressor` protocol.
 *
 * This compressor, when provided, is used to compress outgoing data payloads
 * before transmission. If no compressor is assigned, data will be
 * sent or handled in its default form.
 */
@property (nonatomic, weak) id<ADEumDataCompressor> ADEUM_NULLABLE dataCompressor;
/**
 * Returns a configuration with the specified app key and defaults for the other properties.
 *
 * @param appKey The application key to use.
 */
- (id)initWithAppKey:(NSString *)appKey;

/**
 * Returns a configuration with the specified app key and collector URL,
 * and defaults for the other properties.
 *
 * @param appKey The application key to use.
 * @param collectorURL The URL of the collector.
 *
 * @warning This method is for use in on premise installations only.
 *
 */
- (id)initWithAppKey:(NSString *)appKey collectorURL:(NSString * ADEUM_NULLABLE)collectorURL;

@end

/** AppDynamics iOS SDK
 */
@interface ADEumInstrumentation : NSObject

///---------------------
/// @name Initialization
///---------------------

/**
 * Initializes the SDK.
 *
 * This method should be called once, early in your application's startup sequence.
 *
 * @param appKey The application key.
 *
 * @warning `appKey` must not be `nil`.
 */
+ (void)initWithKey:(NSString *)appKey;

/**
 * Initializes the SDK.
 *
 * This method should be called once, early in your application's startup sequence.
 *
 * @param appKey The application key.
 * @param collectorUrl The URL of the collector. The SDK will send beacons to this collector.
 *
 * @warning `appKey` must not be `nil`.
 * @warning `collectorUrl` must not be `nil`. Otherwise, an NSInvalidArgumentException will be thrown.
 */
+ (void)initWithKey:(NSString *)appKey collectorUrl:(NSString *)collectorUrl;

/**
 * Initializes the SDK.
 *
 * This method should be called once, early in your application's startup sequence.
 *
 * @param agentConfiguration The configuration to use.
 *
 * @warning `agentConfiguration` must not be `nil`. Otherwise, an NSException will be thrown.
 */
+ (void)initWithConfiguration:(ADEumAgentConfiguration *)agentConfiguration;

/* Private, do not use. */
+ (void)initWithConfiguration:(ADEumAgentConfiguration *)agentConfiguration a:(NSString *)a b:(NSString *)b;

/**
 * Changes the application key.
 *
 * The SDK doesn't send all instrumentation data immediately, and calling this method causes all unsent
 * data to be discarded. Use this method sparingly.
 *
 * @param appKey The new application's key.
 *
 * @warning `appKey` must not be `nil`. Otherwise, an NSException will be thrown.
 */
+ (void)changeAppKey:(NSString *)appKey;

///---------------------
/// @name Instrumenting application methods
///---------------------

/**
 * Call this method at the beginning of a method's execution to track that method invocation.
 *
 * @param receiver The object to which this message was sent.
 * @param selector The selector describing the message that was sent.
 * @param arguments The values of the arguments of this method call. This parameter is optional and may be `nil`.
 *                   Additionally, you are free to send only a subset of the actual arguments.
 *
 * @return An object that must be passed to `endCall:`.
 *
 * @warning `receiver` must not be `nil`.
 * @warning `selector` must not be `nil`.
 *
 * @see +endCall:
 * @see +endCall:withValue:
 */
+ (id ADEUM_NULLABLE)beginCall:(id)receiver selector:(SEL)selector withArguments:(NSArray * ADEUM_NULLABLE)arguments;

/**
 * Call this method at the beginning of a method's execution to track that method invocation.
 *
 * Equivalent to `beginCall:receiver selector:selector arguments:nil`.
 *
 * @param receiver The object to which this message was sent.
 * @param selector The selector describing the message that was sent.
 *
 * @return An object that must be passed to `endCall:`.
 *
 * @see +beginCall:selector:withArguments:
 */
+ (id ADEUM_NULLABLE)beginCall:(id)receiver selector:(SEL)selector;

/**
 * Call this method at the beginning of a method's execution to track that method invocation.
 *
 * This method is useful for tracking execution of methods originating from non-iOS systems where
 * 'receiver' & 'selector' are not defined. Otherwise its function is similar to
 * `beginCall:receiver selector:selector arguments:arguments`.
 *
 * @param className String identifing the class of the object containing the method to be tracked.
 * @param methodName String identifing the method to be tracked.
 * @param arguments The values of the arguments of this method call. This parameter is optional and may be `nil`.
 *                   Additionally, you are free to send only a subset of the actual arguments.
 *
 * @return An object that must be passed to `endCall:`.
 *
 * Note:
 * @warning `className` must not be `nil`.
 * @warning `methodName` must not be `nil`.
 *
 * @see +endCall:
 * @see +endCall:withValue:
 */
+ (id)beginCall:(NSString *)className methodName:(NSString *)methodName withArguments:(NSArray *)arguments;

/**
 * Call this method right before returning from a method to finish tracking the method invocation.
 *
 * @param call The object returned from `beginCall:Selector:withArguments:`.
 * @param returnValue The return value of the method. This is optional, and may be `nil`.
 */
+ (void)endCall:(id ADEUM_NULLABLE)call withValue:(id ADEUM_NULLABLE)returnValue;

/**
 * Call this method right before returning from a method to finish tracking the method invocation.
 *
 * Equivalent to `endCall:call withValue:nil`.
 *
 * @param call The object returned from `beginCall:Selector:withArguments:`.
 *
 * @see +endCall:withValue:
 */
+ (void)endCall:(id ADEUM_NULLABLE)call;

///---------------------
/// @name Timing events
///---------------------

/**
 * Starts a timer for tracking a user-defined event with a duration.
 *
 * If this method is called multiple times without a corresponding call to stopTimerWithName,
 * every call after the first will reset the timer.
 *
 * Timer name should contain only alphanumeric characters and spaces.
 * Illegal characters shall be replaced by their ASCII hex value.
 *
 * @param name The name of the timer, which will determine the name of the corresponding metric.
 *             Generally, timers that are logically separate should have distinct names.
 *
 * @warning pre-4.3 agents threw NSException on illegal characters.
 */
+ (void)startTimerWithName:(NSString * ADEUM_NULLABLE)name;

/**
 * Stops a timer for tracking a user-defined event with a duration.
 *
 * If you haven't called startTimerWithName with the given name before calling this method, this method has no effect.
 *
 * Timer name should contain only alphanumeric characters and spaces.
 * Illegal characters shall be replaced by their ASCII hex value.
 *
 * @param name The name of the timer, which will determine the name of the corresponding metric.
 *              Generally, timers that are logically separate should have distinct names.
 *
 * @warning pre-4.3 agents threw NSException on illegal characters.
 */
+ (void)stopTimerWithName:(NSString * ADEUM_NULLABLE)name;

///---------------------
/// @name Reporting metrics
///---------------------

/**
 * Reports the value of a custom metric.
 *
 * Metric name should contain only alphanumeric characters and spaces.
 * Illegal characters shall be replaced by their ASCII hex value.
 *
 * @param name The name of the metric.
 * @param value The value of the metric.
 *
 * @warning pre-4.3 agents threw NSException on illegal characters.
 */
+ (void)reportMetricWithName:(NSString * ADEUM_NULLABLE)name value:(int64_t)value;


///---------------------
/// @name Breadcrumbs tracking for crash reports
///---------------------

/**
 * Records the value of breadcrumb and assigns it a current timestamp.
 *
 * Call this method when something interesting happens in your application.
 * If your application crashes at some point in the future, the breadcrumb
 * will be included in the crash report, to help you understand the problem.
 * Each crash report displays the most recent 99 breadcrumbs.
 *
 * @param breadcrumb The value of breadcrumb.
 *
 * @warning The breadcrumb will not be recorded if it is `nil` or the empty string.
 *           The breadcrumb will be truncated if it is longer than 2048 characters.
 */
+ (void)leaveBreadcrumb:(NSString * ADEUM_NULLABLE)breadcrumb;

/**
 * Records the value of breadcrumb and assigns it a current timestamp.
 *
 * Call this method when something interesting happens in your application.
 * The breadcrumb will be included in different reports depending on the 'mode'.
 * Each crash report displays the most recent 99 breadcrumbs.
 *
 * @param breadcrumb The value of breadcrumb.
 * @param mode The visibility mode, which is either `ADEumBreadcrumbVisibilityCrashesOnly` or
 *        `ADEumBreadcrumbVisibilityCrashesAndSessions`.
 *
 * @warning The breadcrumb will not be recorded if it is `nil` or the empty string.
 *           The breadcrumb will be truncated if it is longer than 2048 characters.
 * @warning `mode` must be either `ADEumBreadcrumbVisibilityCrashesOnly` or
 *          `ADEumBreadcrumbVisibilityCrashesAndSessions`.
 *           If an invalid value is provided, it will default to `ADEumBreadcrumbVisibilityCrashesOnly`.
 */
+ (void)leaveBreadcrumb:(NSString * ADEUM_NULLABLE)breadcrumb mode:(ADEumBreadcrumbVisibility)mode;


/// Sets explicit element sensitivity for the specified <code>UIView</code> instance.
/// Assigning <code>nil</code> removes previously assigned explicit sensitivity.
/// \param view A view instance to set the sensitivity.
///
/// \param isSensitive The explicit view sensitivity.
/// Set <code>@YES</code> to flag the view instance as explicitly sensitive.
/// Set <code>@NO</code> to flag the view instance as explicitly non-sensitive.
/// Set <code>nil</code> to let the view instance sensitivity being derived from its class.
+ (void)setViewInstanceSensitivityWithView:(UIView * _Nonnull)view isSensitive:(NSNumber * _Nullable)isSensitive;

/// Retrieves element sensitivity for the specified <code>UIView</code> instance.
/// The method returns the view sensitivity as it is used by the Session Replay module.
/// The sensitivity is calculated as a combination of the explicitly set sensitivity of the view instance
/// and the sensitivity derived from the view’s class sensitivity.
/// \param view A view instance.
///
///
/// returns:
/// A <code>NSNumber</code> which bool value returns the given view sensitivity.
+ (NSNumber * _Nullable)viewInstanceSensitivityWithView:(UIView * _Nonnull)view SWIFT_WARN_UNUSED_RESULT;

/// Sets explicit sensitivity for the specified <code>UIView</code> class.
/// Assigning <code>nil</code> removes previously assigned explicit sensitivity.
/// \param viewClass A view class to set the sensitivity.
///
/// \param isSensitive The explicit class sensitivity.
/// Set <code>@YES</code> to flag the view class as explicitly sensitive.
/// Set <code>@NO</code> to flag the view class as explicitly non-sensitive.
/// Set <code>nil</code> to let the view class sensitivity being derived from its parent class.
+ (void)setViewClassSensitivityWithViewClass:(SWIFT_METATYPE(UIView) _Nonnull)viewClass isSensitive:(NSNumber * _Nullable)isSensitive;

/// Retrieves sensitivity for the specified <code>UIView</code> class.
/// The method returns the view class sensitivity as it is used by the Session Replay module.
/// The sensitivity is calculated as a combination of the explicitly set sensitivity of the view class
/// and the sensitivity derived from the view class parents sensitivity.
/// \param viewClass A view class.
///
///
/// returns:
/// A <code>NSNumber</code> which bool value returns the given view sensitivity.
+ (NSNumber * _Nullable)viewClassSensitivityWithViewClass:(SWIFT_METATYPE(UIView) _Nonnull)viewClass SWIFT_WARN_UNUSED_RESULT;


/// Covers area that will not be recorded with `coveringRect`, Covering masks can be partially erased if at least partially covered by erasing masks on higher layers.
///  Erases the lower layers of the mask `erasingRect`
+ (void)sensitivityCoveringRectElements:(NSArray<ADEumMaskElement *> * _Nonnull)elements;

///---------------------
/// @name UserData tracking
///---------------------

/**
 * Sets the value of the specified key to the specified string value.
 *
 * ### Notes
 *
 * - All UserData interfaces are type specific and maintain a separate
 *   `key` name space. This means that both
 *   +setUserDataBoolean:value: and
 *   +setUserDataLong:value: can use a `key` of `@"foo"`.
 *
 * - UserData can be used to relay any information available to the
 *   programmer.
 *
 * - The keys for this method are global and must be unique across your
 *   application. Re-using the same key for the same UserData type overwrites the
 *   previous value.
 *
 * @param key The key with which to associate with the value.
 * @param value The non-nil NSString value to store.
 *
 * @warning Both the key and the value will if be truncated if they are longer than 2048 characters.
 */
+ (void)setUserData:(NSString * ADEUM_NULLABLE)key value:(NSString *)value;

/**
 * Removes the NSString value associated with `key`.
 *
 * @param key The key whose value you want to remove.
 */
+ (void)removeUserData:(NSString * ADEUM_NULLABLE)key;

/**
 * Sets the value of the specified key to the specified signed 64-bit integer value.
 *
 * @param key The key with which to associate with the value.
 * @param value Signed 64-bit integer value to store.
 */
+ (void)setUserDataLong:(NSString * ADEUM_NULLABLE)key value:(int64_t)value;

/**
 * Removes the signed 64-bit data value associated with `key`.
 *
 * @param key The key whose value you want to remove.
 */
+ (void)removeUserDataLong:(NSString * ADEUM_NULLABLE)key;

/**
 * Sets the value of the specified key to the specified Boolean value.
 *
 * @param key The key with which to associate with the value.
 * @param value The boolean value to store.
 */
+ (void)setUserDataBoolean:(NSString * ADEUM_NULLABLE)key value:(BOOL)value;

/**
 * Removes the boolean data value associated with `key`.
 *
 * @param key The key whose value you want to remove.
 */
+ (void)removeUserDataBoolean:(NSString * ADEUM_NULLABLE)key;

/**
 * Sets the value of the specified key to the specified double value.
 *
 * @param key The key with which to associate with the value.
 * @param value The double value to store.
 *              The value has to be a finite real number.
 *              The use of `NAN`, `+INF` or `-INF` may lead to undefined behavior.
 */
+ (void)setUserDataDouble:(NSString * ADEUM_NULLABLE)key value:(double)value;

/**
 * Removes the double data value associated with `key`.
 *
 * @param key The key whose value you want to remove.
 */
+ (void)removeUserDataDouble:(NSString * ADEUM_NULLABLE)key;

/**
 * Sets the value of the specified key to the specified NSDate object.
 *
 * ### Note
 *
 * The Date value will be stored as a signed 64-bit integer representing
 * milliseconds since 1970 (epoch time) UTC.
 *
 * @param key The key with which to associate with the value.
 * @param value The non-nil NSDate object to store.
 */
+ (void)setUserDataDate:(NSString * ADEUM_NULLABLE)key
                  value:(NSDate *)value;

/**
 * Removes the Date data value associated with `key`.
 *
 * @param key The key whose value you want to remove.
 */
+ (void)removeUserDataDate:(NSString * ADEUM_NULLABLE)key;

/**
 * Clear all user data for all keys.
 *
 * This operates on the user data set using any of the +setUserData[<type>]:value: methods
 * discussed above.
 *
 * All currently set data is cleared, so that any subsequently created instrumentation beacons
 * for events from this point forward will not have the data attached to them.
 *
 * However, any previously created instrumentation beacons that were already queued for
 * sending to the collector are not included, and their user data is not affected.
 */
+ (void)clearAllUserData;

///---------------------
/// @name Screenshot Support
///---------------------

/**
 * Takes a screenshot of the current app's window.
 *
 * If screenshots are disabled through screenshotsEnabled or through the controller
 * UI, then this method does nothing.
 * This will capture everything, including personal information, so you must be cautious
 * of when to take the screenshot.
 * These screenshots will show up in the Sessions screen for this user.
 * The screenshots are taken on the main application thread as soon as safe to do so.
 * The screenshots are compressed, and only non-redundant parts are uploaded, so
 * it is safe to take many of these without impacting performance of your application.
 */
+ (void)takeScreenshot;

/**
 * Unblocks screenshot capture if it is currently blocked. Otherwise, this has no effect.
 *
 * If screenshots are disabled through ADEumMAgentConfiguration.screenshotsEnabled
 * or through the controller UI, this method has no effect.
 *
 * If screenshots are set to manual mode in the controller UI, this method unblocks for
 * manual mode only.
 *
 * **WARNING:** This will unblock capture for the entire app.
 *
 * The user is expected to manage any possible nesting issues that may
 * occur if blocking and unblocking occur in different code paths.
 *
 */
+ (void)unblockScreenshots;

/**
 * Blocks screenshot capture if it is currently unblocked. Otherwise, this has no effect.
 *
 * If screenshots are disabled through ADEumMAgentConfiguration.screenshotsEnabled
 * or through the controller UI, this method has no effect.
 *
 * **WARNING:**  This will block capture for the entire app.
 *
 * The user is expected to manage any possible nesting issues that may
 * occur if blocking and unblocking occur in different code paths.
 *
 */
+ (void)blockScreenshots;

/**
 *  @return whether screenshot capture is blocked
 */
+ (BOOL)screenshotsBlocked;

///----------------------
/// @name Session Frame Support
///----------------------

/**
 * Starts a Session Frame
 *
 * @param name This is the name for the Session Frame that will appear in the UI.
 *
 * @return An ADEumSessionFrame object is returned which should be retained for further
 * operations.
 *
 * @since 50.1  
 */
+ (ADEumSessionFrame *)startSessionFrame:(NSString *)name;

///----------------------
/// @name NSError Reporting
///----------------------

/**
 * Report an error
 *
 * Creates an error report, with the contents of the passed in NSError object as
 * well as a stack trace of the current machine state.
 *
 * Default severity level `ADEumErrorSeverityLevelWarning` will be used.
 *
 * @param error Standard iOS NSError object.  If nil, no report is made
 *
 * @deprecated Report error without explicitly passing severity is deprecated. Use reportError:withSeverity: instead.
 */
+ (void)reportError:(NSError *)error __attribute__((deprecated("Please use reportError:withSeverity: instead")));

/**
 * Report an error
 *
 * Creates an error report, with the contents of the passed in NSError object as
 * well as an optional stack trace of the current machine state, also with error severity level defined.
 *
 * Valid severity levels are:
 *
 * - `ADEumErrorSeverityLevelInfo`
 * - `ADEumErrorSeverityLevelWarning`
 * - `ADEumErrorSeverityLevelCritical`
 *
 * @param error Standard iOS NSError object.  If nil, no report is made
 * @param severity The error severity level.
 * @param stacktrace YES to indicate that a stack trace should be included, otherwise NO.
 *
 * @warning If an invalid `severity` value is provided, it will default to `ADEumErrorSeverityLevelWarning`.
 *
 * @warning Values passed in `error.userInfo` which cannot be serialized to JSON will be removed and list of this items will be added as `NonSerializableKeys`.
 */
+ (void)reportError:(NSError *)error withSeverity:(ADEumErrorSeverityLevel)severity andStackTrace:(BOOL)stacktrace;


/**
 * Report a hybrid error
 *
 * Creates an error report, with the JSON encoded data in string format also with error severity level defined.
 *
 * This is an internal interface and subject to change without notice.
 *
 * Valid severity levels are:
 *
 * - `ADEumErrorSeverityLevelInfo`
 * - `ADEumErrorSeverityLevelWarning`
 * - `ADEumErrorSeverityLevelCritical`
 *
 * @param hybridExceptionData JSON encoded data, in NSString format
 * @param severity The error severity level.
 *
 * @warning If an invalid `severity` value is provided, it will default to `ADEumErrorSeverityLevelWarning`.
 *
 * @warning Method to be used only by hybrid agents.  Not for general use.
 */
+ (void)reportRawError:(NSString *)hybridExceptionData withSeverity:(ADEumErrorSeverityLevel)severity;

/**
 * Report an error
 *
 * Creates an error report, with the contents of the passed in NSError object as
 * well as a stack trace of the current machine state, also with error severity level defined.
 *
 * Valid severity levels are:
 *
 * - `ADEumErrorSeverityLevelInfo`
 * - `ADEumErrorSeverityLevelWarning`
 * - `ADEumErrorSeverityLevelCritical`
 *
 * @param error Standard iOS NSError object.  If nil, no report is made
 * @param severity The error severity level.
 *
 * @warning If an invalid `severity` value is provided, it will default to `ADEumErrorSeverityLevelWarning`.
 *
 * @warning Values passed in `error.userInfo` which cannot be serialized to JSON will be removed and list of this items will be added as `NonSerializableKeys`.
 */
+ (void)reportError:(NSError *)error withSeverity:(ADEumErrorSeverityLevel)severity;

/**
 * Creates a crash report of the given crash dump. This crash report will be reported 
 * to collector when application restarts.
 *
 * This is an internal interface and subject to change without notice.
 *
 * @param crashDump Json string of the crash dump.
 * @param type Crash report type, only "clrCrashReport" is supported for now.
 *
 * @return status, 0 means no error.
 */
+ (int)createCrashReport:(NSString *)crashDump
                     type:(NSString *)type;

/**
 * Creates a raw crash report of the given hybrid exception data.
 *
 * This is an internal interface and subject to change without notice.
 *
 * @param hybridExceptionData Json string of the exception.
 *
 * @return status, 0 means no error.
 */
+ (int)createRawCrashReport:(NSString *)hybridExceptionData;

/**
 * Starts next session and ends the current session.
 * The session started using this API may be ended by inactivity timeout set in
 * the Application Configuration, before the next call to this API.
 * This API makes some practical assumptions about session lengths among end users.
 * Excessive use of this API will cause sessions to be throttled (excessive use
 * is >10 calls per minute per agent, subject to change)
 */
+ (void)startNextSession;

/**
 * Stops the sending of beacons to the collector.
 * No data will come from this agent while shut down.  All other
 * activities of the agent continue, just the sending of data is disabled.
 */
+ (void)shutdownAgent;

/**
 * Restarts the sending of beacons to the collector.
 * Data will start flowing from the agent immediately.  No change will
 * occur if the shutdownAgent call and not been made.
 */
+ (void)restartAgent;


/**
 * Generates a unique identifier for the agent and stores it in persistent storage.
 * If an identifier already exists, it retrieves and returns the stored value.
 *
 * @return A string representing the unique agent identifier.
 */
  + (NSString *)agentIdentifier;

/**
 * When passed an object derived from ADEumBaseWrapper,
 * such as ADEumURLSessionDelegate or ADEumURLSession, it will
 * return the original object prior to wrapping.  This is usually
 * used when the original object was extended is some way prior to
 * the call and was modified during the call.
 *
 * @warning It is imperative that you only use this API for URLSession
 * and URLSessionDelegate objects from within completion blocks or
 * delegate calbacks.  Behavior is unsupported in any other use case
 * and may cause a crash.  Please contact AppDynamics support if you
 * are unclear on use of this API.
 *
 * @warning This API call should only be used in instances where you
 * need to access the underlying object that was modified during the
 * call.
 *
 * @param wrappedObject The wrapped object in question.
 *
 * @return Original object in its original type if the object passed in
 * was wrapped. Returns nil otherwise.
 */
+ (id)fetchOriginalSessionObjectFrom:(id ADEUM_NULLABLE)wrappedObject;

// Undocumented API calls for hybrid agents.  For AppDynamics interal use only.
+ (BOOL)TrackPageStart:(NSString *)pageName
                  uuid:(NSUUID *)uuid
                 start:(NSDate *)startTime;
+ (BOOL)TrackPageEnd:(NSString *)pageName
                uuid:(NSUUID *)uuid
               start:(NSDate *)startTime
                 end:(NSDate *)endTime;
+ (BOOL)TrackUIEvent:(NSString *)rootViewController
                name:(NSString *)eventName
               class:(NSString *)uiClass
           startTime:(NSDate *)startTime
               label:(NSString *)uiLabel
       accessibility:(NSString *)uiAccessibilityLabel
                 tag:(int)uiTag
               index:(NSString *)index
         uiResponder:(NSString *)uiResponder;

// Undocumented methods, useful for debugging. These are subject to change in future releases.
+ (void)initWithKey:(NSString *)appKey
      enableLogging:(BOOL)enableLogging __attribute__((deprecated("Please use ADEumAgentConfiguration instead")));

+ (void)initWithKey:(NSString *)appKey
       collectorUrl:(NSString * ADEUM_NULLABLE)collectorUrl
      enableLogging:(bool)enableLogging __attribute__((deprecated("Please use ADEumAgentConfiguration instead")));
+ (NSInteger)sessionCounter;

@end

ADEUM_ASSUME_NONNULL_END
