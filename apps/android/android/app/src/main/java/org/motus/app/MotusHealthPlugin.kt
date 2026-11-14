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
        perm(RespiratoryRateRecord::class), perm(BodyFatRecord::class), perm(HydrationRecord::class), perm(Vo2MaxRecord::class),
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
        // Android's own "manage permissions" screen for an app is only for the system to open (it did nothing from
        // Motus), so: Health Connect's data and access screen, then its main settings, then Motus's app info page
        val tries = mutableListOf<Intent>()
        if (sdk() == HealthConnectClient.SDK_AVAILABLE) tries += HealthConnectClient.getHealthConnectManageDataIntent(context)
        tries += Intent(HealthConnectClient.ACTION_HEALTH_CONNECT_SETTINGS)
        tries += Intent(android.provider.Settings.ACTION_APPLICATION_DETAILS_SETTINGS, android.net.Uri.fromParts("package", context.packageName, null))
        val host = activity ?: context
        for (i in tries) {
            if (host === context) i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            try { host.startActivity(i); call.resolve(); return } catch (e: Exception) { /* next */ }
        }
        call.reject("Health Connect's settings could not be opened")
    }

    /**
     * Everything since `from` (an ISO time; years back are fine, Health Connect then needs the history permission
     * for anything older than 30 days before the first grant). Days are the phone's calendar days.
     * { steps: [{date, value}], sleep: [{date, hours}], weight: [{id, at, kg}], sessions: [{id, type, title, start, end, avgHr?, distanceM?, steps?, calories?}],
     *   restingHr: [{date, value}], spo2: [{date, value}], hrv: [{date, value}], (daily averages in bpm, % and ms)
     *   distance: [{date, value}], activeKcal: [{date, value}], (daily totals in metres and kcal)
     *   sleepNights: [{date, start, end, asleepMin, awakeMin, lightMin?, deepMin?, remMin?, avgHr?, minHr?, hr?, avgSpo2?, minSpo2?, respRate?}] }
     * (one per wake-up day; hr: [[unixSeconds, bpm], ...], at most 300 points)
     *   bodyFat: [{id, at, pct}], hydration: [{date, ml}] (daily totals), vo2max: [{date, value}] (the day's latest reading),
     *   hrDays: [{date, min, max, avg, hr: [[unixSeconds, bpm], ...]}] (each calendar day's heart rate, hr in 5-minute
     *   averages, at most 288 points; only the newest 400 days) }
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
                out.put("steps", if (has(StepsRecord::class)) dailyTotal(c, from, zone, StepsRecord::class, { it.startTime }, StepsRecord.COUNT_TOTAL) { it } else JSArray())
                out.put("distance", if (has(DistanceRecord::class)) dailyTotal(c, from, zone, DistanceRecord::class, { it.startTime }, DistanceRecord.DISTANCE_TOTAL) {
                    Math.round(it.inMeters) } else JSArray())
                out.put("activeKcal", if (has(ActiveCaloriesBurnedRecord::class)) dailyTotal(c, from, zone, ActiveCaloriesBurnedRecord::class, { it.startTime },
                    ActiveCaloriesBurnedRecord.ACTIVE_CALORIES_TOTAL) { Math.round(it.inKilocalories) } else JSArray())
                val sleeps = if (has(SleepSessionRecord::class)) readAll(c, SleepSessionRecord::class, from) else emptyList()
                val spo2 = if (has(OxygenSaturationRecord::class)) readAll(c, OxygenSaturationRecord::class, from) else emptyList()
                out.put("sleep", sleep(sleeps, zone))
                out.put("sleepNights", sleepNights(c, sleeps, zone, has(HeartRateRecord::class), spo2,
                    if (has(RespiratoryRateRecord::class)) readAll(c, RespiratoryRateRecord::class, from) else emptyList()))
                out.put("weight", if (has(WeightRecord::class)) weight(c, from) else JSArray())
                out.put("sessions", if (has(ExerciseSessionRecord::class)) sessions(c, from, has) else JSArray())
                out.put("restingHr", if (has(RestingHeartRateRecord::class)) daily(readAll(c, RestingHeartRateRecord::class, from).map {
                    Triple(it.time, it.zoneOffset, it.beatsPerMinute.toDouble()) }, zone, 0) else JSArray())
                out.put("spo2", daily(spo2.map { Triple(it.time, it.zoneOffset, it.percentage.value) }, zone, 1))
                out.put("hrv", if (has(HeartRateVariabilityRmssdRecord::class)) daily(readAll(c, HeartRateVariabilityRmssdRecord::class, from).map {
                    Triple(it.time, it.zoneOffset, it.heartRateVariabilityMillis) }, zone, 1) else JSArray())
                out.put("bodyFat", if (has(BodyFatRecord::class)) JSArray().also { a -> for (b in readAll(c, BodyFatRecord::class, from))
                    a.put(JSObject().put("id", b.metadata.id).put("at", b.time.toString()).put("pct", Math.round(b.percentage.value * 10) / 10.0)) } else JSArray())
                out.put("hydration", if (has(HydrationRecord::class)) dailyTotal(c, from, zone, HydrationRecord::class, { it.startTime },
                    HydrationRecord.VOLUME_TOTAL, "ml") { Math.round(it.inMilliliters) } else JSArray())
                out.put("vo2max", if (has(Vo2MaxRecord::class)) vo2max(readAll(c, Vo2MaxRecord::class, from), zone) else JSArray())
                out.put("hrDays", if (has(HeartRateRecord::class)) hrDays(c, from, zone) else JSArray())
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

    /**
     * Heart rate written after `since` (an ISO time), for showing it live during a workout: called often, so one
     * cheap read (at most 2 pages). { samples: [[unixSeconds, bpm], ...] } ascending, at most 600 (the newest);
     * empty without Health Connect or the heart rate permission.
     */
    @PluginMethod
    fun latestHr(call: PluginCall) {
        val empty = { call.resolve(JSObject().put("samples", JSArray())) }
        if (sdk() != HealthConnectClient.SDK_AVAILABLE) { empty(); return }
        val since = try { Instant.parse(call.getString("since")) } catch (e: Exception) { Instant.now().minusSeconds(600) }
        scope.launch {
            try {
                val c = client()
                if (perm(HeartRateRecord::class) !in c.permissionController.getGrantedPermissions()) { empty(); return@launch }
                val samples = mutableListOf<HeartRateRecord.Sample>()
                var token: String? = null; var pages = 0
                do {
                    val res = c.readRecords(ReadRecordsRequest(HeartRateRecord::class, TimeRangeFilter.after(since),
                        ascendingOrder = true, pageSize = 1000, pageToken = token))
                    for (r in res.records) for (s in r.samples) if (s.time.isAfter(since)) samples += s
                    token = res.pageToken; pages++
                } while (token != null && pages < 2)
                val out = JSArray()
                for (s in samples.sortedBy { it.time }.takeLast(600)) out.put(JSArray().put(s.time.epochSecond).put(s.beatsPerMinute))
                call.resolve(JSObject().put("samples", out))
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
        if (perm(RespiratoryRateRecord::class) in granted) add("respiratoryRate")
        if (perm(DistanceRecord::class) in granted) add("distance")
        if (perm(ActiveCaloriesBurnedRecord::class) in granted) add("activeKcal")
        if (perm(BodyFatRecord::class) in granted) add("bodyFat")
        if (perm(HydrationRecord::class) in granted) add("hydration")
        if (perm(Vo2MaxRecord::class) in granted) add("vo2max")
    }

    // Daily totals (steps, distance, active calories): Health Connect adds up each day itself and leaves out what two
    // apps both wrote (a band and the phone). A long range (years) is asked for 90 days at a time: one request for
    // thousands of day buckets can fail.
    private suspend fun <R : Record, T : Any> dailyTotal(c: HealthConnectClient, from: Instant, zone: ZoneId, type: KClass<R>, startOf: (R) -> Instant,
                                                       metric: AggregateMetric<T>, key: String = "value", value: (T) -> Any): JSArray {
        // start at the oldest record Health Connect will give us, not at `from`: "everything" asks from 2000, and
        // one aggregate call per 90 days since then would run into Health Connect's rate limit and fail the whole read
        val first = c.readRecords(ReadRecordsRequest(type, TimeRangeFilter.after(from), ascendingOrder = true, pageSize = 1)).records.firstOrNull()
            ?: return JSArray()
        var day = LocalDate.ofInstant(maxOf(from, startOf(first)), zone)
        val end = LocalDate.now(zone).plusDays(1)
        val arr = JSArray()
        while (day.isBefore(end)) {
            val next = minOf(day.plusDays(90), end)
            val res = c.aggregateGroupByPeriod(AggregateGroupByPeriodRequest(setOf(metric),
                TimeRangeFilter.between(day.atStartOfDay(), next.atStartOfDay()), Period.ofDays(1)))
            for (r in res) {
                val n = r.result[metric] ?: continue
                arr.put(JSObject().put("date", r.startTime.toLocalDate().toString()).put(key, value(n)))
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
    private val AWAKE = setOf(SleepSessionRecord.STAGE_TYPE_AWAKE, SleepSessionRecord.STAGE_TYPE_OUT_OF_BED, SleepSessionRecord.STAGE_TYPE_AWAKE_IN_BED)
    private fun wakeDay(s: SleepSessionRecord, zone: ZoneId): LocalDate =
        LocalDateTime.ofInstant(s.endTime, s.endZoneOffset ?: zone.rules.getOffset(s.endTime)).toLocalDate()

    private fun sleep(sessions: List<SleepSessionRecord>, zone: ZoneId): JSArray {
        val byDay = sortedMapOf<LocalDate, MutableList<Pair<Instant, Instant>>>()
        for (s in sessions) {
            val day = wakeDay(s, zone)
            val parts = if (s.stages.isEmpty()) listOf(s.startTime to s.endTime) else s.stages.filter { it.stage !in AWAKE }.map { it.startTime to it.endTime }
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

    // Stage kinds of a night: light, deep, REM, asleep with no stage (SLEEPING, UNKNOWN or a session without stages), awake
    private fun stageKind(stage: Int): Int = when (stage) {
        SleepSessionRecord.STAGE_TYPE_LIGHT -> 0
        SleepSessionRecord.STAGE_TYPE_DEEP -> 1
        SleepSessionRecord.STAGE_TYPE_REM -> 2
        in AWAKE -> 4
        else -> 3
    }

    // Night accumulators for heart rate: avg and min over every sample, plus at most 300 time buckets for the chart
    private class NightHr(val s: Long, val e: Long) {
        var sum = 0.0; var n = 0; var min = Long.MAX_VALUE
        val bt = DoubleArray(300); val bb = DoubleArray(300); val bn = IntArray(300)
        fun add(ms: Long, bpm: Long) {
            sum += bpm; n++; if (bpm < min) min = bpm
            val b = ((ms - s) * 300 / (e - s).coerceAtLeast(1)).toInt().coerceIn(0, 299)
            bt[b] += ms.toDouble(); bb[b] += bpm.toDouble(); bn[b]++
        }
    }

    /**
     * One entry per wake-up day (same day rule as `sleep`): from the earliest session start to the latest session end
     * that day, minutes per stage, and heart rate, SpO2 and breathing rate in that window. Two apps writing the same
     * night (overlapping sessions) count each moment once: sessions with stages go first, and a later session only
     * fills time the earlier ones left uncovered.
     */
    private suspend fun sleepNights(c: HealthConnectClient, sessions: List<SleepSessionRecord>, zone: ZoneId, hasHr: Boolean,
                                    spo2: List<OxygenSaturationRecord>, resp: List<RespiratoryRateRecord>): JSArray {
        val byDay = sessions.groupBy { wakeDay(it, zone) }.toSortedMap()
        class Night(val day: LocalDate, val s: Long, val e: Long, val ms: LongArray, val staged: Boolean)
        val nights = mutableListOf<Night>()
        for ((day, list) in byDay) {
            val ordered = list.sortedWith(compareBy<SleepSessionRecord>({ it.stages.isEmpty() }, { -(it.endTime.toEpochMilli() - it.startTime.toEpochMilli()) }))
            val claimed = mutableListOf<LongArray>() // merged, sorted [start, end] already counted
            val ms = LongArray(5)
            for (sess in ordered) {
                val segs = if (sess.stages.isEmpty()) listOf(Triple(sess.startTime.toEpochMilli(), sess.endTime.toEpochMilli(), 3))
                    else sess.stages.map { Triple(it.startTime.toEpochMilli(), it.endTime.toEpochMilli(), stageKind(it.stage)) }
                for ((a, b, k) in segs) {
                    if (b <= a) continue
                    var cur = a
                    for (iv in claimed) {
                        if (iv[1] <= cur) continue
                        if (iv[0] >= b) break
                        if (iv[0] > cur) ms[k] += iv[0] - cur
                        cur = maxOf(cur, iv[1])
                        if (cur >= b) break
                    }
                    if (cur < b) ms[k] += b - cur
                    claimed += longArrayOf(a, b)
                    claimed.sortBy { it[0] }
                    val merged = mutableListOf<LongArray>()
                    for (iv in claimed) { val last = merged.lastOrNull(); if (last != null && iv[0] <= last[1]) last[1] = maxOf(last[1], iv[1]) else merged += longArrayOf(iv[0], iv[1]) }
                    claimed.clear(); claimed += merged
                }
            }
            if (ms[0] + ms[1] + ms[2] + ms[3] <= 0) continue
            nights += Night(day, list.minOf { it.startTime.toEpochMilli() }, list.maxOf { it.endTime.toEpochMilli() }, ms, ms[0] + ms[1] + ms[2] > 0)
        }
        if (nights.isEmpty()) return JSArray()
        val starts = LongArray(nights.size) { nights[it].s }
        // the night whose window holds time t (windows do not normally overlap; the later one wins if they do)
        fun at(t: Long): Int? {
            val i = java.util.Arrays.binarySearch(starts, t).let { if (it >= 0) it else -it - 2 }
            for (j in i downTo maxOf(i - 1, 0)) if (t <= nights[j].e && t >= nights[j].s) return j
            return null
        }

        // heart rate: one paged read over the span of all nights (newest first, so a cap drops the oldest nights),
        // samples bucketed into their night in memory: one read per night would hit Health Connect's rate limit
        val hr = arrayOfNulls<NightHr>(nights.size)
        // (a refused page, e.g. the rate limit, keeps what was read so far rather than failing the whole read)
        if (hasHr) try {
            var token: String? = null; var count = 0
            do {
                val res = c.readRecords(ReadRecordsRequest(HeartRateRecord::class,
                    TimeRangeFilter.between(Instant.ofEpochMilli(nights.first().s), Instant.ofEpochMilli(nights.last().e)),
                    ascendingOrder = false, pageSize = 1000, pageToken = token))
                for (r in res.records) for (smp in r.samples) {
                    val t = smp.time.toEpochMilli()
                    val i = at(t) ?: continue
                    (hr[i] ?: NightHr(nights[i].s, nights[i].e).also { hr[i] = it }).add(t, smp.beatsPerMinute)
                }
                count += res.records.size
                token = res.pageToken
            } while (token != null && count < 200_000)
        } catch (e: Exception) { if (e is kotlinx.coroutines.CancellationException) throw e }
        val ox = arrayOfNulls<MutableList<Double>>(nights.size)
        for (o in spo2) { val i = at(o.time.toEpochMilli()) ?: continue; (ox[i] ?: mutableListOf<Double>().also { ox[i] = it }) += o.percentage.value }
        val rr = arrayOfNulls<MutableList<Double>>(nights.size)
        for (o in resp) { val i = at(o.time.toEpochMilli()) ?: continue; (rr[i] ?: mutableListOf<Double>().also { rr[i] = it }) += o.rate }

        val one = { v: Double -> Math.round(v * 10) / 10.0 }
        val arr = JSArray()
        for ((i, n) in nights.withIndex()) {
            val min = { k: Int -> Math.round(n.ms[k] / 60_000.0) }
            val o = JSObject().put("date", n.day.toString())
                .put("start", Instant.ofEpochMilli(n.s).toString()).put("end", Instant.ofEpochMilli(n.e).toString())
                .put("asleepMin", Math.round((n.ms[0] + n.ms[1] + n.ms[2] + n.ms[3]) / 60_000.0)).put("awakeMin", min(4))
            if (n.staged) o.put("lightMin", min(0)).put("deepMin", min(1)).put("remMin", min(2))
            hr[i]?.let { h ->
                o.put("avgHr", Math.round(h.sum / h.n)).put("minHr", h.min)
                val pts = JSArray()
                for (b in 0 until 300) if (h.bn[b] > 0) pts.put(JSArray().put(Math.round(h.bt[b] / h.bn[b] / 1000)).put(Math.round(h.bb[b] / h.bn[b])))
                o.put("hr", pts)
            }
            ox[i]?.let { o.put("avgSpo2", one(it.average())).put("minSpo2", one(it.min())) }
            rr[i]?.let { o.put("respRate", one(it.average())) }
            arr.put(o)
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

    // VO2 max: the day's latest reading (a newer estimate replaces the earlier one), on the day where it was taken
    private fun vo2max(recs: List<Vo2MaxRecord>, zone: ZoneId): JSArray {
        val byDay = sortedMapOf<LocalDate, Vo2MaxRecord>()
        for (r in recs) {
            val day = LocalDateTime.ofInstant(r.time, r.zoneOffset ?: zone.rules.getOffset(r.time)).toLocalDate()
            val cur = byDay[day]
            if (cur == null || r.time.isAfter(cur.time)) byDay[day] = r
        }
        val arr = JSArray()
        for ((day, r) in byDay) arr.put(JSObject().put("date", day.toString()).put("value", Math.round(r.vo2MillilitersPerMinuteKilogram * 10) / 10.0))
        return arr
    }

    // One calendar day's heart rate: min, max and avg over every sample, plus 5-minute bucket averages for the chart
    private class DayHr(val start: Long) {
        var sum = 0.0; var n = 0; var min = Long.MAX_VALUE; var max = Long.MIN_VALUE
        val bt = DoubleArray(288); val bb = DoubleArray(288); val bn = IntArray(288)
        fun add(ms: Long, bpm: Long) {
            sum += bpm; n++; if (bpm < min) min = bpm; if (bpm > max) max = bpm
            val b = ((ms - start) / 300_000).toInt().coerceIn(0, 287) // a 25-hour day (clock change) folds its last hour in
            bt[b] += ms.toDouble(); bb[b] += bpm.toDouble(); bn[b]++
        }
    }

    /**
     * Each calendar day's heart rate from whole days starting at `from`'s day, at most the newest 400 (Import past
     * data asks from years back; the per-day buckets are what stays in memory, not the samples). One paged read,
     * newest first, samples bucketed in memory like the sleep nights; if it stops early (a refused page or the cap)
     * the oldest day reached may be incomplete, so it is left out.
     */
    private suspend fun hrDays(c: HealthConnectClient, from: Instant, zone: ZoneId): JSArray {
        val today = LocalDate.now(zone)
        val firstDay = maxOf(LocalDate.ofInstant(from, zone), today.minusDays(399))
        val start = firstDay.atStartOfDay(zone).toInstant()
        val end = Instant.now()
        if (!end.isAfter(start)) return JSArray()
        val days = sortedMapOf<LocalDate, DayHr>()
        // the day of the last sample, so most samples skip the date lookup
        var curDay: LocalDate? = null; var curS = 0L; var curE = 0L; var curAcc: DayHr? = null
        var complete = true
        try {
            var token: String? = null; var count = 0
            do {
                val res = c.readRecords(ReadRecordsRequest(HeartRateRecord::class, TimeRangeFilter.between(start, end),
                    ascendingOrder = false, pageSize = 1000, pageToken = token))
                for (r in res.records) for (smp in r.samples) {
                    val t = smp.time.toEpochMilli()
                    if (t < start.toEpochMilli() || t > end.toEpochMilli()) continue
                    if (curDay == null || t < curS || t >= curE) {
                        val d = LocalDate.ofInstant(smp.time, zone)
                        curDay = d; curS = d.atStartOfDay(zone).toInstant().toEpochMilli(); curE = d.plusDays(1).atStartOfDay(zone).toInstant().toEpochMilli()
                        curAcc = days.getOrPut(d) { DayHr(curS) }
                    }
                    curAcc!!.add(t, smp.beatsPerMinute)
                }
                count += res.records.size
                token = res.pageToken
            } while (token != null && count < 600_000)
            if (token != null) complete = false
        } catch (e: Exception) { if (e is kotlinx.coroutines.CancellationException) throw e; complete = false }
        if (!complete && days.isNotEmpty()) days.remove(days.firstKey())
        val arr = JSArray()
        for ((day, h) in days) {
            if (h.n == 0) continue
            val pts = JSArray()
            for (b in 0 until 288) if (h.bn[b] > 0) pts.put(JSArray().put(Math.round(h.bt[b] / h.bn[b] / 1000)).put(Math.round(h.bb[b] / h.bn[b])))
            arr.put(JSObject().put("date", day.toString()).put("min", h.min).put("max", h.max).put("avg", Math.round(h.sum / h.n)).put("hr", pts))
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
