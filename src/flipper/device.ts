import { flipperClient } from "./client.js";
import { debug } from "../utils/logger.js";

interface DeviceDescription {
  serial: string;
  title: string;
  os: string;
  deviceType: string;
  connected: boolean;
}

/**
 * Resolves the device serial to use. If a serial is provided, validates it.
 * Otherwise returns the first connected physical device, falling back to emulators.
 */
export async function resolveSerial(serial?: string): Promise<string> {
  const devices = (await flipperClient.exec("device-list", [])) as DeviceDescription[];

  if (!Array.isArray(devices) || devices.length === 0) {
    throw new Error("No devices connected to Flipper");
  }

  debug(`[Device] Available devices: ${devices.map((d) => `${d.serial} (${d.deviceType})`).join(", ")}`);

  if (serial) {
    const found = devices.find((d) => d.serial === serial);
    if (!found) {
      throw new Error(
        `Device '${serial}' not found. Available: ${devices.map((d) => d.serial).join(", ")}`,
      );
    }
    return serial;
  }

  const physical = devices.find((d) => d.deviceType === "physical");
  if (physical) return physical.serial;

  return devices[0].serial;
}
