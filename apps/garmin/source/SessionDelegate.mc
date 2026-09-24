import Toybox.Lang;
import Toybox.WatchUi;

class SessionDelegate extends WatchUi.BehaviorDelegate {
    function initialize() {
        BehaviorDelegate.initialize();
    }

    function onSelect() as Boolean {
        showStopMenu();
        return true;
    }

    function onBack() as Boolean {
        showStopMenu();
        return true;
    }

    private function showStopMenu() as Void {
        Recorder.stop();
        var menu = new WatchUi.Menu2({ :title => Rez.Strings.Stopped });
        menu.addItem(new WatchUi.MenuItem(Rez.Strings.Resume, null, :resume, null));
        menu.addItem(new WatchUi.MenuItem(Rez.Strings.Save, null, :save, null));
        menu.addItem(new WatchUi.MenuItem(Rez.Strings.Discard, null, :discard, null));
        WatchUi.switchToView(menu, new StopMenuDelegate(), WatchUi.SLIDE_UP);
    }
}

class StopMenuDelegate extends WatchUi.Menu2InputDelegate {
    function initialize() {
        Menu2InputDelegate.initialize();
    }

    function onSelect(item as WatchUi.MenuItem) as Void {
        var id = item.getId();
        if (id == :save) {
            Recorder.save();
            WatchUi.popView(WatchUi.SLIDE_DOWN);
        } else if (id == :discard) {
            Recorder.discard();
            WatchUi.popView(WatchUi.SLIDE_DOWN);
        } else {
            resume();
        }
    }

    function onBack() as Void {
        resume();
    }

    private function resume() as Void {
        Recorder.resume();
        WatchUi.switchToView(new SessionView(), new SessionDelegate(), WatchUi.SLIDE_DOWN);
    }
}
