import { flipperClient } from "./client.js";
import { debug } from "../utils/logger.js";

interface DeviceDescription {
  serial: string;
  title: string;
  os: string;
  deviceType: string;
  connected: boolean;
}

interface ClientDescription {
  id: string;
  query: {
    app: string;
    device_id: string;
    os: string;
    sdk_version?: number;
  };
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

/**
 * Resolves the client ID for a connected app. Returns the first client found,
 * or filters by app name if provided.
 */
export async function resolveClientId(appName?: string): Promise<string> {
  const clients = (await flipperClient.exec("client-list", [])) as ClientDescription[];

  if (!Array.isArray(clients) || clients.length === 0) {
    throw new Error("No app clients connected to Flipper");
  }

  debug(`[Device] Available clients: ${clients.map((c) => `${c.id} (${c.query.app})`).join(", ")}`);

  if (appName) {
    const found = clients.find((c) =>
      c.query.app.toLowerCase().includes(appName.toLowerCase()),
    );
    if (!found) {
      throw new Error(
        `App '${appName}' not found. Available: ${clients.map((c) => c.query.app).join(", ")}`,
      );
    }
    return found.id;
  }

  return clients[0].id;
}
