import { environment, LaunchType, LocalStorage, showHUD, showToast, Toast, updateCommandMetadata } from "@raycast/api";
import { spawn } from "node:child_process";
import { setTimeout } from "node:timers/promises";

const BINARY_PATH = "/Applications/VirtualHereUniversal.app/Contents/MacOS/VirtualHereUniversal";

export default async function main() {
  await run(environment.launchType);
}

async function run(launchType: LaunchType) {
  const device = await getDevice();

  const previousState = await LocalStorage.getItem<State>("state");
  const currentState = device.state;

  if (previousState !== currentState) {
    await LocalStorage.setItem("state", currentState);
    await showHUD(`Wooting 60HE+ ${currentState.toLowerCase()}`);
    await updateCommandMetadata({ subtitle: capitalize(currentState) });
  }

  if (launchType == LaunchType.Background) return;

  if (currentState === State.Unavailable) return;

  const nextState = currentState === State.Connected ? State.Disconnected : State.Connected;
  const command = nextState === State.Connected ? "USE" : "STOP USING";
  await runVirtualHereCommand(`${command},${device.address}`);
  await showToast({
    title: `${nextState === State.Connected ? "Connecting Wooting 60HE+..." : "Disconnecting Wooting 60HE+..."}`,
    style: Toast.Style.Animated,
  });

  await setTimeout(1000);

  await run(LaunchType.Background);
}

const State = {
  Unavailable: "UNAVAILABLE",
  Connected: "CONNECTED",
  Disconnected: "DISCONNECTED",
};

type State = (typeof State)[keyof typeof State];

type Device =
  | {
      address: string;
      state: "CONNECTED" | "DISCONNECTED";
    }
  | {
      address: null;
      state: "UNAVAILABLE";
    };

async function runShellScript(command: string, args: string[]) {
  return new Promise<string>((resolve) => {
    let output = "";
    const process = spawn(command, args);
    process.stdout.on("data", (data) => (output += data));
    process.stderr.on("data", (data) => (output += data));
    process.on("close", () => resolve(output));
  });
}

async function runVirtualHereCommand(command: string) {
  const output = await runShellScript(BINARY_PATH, ["-t", command]);
  return output.trim();
}

async function getDevice(): Promise<Device> {
  const result = await tryUntil(
    () => runVirtualHereCommand("LIST"),
    (result) =>
      result.startsWith("VirtualHere Client IPC") && result.endsWith("VirtualHere Client is running as a service"),
    "Failed to get device list via VirtualHere Client",
  );

  if (!result) {
    return {
      address: null,
      state: "UNAVAILABLE",
    };
  }

  const line =
    result
      .split("\n")
      .find((line) => line.includes("Wooting 60HE+"))
      ?.trim() ?? "";

  const address = line.match(/\(([^)]+)\)/)?.at(1);
  const isConnected = line.includes("In-use by you");

  if (!address) {
    return {
      address: null,
      state: "UNAVAILABLE",
    };
  }

  return {
    address,
    state: isConnected ? "CONNECTED" : "DISCONNECTED",
  };
}

async function tryUntil<T>(
  fn: () => Promise<T>,
  condition: (result: T) => boolean,
  errorMessage: string,
): Promise<T | null> {
  let retries = 0;
  let result = await fn();
  while (!condition(result) && retries < 5) {
    await setTimeout(1000);
    result = await fn();
    retries++;
  }
  if (retries >= 5 && !condition(result)) {
    await showToast({
      title: errorMessage,
      style: Toast.Style.Failure,
    });
    return null;
  }
  return result;
}

function capitalize(string: string): string {
  return string.charAt(0).toUpperCase() + string.slice(1).toLowerCase();
}
