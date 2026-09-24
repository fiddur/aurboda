import Toybox.ActivityMonitor;
import Toybox.Lang;
import Toybox.SensorHistory;

module Stress {
    function read() as Number? {
        var info = ActivityMonitor.getInfo();
        if (info has :stressScore) {
            var score = info.stressScore;
            if (score != null) {
                return valid(score);
            }
        }
        if (Toybox has :SensorHistory && SensorHistory has :getStressHistory) {
            var sample = SensorHistory.getStressHistory({ :period => 1, :order => SensorHistory.ORDER_NEWEST_FIRST }).next();
            if (sample != null) {
                var data = sample.data;
                if (data != null) {
                    return valid(data.toNumber());
                }
            }
        }
        return null;
    }

    function valid(score as Number) as Number? {
        return score >= 0 && score <= 100 ? score : null;
    }
}
