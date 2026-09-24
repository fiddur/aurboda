import Toybox.Activity;
import Toybox.ActivityRecording;
import Toybox.FitContributor;
import Toybox.Lang;
import Toybox.Sensor;

module Recorder {
    const TYPE_FIELD_ID = 40;
    const STRESS_FIELD_ID = 41;

    var session as ActivityRecording.Session? = null;
    var typeField as FitContributor.Field? = null;
    var stressField as FitContributor.Field? = null;
    var typeCode as Number = 0;
    var typeName as String = "";
    var stress as Number? = null;

    function start(entry as Config.WatchType) as Void {
        Sensor.setEnabledSensors([Sensor.SENSOR_HEARTRATE] as Array<Sensor.SensorType>);
        var created = ActivityRecording.createSession({
            :name => Config.typeName(entry),
            :sport => Config.typeSport(entry) as Activity.Sport,
            :subSport => Config.typeSubSport(entry) as Activity.SubSport
        });
        typeField = created.createField("aurboda_type", TYPE_FIELD_ID, FitContributor.DATA_TYPE_UINT16, {
            :mesgType => FitContributor.MESG_TYPE_RECORD,
            :units => ""
        });
        stressField = created.createField("stress", STRESS_FIELD_ID, FitContributor.DATA_TYPE_UINT8, {
            :mesgType => FitContributor.MESG_TYPE_RECORD,
            :units => "score"
        });
        typeCode = Config.typeCode(entry);
        typeName = Config.typeName(entry);
        session = created;
        tick();
        created.start();
    }

    function tick() as Void {
        stress = Stress.read();
        var type = typeField;
        if (type != null) {
            type.setData(typeCode);
        }
        var field = stressField;
        var value = stress;
        if (field != null && value != null) {
            field.setData(value);
        }
    }

    function isActive() as Boolean {
        return session != null;
    }

    function stop() as Void {
        var current = session;
        if (current != null && current.isRecording()) {
            current.stop();
        }
    }

    function resume() as Void {
        var current = session;
        if (current != null && !current.isRecording()) {
            current.start();
        }
    }

    function save() as Void {
        stop();
        var current = session;
        if (current != null) {
            current.save();
        }
        clear();
    }

    function discard() as Void {
        stop();
        var current = session;
        if (current != null) {
            current.discard();
        }
        clear();
    }

    function clear() as Void {
        session = null;
        typeField = null;
        stressField = null;
        stress = null;
    }

    function elapsedSeconds() as Number {
        var info = Activity.getActivityInfo();
        if (info != null) {
            var time = info.timerTime;
            if (time != null) {
                return time / 1000;
            }
        }
        return 0;
    }

    function heartRate() as Number? {
        var info = Activity.getActivityInfo();
        return info != null ? info.currentHeartRate : null;
    }
}
