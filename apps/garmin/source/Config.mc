import Toybox.Application;
import Toybox.Application.Properties;
import Toybox.Application.Storage;
import Toybox.Communications;
import Toybox.Lang;
import Toybox.WatchUi;

module Config {
    typedef WatchType as Array<Number or String>;
    typedef ResponseHandler as Method(responseCode as Number, data as Dictionary or String or Null) as Void;

    const TYPES_KEY = "types";
    const CONFIG_PATH = "/garmin-watch/config";

    function loadTypes() as Array<WatchType> {
        var stored = Storage.getValue(TYPES_KEY);
        if (stored instanceof Array) {
            return stored as Array<WatchType>;
        }
        return [] as Array<WatchType>;
    }

    function findType(code as Number) as WatchType? {
        var types = loadTypes();
        for (var i = 0; i < types.size(); i++) {
            if (typeCode(types[i]) == code) {
                return types[i];
            }
        }
        return null;
    }

    function typeCode(entry as WatchType) as Number {
        return entry[0] as Number;
    }

    function typeName(entry as WatchType) as String {
        return entry[1] as String;
    }

    function typeSport(entry as WatchType) as Number {
        return entry[2] as Number;
    }

    function typeSubSport(entry as WatchType) as Number {
        return entry[3] as Number;
    }

    function stringProperty(key as String) as String {
        var value = Properties.getValue(key);
        if (value instanceof String) {
            return value;
        }
        return "";
    }

    function configUrl() as String? {
        var base = stringProperty("api_url");
        while (base.length() > 0 && "/".equals(base.substring(base.length() - 1, null))) {
            base = base.substring(0, base.length() - 1) as String;
        }
        return base.length() > 0 ? base + CONFIG_PATH : null;
    }

    function isConfigured() as Boolean {
        return configUrl() != null && stringProperty("api_token").length() > 0;
    }

    function fetch(handler as ResponseHandler) as Void {
        var url = configUrl();
        if (url == null) {
            return;
        }
        Communications.makeWebRequest(
            url,
            null,
            {
                :method => Communications.HTTP_REQUEST_METHOD_GET,
                :headers => { "Authorization" => "Bearer " + stringProperty("api_token") },
                :responseType => Communications.HTTP_RESPONSE_CONTENT_TYPE_JSON
            },
            handler
        );
    }

    function parseType(raw as Object?) as WatchType? {
        if (!(raw instanceof Dictionary)) {
            return null;
        }
        var code = raw["code"];
        var name = raw["session_name"];
        var sport = raw["fit_sport"];
        var subSport = raw["fit_sub_sport"];
        if (code instanceof Number && name instanceof String && sport instanceof Number && subSport instanceof Number) {
            return [code, name, sport, subSport] as WatchType;
        }
        return null;
    }

    function handleResponse(responseCode as Number, data as Dictionary or String or Null) as String? {
        if (responseCode == 200 && data instanceof Dictionary) {
            var raw = data["types"];
            if (raw instanceof Array) {
                var types = [] as Array<WatchType>;
                for (var i = 0; i < raw.size(); i++) {
                    var entry = parseType(raw[i] as Object?);
                    if (entry != null) {
                        types.add(entry);
                    }
                }
                Storage.setValue(TYPES_KEY, types as Array<Storage.ValueType>);
                return types.size() > 0 ? null : loadString(Rez.Strings.NoTypes);
            }
            return loadString(Rez.Strings.BadResponse);
        }
        return errorMessage(responseCode);
    }

    function errorMessage(responseCode as Number) as String {
        if (responseCode == 401) {
            return loadString(Rez.Strings.BadToken);
        }
        if (responseCode == Communications.BLE_CONNECTION_UNAVAILABLE || responseCode == Communications.BLE_HOST_TIMEOUT) {
            return loadString(Rez.Strings.PhoneNotConnected);
        }
        if (responseCode == Communications.NETWORK_RESPONSE_TOO_LARGE) {
            return loadString(Rez.Strings.TooManyTypes);
        }
        return loadString(Rez.Strings.RequestFailed) + " (" + responseCode + ")";
    }

    function loadString(id as ResourceId) as String {
        return WatchUi.loadResource(id) as String;
    }
}
