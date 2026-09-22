package com.xclaw.app

import android.Manifest
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.PowerManager
import android.provider.Settings
import android.util.Log
import android.view.View
import android.webkit.ConsoleMessage
import android.webkit.JavascriptInterface
import android.webkit.WebChromeClient
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.EditText
import android.widget.ProgressBar
import android.widget.TextView
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.core.app.NotificationCompat

class MainActivity : AppCompatActivity() {

    companion object {
        private const val TAG = "CodexMainActivity"
        private const val REQ_POST_NOTIFICATIONS = 1472
        private const val CHANNEL_UPDATES = "xclaw_updates"
        private const val NOTIFICATION_ID = 2701
    }

    private lateinit var webView: WebView
    private lateinit var loadingOverlay: View
    private lateinit var statusText: TextView
    private lateinit var statusDetail: TextView
    private lateinit var progressBar: ProgressBar
    private lateinit var serverManager: CodexServerManager

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        webView = findViewById(R.id.webView)
        loadingOverlay = findViewById(R.id.loadingOverlay)
        statusText = findViewById(R.id.statusText)
        statusDetail = findViewById(R.id.statusDetail)
        progressBar = findViewById(R.id.progressBar)

        serverManager = CodexServerManager(this)

        requestBatteryOptimizationExemption()
        requestNotificationPermission()
        startForegroundService()
        setupWebView()
        startSetupFlow()
    }

    override fun onDestroy() {
        super.onDestroy()
        serverManager.stopServer()
        stopService(Intent(this, CodexForegroundService::class.java))
    }

    private fun requestNotificationPermission() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            if (checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) !=
                PackageManager.PERMISSION_GRANTED
            ) {
                requestPermissions(
                    arrayOf(Manifest.permission.POST_NOTIFICATIONS),
                    REQ_POST_NOTIFICATIONS,
                )
            }
        }
    }

    private fun requestBatteryOptimizationExemption() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) return
        val pm = getSystemService(PowerManager::class.java) ?: return
        if (pm.isIgnoringBatteryOptimizations(packageName)) return

        try {
            @Suppress("BatteryLife")
            val intent = Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS).apply {
                data = Uri.parse("package:$packageName")
            }
            startActivity(intent)
        } catch (e: Exception) {
            Log.w(TAG, "Could not request battery optimization exemption: ${e.message}")
        }
    }

    private fun startForegroundService() {
        val intent = Intent(this, CodexForegroundService::class.java)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            startForegroundService(intent)
        } else {
            startService(intent)
        }
    }

    @Deprecated("Use onBackPressedDispatcher")
    override fun onBackPressed() {
        if (webView.canGoBack()) {
            webView.goBack()
        } else {
            @Suppress("DEPRECATION")
            super.onBackPressed()
        }
    }

    @android.annotation.SuppressLint("SetJavaScriptEnabled")
    private fun setupWebView() {
        webView.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            databaseEnabled = true
            allowFileAccess = false
            setSupportZoom(false)
        }

        webView.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(
                view: WebView,
                url: String,
            ): Boolean = false
        }

        webView.webChromeClient = object : WebChromeClient() {
            override fun onConsoleMessage(msg: ConsoleMessage): Boolean {
                Log.d(TAG, "[WebView] ${msg.sourceId()}:${msg.lineNumber()} ${msg.message()}")
                return true
            }
        }

        webView.addJavascriptInterface(XclawBridge(), "XclawAndroid")
    }

    inner class XclawBridge {
        @JavascriptInterface
        fun notify(title: String, message: String) {
            postNotification(title, message)
        }
    }

    private fun postNotification(title: String, message: String) {
        val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_UPDATES,
                "تحديثات Xclaw",
                NotificationManager.IMPORTANCE_DEFAULT,
            )
            nm.createNotificationChannel(channel)
        }
        val intent = Intent(this, MainActivity::class.java)
        val pi = PendingIntent.getActivity(
            this,
            0,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        val notif: Notification = NotificationCompat.Builder(this, CHANNEL_UPDATES)
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentTitle(title)
            .setContentText(message)
            .setStyle(NotificationCompat.BigTextStyle().bigText(message))
            .setAutoCancel(true)
            .setContentIntent(pi)
            .build()
        try {
            nm.notify(NOTIFICATION_ID, notif)
        } catch (e: Exception) {
            Log.w(TAG, "Notification failed: ${e.message}")
        }
    }

    private fun startSetupFlow() {
        showLoading(true)
        setStatus("Initializing…")

        Thread {
            try {
                runSetup()
            } catch (e: Exception) {
                Log.e(TAG, "Setup failed", e)
                runOnUiThread {
                    showError(e.message ?: "Unknown error")
                }
            }
        }.start()
    }

    private fun runSetup() {
        // Step 1: Extract bootstrap
        if (!BootstrapInstaller.isBootstrapInstalled(this)) {
            updateStatus("Extracting environment…")
            BootstrapInstaller.install(this) { msg -> updateStatus(msg) }
        }
        updateStatus("Environment ready")

        // Step 1b: Install proot (needed for dpkg/apt-get path remapping)
        if (!serverManager.isProotInstalled()) {
            updateStatus("Installing proot…", "Needed for package management")
            val prootOk = serverManager.installProot { msg -> updateDetail(msg) }
            if (!prootOk) {
                throw RuntimeException("Failed to install proot")
            }
        }
        updateStatus("proot ready")

        // Step 2: Install Node.js
        if (!serverManager.isNodeInstalled()) {
            updateStatus("Installing Node.js (first run)…", "This may take a few minutes")
            val nodeOk = serverManager.installNode { msg -> updateDetail(msg) }
            if (!nodeOk) {
                throw RuntimeException("Failed to install Node.js")
            }
        }
        updateStatus("Node.js ready")

        // Step 2b: Install Python
        if (!serverManager.isPythonInstalled()) {
            updateStatus("Installing Python…")
            val pyOk = serverManager.installPython { msg -> updateDetail(msg) }
            if (!pyOk) {
                Log.w(TAG, "Python install failed — continuing without it")
            }
        }

        // Step 2c: Install bionic-compat.js (Android platform shim for Node.js)
        serverManager.ensureBionicCompat()

        // Step 2d: Install OpenClaw
        if (!serverManager.isOpenClawInstalled()) {
            updateStatus("Installing build dependencies…")
            serverManager.installOpenClawDeps { msg -> updateDetail(msg) }

            updateStatus("Installing OpenClaw…", "This may take several minutes")
            val openclawOk = serverManager.installOpenClaw { msg -> updateDetail(msg) }
            if (!openclawOk) {
                Log.w(TAG, "OpenClaw install failed — continuing without it")
            } else {
                updateStatus("OpenClaw installed")
            }
        }

        // Step 3: Install Codex CLI
        if (!serverManager.isCodexInstalled()) {
            updateStatus("Installing Codex CLI…", "This may take a few minutes")
            val codexOk = serverManager.installCodex { msg -> updateDetail(msg) }
            if (!codexOk) {
                throw RuntimeException("Failed to install Codex")
            }
        }

        // Ensure codex wrapper script exists
        serverManager.ensureCodexWrapperScript()

        // Step 2e: Install OpenCode CLI
        if (!serverManager.isOpenCodeInstalled()) {
            updateStatus("Installing OpenCode…", "This may take a few minutes")
            val ocOk = serverManager.installOpenCode { msg -> updateDetail(msg) }
            if (!ocOk) {
                Log.w(TAG, "OpenCode install failed — continuing without it")
            }
        }

        // Step 2f: Install Claude Code CLI
        if (!serverManager.isClaudeCodeInstalled()) {
            updateStatus("Installing Claude Code…", "This may take a few minutes")
            val ccOk = serverManager.installClaudeCode { msg -> updateDetail(msg) }
            if (!ccOk) {
                Log.w(TAG, "Claude install failed — continuing without it")
            }
        }

        // Step 3a: Extract web UI from APK assets (every launch)
        updateStatus("Updating web UI…")
        serverManager.installServerBundle { msg -> updateDetail(msg) }

        // Step 3b: Install native platform binary
        if (!serverManager.isPlatformBinaryInstalled()) {
            updateStatus("Installing Codex platform binary…")
            val binOk = serverManager.installPlatformBinary { msg -> updateDetail(msg) }
            if (!binOk) {
                throw RuntimeException("Failed to install Codex platform binary")
            }
        }
        updateStatus("Codex ready")

        // Step 3c: Write full-access config and create default workspace
        serverManager.ensureFullAccessConfig()
        serverManager.ensureDefaultWorkspace()

        // Step 4: Start CONNECT proxy (needed for native binary DNS/TLS)
        updateStatus("Starting network proxy…")
        if (!serverManager.startProxy()) {
            throw RuntimeException("Failed to start network proxy")
        }

        // Step 5: Authenticate via `codex login`
        updateStatus("Checking authentication…")
        if (!serverManager.isLoggedIn()) {
            updateStatus("Login required — opening browser…")
            val authOk = serverManager.loginWithUrl(
                onLoginUrl = { url ->
                    runOnUiThread {
                        startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)))
                    }
                },
                onProgress = { msg -> updateDetail(msg) },
            )
            if (!authOk && !serverManager.isLoggedIn()) {
                updateStatus("Browser login failed — enter API key manually")
                val apiKey = requestApiKey()
                if (apiKey.isBlank()) {
                    throw RuntimeException("No API key provided")
                }
                val loginOk = serverManager.loginWithApiKey(apiKey)
                if (!loginOk) {
                    throw RuntimeException("Login failed — check your API key")
                }
            }
        }
        updateStatus("Authenticated")

        // Step 6: Health check
        updateStatus("Verifying API access…", "Sending test message")
        val healthOk = serverManager.healthCheck { msg -> updateDetail(msg) }
        if (!healthOk) {
            throw RuntimeException("API health check failed — Codex could not reach OpenAI")
        }
        updateStatus("API verified")

        // Step 7: Configure and start OpenClaw
        if (serverManager.isOpenClawInstalled()) {
            updateStatus("Configuring OpenClaw…")
            serverManager.configureOpenClawAuth()

            updateStatus("Starting OpenClaw gateway…")
            serverManager.startOpenClawGateway()

            updateStatus("Starting OpenClaw Control UI…")
            serverManager.startOpenClawControlUiServer()
        }

        // Step 8: Start web server
        updateStatus("Starting server…")
        val started = serverManager.startServer()
        if (!started) {
            throw RuntimeException("Failed to start server")
        }

        // Step 9: Wait for ready
        updateStatus("Waiting for server…")
        val ready = serverManager.waitForServer(timeoutMs = 90_000)
        if (!ready) {
            throw RuntimeException("Server did not start in time")
        }

        // Step 10: Start Xclaw gateway + wait
        updateStatus("Starting Xclaw gateway…")
        serverManager.startXclawGateway()
        val gwReady = serverManager.waitForGateway(timeoutMs = 30_000)

        // Step 11: Show web UI (Xclaw gateway if ready, else fall back to codex UI)
        runOnUiThread {
            showLoading(false)
            webView.visibility = View.VISIBLE
            val base = if (gwReady) {
                "http://127.0.0.1:${CodexServerManager.GATEWAY_PORT}/"
            } else {
                "http://127.0.0.1:${CodexServerManager.SERVER_PORT}/"
            }
            webView.loadUrl(base)
        }
    }

    /**
     * Fallback: prompt for API key if browser login fails.
     */
    private fun requestApiKey(): String {
        var result = ""
        val lock = Object()

        runOnUiThread {
            val input = EditText(this).apply {
                hint = getString(R.string.api_key_hint)
                setSingleLine(true)
            }
            val padding = (24 * resources.displayMetrics.density).toInt()
            val container = android.widget.FrameLayout(this).apply {
                setPadding(padding, padding / 2, padding, 0)
                addView(input)
            }

            AlertDialog.Builder(this)
                .setTitle(R.string.api_key_title)
                .setMessage(R.string.api_key_message)
                .setView(container)
                .setCancelable(false)
                .setPositiveButton(R.string.ok) { _, _ ->
                    result = input.text.toString().trim()
                    synchronized(lock) { lock.notifyAll() }
                }
                .setNegativeButton(R.string.cancel) { _, _ ->
                    synchronized(lock) { lock.notifyAll() }
                }
                .show()
        }

        synchronized(lock) {
            lock.wait(300_000)
        }
        return result
    }

    // ── UI helpers ──────────────────────────────────────────────────────────

    private fun showError(message: String) {
        AlertDialog.Builder(this)
            .setTitle(R.string.error_title)
            .setMessage(message)
            .setPositiveButton(R.string.retry) { _, _ ->
                startSetupFlow()
            }
            .setNegativeButton(R.string.cancel) { _, _ ->
                finish()
            }
            .setCancelable(false)
            .show()
    }

    private fun showLoading(show: Boolean) {
        loadingOverlay.visibility = if (show) View.VISIBLE else View.GONE
    }

    private fun setStatus(text: String, detail: String? = null) {
        statusText.text = text
        if (detail != null) {
            statusDetail.text = detail
            statusDetail.visibility = View.VISIBLE
        } else {
            statusDetail.visibility = View.GONE
        }
    }

    private fun updateStatus(text: String, detail: String? = null) {
        runOnUiThread { setStatus(text, detail) }
    }

    private fun updateDetail(text: String) {
        runOnUiThread {
            statusDetail.text = text
            statusDetail.visibility = View.VISIBLE
        }
    }
}
