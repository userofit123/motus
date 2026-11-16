package org.motus.app

import android.content.Intent
import android.os.Build
import androidx.activity.result.ActivityResult
import androidx.health.connect.client.HealthConnectClient
import androidx.health.connect.client.HealthConnectFeatures
import androidx.health.connect.client.PermissionController
import androidx.health.connect.client.aggregate.AggregateMetric
import androidx.health.connect.client.changes.DeletionChange
import androidx.health.connect.client.changes.UpsertionChange
import androidx.health.connect.client.permission.HealthPermission
import androidx.health.connect.client.records.*
import androidx.health.connect.client.records.metadata.DataOrigin
import androidx.health.connect.client.records.metadata.Device
import androidx.health.connect.client.request.AggregateGroupByPeriodRequest
import androidx.health.connect.client.request.AggregateRequest
import androidx.health.connect.client.request.ChangesTokenRequest
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
import org.json.JSONObject

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
    // Each kind the page knows by name (status, Settings' list), and the record type whose permission it is. Every kind
    // a band, watch, scale or phone app can write (M-239), but cycle tracking (not what Motus is for) and planned
    // workouts (plans, not what was done); exercise routes: see records().
    private val KINDS: List<Pair<String, KClass<out Record>>> = listOf(
        "steps" to StepsRecord::class, "sleep" to SleepSessionRecord::class, "weight" to WeightRecord::class,
        "sessions" to ExerciseSessionRecord::class, "heartRate" to HeartRateRecord::class, "restingHr" to RestingHeartRateRecord::class,
        "spo2" to OxygenSaturationRecord::class, "hrv" to HeartRateVariabilityRmssdRecord::class, "respiratoryRate" to RespiratoryRateRecord::class,
        "distance" to DistanceRecord::class, "activeKcal" to ActiveCaloriesBurnedRecord::class, "bodyFat" to BodyFatRecord::class,
        "hydration" to HydrationRecord::class, "vo2max" to Vo2MaxRecord::class, "elevation" to ElevationGainedRecord::class,
        "floors" to FloorsClimbedRecord::class,
        "totalKcal" to TotalCaloriesBurnedRecord::class, "bmr" to BasalMetabolicRateRecord::class, "speed" to SpeedRecord::class,
        "power" to PowerRecord::class, "skinTemp" to SkinTemperatureRecord::class, "bodyTemp" to BodyTemperatureRecord::class,
        "basalBodyTemp" to BasalBodyTemperatureRecord::class, "bloodPressure" to BloodPressureRecord::class,
        "bloodGlucose" to BloodGlucoseRecord::class, "height" to HeightRecord::class, "leanMass" to LeanBodyMassRecord::class,
        "boneMass" to BoneMassRecord::class, "bodyWater" to BodyWaterMassRecord::class, "wheelchairPushes" to WheelchairPushesRecord::class,
        "nutrition" to NutritionRecord::class,
        // mindfulness returns with the connect-client 1.1.0 upgrade: alpha12 asks for READ_MINDFULNESS_SESSION, which
        // Health Connect doesn't know (it is READ_MINDFULNESS), so it could never be allowed
    )
    // every type read: the kinds', and cadence, whose permissions are steps' and workouts' (Health Connect's own pairing)
    private val TYPES: List<KClass<out Record>> = KINDS.map { it.second } + listOf(StepsCadenceRecord::class, CyclingPedalingCadenceRecord::class)

    // the types this phone's Health Connect has: skin temperature came in newer versions, which say so
    // as a feature (asking for or reading a type the version lacks fails)
    private fun featureOn(c: HealthConnectClient, f: Int): Boolean = try {
        c.features.getFeatureStatus(f) == HealthConnectFeatures.FEATURE_STATUS_AVAILABLE
    } catch (e: Exception) { false }
    private fun offered(c: HealthConnectClient): List<KClass<out Record>> = TYPES.filter {
        when (it) {
            SkinTemperatureRecord::class -> featureOn(c, HealthConnectFeatures.FEATURE_SKIN_TEMPERATURE)
            else -> true
        }
    }

    // Health Connect is part of Android 14+, an app from the Play Store on 9-13, and missing below 9
    private fun sdk(): Int =
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.P) HealthConnectClient.SDK_UNAVAILABLE
        else HealthConnectClient.getSdkStatus(context)

    private fun client() = HealthConnectClient.getOrCreate(context)

    // Without this permission Health Connect hands out only the 30 days before the first grant; it exists only on
    // newer Health Connect versions, so it is asked for (and reported) only where the phone offers it
    private val HISTORY = HealthPermission.PERMISSION_READ_HEALTH_DATA_HISTORY
    private fun historyAvailable(c: HealthConnectClient): Boolean = featureOn(c, HealthConnectFeatures.FEATURE_READ_HEALTH_DATA_HISTORY)

    override fun handleOnDestroy() { scope.cancel() }

    /**
     * { available: "yes" | "update" | "no", granted: string[], offered: string[], history: boolean, historyAvailable: boolean }
     * ("update": the Health Connect app needs installing or updating; offered: the kinds this phone's Health Connect has;
     * history: data older than 30 days before the first grant may be read; historyAvailable: this phone's Health Connect
     * can grant that at all)
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
            out.put("granted", JSArray()).put("offered", JSArray()).put("history", false).put("historyAvailable", false); call.resolve(out); return
        }
        scope.launch {
            try {
                val c = client()
                val granted = c.permissionController.getGrantedPermissions()
                out.put("granted", JSArray(names(granted)))
                val has = offered(c).toSet()
                out.put("offered", JSArray(KINDS.filter { it.second in has }.map { it.first }))
                out.put("history", HISTORY in granted)
                out.put("historyAvailable", historyAvailable(c))
                call.resolve(out)
            } catch (e: Exception) { call.reject(e.message ?: "Health Connect could not be reached") }
        }
    }

    /**
     * Health Connect's own screen asking for the kinds (and past data) not allowed yet, only those: someone who allowed
     * an earlier version sees just the kinds added since, once, when they tap Allow. Resolves with what is granted
     * afterwards (straight away when there is nothing left to ask).
     */
    @PluginMethod
    fun connect(call: PluginCall) {
        if (sdk() != HealthConnectClient.SDK_AVAILABLE) { call.reject("Health Connect is not available"); return }
        scope.launch {
            try {
                val c = client()
                val all = offered(c).map { perm(it) }.toSet() + (if (historyAvailable(c)) setOf(HISTORY) else emptySet())
                val ask = all - c.permissionController.getGrantedPermissions()
                if (ask.isEmpty()) { status(call); return@launch }
                val intent = PermissionController.createRequestPermissionResultContract().createIntent(context, ask)
                activity.runOnUiThread { startActivityForResult(call, intent, "permissionsDone") }
            } catch (e: Exception) { call.reject(e.message ?: "Health Connect could not be reached") }
        }
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
     *   distance: [{date, value}], activeKcal: [{date, value}], (daily totals in metres and kcal; these two and steps
     *   also have worn: whether a band, watch or ring counted that day, and on such a day device: its kind, deviceName?)
     *   device?: {kind, name?} the worn device behind the newest such day (kind: watch | band | ring | chestStrap | unknown)
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
                val steps = if (has(StepsRecord::class)) dailyTotal(c, from, zone, StepsRecord::class, { it.startTime }, StepsRecord.COUNT_TOTAL, STEPS_PIECE) { it } else JSArray()
                val distance = if (has(DistanceRecord::class)) dailyTotal(c, from, zone, DistanceRecord::class, { it.startTime }, DistanceRecord.DISTANCE_TOTAL, {
                    Piece(it.startTime, it.endTime, it.startZoneOffset, it.endZoneOffset, it.distance.inMeters, it.metadata.lastModifiedTime) }) {
                    Math.round(it.inMeters) } else JSArray()
                val activeKcal = if (has(ActiveCaloriesBurnedRecord::class)) dailyTotal(c, from, zone, ActiveCaloriesBurnedRecord::class, { it.startTime },
                    ActiveCaloriesBurnedRecord.ACTIVE_CALORIES_TOTAL, { Piece(it.startTime, it.endTime, it.startZoneOffset, it.endZoneOffset,
                        it.energy.inKilocalories, it.metadata.lastModifiedTime) }) { Math.round(it.inKilocalories) } else JSArray()
                out.put("steps", steps).put("distance", distance).put("activeKcal", activeKcal)
                latestWorn(steps, distance, activeKcal)?.let { out.put("device", it) }
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
                    HydrationRecord.VOLUME_TOTAL, null, "ml") { Math.round(it.inMilliliters) } else JSArray())
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
     * steps: the band's only (bestBand), absent when no band, watch or ring counted then; bandOnly: steps were read
     * this way (an older build took the app with the most, often the phone's own counter). covered: the worn device's
     * data stands for the whole span (spanByApp, coverage: its step records reach past it on both sides; false when the band was off
     * or has not synced yet).
     * hr: at most 600 points. For an activity the worn device covered, also what it measured meanwhile (rangeBand):
     * distanceM, activeKcal, elevationM, floors, each absent when it had none; bandFields: this build reads them.
     * device, deviceName?: the kind of worn device whose steps these are (as in read()), with steps.
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
                val has = { t: KClass<out Record> -> perm(t) in granted }
                val results = JSArray()
                for (i in 0 until minOf(list.length(), 200)) {
                    val r = list.optJSONObject(i) ?: continue
                    val kind = r.optString("kind", ""); val id = r.opt("id")
                    val o = JSObject().put("kind", kind).put("id", id)
                    try {
                        val start = Instant.parse(r.getString("start")); val end = Instant.parse(r.getString("end"))
                        var covered = false
                        if ((hasSteps || hasHr) && end.isAfter(start)) {
                            val best = bestBand(spanByApp(c, start, end, hasSteps, hasHr))
                            covered = best?.coverage?.covered == true
                            if (hasSteps) {
                                best?.count?.let { n -> o.put("steps", n); putWorn(o, wornOf(best?.device)) }
                                o.put("bandOnly", true)
                            }
                            if (kind == "activity" && covered && best != null) {
                                val app = best.app
                                if (has(DistanceRecord::class)) rangeBand(c, DistanceRecord::class, app, start, end, { it.startTime to it.endTime }) { it.distance.inMeters }?.let { o.put("distanceM", it) }
                                if (has(ActiveCaloriesBurnedRecord::class)) rangeBand(c, ActiveCaloriesBurnedRecord::class, app, start, end, { it.startTime to it.endTime }) { it.energy.inKilocalories }?.let { o.put("activeKcal", it) }
                                if (has(ElevationGainedRecord::class)) rangeBand(c, ElevationGainedRecord::class, app, start, end, { it.startTime to it.endTime }) { it.elevation.inMeters }?.let { o.put("elevationM", it) }
                                if (has(FloorsClimbedRecord::class)) rangeBand(c, FloorsClimbedRecord::class, app, start, end, { it.startTime to it.endTime }) { it.floors }?.let { o.put("floors", it) }
                            }
                        }
                        if (kind == "activity") o.put("bandFields", true)
                        o.put("covered", covered)
                        if (hasHr && end.isAfter(start)) rangeHr(c, start, end)?.let { o.put("hr", it) }
                    } catch (e: Exception) {
                        if (e is kotlinx.coroutines.CancellationException) throw e
                        o.remove("steps"); o.remove("hr"); o.remove("bandOnly"); o.put("covered", false); o.remove("device"); o.remove("deviceName")
                        o.remove("bandFields"); o.remove("distanceM"); o.remove("activeKcal"); o.remove("elevationM"); o.remove("floors")
                    }
                    results.put(o)
                }
                call.resolve(JSObject().put("results", results))
            } catch (e: Exception) { call.reject(e.message ?: "Health Connect could not be read") }
        }
    }

    /**
     * Whether any app wrote, changed or removed something Motus may read since `token` (Health Connect's changes list):
     * one cheap call, so the page can look every minute and run the full read() only when there is something new.
     * { token?: string } → { changed: boolean, token: string, deleted: string[], touched: number[] } (no token, or one
     * Health Connect let expire: changed is true, and the new token starts from now; expired: true for the latter, as
     * the changes in between are lost and the page has to read everything again). deleted: the ids of records
     * deleted since, touched: the start times (unix seconds) of records written or changed since, so the page can delete
     * those here and read their days again (POST /health/records, M-238). A page of the list is taken whole (its token
     * is the only way on); after about 5000 of either (or 20 pages) the look stops there with more: true, and the token
     * it returns picks up the rest, so no deletion is skipped.
     */
    @PluginMethod
    fun changes(call: PluginCall) {
        if (sdk() != HealthConnectClient.SDK_AVAILABLE) { call.reject("Health Connect is not available"); return }
        val given = call.getString("token")
        scope.launch {
            try {
                val c = client()
                val granted = c.permissionController.getGrantedPermissions()
                val types = TYPES.filter { perm(it) in granted }.toSet()
                if (types.isEmpty()) { call.resolve(JSObject().put("changed", false).put("token", "")); return@launch }
                suspend fun fresh(): String = c.getChangesToken(ChangesTokenRequest(types))
                if (given.isNullOrEmpty()) { call.resolve(JSObject().put("changed", true).put("token", fresh())); return@launch }
                var token: String = given
                var changed = false; var more = false; var pages = 0
                val deleted = JSArray(); val touched = JSArray()
                while (true) {
                    val res = c.getChanges(token)
                    // what changed meanwhile is gone with the old token: expired says so, the page reads everything again
                    if (res.changesTokenExpired) { call.resolve(JSObject().put("changed", true).put("token", fresh()).put("expired", true)); return@launch }
                    if (res.changes.isNotEmpty()) changed = true
                    for (ch in res.changes) when (ch) {
                        is DeletionChange -> deleted.put(ch.recordId)
                        is UpsertionChange -> recordStart(ch.record)?.let { touched.put(it.epochSecond) }
                        else -> {}
                    }
                    token = res.nextChangesToken
                    if (!res.hasMore) break
                    // the rest waits for the next look, from this token: nothing is passed over unseen
                    if (deleted.length() >= 5000 || touched.length() >= 5000 || ++pages >= 20) { more = true; break }
                }
                call.resolve(JSObject().put("changed", changed).put("token", token).put("deleted", deleted).put("touched", touched).put("more", more))
            } catch (e: Exception) { call.reject(e.message ?: "Health Connect could not be read") }
        }
    }

    /**
     * Every record of every kind Motus may read that starts in [from, to) (ISO times), as Health Connect has it, for
     * POST /health/records (M-238; the engine says what each field is: modules/healthRecords.ts).
     * { from, to } → { from, to, tz, types: { [type]: { complete: boolean, records: [{id, s, e?, z, o, dv?, m, v? | p? | st?, x?, t?}] } } }
     * Health Connect picks records by their start time (or, for some versions, wants them to end inside too), so each
     * kind is read from a day earlier to a day later and only those starting inside are kept: a record never runs past a
     * day (sleep and sessions included, as far as Motus cares). complete: false when the read stopped at its cap
     * (readBetween), so the engine deletes nothing it didn't see. Kinds without permission are left out.
     */
    @PluginMethod
    fun records(call: PluginCall) {
        if (sdk() != HealthConnectClient.SDK_AVAILABLE) { call.reject("Health Connect is not available"); return }
        val from = try { Instant.parse(call.getString("from")) } catch (e: Exception) { call.reject("from is missing"); return }
        val to = try { Instant.parse(call.getString("to")) } catch (e: Exception) { Instant.now() }
        scope.launch {
            try {
                val c = client()
                val granted = c.permissionController.getGrantedPermissions()
                val zone = ZoneId.systemDefault()
                val types = JSObject()
                suspend fun <T : Record> kind(name: String, type: KClass<T>, start: (T) -> Instant, fill: (T, JSObject) -> Unit) {
                    if (perm(type) !in granted) return
                    val all = readBetween(c, type, from.minus(HR_RECORD_BACK), to.plus(HR_RECORD_BACK))
                    val list = JSArray()
                    for (r in all) {
                        val t = start(r)
                        if (t.isBefore(from) || !t.isBefore(to)) continue
                        val m = r.metadata
                        val o = JSObject().put("id", m.id).put("s", t.epochSecond).put("o", m.dataOrigin.packageName)
                            .put("m", m.lastModifiedTime.toEpochMilli()).put("z", zone.rules.getOffset(t).totalSeconds)
                        m.device?.let { d ->
                            val dv = JSObject().put("type", d.type)
                            d.manufacturer?.let { dv.put("maker", it) }; d.model?.let { dv.put("model", it) }
                            o.put("dv", dv)
                        }
                        fill(r, o)
                        list.put(o)
                    }
                    types.put(name, JSObject().put("complete", all.size < 50000).put("records", list))
                }
                // the zone the record was written with, when it says (else the phone's, above)
                fun iv(o: JSObject, e: Instant, z: ZoneOffset?) { o.put("e", e.epochSecond); z?.let { o.put("z", it.totalSeconds) } }
                fun at(o: JSObject, z: ZoneOffset?) { z?.let { o.put("z", it.totalSeconds) } }
                kind("steps", StepsRecord::class, { it.startTime }) { r, o -> iv(o, r.endTime, r.startZoneOffset); o.put("v", r.count) }
                kind("distance", DistanceRecord::class, { it.startTime }) { r, o -> iv(o, r.endTime, r.startZoneOffset); o.put("v", r.distance.inMeters) }
                kind("active_kcal", ActiveCaloriesBurnedRecord::class, { it.startTime }) { r, o -> iv(o, r.endTime, r.startZoneOffset); o.put("v", r.energy.inKilocalories) }
                kind("floors", FloorsClimbedRecord::class, { it.startTime }) { r, o -> iv(o, r.endTime, r.startZoneOffset); o.put("v", r.floors) }
                kind("elevation", ElevationGainedRecord::class, { it.startTime }) { r, o -> iv(o, r.endTime, r.startZoneOffset); o.put("v", r.elevation.inMeters) }
                kind("hydration", HydrationRecord::class, { it.startTime }) { r, o -> iv(o, r.endTime, r.startZoneOffset); o.put("v", r.volume.inMilliliters) }
                kind("heart_rate", HeartRateRecord::class, { it.startTime }) { r, o ->
                    iv(o, r.endTime, r.startZoneOffset)
                    o.put("p", JSArray().also { a -> for (x in r.samples) a.put(JSArray().put(x.time.epochSecond).put(x.beatsPerMinute)) })
                }
                kind("sleep", SleepSessionRecord::class, { it.startTime }) { r, o ->
                    // a night is filed by the day it ends (the engine's recordDay, wakeDay below), so its zone is the end's
                    o.put("e", r.endTime.epochSecond).put("z", (r.endZoneOffset ?: zone.rules.getOffset(r.endTime)).totalSeconds)
                    o.put("st", JSArray().also { a -> for (x in r.stages) a.put(JSArray().put(x.startTime.epochSecond).put(x.endTime.epochSecond).put(x.stage)) })
                    r.title?.let { o.put("t", it) }
                }
                // laps and segments a watch recorded with the workout (M-239). Not its route: Health Connect hands another
                // app's route only after asking the person about that one workout (ExerciseRouteRequestContract), a
                // prompt per session that a background read can't show, so routes are left out
                kind("exercise", ExerciseSessionRecord::class, { it.startTime }) { r, o ->
                    iv(o, r.endTime, r.startZoneOffset); o.put("x", r.exerciseType); r.title?.let { o.put("t", it) }
                    if (r.laps.isNotEmpty()) o.put("lp", JSArray().also { a -> for (l in r.laps) a.put(JSArray().put(l.startTime.epochSecond).put(l.endTime.epochSecond).also { q -> l.length?.let { q.put(it.inMeters) } }) })
                    if (r.segments.isNotEmpty()) o.put("sg", JSArray().also { a -> for (g in r.segments) a.put(JSArray().put(g.startTime.epochSecond).put(g.endTime.epochSecond).put(g.segmentType).put(g.repetitions)) })
                }
                kind("resting_hr", RestingHeartRateRecord::class, { it.time }) { r, o -> at(o, r.zoneOffset); o.put("v", r.beatsPerMinute) }
                kind("spo2", OxygenSaturationRecord::class, { it.time }) { r, o -> at(o, r.zoneOffset); o.put("v", r.percentage.value) }
                kind("hrv", HeartRateVariabilityRmssdRecord::class, { it.time }) { r, o -> at(o, r.zoneOffset); o.put("v", r.heartRateVariabilityMillis) }
                kind("resp_rate", RespiratoryRateRecord::class, { it.time }) { r, o -> at(o, r.zoneOffset); o.put("v", r.rate) }
                kind("vo2max", Vo2MaxRecord::class, { it.time }) { r, o -> at(o, r.zoneOffset); o.put("v", r.vo2MillilitersPerMinuteKilogram) }
                kind("weight", WeightRecord::class, { it.time }) { r, o -> at(o, r.zoneOffset); o.put("v", r.weight.inKilograms) }
                kind("body_fat", BodyFatRecord::class, { it.time }) { r, o -> at(o, r.zoneOffset); o.put("v", r.percentage.value) }
                // read since M-239 (the engine's healthRecords.ts says what each field is); a: what else Health Connect says
                fun samples(o: JSObject, list: List<Pair<Instant, Double>>) = o.put("p", JSArray().also { a -> for ((t, v) in list) a.put(JSArray().put(t.epochSecond).put(v)) })
                kind("total_kcal", TotalCaloriesBurnedRecord::class, { it.startTime }) { r, o -> iv(o, r.endTime, r.startZoneOffset); o.put("v", r.energy.inKilocalories) }
                kind("wheelchair_pushes", WheelchairPushesRecord::class, { it.startTime }) { r, o -> iv(o, r.endTime, r.startZoneOffset); o.put("v", r.count) }
                kind("speed", SpeedRecord::class, { it.startTime }) { r, o -> iv(o, r.endTime, r.startZoneOffset); samples(o, r.samples.map { it.time to it.speed.inMetersPerSecond }) }
                kind("power", PowerRecord::class, { it.startTime }) { r, o -> iv(o, r.endTime, r.startZoneOffset); samples(o, r.samples.map { it.time to it.power.inWatts }) }
                kind("steps_cadence", StepsCadenceRecord::class, { it.startTime }) { r, o -> iv(o, r.endTime, r.startZoneOffset); samples(o, r.samples.map { it.time to it.rate }) }
                kind("cycling_cadence", CyclingPedalingCadenceRecord::class, { it.startTime }) { r, o -> iv(o, r.endTime, r.startZoneOffset); samples(o, r.samples.map { it.time to it.revolutionsPerMinute }) }
                kind("skin_temp", SkinTemperatureRecord::class, { it.startTime }) { r, o ->
                    iv(o, r.endTime, r.startZoneOffset); samples(o, r.deltas.map { it.time to it.delta.inCelsius })
                    r.baseline?.let { o.put("v", it.inCelsius) }; o.put("a", JSObject().put("loc", r.measurementLocation))
                }
                kind("nutrition", NutritionRecord::class, { it.startTime }) { r, o ->
                    iv(o, r.endTime, r.startZoneOffset); r.energy?.let { o.put("v", it.inKilocalories) }
                    val a = JSObject().put("meal", r.mealType)
                    r.name?.let { a.put("name", it) }; r.energyFromFat?.let { a.put("kcalFromFat", it.inKilocalories) }
                    // grams of each nutrient the app filled in
                    for ((k, m) in listOf("protein" to r.protein, "carbs" to r.totalCarbohydrate, "fat" to r.totalFat, "sugar" to r.sugar,
                        "fiber" to r.dietaryFiber, "saturatedFat" to r.saturatedFat, "unsaturatedFat" to r.unsaturatedFat,
                        "monounsaturatedFat" to r.monounsaturatedFat, "polyunsaturatedFat" to r.polyunsaturatedFat, "transFat" to r.transFat,
                        "cholesterol" to r.cholesterol, "sodium" to r.sodium, "potassium" to r.potassium, "calcium" to r.calcium,
                        "iron" to r.iron, "magnesium" to r.magnesium, "zinc" to r.zinc, "phosphorus" to r.phosphorus, "caffeine" to r.caffeine,
                        "vitaminA" to r.vitaminA, "vitaminB6" to r.vitaminB6, "vitaminB12" to r.vitaminB12, "vitaminC" to r.vitaminC,
                        "vitaminD" to r.vitaminD, "vitaminE" to r.vitaminE, "vitaminK" to r.vitaminK, "biotin" to r.biotin, "folate" to r.folate,
                        "folicAcid" to r.folicAcid, "niacin" to r.niacin, "pantothenicAcid" to r.pantothenicAcid, "riboflavin" to r.riboflavin,
                        "thiamin" to r.thiamin, "chloride" to r.chloride, "chromium" to r.chromium, "copper" to r.copper, "iodine" to r.iodine,
                        "manganese" to r.manganese, "molybdenum" to r.molybdenum, "selenium" to r.selenium))
                        m?.let { a.put(k, it.inGrams) }
                    o.put("a", a)
                }
                kind("bmr", BasalMetabolicRateRecord::class, { it.time }) { r, o -> at(o, r.zoneOffset); o.put("v", r.basalMetabolicRate.inKilocaloriesPerDay) }
                kind("body_temp", BodyTemperatureRecord::class, { it.time }) { r, o ->
                    at(o, r.zoneOffset); o.put("v", r.temperature.inCelsius); o.put("a", JSObject().put("loc", r.measurementLocation))
                }
                kind("basal_body_temp", BasalBodyTemperatureRecord::class, { it.time }) { r, o ->
                    at(o, r.zoneOffset); o.put("v", r.temperature.inCelsius); o.put("a", JSObject().put("loc", r.measurementLocation))
                }
                kind("blood_pressure", BloodPressureRecord::class, { it.time }) { r, o ->
                    at(o, r.zoneOffset); o.put("v", r.systolic.inMillimetersOfMercury)
                    o.put("a", JSObject().put("dia", r.diastolic.inMillimetersOfMercury).put("pos", r.bodyPosition).put("loc", r.measurementLocation))
                }
                kind("blood_glucose", BloodGlucoseRecord::class, { it.time }) { r, o ->
                    at(o, r.zoneOffset); o.put("v", r.level.inMillimolesPerLiter)
                    o.put("a", JSObject().put("specimen", r.specimenSource).put("meal", r.mealType).put("relation", r.relationToMeal))
                }
                kind("height", HeightRecord::class, { it.time }) { r, o -> at(o, r.zoneOffset); o.put("v", r.height.inMeters) }
                kind("lean_mass", LeanBodyMassRecord::class, { it.time }) { r, o -> at(o, r.zoneOffset); o.put("v", r.mass.inKilograms) }
                kind("bone_mass", BoneMassRecord::class, { it.time }) { r, o -> at(o, r.zoneOffset); o.put("v", r.mass.inKilograms) }
                kind("body_water", BodyWaterMassRecord::class, { it.time }) { r, o -> at(o, r.zoneOffset); o.put("v", r.mass.inKilograms) }
                call.resolve(JSObject().put("from", from.toString()).put("to", to.toString()).put("types", types))
            } catch (e: Exception) { call.reject(e.message ?: "Health Connect could not be read") }
        }
    }

    // A record's start (or, for a reading, its time), per type: Health Connect's IntervalRecord and InstantaneousRecord
    // aren't public. null for a type Motus doesn't read.
    private fun recordStart(r: Record): Instant? = when (r) {
        is StepsRecord -> r.startTime
        is SleepSessionRecord -> r.startTime
        is ExerciseSessionRecord -> r.startTime
        is HeartRateRecord -> r.startTime
        is DistanceRecord -> r.startTime
        is ActiveCaloriesBurnedRecord -> r.startTime
        is HydrationRecord -> r.startTime
        is ElevationGainedRecord -> r.startTime
        is FloorsClimbedRecord -> r.startTime
        is WeightRecord -> r.time
        is RestingHeartRateRecord -> r.time
        is OxygenSaturationRecord -> r.time
        is HeartRateVariabilityRmssdRecord -> r.time
        is RespiratoryRateRecord -> r.time
        is BodyFatRecord -> r.time
        is Vo2MaxRecord -> r.time
        is TotalCaloriesBurnedRecord -> r.startTime
        is WheelchairPushesRecord -> r.startTime
        is SpeedRecord -> r.startTime
        is PowerRecord -> r.startTime
        is StepsCadenceRecord -> r.startTime
        is CyclingPedalingCadenceRecord -> r.startTime
        is SkinTemperatureRecord -> r.startTime
        is NutritionRecord -> r.startTime
        is BasalMetabolicRateRecord -> r.time
        is BodyTemperatureRecord -> r.time
        is BasalBodyTemperatureRecord -> r.time
        is BloodPressureRecord -> r.time
        is BloodGlucoseRecord -> r.time
        is HeightRecord -> r.time
        is LeanBodyMassRecord -> r.time
        is BoneMassRecord -> r.time
        is BodyWaterMassRecord -> r.time
        else -> null
    }

    /**
     * The start (or time) of the oldest record Motus may read, of any kind: where the back-fill of every record
     * (records(), M-238) stops. { at?: ISO time } (absent when there is none). One read per kind, oldest first, one record.
     */
    @PluginMethod
    fun oldest(call: PluginCall) {
        if (sdk() != HealthConnectClient.SDK_AVAILABLE) { call.reject("Health Connect is not available"); return }
        scope.launch {
            try {
                val c = client()
                val granted = c.permissionController.getGrantedPermissions()
                var oldest: Instant? = null
                for (type in TYPES) {
                    if (perm(type) !in granted) continue
                    val r = c.readRecords(ReadRecordsRequest(type, TimeRangeFilter.before(Instant.now().plusSeconds(86400)), ascendingOrder = true, pageSize = 1)).records.firstOrNull()
                    val t = r?.let { recordStart(it) } ?: continue
                    if (oldest == null || t.isBefore(oldest)) oldest = t
                }
                call.resolve(JSObject().also { o -> oldest?.let { o.put("at", it.toString()) } })
            } catch (e: Exception) { call.reject(e.message ?: "Health Connect could not be read") }
        }
    }

    /**
     * Heart rate measured after `since` (an ISO time), for showing it live during a workout: called every minute, so
     * one read (records reaching back HR_RECORD_BACK, newest first, at most 2 pages). { samples: [[unixSeconds, bpm], ...] }
     * ascending, at most 600 (the newest); empty without Health Connect or the heart rate permission.
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
                    val res = c.readRecords(ReadRecordsRequest(HeartRateRecord::class, TimeRangeFilter.after(since.minus(HR_RECORD_BACK)),
                        ascendingOrder = false, pageSize = 1000, pageToken = token))
                    for (r in res.records) for (s in r.samples) if (s.time.isAfter(since)) samples += s
                    token = res.pageToken; pages++
                } while (token != null && pages < 2)
                val out = JSArray()
                for (s in samples.sortedBy { it.time }.takeLast(600)) out.put(JSArray().put(s.time.epochSecond).put(s.beatsPerMinute))
                call.resolve(JSObject().put("samples", out))
            } catch (e: Exception) { call.reject(e.message ?: "Health Connect could not be read") }
        }
    }

    // Health Connect picks interval records by their start time, and a band app's heart rate record can start long
    // before the moment asked about: Gadgetbridge writes one record per unbroken run of readings since its last sync
    // (up to 1000 readings, cut at midnight and at gaps over 15 minutes), so the record holding a workout's readings
    // usually starts before the workout did, and a read from the workout's start left it out (no live heart rate, and
    // a finished workout missing its start or all of it). Heart rate reads start this much earlier and keep only the
    // samples inside: a record never spans more than a day.
    private val HR_RECORD_BACK = java.time.Duration.ofHours(24)
    private suspend fun hrBetween(c: HealthConnectClient, start: Instant, end: Instant) =
        readBetween(c, HeartRateRecord::class, start.minus(HR_RECORD_BACK), end).filter { it.endTime.isAfter(start) }

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

    // Whether a worn device's numbers stand for a whole span (an activity recorded in Motus): one rule for its steps
    // (readRanges), what else it measured then (rangeBand) and the activity's Step sources sheet (activitySources).
    // A band app writes step records only for minutes with steps (Gadgetbridge), so a hole in them inside a walk is
    // standing still, 0 steps, not missing data. What says the data is all there: the device's app has step records
    // reaching past the walk on both sides, one at or before the start and one at or after the end, each within 30
    // minutes (it synced past the walk). Heart rate is never asked: its measuring may be off while steps almost never are.
    private val SYNC_SLACK_MS = 30L * 60 * 1000
    // why: null when covered, else "after" (no step record at or after the end: not synced yet) or "before" (none at or
    // before the start)
    private class Coverage(val covered: Boolean, val why: String?)
    // One app's numbers around a span: its step records (from 30 minutes before to 30 after), the steps inside (records
    // crossing the edges count by their share of time inside; count null when it has no step record inside), its heart
    // rate sample times and the device its records name. band: a band's, watch's or ring's (isBand, per record: an app
    // may write both the phone's and a watch's). coverage: for a band only (the phone's own counting is never the device's).
    private class AppSpan(val app: String, val band: Boolean, val steps: List<StepsRecord>, val raw: Double, val inside: Boolean,
                          val hr: List<Instant>, val device: Device?) {
        var coverage = Coverage(false, null)
        val count: Long? get() = if (inside) Math.round(raw) else null
    }
    private fun named(devices: List<Device?>): Device? = devices.firstOrNull { d -> d?.type.let { it != null && it != Device.TYPE_UNKNOWN } } ?: devices.firstOrNull()
    private suspend fun spanByApp(c: HealthConnectClient, start: Instant, end: Instant, hasSteps: Boolean, hasHr: Boolean): List<AppSpan> {
        val from = start.minusMillis(SYNC_SLACK_MS); val to = end.plusMillis(SYNC_SLACK_MS)
        val steps = if (hasSteps) readBetween(c, StepsRecord::class, from, to) else emptyList()
        val hrRecs = if (hasHr) hrBetween(c, from, to).filter { isBand(it.metadata.dataOrigin.packageName, it.metadata.device?.type) } else emptyList()
        fun crosses(s: StepsRecord) = if (s.startTime == s.endTime) !s.startTime.isBefore(start) && !s.startTime.isAfter(end) else s.endTime.isAfter(start) && s.startTime.isBefore(end)
        fun inside(s: StepsRecord): Double {
            val len = s.endTime.toEpochMilli() - s.startTime.toEpochMilli()
            if (len <= 0) return s.count.toDouble()
            val a = maxOf(s.startTime, start).toEpochMilli(); val b = minOf(s.endTime, end).toEpochMilli()
            return s.count.toDouble() * (b - a).coerceAtLeast(0) / len
        }
        val stepGroups = steps.groupBy { it.metadata.dataOrigin.packageName to isBand(it.metadata.dataOrigin.packageName, it.metadata.device?.type) }
            .mapValues { (_, g) -> once(g) { it.startTime to it.endTime } }
        val hrGroups = hrRecs.groupBy { it.metadata.dataOrigin.packageName }
        val keys = stepGroups.keys + hrGroups.keys.map { it to true }
        return keys.map { key ->
            val recs = stepGroups[key].orEmpty()
            val hr = if (key.second) hrGroups[key.first].orEmpty() else emptyList()
            val inSpan = recs.filter { crosses(it) }
            val span = AppSpan(key.first, key.second, recs, inSpan.sumOf { inside(it) }, inSpan.isNotEmpty(),
                hr.flatMap { r -> r.samples.map { it.time } }.filter { !it.isBefore(from) && !it.isAfter(to) }.sorted(),
                named(inSpan.map { it.metadata.device } + hr.map { it.metadata.device } + recs.map { it.metadata.device }))
            if (span.band) span.coverage = coverage(span, start, end)
            span
        }.filter { it.inside || it.hr.isNotEmpty() }
    }
    private fun coverage(a: AppSpan, start: Instant, end: Instant): Coverage {
        // a record overlapping the edge or ending/starting within 30 minutes of it (the read already covers that much)
        val before = a.steps.any { !it.startTime.isAfter(start) }
        val after = a.steps.any { !it.endTime.isBefore(end) }
        if (!after) return Coverage(false, "after")
        if (!before) return Coverage(false, "before")
        return Coverage(true, null)
    }
    // The worn device whose numbers stand for the span: the band app with the most steps inside it (two apps writing for
    // the same band: the larger), else one with heart rate then (a type without steps). Only a band, watch or ring
    // (isBand): the phone's own step counter is the same sensor Motus counted with, not the band.
    private fun bestBand(spans: List<AppSpan>): AppSpan? = spans.filter { it.band }.maxWithOrNull(compareBy<AppSpan>({ it.inside }, { it.raw }, { it.hr.size }))

    // What the band, watch or ring measured in the span (distance, active calories, climb): records crossing the edges
    // count by their share of time inside, as for steps; only the worn device's app whose coverage was checked (bestBand),
    // never the phone's own counting. null when it measured nothing then.
    // (span: a record's start and end time, given per type: Health Connect's IntervalRecord isn't public)
    private suspend fun <T : Record> rangeBand(c: HealthConnectClient, type: KClass<T>, app: String, start: Instant, end: Instant, span: (T) -> Pair<Instant, Instant>, amount: (T) -> Double): Double? {
        val recs = once(readBetween(c, type, start, end).filter {
            val (s, e) = span(it)
            e.isAfter(start) && s.isBefore(end) && it.metadata.dataOrigin.packageName == app && isBand(app, it.metadata.device?.type)
        }, span)
        if (recs.isEmpty()) return null
        fun inside(r: T): Double {
            val (s, e) = span(r)
            val len = e.toEpochMilli() - s.toEpochMilli()
            if (len <= 0) return amount(r)
            val a = maxOf(s, start).toEpochMilli(); val b = minOf(e, end).toEpochMilli()
            return amount(r) * (b - a).coerceAtLeast(0) / len
        }
        val total = recs.sumOf { inside(it) }
        return if (total > 0) Math.round(total * 10) / 10.0 else null
    }

    // An app's records added up one by one, as the band's own app shows them. Health Connect's own total for one app
    // (aggregate with dataOriginFilter) is not that: it filters by app first, but then lets only one record count for
    // each moment where records overlap (the most recently changed; AOSP PriorityRecordsAggregator /
    // ValueColumnAggregationData), so where the band app's records overlap each other the overlapped part is dropped
    // (14 Nov: Gadgetbridge 5,036 in its own app and in Health Connect's app list, its aggregate 4,821). Only exact
    // duplicates (same start and end from the same app) count once, the most recently changed as Health Connect keeps.
    private fun <T : Record> once(recs: List<T>, span: (T) -> Pair<Instant, Instant>): List<T> =
        recs.groupBy { Triple(it.metadata.dataOrigin.packageName, span(it).first, span(it).second) }.values
            .map { same -> same.maxBy { it.metadata.lastModifiedTime } }

    // one record for adding up per day: its time span with the offsets it was written in, its amount and when it changed
    private class Piece(val start: Instant, val end: Instant, val startOffset: ZoneOffset?, val endOffset: ZoneOffset?, val amount: Double, val modified: Instant)
    private val STEPS_PIECE = { r: StepsRecord -> Piece(r.startTime, r.endTime, r.startZoneOffset, r.endZoneOffset, r.count.toDouble(), r.metadata.lastModifiedTime) }

    // Adds one app's records in the range to `into`, per local day (the record's own offset, as Health Connect's day
    // totals do); a record across midnight is split by its share of time on each side. Read in pages of 5000: one paged
    // read per app and 90 days, never one call per day (Health Connect's rate limit).
    private suspend fun <R : Record> ownDays(c: HealthConnectClient, type: KClass<R>, range: TimeRangeFilter, o: DataOrigin, zone: ZoneId,
                                             piece: (R) -> Piece, into: MutableMap<LocalDate, Double>) {
        val kept = HashMap<Pair<Instant, Instant>, Piece>()
        var token: String? = null; var pages = 0
        do {
            val res = c.readRecords(ReadRecordsRequest(type, range, dataOriginFilter = setOf(o), pageSize = 5000, pageToken = token))
            for (r in res.records) {
                val p = piece(r); val k = p.start to p.end
                val cur = kept[k]
                if (cur == null || p.modified.isAfter(cur.modified)) kept[k] = p
            }
            token = res.pageToken
        } while (token != null && ++pages < 200)
        for (p in kept.values) addByDay(p, zone, into)
    }
    private fun addByDay(p: Piece, zone: ZoneId, into: MutableMap<LocalDate, Double>) {
        val s = LocalDateTime.ofInstant(p.start, p.startOffset ?: zone.rules.getOffset(p.start))
        val e = LocalDateTime.ofInstant(p.end, p.endOffset ?: zone.rules.getOffset(p.end))
        val sMs = s.toInstant(ZoneOffset.UTC).toEpochMilli(); val eMs = e.toInstant(ZoneOffset.UTC).toEpochMilli()
        if (eMs <= sMs) { val d = s.toLocalDate(); into[d] = (into[d] ?: 0.0) + p.amount; return }
        var d = s.toLocalDate()
        while (!d.isAfter(e.toLocalDate())) {
            val a = maxOf(sMs, d.atStartOfDay().toInstant(ZoneOffset.UTC).toEpochMilli())
            val b = minOf(eMs, d.plusDays(1).atStartOfDay().toInstant(ZoneOffset.UTC).toEpochMilli())
            if (b > a) into[d] = (into[d] ?: 0.0) + p.amount * (b - a) / (eMs - sMs)
            d = d.plusDays(1)
        }
    }

    // Heart rate samples in the span as [unixSeconds, bpm], averaged into at most 600 time buckets. Only a worn device's
    // (isBand, as for steps): an app on the phone may write a reading measured some other way. No coverage needed: any
    // reading inside the span is the person's heart rate then, and one is enough (a band may measure only every 10 minutes).
    private suspend fun rangeHr(c: HealthConnectClient, start: Instant, end: Instant): JSArray? {
        val samples = hrBetween(c, start, end)
            .filter { isBand(it.metadata.dataOrigin.packageName, it.metadata.device?.type) }.flatMap { it.samples }
            .filter { !it.time.isBefore(start) && !it.time.isAfter(end) }
            // each second once, as the server's onePerSecond: the same readings from two apps count once, so the
            // phone's answer and the server's agree
            .distinctBy { it.time.epochSecond }
            .sortedBy { it.time }
        if (samples.isEmpty()) return null
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

    private fun names(granted: Set<String>): List<String> = KINDS.filter { perm(it.second) in granted }.map { it.first }

    // Daily totals (steps, distance, active calories; water sums every app, piece null). Health Connect adds up each day
    // itself, but where its first app (the band) has no record for a moment it adds the next one's (the phone's own step
    // counter, Google Fit), so a day read thousands of steps more than the band and Health Connect's own screen showed
    // (14 Nov: band 3,656, Motus 6,205). So on a day a band, watch or ring counted anything (bandOrigin), the day is that
    // device's own total only (the largest, if two apps write for the same band), as Gadgetbridge shows it: its records
    // added up by Motus (ownDays), since Health Connect's per-app total drops what overlaps within the app. On a day
    // without one, Health Connect's total stands and says so (worn false: "from Health Connect", not "from your band").
    // A long range (years) is asked for 90 days at a time: one request for thousands of day buckets can fail.
    private suspend fun <R : Record, T : Any> dailyTotal(c: HealthConnectClient, from: Instant, zone: ZoneId, type: KClass<R>, startOf: (R) -> Instant,
                                                       metric: AggregateMetric<T>, piece: ((R) -> Piece)?, key: String = "value", value: (T) -> Any): JSArray {
        // start at the oldest record Health Connect will give us, not at `from`: "everything" asks from 2000, and
        // one aggregate call per 90 days since then would run into Health Connect's rate limit and fail the whole read
        val first = c.readRecords(ReadRecordsRequest(type, TimeRangeFilter.after(from), ascendingOrder = true, pageSize = 1)).records.firstOrNull()
            ?: return JSArray()
        var day = maxOf(from, startOf(first)).atZone(zone).toLocalDate()
        val end = LocalDate.now(zone).plusDays(1)
        val worn = mutableMapOf<String, Worn?>() // per app: the worn device it writes for, null when it isn't one
        val own = mutableMapOf<String, MutableMap<LocalDate, Double>>() // per band app: its own total per day
        val days = mutableListOf<Pair<LocalDate, T>>() // Health Connect's total per day
        while (day.isBefore(end)) {
            val next = minOf(day.plusDays(90), end)
            val range = TimeRangeFilter.between(day.atStartOfDay(), next.atStartOfDay())
            val res = c.aggregateGroupByPeriod(AggregateGroupByPeriodRequest(setOf(metric), range, Period.ofDays(1)))
            for (r in res) r.result[metric]?.let { days += r.startTime.toLocalDate() to it }
            if (piece != null) {
                val origins = res.flatMap { it.result.dataOrigins }.toSet()
                for (o in origins) if (o.packageName !in worn) worn[o.packageName] = bandOrigin(c, type, range, o)
                // a failure here fails the whole read (not this band's days quietly saved with the phone's steps mixed
                // in), so the read isn't remembered as done and the next sync asks again. A record across midnight at
                // the end of a block adds its share to the next block's first day too, so the days are kept for all blocks.
                for (o in origins) if (worn[o.packageName] != null) ownDays(c, type, range, o, zone, piece, own.getOrPut(o.packageName) { mutableMapOf() })
            }
            day = next
        }
        val arr = JSArray()
        for ((date, n) in days) {
            var b: Double? = null; var w: Worn? = null
            for ((pkg, totals) in own) {
                val v = totals[date] ?: continue
                if (v > 0 && (b == null || v > b)) { b = v; w = worn[pkg] }
            }
            val o = JSObject().put("date", date.toString()).put(key, if (b != null) Math.round(b) else value(n))
            if (piece != null) o.put("worn", b != null)
            if (b != null) w?.let { putWorn(o, it) }
            arr.put(o)
        }
        return arr
    }

    // Which apps' data comes from a band, watch or ring. Health Connect also holds steps the phone counted itself: its own
    // step tracking (package "android", or "com.android.healthconnect.phone.<id>" since mid 2026), Google Fit, a phone
    // maker's health app. Those count the same sensor Motus's own pedometer reads, so taking them for the band's made a
    // walk say "From your band" with exactly the phone's count. A band app's records say so by their device type, but
    // Gadgetbridge writes "unknown" for gadgets it has no kind for, so known band apps count as a band as well; Samsung
    // Health and other apps that also count on the phone only when their records say watch, band or ring.
    private val WORN = setOf(Device.TYPE_WATCH, Device.TYPE_FITNESS_BAND, Device.TYPE_RING, Device.TYPE_CHEST_STRAP)
    private val PHONE_APPS = setOf("android", "com.google.android.apps.fitness", "com.google.android.apps.healthdata", "com.mi.health")
    private val BAND_APPS = listOf(
        "nodomain.freeyourgadget.gadgetbridge", // Gadgetbridge, with its nightly and other builds (".nightly", ...)
        "com.xiaomi.wearable", "com.xiaomi.hm.health", "com.huami.watch.hmwatchmanager", "com.huami.midong", // Mi Fitness, Mi Fit / Zepp Life, Zepp, Amazfit
        "com.fitbit.FitbitMobile", "com.garmin.android.apps.connectmobile", "com.huawei.health", "com.ouraring.oura",
        "com.whoop.android", "fi.polar.polarflow", "com.suunto.android",
    )
    private fun phoneApp(pkg: String) = pkg in PHONE_APPS || pkg.startsWith("com.android.healthconnect") || pkg.startsWith("com.google.android.healthconnect")
    private fun isBand(pkg: String, deviceType: Int?): Boolean {
        if (pkg == context.packageName || phoneApp(pkg) || deviceType == Device.TYPE_PHONE) return false
        if (deviceType != null && deviceType in WORN) return true
        return BAND_APPS.any { pkg == it || pkg.startsWith("$it.") }
    }
    // an app's records in the range: the worn device it writes for, or null when it isn't one. Its kind comes from its
    // newest record that names a type (not just its first: an app may write some records without one, and the first in a
    // window that moves every read would make the kind come and go), else the newest record's ("unknown" kind).
    private suspend fun <R : Record> bandOrigin(c: HealthConnectClient, type: KClass<R>, range: TimeRangeFilter, o: DataOrigin): Worn? {
        val records = c.readRecords(ReadRecordsRequest(type, range, dataOriginFilter = setOf(o), ascendingOrder = false, pageSize = 100)).records
        val typed = records.firstOrNull { r -> r.metadata.device?.type.let { it != null && it != Device.TYPE_UNKNOWN } }
        val d = (typed ?: records.firstOrNull())?.metadata?.device
        return if (isBand(o.packageName, d?.type)) wornOf(d) else null
    }

    // Which kind of worn device a day's or a span's numbers came from, so the app says "your watch" or "your ring" and
    // not "your band" for everyone: watch, band, ring, chestStrap, or unknown (Gadgetbridge writes no kind for many
    // gadgets; the app then uses a neutral word). name: its maker and model when the record says, else absent.
    private class Worn(val kind: String, val name: String?)
    private fun wornOf(d: Device?): Worn {
        val kind = when (d?.type) {
            Device.TYPE_WATCH -> "watch"; Device.TYPE_FITNESS_BAND -> "band"; Device.TYPE_RING -> "ring"; Device.TYPE_CHEST_STRAP -> "chestStrap"
            else -> "unknown"
        }
        val maker = d?.manufacturer?.trim().orEmpty(); val model = d?.model?.trim().orEmpty()
        val name = if (maker.isNotEmpty() && !model.startsWith(maker, ignoreCase = true)) "$maker $model".trim() else model.ifEmpty { maker }
        return Worn(kind, name.takeIf { it.isNotEmpty() }?.take(60))
    }
    private fun putWorn(o: JSONObject, w: Worn) { o.put("device", w.kind); if (w.name != null) o.put("deviceName", w.name) }
    // the device behind the newest day a worn device of a known kind counted (steps first, then distance, then active
    // calories), for an engine of the release before, which saved it as the person's: an "unknown" day is skipped, so it
    // never takes a known kind away there. A newer engine takes each day's own device instead.
    private fun latestWorn(vararg days: JSArray): JSObject? {
        var best: JSONObject? = null
        for (a in days) for (i in a.length() - 1 downTo 0) {
            val d = a.optJSONObject(i) ?: continue
            if (!d.has("device") || d.optString("device") == "unknown") continue
            if (best == null || d.optString("date") > best.optString("date")) best = d
            break
        }
        val b = best ?: return null
        return JSObject().put("kind", b.getString("device")).also { if (b.has("deviceName")) it.put("name", b.getString("deviceName")) }
    }

    private fun deviceName(t: Int?): String = when (t) {
        Device.TYPE_WATCH -> "watch"; Device.TYPE_FITNESS_BAND -> "band"; Device.TYPE_RING -> "ring"; Device.TYPE_CHEST_STRAP -> "chest strap"
        Device.TYPE_PHONE -> "phone"; Device.TYPE_SCALE -> "scale"; else -> "unknown"
    }
    // the name Health Connect shows the phone's own steps under ("Robin"): the name set in the phone's settings
    private fun phoneName(): String = try {
        android.provider.Settings.Global.getString(context.contentResolver, "device_name")?.takeIf { it.isNotBlank() } ?: Build.MODEL
    } catch (e: Exception) { Build.MODEL }
    private fun appLabel(pkg: String): String? = try {
        val pm = context.packageManager
        @Suppress("DEPRECATION") pm.getApplicationLabel(pm.getApplicationInfo(pkg, 0)).toString()
    } catch (e: Exception) { null }

    /**
     * Where one day's steps came from, so the person can check what Motus used (Settings → Integrations → Imported data):
     * { date, total: Health Connect's own total, used: the band app whose count is the day's, or null (Health Connect's
     *   total), phoneName: this phone's name, sources: [{ app: package, label?: its name on this phone, steps, band: boolean,
     *   phone: the phone's own step counting, device: "band" | "watch" | "phone" | "unknown" | ... }] }
     */
    @PluginMethod
    fun stepSources(call: PluginCall) {
        if (sdk() != HealthConnectClient.SDK_AVAILABLE) { call.reject("Health Connect is not available"); return }
        val date = try { LocalDate.parse(call.getString("date")) } catch (e: Exception) { call.reject("Pick a day"); return }
        scope.launch {
            try {
                val c = client()
                if (perm(StepsRecord::class) !in c.permissionController.getGrantedPermissions()) { call.reject("Motus may not read steps"); return@launch }
                val range = TimeRangeFilter.between(date.atStartOfDay(), date.plusDays(1).atStartOfDay())
                val zone = ZoneId.systemDefault()
                val all = c.aggregate(AggregateRequest(setOf(StepsRecord.COUNT_TOTAL), range))
                val sources = JSArray()
                var used: String? = null; var best = -1L
                for (o in all.dataOrigins.sortedBy { it.packageName }) {
                    val t = c.readRecords(ReadRecordsRequest(StepsRecord::class, range, dataOriginFilter = setOf(o), pageSize = 1)).records.firstOrNull()?.metadata?.device?.type
                    val band = isBand(o.packageName, t)
                    // a band's count as Motus uses it: its records added up (ownDays; from the day before, so a record
                    // across midnight adds its share); other apps' as Health Connect counts them
                    val n = if (band) {
                        val days = mutableMapOf<LocalDate, Double>()
                        ownDays(c, StepsRecord::class, TimeRangeFilter.between(date.minusDays(1).atStartOfDay(), date.plusDays(1).atStartOfDay()), o, zone, STEPS_PIECE, days)
                        Math.round(days[date] ?: 0.0)
                    } else c.aggregate(AggregateRequest(setOf(StepsRecord.COUNT_TOTAL), range, setOf(o)))[StepsRecord.COUNT_TOTAL] ?: 0L
                    if (band && n > 0 && n > best) { best = n; used = o.packageName }
                    val s = JSObject().put("app", o.packageName).put("steps", n).put("band", band).put("device", deviceName(t))
                        .put("phone", !band && (phoneApp(o.packageName) || t == Device.TYPE_PHONE))
                    appLabel(o.packageName)?.let { s.put("label", it) }
                    sources.put(s)
                }
                val out = JSObject().put("date", date.toString()).put("total", all[StepsRecord.COUNT_TOTAL] ?: 0L).put("sources", sources)
                    .put("phoneName", phoneName())
                out.put("used", used ?: JSONObject.NULL)
                call.resolve(out)
            } catch (e: Exception) { call.reject(e.message ?: "Health Connect could not be read") }
        }
    }

    /**
     * Where an activity's steps came from (the activity's ⋮ → Step sources): each app's steps in Health Connect for
     * { start, end } (ISO times), read as readRanges reads them (spanByApp, bestBand), so the sheet shows what Motus went by.
     * { phoneName, used: the worn device's app readRanges takes, or null, sources: [{ app, label?, steps, band, phone,
     *   device: "band" | "watch" | "phone" | "unknown" | ..., deviceName?, covered, heartRate: it measured heart rate then,
     *   why?: why it isn't covered (coverage: "after" or "before") }] }
     */
    @PluginMethod
    fun activitySources(call: PluginCall) {
        if (sdk() != HealthConnectClient.SDK_AVAILABLE) { call.reject("Health Connect is not available"); return }
        val (start, end) = try { Instant.parse(call.getString("start")) to Instant.parse(call.getString("end")) } catch (e: Exception) { call.reject("Pick a time"); return }
        scope.launch {
            try {
                val c = client()
                if (perm(StepsRecord::class) !in c.permissionController.getGrantedPermissions()) { call.reject("Motus may not read steps"); return@launch }
                val hasHr = perm(HeartRateRecord::class) in c.permissionController.getGrantedPermissions()
                val spans = if (end.isAfter(start)) spanByApp(c, start, end, true, hasHr) else emptyList()
                val best = bestBand(spans)
                val sources = JSArray()
                for (sp in spans.sortedBy { it.app }) {
                    val d = sp.device
                    val o = JSObject().put("app", sp.app).put("steps", sp.count ?: 0L).put("band", sp.band).put("device", deviceName(d?.type))
                        .put("phone", !sp.band && (phoneApp(sp.app) || d?.type == Device.TYPE_PHONE)).put("covered", sp.coverage.covered)
                        .put("heartRate", sp.hr.isNotEmpty())
                    if (sp.band) { wornOf(d).name?.let { o.put("deviceName", it) }; sp.coverage.why?.let { o.put("why", it) } }
                    appLabel(sp.app)?.let { o.put("label", it) }
                    sources.put(o)
                }
                val out = JSObject().put("phoneName", phoneName()).put("sources", sources)
                out.put("used", best?.app ?: JSONObject.NULL)
                call.resolve(out)
            } catch (e: Exception) { call.reject(e.message ?: "Health Connect could not be read") }
        }
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
        // each second once, as the server's onePerSecond: two apps writing the same reading (the band's app beside
        // Gadgetbridge) would otherwise weigh it twice in the night's average
        private val seen = HashSet<Long>()
        fun add(ms: Long, bpm: Long) {
            if (!seen.add(Math.floorDiv(ms, 1000L))) return
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
        // each second once, as the server's onePerSecond (two apps writing the same readings)
        private val seen = HashSet<Long>()
        fun add(ms: Long, bpm: Long) {
            if (!seen.add(Math.floorDiv(ms, 1000L))) return
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
        val firstDay = maxOf(from.atZone(zone).toLocalDate(), today.minusDays(399))
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
                        val d = smp.time.atZone(zone).toLocalDate()
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
