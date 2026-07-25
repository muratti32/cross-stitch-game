package expo.modules.perfthermal

import android.app.ActivityManager
import android.content.Context
import android.os.Build
import android.os.PowerManager
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class PerfThermalModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("PerfThermal")

    Function("getThermalState") { ->
      getThermalStateImpl()
    }

    Function("getDeviceProfile") { ->
      getDeviceProfileImpl()
    }

    Function("isThermalSupported") { ->
      isThermalSupportedImpl()
    }
  }

  private val context: Context?
    get() = appContext.reactContext

  private fun getThermalStateImpl(): String {
    val ctx = context ?: return "unsupported"
    if (Build.VERSION.SDK_INT < 29) {
      return "unsupported"
    }
    val powerManager = ctx.getSystemService(Context.POWER_SERVICE) as? PowerManager ?: return "unsupported"
    val status = try {
      powerManager.currentThermalStatus
    } catch (e: Exception) {
      return "unsupported"
    }
    return when (status) {
      PowerManager.THERMAL_STATUS_NONE, PowerManager.THERMAL_STATUS_LIGHT -> "nominal"
      PowerManager.THERMAL_STATUS_MODERATE -> "fair"
      PowerManager.THERMAL_STATUS_SEVERE -> "serious"
      PowerManager.THERMAL_STATUS_CRITICAL, PowerManager.THERMAL_STATUS_EMERGENCY, PowerManager.THERMAL_STATUS_SHUTDOWN -> "critical"
      else -> "unsupported"
    }
  }

  private fun isThermalSupportedImpl(): Boolean {
    if (Build.VERSION.SDK_INT < 29) {
      return false
    }
    val ctx = context ?: return false
    val powerManager = ctx.getSystemService(Context.POWER_SERVICE) as? PowerManager ?: return false
    return try {
      powerManager.currentThermalStatus >= 0
    } catch (e: Exception) {
      false
    }
  }

  private fun getDeviceProfileImpl(): Map<String, Any> {
    val ctx = context
    val osVersion = Build.VERSION.RELEASE ?: "unknown"
    val model = "${Build.MANUFACTURER} ${Build.MODEL}"
    
    var totalMemoryBytes: Long = 0
    if (ctx != null) {
      val activityManager = ctx.getSystemService(Context.ACTIVITY_SERVICE) as? ActivityManager
      if (activityManager != null) {
        val memoryInfo = ActivityManager.MemoryInfo()
        try {
          activityManager.getMemoryInfo(memoryInfo)
          totalMemoryBytes = memoryInfo.totalMem
        } catch (e: Exception) {
          // ignore
        }
      }
    }

    val isEmulator = checkIsEmulator()

    return mapOf(
      "platform" to "android",
      "osVersion" to osVersion,
      "model" to model,
      "totalMemoryBytes" to totalMemoryBytes,
      "isEmulator" to isEmulator
    )
  }

  private fun checkIsEmulator(): Boolean {
    val fingerprint = Build.FINGERPRINT ?: ""
    val model = Build.MODEL ?: ""
    val product = Build.PRODUCT ?: ""
    val manufacturer = Build.MANUFACTURER ?: ""
    val hardware = Build.HARDWARE ?: ""
    val brand = Build.BRAND ?: ""
    val device = Build.DEVICE ?: ""

    return (fingerprint.startsWith("generic")
        || fingerprint.startsWith("unknown")
        || model.contains("google_sdk")
        || model.contains("Emulator")
        || model.contains("Android SDK built for x86")
        || manufacturer.contains("Genymotion")
        || brand.startsWith("generic") && device.startsWith("generic")
        || "google_sdk" == product
        || hardware.contains("goldfish")
        || hardware.contains("ranchu")
        || product.contains("sdk_gphone")
        || product.contains("emulator"))
  }
}
