const test = require("node:test")
const assert = require("node:assert/strict")
const Model = require("../Model.js")

const DIR = Model.SYSFS_DIR

test("parses grep -H output", () => {
  const s = Model.parseSysfs(`${DIR}/health_mode:1\n${DIR}/calibration_mode:0\n${DIR}/temperature:24900\n`)
  assert.equal(s.health, 1)
  assert.equal(s.calibration, 0)
  assert.equal(Model.tempCelsius(s), 24.9)
  assert.ok(Model.driverPresent(s))
})

test("missing temperature does not shift other values", () => {
  const s = Model.parseSysfs(`${DIR}/health_mode:0\n${DIR}/calibration_mode:1\n`)
  assert.equal(s.health, 0)
  assert.equal(s.calibration, 1)
  assert.ok(Number.isNaN(Model.tempCelsius(s)))
})

test("empty output means driver absent", () => {
  assert.equal(Model.driverPresent(Model.parseSysfs("")), false)
  assert.equal(Model.barIcon(Model.parseSysfs("")), "󰂑")
})

test("unsupported (-1) stays -1", () => {
  const s = Model.parseSysfs(`${DIR}/health_mode:-1\n${DIR}/calibration_mode:-1\n`)
  assert.equal(s.health, -1)
  assert.equal(Model.driverPresent(s), false)
})

test("write command only targets whitelisted files", () => {
  assert.deepEqual(Model.writeCommand([{ mode: "evil", value: 1 }]), [])
  assert.deepEqual(Model.writeCommand([]), [])
  const argv = Model.writeCommand([{ mode: "calibration", value: 0 }, { mode: "health", value: 1 }])
  assert.equal(argv[0], "pkexec")
  assert.equal(argv[1], "/usr/bin/sh")
  assert.deepEqual(argv.slice(5), [`${DIR}/calibration_mode`, "0", `${DIR}/health_mode`, "1"])
})

test("non-1 values are coerced to 0", () => {
  const argv = Model.writeCommand([{ mode: "health", value: "1; rm -rf /" }])
  assert.equal(argv[argv.length - 1], "0")
})

test("health limit cannot be re-enabled mid-calibration", () => {
  const plan = Model.planHealth(true, { health: 0, calibration: 1, onAc: true })
  assert.equal(plan.writes.length, 0)
  assert.equal(plan.blockedKey, "blocked.healthDuringCalibration")
})

test("health toggles off normally", () => {
  const plan = Model.planHealth(false, { health: 1, calibration: 0, onAc: true })
  assert.deepEqual(plan.writes, [{ mode: "health", value: 0 }])
})

const BAT = "/sys/class/power_supply/BAT1"

test("watts from current × voltage when power_now is absent", () => {
  const s = Model.parseSysfs(`${BAT}/status:Discharging\n${BAT}/current_now:1000000\n${BAT}/voltage_now:11481000\n`)
  const p = Model.powerReading(s)
  assert.equal(p.direction, "discharging")
  assert.ok(Math.abs(p.watts - 11.481) < 1e-9)
})

test("power_now wins over current × voltage", () => {
  const s = Model.parseSysfs(`${BAT}/status:Charging\n${BAT}/power_now:25000000\n${BAT}/current_now:1\n${BAT}/voltage_now:1\n`)
  assert.deepEqual(Model.powerReading(s), { watts: 25, direction: "charging" })
})

test("negative firmware current is treated as a magnitude", () => {
  const s = Model.parseSysfs(`${BAT}/status:Discharging\n${BAT}/current_now:-2000000\n${BAT}/voltage_now:10000000\n`)
  assert.equal(Model.powerReading(s).watts, 20)
})

test("held at the charge limit reads as idle with 0 W", () => {
  const s = Model.parseSysfs(`${BAT}/status:Not charging\n${BAT}/current_now:0\n${BAT}/voltage_now:11481000\n`)
  assert.deepEqual(Model.powerReading(s), { watts: 0, direction: "idle" })
})

test("no battery data gives NaN, not a fake 0", () => {
  assert.ok(Number.isNaN(Model.powerReading(Model.parseSysfs("")).watts))
})
