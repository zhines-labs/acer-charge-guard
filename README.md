# Acer Charge Guard

An Omarchy plugin to protect your Acer laptop battery. Website: https://zhines-labs.github.io/acer-charge-guard/

A bar widget for the [Omarchy](https://omarchy.org) shell that controls the
[acer-wmi-battery](https://github.com/frederik-h/acer-wmi-battery) kernel driver
on Acer laptops.

- **Charge limit (health mode).** Stops charging at 80% to slow battery wear.
- **Calibration mode.** Charges to 100%, discharges, then recharges, so the
  battery gauge reads accurately again.
- **Live stats.** Battery temperature, power flow in watts (+ while charging,
  − while discharging), and whether you're plugged in.

The bar icon shows the current state at a glance:

| Icon | Meaning |
|------|---------|
| 󰌪 | 80% limit on |
| 󰁹 | No limit, charging to 100% |
| 󰑓 | Calibration running |
| 󰂑 | Driver not loaded |

## Requirements

- Omarchy with shell plugin support
- An Acer laptop with the `acer-wmi-battery` driver loaded
  (`/sys/bus/wmi/drivers/acer-wmi-battery` must exist)
- `pkexec` (polkit). Changing a mode writes to sysfs as root, so you'll get an
  authentication prompt.

## Install

1. Install and load the driver (AUR):

   ```bash
   yay -S acer-wmi-battery-dkms
   sudo modprobe acer-wmi-battery
   ```

2. Add the plugin:

   ```bash
   omarchy plugin add https://github.com/zhines-labs/acer-charge-guard --enable
   ```

3. Add the **Acer Charge Guard** widget to your bar from the Omarchy shell
   settings (category *System*).

### Install from a clone (for development)

```bash
git clone https://github.com/zhines-labs/acer-charge-guard ~/Work/acer-charge-guard
ln -s ~/Work/acer-charge-guard ~/.config/omarchy/plugins/io.github.zhines-labs.acer-charge-guard
```

## Keybindings and scripts

Every action can be called over IPC:

```bash
omarchy-shell io.github.zhines-labs.acer-charge-guard toggleHealth
```

| Method | What it does |
|--------|--------------|
| `toggleHealth` | Turn the 80% limit on or off |
| `toggleCalibration` | Start or stop calibration |
| `toggle` / `open` / `close` | Show or hide the panel |

## How it works

- `Model.js` holds all the logic and has no QML imports, so it runs in the
  shell and under Node for tests.
- State is read with one `grep -H` over the driver's sysfs files and
  `/sys/class/power_supply/BAT*`. A missing or unreadable file (for example
  `power_now`, which many Acers don't have) doesn't break the other values.
- Power uses `power_now` when the firmware provides it, otherwise
  current × voltage.
- Writes go through `pkexec` with a fixed shell script. Only `health_mode` and
  `calibration_mode` can be written, and only the values `0` or `1`.
- The limit can't be turned back on while calibration is running.

## Development

```bash
node --test test/
```

User-facing strings are in `i18n/en.json`.

## License

MIT. See [LICENSE](LICENSE).

Not affiliated with Acer Inc. "Acer" is used only to say which laptops this works with.
