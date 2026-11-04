package com.smartshield.app.plugins;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;
import android.os.IBinder;
import android.os.PowerManager;

import androidx.core.app.NotificationCompat;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.Date;
import java.util.List;
import java.util.Locale;
import java.util.TimeZone;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;

/**
 * Background engine. Keeps running when the app window is closed and, using
 * the signed-in user's Firebase token, it:
 *
 *   1. every 15 s   - runs pending admin commands (start/stop Focus Mode,
 *                     sync now) natively,
 *   2. every 60 s   - reports "connected" + Focus Mode state + permissions,
 *   3. every 5 min  - uploads today's screen time and per-app usage,
 *
 * all through the Firestore REST API (no WebView needed).
 */
public class SyncService extends Service {

    // ---- Shared with BackgroundSyncPlugin and BootReceiver ----
    static final String PREFS = "smartshield_background_sync";
    static final String KEY_ENABLED = "enabled";
    static final String KEY_DEVICE_ID = "deviceId";
    static final String KEY_PROJECT_ID = "projectId";
    static final String KEY_API_KEY = "apiKey";
    static final String KEY_REFRESH_TOKEN = "refreshToken";
    static final String KEY_LAST_ATTEMPT = "lastAttemptAt";
    static final String KEY_LAST_SUCCESS = "lastSuccessAt";
    static final String KEY_LAST_ERROR = "lastError";
    static final String KEY_LAST_USAGE = "lastUsageAt";
    static final String KEY_LAST_COMMAND = "lastCommand";

    static volatile boolean running = false;

    private static final String CHANNEL_ID = "smartshield_background_sync";
    private static final int NOTIFICATION_ID = 4102;

    // ForegroundServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE (API 34)
    private static final int FGS_TYPE_SPECIAL_USE = 0x40000000;

    private static final long TICK_SECONDS = 15;
    private static final int HEARTBEAT_EVERY_TICKS = 4;   // 60 s
    private static final int USAGE_EVERY_TICKS = 20;      // 5 min
    private static final int TOP_APPS = 10;

    private static final long COMMAND_TTL_MS = 10 * 60 * 1000L;
    private static final long TOKEN_MARGIN_MS = 5 * 60 * 1000L;

    // Keeps the CPU awake so the timer is not frozen in deep sleep.
    // Uses more battery. Set to false if battery use is a concern.
    private static final boolean USE_WAKE_LOCK = true;

    private ScheduledExecutorService executor;
    private PowerManager.WakeLock wakeLock;

    private String idToken;
    private long idTokenExpiresAt = 0;
    private int tickCount = 0;

    private FocusModePlugin focusController;
    private UsageStatsPlugin usageCollector;

    // =========================================================
    // START / STOP HELPERS
    // =========================================================

    static SharedPreferences prefs(Context context) {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    static void start(Context context) {
        Intent intent = new Intent(context, SyncService.class);

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            context.startForegroundService(intent);
        } else {
            context.startService(intent);
        }
    }

    static void stop(Context context) {
        context.stopService(new Intent(context, SyncService.class));
    }

    // =========================================================
    // LIFECYCLE
    // =========================================================

    @Override
    public void onCreate() {
        super.onCreate();

        createNotificationChannel();
        startForegroundCompat(buildNotification());

        focusController = FocusModePlugin.forService(this);
        usageCollector = UsageStatsPlugin.forService(this);

        if (USE_WAKE_LOCK) {
            PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);

            if (pm != null) {
                wakeLock = pm.newWakeLock(
                        PowerManager.PARTIAL_WAKE_LOCK,
                        "SmartShield:BackgroundSync"
                );
                wakeLock.setReferenceCounted(false);
                wakeLock.acquire();
            }
        }

        running = true;
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        SharedPreferences prefs = prefs(this);

        boolean enabled = prefs.getBoolean(KEY_ENABLED, false);
        boolean configured =
                !prefs.getString(KEY_DEVICE_ID, "").isEmpty()
                        && !prefs.getString(KEY_PROJECT_ID, "").isEmpty()
                        && !prefs.getString(KEY_API_KEY, "").isEmpty()
                        && !prefs.getString(KEY_REFRESH_TOKEN, "").isEmpty();

