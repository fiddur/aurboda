import Toybox.Graphics;
import Toybox.Lang;
import Toybox.Timer;
import Toybox.WatchUi;

class SessionView extends WatchUi.View {
    private var _timer as Timer.Timer?;

    function initialize() {
        View.initialize();
    }

    function onShow() as Void {
        var timer = new Timer.Timer();
        timer.start(method(:onTick), 1000, true);
        _timer = timer;
    }

    function onHide() as Void {
        var timer = _timer;
        if (timer != null) {
            timer.stop();
        }
        _timer = null;
    }

    function onTick() as Void {
        Recorder.tick();
        WatchUi.requestUpdate();
    }

    function onUpdate(dc as Dc) as Void {
        dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_BLACK);
        dc.clear();
        var x = dc.getWidth() / 2;
        var height = dc.getHeight();

        dc.drawText(x, height * 0.18, Graphics.FONT_SMALL, Recorder.typeName, Graphics.TEXT_JUSTIFY_CENTER);
        dc.drawText(
            x,
            height * 0.42,
            Graphics.FONT_NUMBER_MEDIUM,
            formatDuration(Recorder.elapsedSeconds()),
            Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER
        );
        dc.drawText(
            x,
            height * 0.62,
            Graphics.FONT_MEDIUM,
            Config.loadString(Rez.Strings.HeartRate) + " " + orDash(Recorder.heartRate()),
            Graphics.TEXT_JUSTIFY_CENTER
        );
        dc.drawText(
            x,
            height * 0.76,
            Graphics.FONT_SMALL,
            Config.loadString(Rez.Strings.Stress) + " " + orDash(Recorder.stress),
            Graphics.TEXT_JUSTIFY_CENTER
        );
    }

    private function orDash(value as Number?) as String {
        return value != null ? value.toString() : "--";
    }

    private function formatDuration(seconds as Number) as String {
        var minutes = seconds / 60;
        if (minutes >= 60) {
            return Lang.format("$1$:$2$:$3$", [minutes / 60, (minutes % 60).format("%02d"), (seconds % 60).format("%02d")]);
        }
        return Lang.format("$1$:$2$", [minutes.format("%02d"), (seconds % 60).format("%02d")]);
    }
}
