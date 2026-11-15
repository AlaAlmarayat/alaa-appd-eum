# AppDynamics Cordova Plugin

This AppDynamics plugin installs both EUM mobile and RUM browser monitoring in Cordova based applications. EUM mobile monitoring tracks activities in native Android & iOS layer while the RUM browser monitoring tracks activities in the base Cordova WebView.

The plugin provides an JavaScript API allowing configuration and customizaiton of events to be monitored. This includes APIs to instrument specific methods in your own code, to measure durations of operations in your application (like application start up, for example), or to report an arbitrary metric. The SDK also provides a facility to track any application crashes that occur.

The plugin will automatically detect and instrument HTTP requests originating from both native network activity as well as those internal to embedded WebViews.

### Supported Platforms

* `Cordova` version 7.0 and up

### Installation for Ionic platform

```
ionic cordova plugin add appd-plugin-eum-mobile --save
```
### License

Your Use Rights in the Splunk AppDynamics Cordova Plugin ("Plugin") are limited to your use solely in connection with the applicable Cisco Offer and subject to the same terms and conditions for that Cisco Offer, which may include but are not limited to the [Cisco General Terms](https://www.cisco.com/site/us/en/about/legal/contract-experience/index.html) and the applicable offer description(s) ("Agreement"). Despite anything to the contrary in the Agreement, and unless otherwise required by law, the Plugin are provided **“AS-IS”** without any indemnification or warranties. Support and service levels for the Plugin are as set out in the Agreement. Capitalized terms herein shall have the same meaning as set out in the Agreement.

### More Info

[`JSDocs`](https://sdkdocs.appdynamics.com/javadocs/cordova-plugin/1/latest/ADEUMMobilePlugin.html )

Copyright (c) Splunk AppDynamics, Inc. 2025 CA. All rights reserved.

