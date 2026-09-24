import Toybox.Graphics;
import Toybox.Lang;
import Toybox.WatchUi;

function switchToStatus(transition as WatchUi.SlideType) as Void {
    var view = new StatusView();
    WatchUi.switchToView(view, new StatusDelegate(view), transition);
}

class StatusView extends WatchUi.View {
    private var _message as String = "";
    private var _visible as Boolean = false;

    function initialize() {
        View.initialize();
        fetch();
    }

    function fetch() as Void {
        if (!Config.isConfigured()) {
            _message = Config.loadString(Rez.Strings.NotConfigured);
        } else {
            _message = Config.loadString(Rez.Strings.Fetching);
            Config.fetch(method(:onResponse));
        }
        WatchUi.requestUpdate();
    }

    function onResponse(responseCode as Number, data as Dictionary or String or Null) as Void {
        var error = Config.handleResponse(responseCode, data);
        if (error == null) {
            if (_visible) {
                switchToTypeMenu(WatchUi.SLIDE_LEFT);
            }
            return;
        }
        _message = error + "\n" + Config.loadString(Rez.Strings.RetryHint);
        WatchUi.requestUpdate();
    }

    function onShow() as Void {
        _visible = true;
    }

    function onHide() as Void {
        _visible = false;
    }

    function onUpdate(dc as Dc) as Void {
        dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_BLACK);
        dc.clear();
        var width = dc.getWidth();
        var height = dc.getHeight();
        var text = Graphics.fitTextToArea(_message, Graphics.FONT_SMALL, width * 0.8, height * 0.7, true);
        dc.drawText(
            width / 2,
            height / 2,
            Graphics.FONT_SMALL,
            text != null ? text : _message,
            Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER
        );
    }
}

class StatusDelegate extends WatchUi.BehaviorDelegate {
    private var _view as StatusView;

    function initialize(view as StatusView) {
        BehaviorDelegate.initialize();
        _view = view;
    }

    function onSelect() as Boolean {
        _view.fetch();
        return true;
    }

    function onBack() as Boolean {
        if (Config.loadTypes().size() > 0) {
            switchToTypeMenu(WatchUi.SLIDE_RIGHT);
            return true;
        }
        return false;
    }
}
