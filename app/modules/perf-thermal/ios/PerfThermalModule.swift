import ExpoModulesCore
import UIKit
import Foundation

public class PerfThermalModule: Module {
  public func definition() -> ModuleDefinition {
    Name("PerfThermal")

    Function("getThermalState") { () -> String in
      let state = ProcessInfo.processInfo.thermalState
      switch state {
      case .nominal:
        return "nominal"
      case .fair:
        return "fair"
      case .serious:
        return "serious"
      case .critical:
        return "critical"
      default:
        return "unsupported"
      }
    }

    Function("getDeviceProfile") { () -> [String: Any] in
      let osVersion = UIDevice.current.systemVersion
      var isEmulator = false
      #if targetEnvironment(simulator)
      isEmulator = true
      #endif

      let model = self.getDeviceModel()
      let totalMemoryBytes = ProcessInfo.processInfo.physicalMemory

      return [
        "platform": "ios",
        "osVersion": osVersion,
        "model": model,
        "totalMemoryBytes": Double(totalMemoryBytes),
        "isEmulator": isEmulator
      ]
    }

    Function("isThermalSupported") { () -> Bool in
      return true
    }
  }

  private func getDeviceModel() -> String {
    var systemInfo = utsname()
    uname(&systemInfo)
    let machineMirror = Mirror(reflecting: systemInfo.machine)
    let identifier = machineMirror.children.reduce("") { identifier, element in
      guard let value = element.value as? Int8, value != 0 else { return identifier }
      return identifier + String(UnicodeScalar(UInt8(value)))
    }
    return identifier
  }
}
