import Toybox.Lang;
import Toybox.WatchUi;

function switchToTypeMenu(transition as WatchUi.SlideType) as Void {
    WatchUi.switchToView(new TypeMenu(), new TypeMenuDelegate(), transition);
}

class TypeMenu extends WatchUi.Menu2 {
    function initialize() {
        Menu2.initialize({ :title => Rez.Strings.AppName });
        var types = Config.loadTypes();
        for (var i = 0; i < types.size(); i++) {
            addItem(new WatchUi.MenuItem(Config.typeName(types[i]), null, Config.typeCode(types[i]), null));
        }
        addItem(new WatchUi.MenuItem(Rez.Strings.RefreshTypes, null, :refresh, null));
    }
}

class TypeMenuDelegate extends WatchUi.Menu2InputDelegate {
    function initialize() {
        Menu2InputDelegate.initialize();
    }

    function onSelect(item as WatchUi.MenuItem) as Void {
        var id = item.getId();
        if (id == :refresh) {
            switchToStatus(WatchUi.SLIDE_LEFT);
            return;
        }
        if (id instanceof Number) {
            var entry = Config.findType(id);
            if (entry != null) {
                Recorder.start(entry);
                WatchUi.pushView(new SessionView(), new SessionDelegate(), WatchUi.SLIDE_LEFT);
            }
        }
    }
}