        if (!enabled || !configured) {
            stopSelf();
            return START_NOT_STICKY;
        }

        if (executor == null) {
            executor = Executors.newSingleThreadScheduledExecutor();
            executor.scheduleWithFixedDelay(
                    this::tick,
                    0,
                    TICK_SECONDS,
                    TimeUnit.SECONDS
            );
        }

        return START_STICKY;
    }

    @Override
    public void onDestroy() {
        running = false;

        if (executor != null) {
            executor.shutdownNow();
            executor = null;
        }

        if (wakeLock != null && wakeLock.isHeld()) {
            wakeLock.release();
        }

        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    // =========================================================
    // MAIN LOOP
    // =========================================================

    private void tick() {
        SharedPreferences prefs = prefs(this);

        prefs.edit()
                .putLong(KEY_LAST_ATTEMPT, System.currentTimeMillis())
                .apply();

        try {
            String deviceId = prefs.getString(KEY_DEVICE_ID, "");
            String projectId = prefs.getString(KEY_PROJECT_ID, "");

            if (deviceId.isEmpty() || projectId.isEmpty()) {
                throw new IllegalStateException("Missing device configuration.");
            }

            boolean heartbeatDue = tickCount % HEARTBEAT_EVERY_TICKS == 0;
            boolean usageDue = tickCount % USAGE_EVERY_TICKS == 0;
            tickCount++;

            String token = getIdToken(prefs);

            // 1. Admin commands (every tick).
            CommandOutcome outcome = processPendingCommands(projectId, deviceId, token);

            // 2. Status + usage.
            if (heartbeatDue || usageDue || outcome.handledAny) {
                boolean includeUsage = usageDue || outcome.wantsUsage;

                sendStatus(projectId, deviceId, token, includeUsage);

                if (includeUsage) {
                    prefs.edit()
                            .putLong(KEY_LAST_USAGE, System.currentTimeMillis())
                            .apply();
                }
            }

            prefs.edit()
                    .putLong(KEY_LAST_SUCCESS, System.currentTimeMillis())
                    .putString(KEY_LAST_ERROR, "")
                    .apply();

        } catch (Throwable error) {
            if (error instanceof HttpException
                    && ((HttpException) error).code == 401) {
                idToken = null;
            }

            prefs.edit()
                    .putString(
                            KEY_LAST_ERROR,
                            error.getClass().getSimpleName() + ": " + error.getMessage()
                    )
                    .apply();
        }
    }

    // =========================================================
    // TOKEN
    // =========================================================

    private String getIdToken(SharedPreferences prefs) throws Exception {
        long now = System.currentTimeMillis();

        if (idToken != null && now < idTokenExpiresAt - TOKEN_MARGIN_MS) {
            return idToken;
        }

        String apiKey = prefs.getString(KEY_API_KEY, "");
        String refreshToken = prefs.getString(KEY_REFRESH_TOKEN, "");

        if (apiKey.isEmpty() || refreshToken.isEmpty()) {
            throw new IllegalStateException(
                    "No sign-in token. Open Smart Shield once while signed in."
            );
        }

        String body = "grant_type=refresh_token&refresh_token="
                + URLEncoder.encode(refreshToken, "UTF-8");

        String response = post(
                "https://securetoken.googleapis.com/v1/token?key="
                        + URLEncoder.encode(apiKey, "UTF-8"),
                body,
                "application/x-www-form-urlencoded",
                null
        );

        JSONObject json = new JSONObject(response);

        idToken = json.getString("id_token");

        long expiresInSeconds = Long.parseLong(json.optString("expires_in", "3600"));
        idTokenExpiresAt = now + expiresInSeconds * 1000L;

        String newRefreshToken = json.optString("refresh_token", "");

        if (!newRefreshToken.isEmpty() && !newRefreshToken.equals(refreshToken)) {
            prefs.edit().putString(KEY_REFRESH_TOKEN, newRefreshToken).apply();
        }

        return idToken;
    }

    // =========================================================
    // STATUS + USAGE  ->  devices/{deviceId}
    // =========================================================

    private void sendStatus(
            String projectId,
            String deviceId,
            String token,
            boolean includeUsage
    ) throws Exception {
        JSONObject fields = new JSONObject();
        JSONArray mask = new JSONArray();

        fields.put("status", str("connected"));
        mask.put("status");

        JSONObject permissions = focusController.permissionsForService();
        boolean usageAccess = permissions.optBoolean("usageAccess", false);

        fields.put("permissions", map(new JSONObject()
                .put("usageAccess", bool(usageAccess))
                .put("overlay", bool(permissions.optBoolean("overlay", false)))));
        mask.put("permissions");

        JSONObject focus = focusController.focusStateForService();

        fields.put("focus", map(new JSONObject()
                .put("active", bool(focus.optBoolean("active", false)))
                .put("adminControlled", bool(focus.optBoolean("adminControlled", false)))
                .put("startTime", integer(focus.optLong("startTime", 0L)))
                .put("endTime", integer(focus.optLong("endTime", 0L)))
                .put("blockedAttempts", integer(focus.optLong("blockedAttempts", 0L)))
                .put("packageCount", integer(focus.optLong("packageCount", 0L)))));
        mask.put("focus");

        if (includeUsage && usageAccess) {
            JSONObject usageSummary = buildUsageSummary();

            if (usageSummary != null) {
                fields.put("usageSummary", usageSummary);
                mask.put("usageSummary");
            }
        }

        commitUpdate(
                projectId,
                token,
                documentName(projectId, "devices/" + deviceId),
                fields,
                mask,
                new String[]{"lastSyncAt"},
                new JSONObject().put("exists", true)
        );
    }

    private JSONObject buildUsageSummary() {
        try {
            JSONObject usage = usageCollector.summaryForService();

            if (usage == null) {
                return null;
            }

            JSONArray apps = usage.optJSONArray("apps");
            JSONArray values = new JSONArray();

            int count = apps == null ? 0 : apps.length();

            for (int i = 0; i < count && i < TOP_APPS; i++) {
                JSONObject app = apps.getJSONObject(i);

                String packageName = app.optString("packageName", "");
                String appName = app.optString("appName", packageName);

                values.put(map(new JSONObject()
                        .put("appName", str(appName))
                        .put("packageName", str(packageName))
                        .put("timeMs", integer(app.optLong("totalTimeInForeground", 0L)))));
            }

            return map(new JSONObject()
                    .put("totalScreenTime", integer(usage.optLong("totalScreenTime", 0L)))
                    .put("appCount", integer(count))
                    .put("apps", new JSONObject()
                            .put("arrayValue", new JSONObject().put("values", values)))
                    .put("updatedAt", timestamp(System.currentTimeMillis())));

        } catch (Exception error) {
            return null;
        }
    }

    // =========================================================
    // ADMIN COMMANDS  ->  devices/{deviceId}/commands
    // =========================================================

    private static class CommandOutcome {
        boolean handledAny = false;
        boolean wantsUsage = false;
    }

    private static class PendingCommand {
        String name;
        String updateTime;
        String type;
        JSONObject payloadFields;
        long createdMs;
    }

    private CommandOutcome processPendingCommands(
            String projectId,
            String deviceId,
            String token
    ) throws Exception {
        CommandOutcome outcome = new CommandOutcome();

        List<PendingCommand> pending = fetchPendingCommands(projectId, deviceId, token);

        for (PendingCommand command : pending) {
            try {
                runCommand(projectId, token, command, outcome);
            } catch (Exception error) {
                // Never let one bad command stop the others.
                try {
                    finishCommand(
                            projectId, token, command.name, false,
                            "Command failed: " + error.getMessage()
                    );
                } catch (Exception ignored) {
                    // Next tick will see it again if it is still pending.
                }
            }
        }

        return outcome;
    }

    private List<PendingCommand> fetchPendingCommands(
            String projectId,
            String deviceId,
            String token
    ) throws Exception {
        JSONObject filter = new JSONObject()
                .put("fieldFilter", new JSONObject()
                        .put("field", new JSONObject().put("fieldPath", "status"))
                        .put("op", "EQUAL")
                        .put("value", str("pending")));

        JSONObject query = new JSONObject()
                .put("from", new JSONArray()
                        .put(new JSONObject().put("collectionId", "commands")))
                .put("where", filter)
                .put("limit", 10);

        String response = post(
                "https://firestore.googleapis.com/v1/projects/" + projectId
                        + "/databases/(default)/documents/devices/" + deviceId
                        + ":runQuery",
                new JSONObject().put("structuredQuery", query).toString(),
                "application/json",
                token
        );

        List<PendingCommand> result = new ArrayList<>();
        JSONArray rows = new JSONArray(response);

        for (int i = 0; i < rows.length(); i++) {
            JSONObject document = rows.getJSONObject(i).optJSONObject("document");

            if (document == null) {
                continue;
            }

            JSONObject fields = document.optJSONObject("fields");

            if (fields == null) {
                continue;
            }

            PendingCommand command = new PendingCommand();
            command.name = document.optString("name", "");
            command.updateTime = document.optString("updateTime", "");
            command.type = stringField(fields, "type");
            command.createdMs = parseIso(timestampField(fields, "createdAt"));

            JSONObject payload = fields.optJSONObject("payload");
            command.payloadFields = payload == null
                    ? new JSONObject()
                    : payload.optJSONObject("mapValue") == null
                    ? new JSONObject()
                    : payload.getJSONObject("mapValue").optJSONObject("fields");

            if (command.payloadFields == null) {
                command.payloadFields = new JSONObject();
            }

            if (!command.name.isEmpty()) {
                result.add(command);
            }
        }

        Collections.sort(result, new Comparator<PendingCommand>() {
            @Override
            public int compare(PendingCommand a, PendingCommand b) {
                return Long.compare(a.createdMs, b.createdMs);
            }
        });

        return result;
    }

    private void runCommand(
            String projectId,
            String token,
            PendingCommand command,
            CommandOutcome outcome
    ) throws Exception {
        long now = System.currentTimeMillis();
        long created = command.createdMs > 0 ? command.createdMs : now;

        if (now - created > COMMAND_TTL_MS) {
            commitUpdate(
                    projectId,
                    token,
                    command.name,
                    new JSONObject()
                            .put("status", str("expired"))
                            .put("result", map(new JSONObject().put(
                                    "error",
                                    str("Command expired because the device was offline."))))
                    ,
                    new JSONArray().put("status").put("result"),
                    new String[]{"completedAt"},
                    null
            );
            return;
        }

        // Claim the command. If the app (or another run) claimed it first,
        // the precondition fails and we simply skip it.
        try {
            commitUpdate(
                    projectId,
                    token,
                    command.name,
                    new JSONObject().put("status", str("processing")),
                    new JSONArray().put("status"),
                    new String[]{"startedAt"},
                    new JSONObject().put("updateTime", command.updateTime)
            );
        } catch (HttpException error) {
            if (error.code == 400 || error.code == 409 || error.code == 412) {
                return;
            }
            throw error;
        }

        outcome.handledAny = true;

        String problem;

        switch (command.type) {
            case "START_FOCUS": {
                JSONArray packages = new JSONArray();
                JSONObject packageField = command.payloadFields.optJSONObject("packages");

                if (packageField != null && packageField.optJSONObject("arrayValue") != null) {
                    JSONArray values = packageField
                            .getJSONObject("arrayValue")
                            .optJSONArray("values");

                    if (values != null) {
                        for (int i = 0; i < values.length(); i++) {
                            packages.put(values.getJSONObject(i).optString("stringValue", ""));
                        }
                    }
                }

                long minutes = numberField(command.payloadFields, "durationMinutes");

                if (packages.length() == 0) {
                    problem = "Select at least one application.";
                } else if (minutes < 1 || minutes > 1440) {
                    problem = "Duration must be between 1 and 1440 minutes.";
                } else {
                    problem = focusController.startAdminSessionFromService(
                            packages, minutes * 60L * 1000L);
                }
                break;
            }

            case "STOP_FOCUS":
                problem = focusController.stopAdminSessionFromService();
                break;

            case "SYNC_NOW":
                outcome.wantsUsage = true;
                problem = null;
                break;

            default:
                problem = "Unsupported command: " + command.type;
        }

        prefs(this).edit()
                .putString(KEY_LAST_COMMAND,
                        command.type + (problem == null ? " ok" : " failed: " + problem))
                .apply();

        finishCommand(projectId, token, command.name, problem == null, problem);
    }

    private void finishCommand(
            String projectId,
            String token,
            String commandName,
            boolean success,
            String error
    ) throws Exception {
        JSONObject result = new JSONObject();

        if (success) {
            result.put("message", str("Command executed successfully."));
        } else {
            result.put("error", str(error == null ? "Command failed." : error));
        }

        commitUpdate(
                projectId,
                token,
                commandName,
                new JSONObject()
                        .put("status", str(success ? "completed" : "failed"))
                        .put("result", map(result)),
                new JSONArray().put("status").put("result"),
                new String[]{"completedAt"},
                null
        );
    }

    // =========================================================
    // FIRESTORE REST HELPERS
    // =========================================================

    private static String documentName(String projectId, String path) {
        return "projects/" + projectId + "/databases/(default)/documents/" + path;
    }

    private void commitUpdate(
            String projectId,
            String token,
            String documentName,
            JSONObject fields,
            JSONArray mask,
            String[] serverTimeFields,
            JSONObject precondition
    ) throws Exception {
        JSONObject write = new JSONObject()
                .put("update", new JSONObject()
                        .put("name", documentName)
                        .put("fields", fields))
                .put("updateMask", new JSONObject().put("fieldPaths", mask));

        if (serverTimeFields != null && serverTimeFields.length > 0) {
            JSONArray transforms = new JSONArray();

            for (String fieldPath : serverTimeFields) {
                transforms.put(new JSONObject()
                        .put("fieldPath", fieldPath)
                        .put("setToServerValue", "REQUEST_TIME"));
            }

            write.put("updateTransforms", transforms);
        }

        if (precondition != null) {
            write.put("currentDocument", precondition);
        }

        post(
                "https://firestore.googleapis.com/v1/projects/" + projectId
                        + "/databases/(default)/documents:commit",
                new JSONObject().put("writes", new JSONArray().put(write)).toString(),
                "application/json",
                token
        );
    }

    private static JSONObject str(String value) throws Exception {
        return new JSONObject().put("stringValue", value == null ? "" : value);
    }

    private static JSONObject bool(boolean value) throws Exception {
        return new JSONObject().put("booleanValue", value);
    }

    private static JSONObject integer(long value) throws Exception {
        return new JSONObject().put("integerValue", String.valueOf(value));
    }

    private static JSONObject timestamp(long millis) throws Exception {
        SimpleDateFormat format =
                new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US);
        format.setTimeZone(TimeZone.getTimeZone("UTC"));

        return new JSONObject().put("timestampValue", format.format(new Date(millis)));
    }

    private static JSONObject map(JSONObject fields) throws Exception {
        return new JSONObject()
                .put("mapValue", new JSONObject().put("fields", fields));
    }

    private static String stringField(JSONObject fields, String key) {
        JSONObject field = fields.optJSONObject(key);
        return field == null ? "" : field.optString("stringValue", "");
    }

    private static String timestampField(JSONObject fields, String key) {
        JSONObject field = fields.optJSONObject(key);
        return field == null ? "" : field.optString("timestampValue", "");
    }

    private static long numberField(JSONObject fields, String key) {
        JSONObject field = fields.optJSONObject(key);

        if (field == null) {
            return 0L;
        }

        if (field.has("integerValue")) {
            try {
                return Long.parseLong(field.optString("integerValue", "0"));
            } catch (NumberFormatException ignored) {
                return 0L;
            }
        }

        return (long) field.optDouble("doubleValue", 0);
    }

    private static long parseIso(String text) {
        try {
            if (text == null || text.isEmpty()) {
                return 0L;
            }

            long millis = 0L;
            String base;
            int dot = text.indexOf('.');

            if (dot > 0) {
                int end = text.indexOf('Z', dot);
                String fraction = text.substring(dot + 1, end > 0 ? end : text.length());
                millis = Long.parseLong((fraction + "000").substring(0, 3));
                base = text.substring(0, dot);
            } else {
                base = text.replace("Z", "");
            }

            SimpleDateFormat format =
                    new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss", Locale.US);
            format.setTimeZone(TimeZone.getTimeZone("UTC"));

            Date date = format.parse(base);

            return date == null ? 0L : date.getTime() + millis;

        } catch (Exception error) {
            return 0L;
        }
    }

    // =========================================================
    // HTTP
    // =========================================================

    private static class HttpException extends Exception {
        final int code;

        HttpException(int code, String message) {
            super("HTTP " + code + " " + message);
            this.code = code;
        }
    }

    private static String post(
            String url,
            String body,
            String contentType,
            String bearerToken
    ) throws Exception {
        HttpURLConnection connection =
                (HttpURLConnection) new URL(url).openConnection();

        try {
            connection.setRequestMethod("POST");
            connection.setConnectTimeout(15000);
            connection.setReadTimeout(15000);
            connection.setDoOutput(true);
            connection.setRequestProperty("Content-Type", contentType);

            if (bearerToken != null) {
                connection.setRequestProperty("Authorization", "Bearer " + bearerToken);
            }

            byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
            connection.setFixedLengthStreamingMode(bytes.length);

            try (OutputStream out = connection.getOutputStream()) {
                out.write(bytes);
            }

            int code = connection.getResponseCode();

            String text = readAll(
                    code >= 400
                            ? connection.getErrorStream()
                            : connection.getInputStream()
            );

            if (code >= 400) {
                String shortText = text.length() > 220 ? text.substring(0, 220) : text;
                throw new HttpException(code, shortText);
            }

            return text;
        } finally {
            connection.disconnect();
        }
    }

    private static String readAll(InputStream stream) throws Exception {
        if (stream == null) return "";

        StringBuilder builder = new StringBuilder();

        try (BufferedReader reader = new BufferedReader(
                new InputStreamReader(stream, StandardCharsets.UTF_8))) {
            String line;

            while ((line = reader.readLine()) != null) {
                builder.append(line);
            }
        }

        return builder.toString();
    }

    // =========================================================
    // NOTIFICATION
    // =========================================================

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            return;
        }

        NotificationManager manager =
                (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);

        if (manager == null) {
            return;
        }

        NotificationChannel channel = new NotificationChannel(
                CHANNEL_ID,
                "Background connection",
                NotificationManager.IMPORTANCE_LOW
        );

        channel.setDescription(
                "Keeps this device connected to Smart Shield in the background."
        );

        manager.createNotificationChannel(channel);
    }

    private Notification buildNotification() {
        PendingIntent contentIntent = null;
        Intent launch = getPackageManager().getLaunchIntentForPackage(getPackageName());

        if (launch != null) {
            contentIntent = PendingIntent.getActivity(
                    this,
                    0,
                    launch,
                    PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
            );
        }

        return new NotificationCompat.Builder(this, CHANNEL_ID)
                .setSmallIcon(android.R.drawable.stat_notify_sync)
                .setContentTitle("Smart Shield is active")
                .setContentText("This device stays connected to your admin.")
                .setOngoing(true)
                .setOnlyAlertOnce(true)
                .setCategory(NotificationCompat.CATEGORY_SERVICE)
                .setContentIntent(contentIntent)
                .build();
    }

    private void startForegroundCompat(Notification notification) {
        if (Build.VERSION.SDK_INT >= 34) {
            startForeground(NOTIFICATION_ID, notification, FGS_TYPE_SPECIAL_USE);
        } else {
            startForeground(NOTIFICATION_ID, notification);
        }
    }
}