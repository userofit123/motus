package org.motus.app;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.hardware.Sensor;
import android.hardware.SensorEvent;
import android.hardware.SensorEventListener;
import android.hardware.SensorManager;
import android.os.Build;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

/**
 * The rest timer in the notification shade and on the lock screen: a live countdown while a rest runs.
 * Also the phone's step counter while a walk is recorded: the hardware counter keeps counting with the screen off,
 * and the recording reads the running total (steps since the phone started) and subtracts where it began.
 */
@CapacitorPlugin(name = "MotusWorkout", permissions = { @Permission(alias = "steps", strings = { "android.permission.ACTIVITY_RECOGNITION" }) })
public class MotusWorkoutPlugin extends Plugin implements SensorEventListener {
    private static final String CHANNEL = "workout";
    private static final int ID = 7002;

    private void channel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel ch = new NotificationChannel(CHANNEL, "Workout in progress", NotificationManager.IMPORTANCE_LOW);
            ch.setShowBadge(false);
            ((NotificationManager) getContext().getSystemService(Context.NOTIFICATION_SERVICE)).createNotificationChannel(ch);
        }
    }

    @PluginMethod
    public void showRest(PluginCall call) {
        channel();
        long endAt = call.getLong("endAt", System.currentTimeMillis());
        String body = call.getString("body", "");
        Intent open = new Intent(getContext(), MainActivity.class);
        open.addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent pi = PendingIntent.getActivity(getContext(), 0, open, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        NotificationCompat.Builder b = new NotificationCompat.Builder(getContext(), CHANNEL)
            .setSmallIcon(R.drawable.ic_stat_motus)
            .setContentTitle("Rest")
            .setContentText(body)
            .setWhen(endAt)
            .setUsesChronometer(true)
            .setChronometerCountDown(true)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setCategory(NotificationCompat.CATEGORY_STOPWATCH)
            .setTimeoutAfter(Math.max(1000, endAt - System.currentTimeMillis() + 2000))
            .setContentIntent(pi);
        try { NotificationManagerCompat.from(getContext()).notify(ID, b.build()); } catch (SecurityException e) { /* notifications not allowed */ }
        call.resolve();
    }

    @PluginMethod
    public void clearRest(PluginCall call) {
        NotificationManagerCompat.from(getContext()).cancel(ID);
        call.resolve();
    }

    // ---- steps ----
    private long stepTotal = -1;

    private Sensor stepSensor() {
        SensorManager sm = (SensorManager) getContext().getSystemService(Context.SENSOR_SERVICE);
        return sm == null ? null : sm.getDefaultSensor(Sensor.TYPE_STEP_COUNTER);
    }

    @PluginMethod
    public void startSteps(PluginCall call) {
        if (stepSensor() == null) { JSObject r = new JSObject(); r.put("available", false); call.resolve(r); return; }
        // Android 10+ asks for "physical activity" before the step counter reports anything
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q && getPermissionState("steps") != PermissionState.GRANTED) {
            requestPermissionForAlias("steps", call, "stepsPermission");
            return;
        }
        listen(call);
    }

    @PermissionCallback
    private void stepsPermission(PluginCall call) {
        if (getPermissionState("steps") == PermissionState.GRANTED) listen(call);
        else { JSObject r = new JSObject(); r.put("available", false); r.put("denied", true); call.resolve(r); }
    }

    private void listen(PluginCall call) {
        SensorManager sm = (SensorManager) getContext().getSystemService(Context.SENSOR_SERVICE);
        sm.unregisterListener(this);
        sm.registerListener(this, stepSensor(), SensorManager.SENSOR_DELAY_NORMAL, 0);
        JSObject r = new JSObject();
        r.put("available", true);
        r.put("total", stepTotal);
        call.resolve(r);
    }

    @PluginMethod
    public void getSteps(PluginCall call) {
        JSObject r = new JSObject();
        r.put("available", stepSensor() != null);
        r.put("total", stepTotal);
        call.resolve(r);
    }

    @PluginMethod
    public void stopSteps(PluginCall call) {
        SensorManager sm = (SensorManager) getContext().getSystemService(Context.SENSOR_SERVICE);
        if (sm != null) sm.unregisterListener(this);
        call.resolve();
    }

    @Override
    public void onSensorChanged(SensorEvent e) {
        if (e.sensor.getType() != Sensor.TYPE_STEP_COUNTER) return;
        stepTotal = (long) e.values[0];
        JSObject r = new JSObject();
        r.put("total", stepTotal);
        notifyListeners("steps", r);
    }

    @Override
    public void onAccuracyChanged(Sensor sensor, int accuracy) { }
}
