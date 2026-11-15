cordova.define('cordova/plugin_list', function(require, exports, module) {
  module.exports = [
    {
      "id": "appd-plugin-eum-mobile.ADEUMMobilePlugin",
      "file": "plugins/appd-plugin-eum-mobile/www/ADEUMMobilePlugin.js",
      "pluginId": "appd-plugin-eum-mobile",
      "clobbers": [
        "ADEUMMobilePlugin"
      ]
    }
  ];
  module.exports.metadata = {
    "appd-plugin-eum-mobile": "1.0.0"
  };
});