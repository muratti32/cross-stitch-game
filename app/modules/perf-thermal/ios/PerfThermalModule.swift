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

    Function("getMemoryFootprint") { () -> [String: Any] in
      var taskInfo = task_vm_info_data_t()
      var count = mach_msg_type_number_t(MemoryLayout<task_vm_info_data_t>.size / MemoryLayout<integer_t>.size)
      let result = withUnsafeMutablePointer(to: &taskInfo) {
        $0.withMemoryRebound(to: integer_t.self, capacity: Int(count)) {
          task_info(mach_task_self_, task_flavor_t(TASK_VM_INFO), $0, &count)
        }
      }

      var residentBytes: Double = 0.0
      var footprintBytes: Double = 0.0
      if result == KERN_SUCCESS {
        residentBytes = Double(taskInfo.resident_size)
        footprintBytes = Double(taskInfo.phys_footprint)
      }

      return [
        "residentBytes": residentBytes,
        "footprintBytes": footprintBytes
      ]
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
