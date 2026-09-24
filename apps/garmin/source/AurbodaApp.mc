import Toybox.Application;
import Toybox.Lang;
import Toybox.WatchUi;

class AurbodaApp extends Application.AppBase {
    function initialize() {
        AppBase.initialize();
    }

    function onStop(state as Dictionary?) as Void {
        if (Recorder.isActive()) {
            Recorder.save();
        }
    }

    function getInitialView() as [Views] or [Views, InputDelegates] {
        if (Config.loadTypes().size() > 0) {
            if (Config.isConfigured()) {
                Config.fetch(method(:onRefresh));
            }
            return [new TypeMenu(), new TypeMenuDelegate()];
        }
        var view = new StatusView();
        return [view, new StatusDelegate(view)];
    }

    function onRefresh(responseCode as Number, data as Dictionary or String or Null) as Void {
        var before = Config.loadTypes().toString();
        Config.handleResponse(responseCode, data);
        var types = Config.loadTypes();
        if (Recorder.isActive() || before.equals(types.toString())) {
            return;
        }
        if (types.size() > 0) {
            switchToTypeMenu(WatchUi.SLIDE_IMMEDIATE);
        } else {
            switchToStatus(WatchUi.SLIDE_IMMEDIATE);
        }
    }

    function onSettingsChanged() as Void {
        if (!Recorder.isActive()) {
            switchToStatus(WatchUi.SLIDE_IMMEDIATE);
        }
    }
}
