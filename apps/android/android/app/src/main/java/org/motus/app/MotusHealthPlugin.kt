package org.motus.app

import android.content.Intent
import android.os.Build
import androidx.activity.result.ActivityResult
import androidx.health.connect.client.HealthConnectClient
import androidx.health.connect.client.HealthConnectFeatures
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
import java.time.ZoneOffset
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
        perm(RestingHeartRateRecord::class), perm(OxygenSaturationRecord::class), perm(HeartRateVariabilityRmssdRecord::class),
    )

    // Health Connect is part of Android 14+, an app from the Play Store on 9-13, and missing below 9
    private fun sdk(): Int =
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.P) HealthConnectClient.SDK_UNAVAILABLE
        else HealthConnectClient.getSdkStatus(context)

    private fun client() = HealthConnectClient.getOrCreate(context)

    // Without this permission Health Connect hands out only the 30 days before the first grant; it exists only on
    // newer Health Connect versions, so it is asked for (and reported) only where the phone offers it
    private val HISTORY = HealthPermission.PERMISSION_READ_HEALTH_DATA_HISTORY
    private fun historyAvailable(c: HealthConnectClient): Boolean = try {
        c.features.getFeatureStatus(HealthConnectFeatures.FEATURE_READ_HEALTH_DATA_HISTORY) == HealthConnectFeatures.FEATURE_STATUS_AVAILABLE
    } catch (e: Exception) { false }

    override fun handleOnDestroy() { scope.cancel() }

    /**
     * { available: "yes" | "update" | "no", granted: string[], history: boolean, historyAvailable: boolean }
     * ("update": the Health Connect app needs installing or updating; history: data older than 30 days before the
     * first grant may be read; historyAvailable: this phone's Health Connect can grant that at all)
     */
    @PluginMethod
    fun status(call: PluginCall) {
        val s = sdk()
        val out = JSObject()
        out.put("available", when (s) {
            HealthConnectClient.SDK_AVAILABLE -> "yes"
            HealthConnectClient.SDK_UNAVAILABLE_PROVIDER_UPDATE_REQUIRED -> "update"
            else -> "no"
        })
        if (s != HealthConnectClient.SDK_AVAILABLE) {
            out.put("granted", JSArray()).put("history", false).put("historyAvailable", false); call.resolve(out); return
        }
        scope.launch {
            try {
                val c = client()
                val granted = c.permissionController.getGrantedPermissions()
                out.put("granted", JSArray(names(granted)))
                out.put("history", HISTORY in granted)
                out.put("historyAvailable", historyAvailable(c))
                call.resolve(out)
            } catch (e: Exception) { call.reject(e.message ?: "Health Connect could not be reached") }
        }
    }

    /** Health Connect's own screen asking for each kind; resolves with what is granted afterwards */
    @PluginMethod
    fun connect(call: PluginCall) {
        if (sdk() != HealthConnectClient.SDK_AVAILABLE) { call.reject("Health Connect is not available"); return }
        val perms = if (historyAvailable(client())) PERMS + HISTORY else PERMS
        val intent = PermissionController.createRequestPermissionResultContract().createIntent(context, perms)
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
     * Everything since `from` (an ISO time; years back are fine, Health Connect then needs the history permission
     * for anything older than 30 days before the first grant). Days are the phone's calendar days.
     * { steps: [{date, value}], sleep: [{date, hours}], weight: [{id, at, kg}], sessions: [{id, type, title, start, end, avgHr?, distanceM?, steps?, calories?}],
     *   restingHr: [{date, value}], spo2: [{date, value}], hrv: [{date, value}] } (the last three: daily averages in bpm, % and ms)
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
                out.put("restingHr", if (has(RestingHeartRateRecord::class)) daily(readAll(c, RestingHeartRateRecord::class, from).map {
                    Triple(it.time, it.zoneOffset, it.beatsPerMinute.toDouble()) }, zone, 0) else JSArray())
                out.put("spo2", if (has(OxygenSaturationRecord::class)) daily(readAll(c, OxygenSaturationRecord::class, from).map {
                    Triple(it.time, it.zoneOffset, it.percentage.value) }, zone, 1) else JSArray())
                out.put("hrv", if (has(HeartRateVariabilityRmssdRecord::class)) daily(readAll(c, HeartRateVariabilityRmssdRecord::class, from).map {
                    Triple(it.time, it.zoneOffset, it.heartRateVariabilityMillis) }, zone, 1) else JSArray())
                call.resolve(out)
            } catch (e: Exception) { call.reject(e.message ?: "Health Connect could not be read") }
        }
    }

    /**
     * Steps and heart rate inside given time spans (e.g. a workout, a day), each looked up on its own.
     * { ranges: [{kind, id, start, end}] } (at most 200) →
     * { results: [{kind, id, steps?: number, covered: boolean, hr?: [[unixSeconds, bpm], ...]}] }
     * steps: from one app only (the one with the most steps in the span; Motus's own left out), since Health Connect
     * may hold the same steps from a band and from the phone. covered: that app's records reach across the whole span
     * with no hole over 10 minutes (false when the band was off or has not synced yet). hr: at most 600 points.
     */
    @PluginMethod
    fun readRanges(call: PluginCall) {
        if (sdk() != HealthConnectClient.SDK_AVAILABLE) { call.reject("Health Connect is not available"); return }
        val list = call.getArray("ranges", JSArray()) ?: JSArray()
        scope.launch {
            try {
                val c = client()
                val granted = c.permissionController.getGrantedPermissions()
                val hasSteps = perm(StepsRecord::class) in granted
                val hasHr = perm(HeartRateRecord::class) in granted
                val results = JSArray()
                for (i in 0 until minOf(list.length(), 200)) {
                    val r = list.optJSONObject(i) ?: continue
                    val kind = r.optString("kind", ""); val id = r.opt("id")
                    val o = JSObject().put("kind", kind).put("id", id)
                    try {
                        val start = Instant.parse(r.getString("start")); val end = Instant.parse(r.getString("end"))
                        var covered = false
                        if (hasSteps && end.isAfter(start)) {
                            val (n, cov) = rangeSteps(c, start, end)
                            if (n != null) o.put("steps", n)
                            covered = cov
                        }
                        o.put("covered", covered)
                        if (hasHr && end.isAfter(start)) rangeHr(c, start, end)?.let { o.put("hr", it) }
                    } catch (e: Exception) {
                        if (e is kotlinx.coroutines.CancellationException) throw e
                        o.remove("steps"); o.remove("hr"); o.put("covered", false)
                    }
                    results.put(o)
                }
                call.resolve(JSObject().put("results", results))
            } catch (e: Exception) { call.reject(e.message ?: "Health Connect could not be read") }
        }
    }

    private suspend fun <T : Record> readBetween(c: HealthConnectClient, type: KClass<T>, start: Instant, end: Instant): List<T> {
        val all = mutableListOf<T>()
        var token: String? = null
        do {
            val res = c.readRecords(ReadRecordsRequest(type, TimeRangeFilter.between(start, end), pageSize = 1000, pageToken = token))
            all += res.records
            token = res.pageToken
        } while (token != null && all.size < 50000)
        return all
    }

    // Steps of the app with the most in the span (records crossing the edges count by their share of time inside),
    // and whether that app's records cover the span without a hole over 10 minutes
    private suspend fun rangeSteps(c: HealthConnectClient, start: Instant, end: Instant): Pair<Long?, Boolean> {
        val recs = readBetween(c, StepsRecord::class, start, end).filter {
            it.metadata.dataOrigin.packageName != context.packageName && it.endTime.isAfter(start) && it.startTime.isBefore(end)
        }
        if (recs.isEmpty()) return null to false
        val byOrigin = recs.groupBy { it.metadata.dataOrigin.packageName }
        fun inside(s: StepsRecord): Double {
            val len = s.endTime.toEpochMilli() - s.startTime.toEpochMilli()
            if (len <= 0) return s.count.toDouble()
            val a = maxOf(s.startTime, start).toEpochMilli(); val b = minOf(s.endTime, end).toEpochMilli()
            return s.count.toDouble() * (b - a).coerceAtLeast(0) / len
        }
        val best = byOrigin.values.maxBy { rs -> rs.sumOf { inside(it) } }
        val total = Math.round(best.sumOf { inside(it) })
        val slack = 10L * 60 * 1000
        val spanMs = end.toEpochMilli() - start.toEpochMilli()
        val covered = if (spanMs < slack) true else {
            val sorted = best.sortedBy { it.startTime }
            var ok = sorted.first().startTime.toEpochMilli() <= start.toEpochMilli() + slack
            var reach = sorted.first().endTime.toEpochMilli()
            for (s in sorted.drop(1)) {
                if (s.startTime.toEpochMilli() - reach > slack) { ok = false; break }
                reach = maxOf(reach, s.endTime.toEpochMilli())
            }
            ok && reach >= end.toEpochMilli() - slack
        }
        return total to covered
    }

    // Heart rate samples in the span as [unixSeconds, bpm], averaged into at most 600 time buckets
    private suspend fun rangeHr(c: HealthConnectClient, start: Instant, end: Instant): JSArray? {
        val samples = readBetween(c, HeartRateRecord::class, start, end).flatMap { it.samples }
            .filter { !it.time.isBefore(start) && !it.time.isAfter(end) }
            .sortedBy { it.time }
        if (samples.size < 2) return null
        val out = JSArray()
        if (samples.size <= 600) {
            for (s in samples) out.put(JSArray().put(s.time.epochSecond).put(s.beatsPerMinute))
            return out
        }
        val t0 = start.toEpochMilli(); val span = (end.toEpochMilli() - t0).coerceAtLeast(1)
        val sumT = DoubleArray(600); val sumB = DoubleArray(600); val n = IntArray(600)
        for (s in samples) {
            val ms = s.time.toEpochMilli()
            val b = ((ms - t0) * 600 / span).toInt().coerceIn(0, 599)
            sumT[b] += ms.toDouble(); sumB[b] += s.beatsPerMinute.toDouble(); n[b]++
        }
        for (b in 0 until 600) if (n[b] > 0) out.put(JSArray().put(Math.round(sumT[b] / n[b] / 1000)).put(Math.round(sumB[b] / n[b])))
        return out
    }

    private fun names(granted: Set<String>): List<String> = buildList {
        if (perm(StepsRecord::class) in granted) add("steps")
        if (perm(SleepSessionRecord::class) in granted) add("sleep")
        if (perm(WeightRecord::class) in granted) add("weight")
        if (perm(ExerciseSessionRecord::class) in granted) add("sessions")
        if (perm(HeartRateRecord::class) in granted) add("heartRate")
        if (perm(RestingHeartRateRecord::class) in granted) add("restingHr")
        if (perm(OxygenSaturationRecord::class) in granted) add("spo2")
        if (perm(HeartRateVariabilityRmssdRecord::class) in granted) add("hrv")
    }

    // Health Connect adds up each day itself and leaves out steps two apps both wrote (a band and the phone).
    // A long range (years) is asked for 90 days at a time: one request for thousands of day buckets can fail.
    private suspend fun steps(c: HealthConnectClient, from: Instant, zone: ZoneId): JSArray {
        // start at the oldest step record Health Connect will give us, not at `from`: "everything" asks from 2000, and
        // one aggregate call per 90 days since then would run into Health Connect's rate limit and fail the whole read
        val first = c.readRecords(ReadRecordsRequest(StepsRecord::class, TimeRangeFilter.after(from), ascendingOrder = true, pageSize = 1)).records.firstOrNull()
            ?: return JSArray()
        var day = LocalDate.ofInstant(maxOf(from, first.startTime), zone)
        val end = LocalDate.now(zone).plusDays(1)
        val arr = JSArray()
        while (day.isBefore(end)) {
            val next = minOf(day.plusDays(90), end)
            val res = c.aggregateGroupByPeriod(AggregateGroupByPeriodRequest(setOf(StepsRecord.COUNT_TOTAL),
                TimeRangeFilter.between(day.atStartOfDay(), next.atStartOfDay()), Period.ofDays(1)))
            for (r in res) {
                val n = r.result[StepsRecord.COUNT_TOTAL] ?: continue
                arr.put(JSObject().put("date", r.startTime.toLocalDate().toString()).put("value", n))
            }
            day = next
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

    // Daily average of point readings (resting heart rate, SpO2, HRV), on the day the reading was taken where it was taken
    private fun daily(points: List<Triple<Instant, ZoneOffset?, Double>>, zone: ZoneId, decimals: Int): JSArray {
        val byDay = sortedMapOf<LocalDate, MutableList<Double>>()
        for ((t, off, v) in points) byDay.getOrPut(LocalDateTime.ofInstant(t, off ?: zone.rules.getOffset(t)).toLocalDate()) { mutableListOf() }.add(v)
        val arr = JSArray()
        for ((day, vs) in byDay) {
            val avg = vs.average()
            val o = JSObject().put("date", day.toString())
            if (decimals == 0) o.put("value", Math.round(avg)) else o.put("value", Math.round(avg * 10) / 10.0)
            arr.put(o)
        }
        return arr
    }

    private suspend fun weight(c: HealthConnectClient, from: Instant): JSArray {
        val arr = JSArray()
        for (w in readAll(c, WeightRecord::class, from)) arr.put(JSObject().put("id", w.metadata.id).put("at", w.time.toString()).put("kg", w.weight.inKilograms))
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
            // one aggregate per session: over years of sessions Health Connect may refuse some (its rate limit), and
            // those sessions still come back, only without heart rate, distance, steps and calories
            if (metrics.isNotEmpty()) try {
                val a = c.aggregate(AggregateRequest(metrics, TimeRangeFilter.between(s.startTime, s.endTime)))
                a[HeartRateRecord.BPM_AVG]?.let { o.put("avgHr", it) }
                a[DistanceRecord.DISTANCE_TOTAL]?.let { o.put("distanceM", it.inMeters) }
                a[StepsRecord.COUNT_TOTAL]?.let { o.put("steps", it) }
                a[ActiveCaloriesBurnedRecord.ACTIVE_CALORIES_TOTAL]?.let { o.put("calories", it.inKilocalories.toInt()) }
            } catch (e: Exception) { if (e is kotlinx.coroutines.CancellationException) throw e }
            arr.put(o)
        }
        return arr
    }
}
