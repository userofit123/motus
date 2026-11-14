package org.motus.app

import android.content.Intent
import android.os.Build
import androidx.activity.result.ActivityResult
import androidx.health.connect.client.HealthConnectClient
import androidx.health.connect.client.PermissionController
import androidx.health.connect.client.aggregate.AggregateMetric
import androidx.health.connect.client.permission.HealthPermission
import androidx.health.connect.client.records.*
import androidx.health.connect.client.request.AggregateGroupByPeriodRequest
import androidx.health.connect.client.request.AggregateRequest
import androidx.health.connect.client.request.ReadRecordsRequest
import androidx.health.connect.client.time.TimeRangeFilter
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.ActivityCallback
import com.getcapacitor.annotation.CapacitorPlugin
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import java.time.Instant
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.Period
import java.time.ZoneId
import kotlin.reflect.KClass

/**
 * Reads what other apps wrote to Health Connect (Gadgetbridge for a band, a scale's app, a watch's) so it shows in
 * Motus: daily steps, sleep, weight and exercise sessions with their heart rate, distance, steps and calories.
 * Read only. The page sends the result to the engine (POST /health/import), which decides what to keep.
 * Each kind is read only when its permission was granted, so a person can allow steps and not sleep.
 */
@CapacitorPlugin(name = "MotusHealth")
class MotusHealthPlugin : Plugin() {
    private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())

    private fun perm(c: KClass<out Record>) = HealthPermission.getReadPermission(c)
    private val PERMS = setOf(
        perm(StepsRecord::class), perm(SleepSessionRecord::class), perm(WeightRecord::class), perm(ExerciseSessionRecord::class),
        perm(HeartRateRecord::class), perm(DistanceRecord::class), perm(ActiveCaloriesBurnedRecord::class),
    )

    // Health Connect is part of Android 14+, an app from the Play Store on 9-13, and missing below 9
    private fun sdk(): Int =
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.P) HealthConnectClient.SDK_UNAVAILABLE
        else HealthConnectClient.getSdkStatus(context)

    private fun client() = HealthConnectClient.getOrCreate(context)

    override fun handleOnDestroy() { scope.cancel() }

    /** { available: "yes" | "update" | "no", granted: string[] } ("update": the Health Connect app needs installing or updating) */
    @PluginMethod
    fun status(call: PluginCall) {
        val s = sdk()
        val out = JSObject()
        out.put("available", when (s) {
            HealthConnectClient.SDK_AVAILABLE -> "yes"
            HealthConnectClient.SDK_UNAVAILABLE_PROVIDER_UPDATE_REQUIRED -> "update"
            else -> "no"
        })
        if (s != HealthConnectClient.SDK_AVAILABLE) { out.put("granted", JSArray()); call.resolve(out); return }
        scope.launch {
            try {
                out.put("granted", JSArray(names(client().permissionController.getGrantedPermissions())))
                call.resolve(out)
            } catch (e: Exception) { call.reject(e.message ?: "Health Connect could not be reached") }
        }
    }

    /** Health Connect's own screen asking for each kind; resolves with what is granted afterwards */
    @PluginMethod
    fun connect(call: PluginCall) {
        if (sdk() != HealthConnectClient.SDK_AVAILABLE) { call.reject("Health Connect is not available"); return }
        val intent = PermissionController.createRequestPermissionResultContract().createIntent(context, PERMS)
        startActivityForResult(call, intent, "permissionsDone")
    }

    @ActivityCallback
    private fun permissionsDone(call: PluginCall?, @Suppress("UNUSED_PARAMETER") result: ActivityResult) {
        if (call == null) return
        status(call)
    }

    /** Opens Health Connect's settings, where permissions can be changed or taken back */
    @PluginMethod
    fun openSettings(call: PluginCall) {
        val action = if (Build.VERSION.SDK_INT >= 34) "android.health.connect.action.MANAGE_HEALTH_PERMISSIONS" else "androidx.health.ACTION_HEALTH_CONNECT_SETTINGS"
        try {
            val i = Intent(action).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            if (Build.VERSION.SDK_INT >= 34) i.putExtra(Intent.EXTRA_PACKAGE_NAME, context.packageName)
            context.startActivity(i)
            call.resolve()
        } catch (e: Exception) { call.reject("Health Connect's settings could not be opened") }
    }

    /**
     * Everything since `from` (an ISO time). Days are the phone's calendar days.
     * { steps: [{date, value}], sleep: [{date, hours}], weight: [{at, kg}], sessions: [{id, type, title, start, end, avgHr?, distanceM?, steps?, calories?}] }
     */
    @PluginMethod
    fun read(call: PluginCall) {
        if (sdk() != HealthConnectClient.SDK_AVAILABLE) { call.reject("Health Connect is not available"); return }
        val from = try { Instant.parse(call.getString("from")) } catch (e: Exception) { Instant.now().minusSeconds(30L * 86400) }
        scope.launch {
            try {
                val c = client()
                val granted = c.permissionController.getGrantedPermissions()
                val has = { k: KClass<out Record> -> perm(k) in granted }
                val zone = ZoneId.systemDefault()
                val out = JSObject()
                out.put("steps", if (has(StepsRecord::class)) steps(c, from, zone) else JSArray())
                out.put("sleep", if (has(SleepSessionRecord::class)) sleep(c, from, zone) else JSArray())
                out.put("weight", if (has(WeightRecord::class)) weight(c, from) else JSArray())
                out.put("sessions", if (has(ExerciseSessionRecord::class)) sessions(c, from, has) else JSArray())
                call.resolve(out)
            } catch (e: Exception) { call.reject(e.message ?: "Health Connect could not be read") }
        }
    }

    private fun names(granted: Set<String>): List<String> = buildList {
        if (perm(StepsRecord::class) in granted) add("steps")
        if (perm(SleepSessionRecord::class) in granted) add("sleep")
        if (perm(WeightRecord::class) in granted) add("weight")
        if (perm(ExerciseSessionRecord::class) in granted) add("sessions")
        if (perm(HeartRateRecord::class) in granted) add("heartRate")
    }

    // Health Connect adds up each day itself and leaves out steps two apps both wrote (a band and the phone)
    private suspend fun steps(c: HealthConnectClient, from: Instant, zone: ZoneId): JSArray {
        val start = LocalDate.ofInstant(from, zone).atStartOfDay()
        val end = LocalDate.now(zone).plusDays(1).atStartOfDay()
        val res = c.aggregateGroupByPeriod(AggregateGroupByPeriodRequest(setOf(StepsRecord.COUNT_TOTAL), TimeRangeFilter.between(start, end), Period.ofDays(1)))
        val arr = JSArray()
        for (r in res) {
            val n = r.result[StepsRecord.COUNT_TOTAL] ?: continue
            arr.put(JSObject().put("date", r.startTime.toLocalDate().toString()).put("value", n))
        }
        return arr
    }

    private suspend fun <T : Record> readAll(c: HealthConnectClient, type: KClass<T>, from: Instant): List<T> {
        val all = mutableListOf<T>()
        var token: String? = null
        do {
            val res = c.readRecords(ReadRecordsRequest(type, TimeRangeFilter.after(from), pageSize = 1000, pageToken = token))
            all += res.records
            token = res.pageToken
        } while (token != null && all.size < 20000)
        return all
    }

    // A night counts on the day you wake up. Time awake or out of bed is left out, and two apps writing the same
    // night (overlapping sessions) count it once: the asleep stretches are merged before they are added up.
    private suspend fun sleep(c: HealthConnectClient, from: Instant, zone: ZoneId): JSArray {
        val awake = setOf(SleepSessionRecord.STAGE_TYPE_AWAKE, SleepSessionRecord.STAGE_TYPE_OUT_OF_BED, SleepSessionRecord.STAGE_TYPE_AWAKE_IN_BED)
        val byDay = sortedMapOf<LocalDate, MutableList<Pair<Instant, Instant>>>()
        for (s in readAll(c, SleepSessionRecord::class, from)) {
            val day = LocalDateTime.ofInstant(s.endTime, s.endZoneOffset ?: zone.rules.getOffset(s.endTime)).toLocalDate()
            val parts = if (s.stages.isEmpty()) listOf(s.startTime to s.endTime) else s.stages.filter { it.stage !in awake }.map { it.startTime to it.endTime }
            byDay.getOrPut(day) { mutableListOf() }.addAll(parts)
        }
        val arr = JSArray()
        for ((day, parts) in byDay) {
            var ms = 0L; var curS: Instant? = null; var curE: Instant? = null
            for ((s, e) in parts.sortedBy { it.first }) {
                if (curE == null || s.isAfter(curE)) { if (curS != null) ms += curE!!.toEpochMilli() - curS.toEpochMilli(); curS = s; curE = e }
                else if (e.isAfter(curE)) curE = e
            }
            if (curS != null) ms += curE!!.toEpochMilli() - curS.toEpochMilli()
            if (ms > 0) arr.put(JSObject().put("date", day.toString()).put("hours", ms / 3_600_000.0))
        }
        return arr
    }

    private suspend fun weight(c: HealthConnectClient, from: Instant): JSArray {
        val arr = JSArray()
        for (w in readAll(c, WeightRecord::class, from)) arr.put(JSObject().put("at", w.time.toString()).put("kg", w.weight.inKilograms))
        return arr
    }

    // Motus's activity types; strength training is left out, since gym workouts are logged in Motus itself
    private fun typeOf(t: Int): String? = when (t) {
        ExerciseSessionRecord.EXERCISE_TYPE_WALKING -> "walk"
        ExerciseSessionRecord.EXERCISE_TYPE_RUNNING, ExerciseSessionRecord.EXERCISE_TYPE_RUNNING_TREADMILL -> "run"
        ExerciseSessionRecord.EXERCISE_TYPE_HIKING -> "hike"
        ExerciseSessionRecord.EXERCISE_TYPE_BIKING, ExerciseSessionRecord.EXERCISE_TYPE_BIKING_STATIONARY -> "cycle"
        ExerciseSessionRecord.EXERCISE_TYPE_SWIMMING_POOL, ExerciseSessionRecord.EXERCISE_TYPE_SWIMMING_OPEN_WATER -> "swim"
        ExerciseSessionRecord.EXERCISE_TYPE_YOGA -> "yoga"
        ExerciseSessionRecord.EXERCISE_TYPE_STRETCHING -> "stretching"
        ExerciseSessionRecord.EXERCISE_TYPE_ROWING, ExerciseSessionRecord.EXERCISE_TYPE_ROWING_MACHINE -> "rowing"
        ExerciseSessionRecord.EXERCISE_TYPE_ELLIPTICAL -> "elliptical"
        ExerciseSessionRecord.EXERCISE_TYPE_STRENGTH_TRAINING, ExerciseSessionRecord.EXERCISE_TYPE_WEIGHTLIFTING,
        ExerciseSessionRecord.EXERCISE_TYPE_CALISTHENICS -> null
        else -> "other"
    }

    private suspend fun sessions(c: HealthConnectClient, from: Instant, has: (KClass<out Record>) -> Boolean): JSArray {
        val metrics = mutableSetOf<AggregateMetric<*>>()
        if (has(HeartRateRecord::class)) metrics += HeartRateRecord.BPM_AVG
        if (has(DistanceRecord::class)) metrics += DistanceRecord.DISTANCE_TOTAL
        if (has(StepsRecord::class)) metrics += StepsRecord.COUNT_TOTAL
        if (has(ActiveCaloriesBurnedRecord::class)) metrics += ActiveCaloriesBurnedRecord.ACTIVE_CALORIES_TOTAL
        val arr = JSArray()
        for (s in readAll(c, ExerciseSessionRecord::class, from)) {
            if (s.metadata.dataOrigin.packageName == context.packageName) continue
            val type = typeOf(s.exerciseType) ?: continue
            val o = JSObject().put("id", s.metadata.id).put("type", type).put("title", s.title ?: "")
                .put("start", s.startTime.toString()).put("end", s.endTime.toString())
            if (metrics.isNotEmpty()) {
                val a = c.aggregate(AggregateRequest(metrics, TimeRangeFilter.between(s.startTime, s.endTime)))
                a[HeartRateRecord.BPM_AVG]?.let { o.put("avgHr", it) }
                a[DistanceRecord.DISTANCE_TOTAL]?.let { o.put("distanceM", it.inMeters) }
                a[StepsRecord.COUNT_TOTAL]?.let { o.put("steps", it) }
                a[ActiveCaloriesBurnedRecord.ACTIVE_CALORIES_TOTAL]?.let { o.put("calories", it.inKilocalories.toInt()) }
            }
            arr.put(o)
        }
        return arr
    }
}
