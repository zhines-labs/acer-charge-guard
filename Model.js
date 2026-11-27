// Pure logic for the Acer battery plugin. No QML imports, so the same file
// loads in the shell and under `node --test test/`.

var SYSFS_DIR = "/sys/bus/wmi/drivers/acer-wmi-battery"

// The only files the plugin may ever write as root. Writes are looked up by
// mode name here; nothing outside this map reaches pkexec.
var WRITABLE = {
  health: SYSFS_DIR + "/health_mode",
  calibration: SYSFS_DIR + "/calibration_mode"
}

function readCommand() {
  // grep -H prints "path:value" per file, so one unreadable file (temperature
  // can return EIO, power_now is absent on many Acers) doesn't shift the
  // others. The script is a constant; sh is only here to expand the BAT* glob.
  var files = [WRITABLE.health, WRITABLE.calibration, SYSFS_DIR + "/temperature"].join(" ")
  var bat = "/sys/class/power_supply/BAT*/"
  return ["sh", "-c", "grep -H . " + files + " " + bat + "status " + bat + "current_now "
    + bat + "voltage_now " + bat + "power_now 2>/dev/null; true"]
}

// -1 means "not supported / unknown", matching the driver's own convention.
function parseSysfs(raw) {
  var out = { health: -1, calibration: -1, tempMilli: NaN, loaded: true,
              status: "", currentMicroA: NaN, voltageMicroV: NaN, powerMicroW: NaN }
  var lines = String(raw || "").split("\n")
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i]
    var sep = line.lastIndexOf(":")
    if (sep <= 0) continue
    var name = line.slice(0, sep).split("/").pop()
    if (name === "status") { out.status = line.slice(sep + 1).trim().slice(0, 32); continue }
    var value = parseInt(line.slice(sep + 1).trim(), 10)
    if (!isFinite(value)) continue
    if (name === "health_mode") out.health = value > 0 ? 1 : (value === 0 ? 0 : -1)
    else if (name === "calibration_mode") out.calibration = value > 0 ? 1 : (value === 0 ? 0 : -1)
    else if (name === "temperature" && value > -50000 && value < 150000) out.tempMilli = value
    // Some firmwares report current/power as negative while discharging;
    // direction comes from `status`, so keep magnitudes only. Cap at 500 W.
    else if (name === "current_now" && Math.abs(value) < 1e8) out.currentMicroA = Math.abs(value)
    else if (name === "voltage_now" && value >= 0 && value < 1e8) out.voltageMicroV = value
    else if (name === "power_now" && Math.abs(value) < 5e8) out.powerMicroW = Math.abs(value)
  }
  return out
}

function driverPresent(s) {
  return !!(s && s.loaded && (s.health >= 0 || s.calibration >= 0))
}

function tempCelsius(s) {
  return s && isFinite(s.tempMilli) ? s.tempMilli / 1000 : NaN
}

// Battery power flow in watts. Prefers power_now when the firmware provides
// it; otherwise P = I × V (µA × µV = 1e-12 W). Returns
// { watts, direction: "charging" | "discharging" | "idle" | "unknown" } with
// watts as a positive magnitude (NaN when it can't be computed).
function powerReading(s) {
  var watts = NaN
  if (s && isFinite(s.powerMicroW)) watts = s.powerMicroW / 1e6
  else if (s && isFinite(s.currentMicroA) && isFinite(s.voltageMicroV))
    watts = s.currentMicroA * s.voltageMicroV / 1e12
  var status = s ? s.status : ""
  var direction = "unknown"
  if (status === "Charging") direction = "charging"
  else if (status === "Discharging") direction = "discharging"
  else if (status === "Not charging" || status === "Full") direction = "idle"
  if (direction !== "unknown" && isFinite(watts) && watts < 0.05) direction = "idle"
  return { watts: watts, direction: direction }
}

function barIcon(s) {
  if (!driverPresent(s)) return "󰂑"          // battery-unknown
  if (s.calibration === 1) return "󰑓"        // reload: calibration cycle running
  if (s.health === 1) return "󰌪"             // leaf: charge limit protecting the cell
  return "󰁹"                                 // full battery: no limit
}

// Builds the pkexec argv for a list of {mode, value} writes. All writes go in
// one sh invocation so the user authenticates once. Paths and values are
// whitelisted; the sh script itself is a constant and takes them as $@.
function writeCommand(writes) {
  var args = []
  for (var i = 0; i < writes.length; i++) {
    var path = WRITABLE[writes[i].mode]
    var value = writes[i].value === 1 ? "1" : "0"
    if (!path) return []
    args.push(path, value)
  }
  if (args.length === 0) return []
  var script = 'while [ "$#" -ge 2 ]; do printf "%s\\n" "$2" > "$1" || exit 1; shift 2; done'
  return ["pkexec", "/usr/bin/sh", "-c", script, "acer-charge-guard"].concat(args)
}

// Plan for flipping the 80% charge limit.
// ctx: { health, calibration, onAc }
function planHealth(enable, ctx) {
  if (enable && ctx.calibration === 1)
    return { writes: [], blockedKey: "blocked.healthDuringCalibration" }
  return { writes: [{ mode: "health", value: enable ? 1 : 0 }], blockedKey: "" }
}

// Plan for starting or stopping calibration.
// ctx: { health, calibration, onAc }
// Return { writes: [{mode, value}, ...], blockedKey: "" } where blockedKey is
// an i18n key (see i18n/en.json "blocked.*") explaining a refusal, or "".
function planCalibration(enable, ctx) {
  // TODO(zhines): decide the calibration policy. Questions to answer:
  //   - Starting on battery: the driver README says plug in first. Refuse
  //     (blockedKey: "blocked.calibrationNeedsAc") or allow it anyway?
  //   - Stopping: the driver turns health mode off during calibration and
  //     never turns it back on. Should stopping also write health=1, so the
  //     80% limit comes back automatically?
  // Current default: just do the requested write, nothing else.
  return { writes: [{ mode: "calibration", value: enable ? 1 : 0 }], blockedKey: "" }
}

if (typeof module !== "undefined") {
  module.exports = {
    SYSFS_DIR: SYSFS_DIR,
    readCommand: readCommand,
    parseSysfs: parseSysfs,
    driverPresent: driverPresent,
    tempCelsius: tempCelsius,
    powerReading: powerReading,
    barIcon: barIcon,
    writeCommand: writeCommand,
    planHealth: planHealth,
    planCalibration: planCalibration
  }
}
